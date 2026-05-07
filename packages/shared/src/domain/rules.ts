/**
 * Pure rules engine. Single source of truth for R1–R5 (lifecycle) and
 * C1–C6 (decision checks).
 *
 * No side effects. No I/O. No `Date.now()` calls — all timestamps and
 * generated IDs come in via opts so tests are deterministic.
 *
 * On the corpus accounting model used here:
 * - Trade open debits `entryValue = entryPrice * qty * lotSize` from
 *   `investableCorpus` (handled by the caller, not this engine).
 * - Trade close credits `exitValue = exitPrice * qty * lotSize`. That is
 *   the basic close.
 * - On a SELF_SUSTAINING profitable close (R2): `fees = round(gross *
 *   feePercent)` are debited; the keeper half of `net` stays in the
 *   corpus (already there from the gross return); the other half is
 *   queued as a `PendingWithdrawal` and stays in the corpus until the
 *   user confirms it (D6, R5).
 */

import type {
  Account,
  AccountSnapshot,
  CheckResult,
  DecisionRecord,
  NewTradeInput,
  PendingWithdrawal,
  Trade,
  Verdict,
} from '../types';
import { applyRate } from './money';

// ─── helpers ──────────────────────────────────────────────────────────

function lockFloor(account: Pick<Account, 'principalX'>): number {
  if (account.principalX === null) return 0;
  return Math.floor(account.principalX / 2);
}

function tradeCapital(t: Pick<Trade, 'entryPrice' | 'qty' | 'lotSize'>): number {
  return t.entryPrice * t.qty * t.lotSize;
}

function tradeExitValue(t: Pick<Trade, 'exitPrice' | 'qty' | 'lotSize'>): number {
  if (t.exitPrice === undefined) {
    throw new Error('tradeExitValue: trade has no exitPrice');
  }
  return t.exitPrice * t.qty * t.lotSize;
}

// ─── R1–R3: applyRulesOnClose ─────────────────────────────────────────

export interface CloseOptions {
  /** UUID for the queued PendingWithdrawal if R2 fires. */
  withdrawalId: string;
  /** ISO timestamp for `exitAt` and the withdrawal's `createdAt`. */
  now: string;
}

export interface CloseResult {
  account: Account;
  trade: Trade;
  queuedWithdrawal?: PendingWithdrawal;
  /** Which rules fired during this close. Useful for UI toasts and tests. */
  firedRules: ('R1' | 'R2' | 'R3')[];
}

/**
 * Close a trade and apply R1, R2, R3 in order.
 *
 * Input contract: `trade.status === 'OPEN'` and `trade.exitPrice` is set.
 * `exitAt` will be set to `opts.now` if not already provided.
 *
 * Pure: returns new Account and new Trade objects; does not mutate inputs.
 */
export function applyRulesOnClose(
  account: Account,
  trade: Trade,
  opts: CloseOptions,
): CloseResult {
  if (trade.status !== 'OPEN') {
    throw new Error(`applyRulesOnClose: trade ${trade.id} is not OPEN`);
  }
  if (trade.exitPrice === undefined) {
    throw new Error(`applyRulesOnClose: trade ${trade.id} has no exitPrice`);
  }
  if (account.phase === 'LOCKED') {
    // R3 already fired previously. New trades are blocked at the gate, so
    // this would only happen via a race; close still proceeds, R3 stays.
  }

  const startingPhase = account.phase;
  const exitValue = tradeExitValue(trade);
  const entryValue = tradeCapital(trade);
  const grossPnL = exitValue - entryValue;
  const isProfit = grossPnL > 0;

  const next: Account = { ...account };
  let queuedWithdrawal: PendingWithdrawal | undefined;
  const firedRules: ('R1' | 'R2' | 'R3')[] = [];

  // Basic close: credit exit value back to the corpus.
  next.investableCorpus = account.investableCorpus + exitValue;

  let fees = 0;
  let netPnL = grossPnL;

  // Profit share — applied on EVERY profitable close, regardless of phase.
  // The fee leaves the corpus and accumulates in feesPaid; realizedPnL
  // accumulates the NET (post-share) amount, matching the spec's "cumulative
  // net realizedPnL" wording for the 2X bootstrap goal.
  if (isProfit) {
    fees = applyRate(grossPnL, account.feePercent);
    netPnL = grossPnL - fees;
    next.investableCorpus -= fees;
    next.feesPaid = account.feesPaid + fees;
  }

  next.realizedPnL = account.realizedPnL + netPnL;

  // R2 — SELF_SUSTAINING profitable close also splits half the net into a
  // withdrawal queue. Phase at close-start determines whether R2 applies, so
  // a close that triggers R1 (BOOTSTRAP -> SELF_SUSTAINING) does not also
  // fire R2 on the same close.
  if (isProfit && startingPhase === 'SELF_SUSTAINING') {
    const withdrawAmount = Math.floor(netPnL / 2);
    if (withdrawAmount > 0) {
      queuedWithdrawal = {
        id: opts.withdrawalId,
        amount: withdrawAmount,
        fromTradeId: trade.id,
        source: 'AUTO',
        createdAt: opts.now,
        status: 'PENDING',
      };
    }
    firedRules.push('R2');
  }

  // R1 — BOOTSTRAP and cumulative net realizedPnL >= 2X: move principal
  // aside, transition to SELF_SUSTAINING. Goalpost does not move.
  if (
    startingPhase === 'BOOTSTRAP' &&
    next.principalX !== null &&
    next.realizedPnL >= 2 * next.principalX
  ) {
    next.investableCorpus -= next.principalX;
    next.setAside = account.setAside + next.principalX;
    next.phase = 'SELF_SUSTAINING';
    firedRules.push('R1');
  }

  // R3 — corpus floor breach: lock new entries.
  if (
    next.principalX !== null &&
    next.phase !== 'LOCKED' &&
    next.investableCorpus <= lockFloor(next)
  ) {
    next.phase = 'LOCKED';
    firedRules.push('R3');
  }

  const closedTrade: Trade = {
    ...trade,
    status: 'CLOSED',
    exitAt: trade.exitAt ?? opts.now,
    grossPnL,
    netPnL,
    fees,
  };

  const result: CloseResult = { account: next, trade: closedTrade, firedRules };
  if (queuedWithdrawal) result.queuedWithdrawal = queuedWithdrawal;
  return result;
}

// ─── R4: unlock ───────────────────────────────────────────────────────

/**
 * User-initiated unlock. Restores phase based on current corpus position
 * (BOOTSTRAP if principalX still at risk, otherwise SELF_SUSTAINING).
 * Records `lockOverrideAt` for the audit trail.
 */
export function unlock(account: Account, now: string): Account {
  if (account.phase !== 'LOCKED') {
    throw new Error('unlock: account is not LOCKED');
  }
  // Heuristic for the prior phase: if setAside is still 0, BOOTSTRAP was
  // the phase before R3 fired; otherwise the user had already crossed 2X.
  const restored = account.setAside > 0 ? 'SELF_SUSTAINING' : 'BOOTSTRAP';
  return { ...account, phase: restored, lockOverrideAt: now };
}

// ─── R5: confirm / cancel withdrawal ──────────────────────────────────

export interface WithdrawalDecisionResult {
  account: Account;
  withdrawal: PendingWithdrawal;
}

/** Confirm a PENDING withdrawal: cash leaves the corpus. */
export function confirmWithdrawal(
  account: Account,
  withdrawal: PendingWithdrawal,
  now: string,
): WithdrawalDecisionResult {
  if (withdrawal.status !== 'PENDING') {
    throw new Error(`confirmWithdrawal: withdrawal ${withdrawal.id} is not PENDING`);
  }
  const next: Account = {
    ...account,
    investableCorpus: account.investableCorpus - withdrawal.amount,
    cashWithdrawn: account.cashWithdrawn + withdrawal.amount,
  };
  return {
    account: next,
    withdrawal: { ...withdrawal, status: 'CONFIRMED', decidedAt: now },
  };
}

/** Cancel a PENDING withdrawal: amount stays in the corpus. */
export function cancelWithdrawal(
  account: Account,
  withdrawal: PendingWithdrawal,
  now: string,
): WithdrawalDecisionResult {
  if (withdrawal.status !== 'PENDING') {
    throw new Error(`cancelWithdrawal: withdrawal ${withdrawal.id} is not PENDING`);
  }
  return {
    account, // unchanged
    withdrawal: { ...withdrawal, status: 'CANCELLED', decidedAt: now },
  };
}

// ─── C1–C6: evaluateDecision ──────────────────────────────────────────

export interface EvaluateOptions {
  id: string;
  decidedAt: string;
}

export interface DecisionComputed {
  capitalRequired: number;
}

export function computeDecisionInputs(input: NewTradeInput): DecisionComputed {
  return { capitalRequired: input.entryPrice * input.qty * input.lotSize };
}

export function evaluateDecision(
  input: NewTradeInput,
  snapshot: AccountSnapshot,
  openTrades: Pick<Trade, 'symbol' | 'status'>[],
  opts: EvaluateOptions,
): DecisionRecord {
  const { capitalRequired } = computeDecisionInputs(input);
  const checks: CheckResult[] = [];

  // C1 — phase ≠ LOCKED. BLOCK.
  checks.push(
    snapshot.phase === 'LOCKED'
      ? { id: 'C1', status: 'BLOCK', reason: 'Account is LOCKED — new trades blocked.' }
      : { id: 'C1', status: 'OK', reason: `Phase is ${snapshot.phase}.` },
  );

  // C2 — capitalRequired ≤ investableCorpus. BLOCK.
  checks.push(
    capitalRequired <= snapshot.investableCorpus
      ? { id: 'C2', status: 'OK', reason: 'Capital required fits in corpus.' }
      : {
          id: 'C2',
          status: 'BLOCK',
          reason: 'Capital required exceeds investable corpus.',
        },
  );

  // C5 — position-size soft cap. WARN. Disabled if cap = 0.
  if (snapshot.positionSizeCap > 0) {
    const limit = Math.floor(snapshot.investableCorpus * snapshot.positionSizeCap);
    checks.push(
      capitalRequired <= limit
        ? { id: 'C5', status: 'OK', reason: 'Within position-size cap.' }
        : {
            id: 'C5',
            status: 'WARN',
            reason: `Capital exceeds ${(snapshot.positionSizeCap * 100).toFixed(0)}% cap of corpus.`,
          },
    );
  } else {
    checks.push({ id: 'C5', status: 'OK', reason: 'Position-size cap disabled.' });
  }

  // C6 — same symbol not already open. WARN.
  const conflicting = openTrades.some((t) => t.status === 'OPEN' && t.symbol === input.symbol);
  checks.push(
    conflicting
      ? { id: 'C6', status: 'WARN', reason: `An OPEN trade on ${input.symbol} already exists.` }
      : { id: 'C6', status: 'OK', reason: 'No open trade on this symbol.' },
  );

  const verdict: Verdict = checks.some((c) => c.status === 'BLOCK')
    ? 'BLOCK'
    : checks.some((c) => c.status === 'WARN')
      ? 'WARN'
      : 'GO';

  return {
    id: opts.id,
    input,
    checks,
    verdict,
    decidedAt: opts.decidedAt,
    acceptedByUser: false,
  };
}

// ─── snapshot helper ──────────────────────────────────────────────────

export function accountToSnapshot(account: Account): AccountSnapshot {
  const lockFloorDistance =
    account.principalX === null
      ? null
      : account.investableCorpus - Math.floor(account.principalX / 2);
  return {
    phase: account.phase,
    principalX: account.principalX,
    investableCorpus: account.investableCorpus,
    setAside: account.setAside,
    cashWithdrawn: account.cashWithdrawn,
    realizedPnL: account.realizedPnL,
    feesPaid: account.feesPaid,
    feePercent: account.feePercent,
    positionSizeCap: account.positionSizeCap,
    lockFloorDistance,
  };
}
