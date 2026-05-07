import { describe, expect, it } from 'vitest';
import type { Account, NewTradeInput, PendingWithdrawal, Trade } from '../src/types';
import {
  accountToSnapshot,
  applyRulesOnClose,
  cancelWithdrawal,
  computeDecisionInputs,
  confirmWithdrawal,
  evaluateDecision,
  unlock,
} from '../src/domain/rules';
import { applyRate, formatINR, paiseToRupees, rupeesToPaise } from '../src/domain/money';

// Worked examples in the spec use X = ₹100,000, feePercent = 5%.
// All amounts in these tests are paise.
const X_PAISE = rupeesToPaise(100_000);

function bootstrapAccount(overrides: Partial<Account> = {}): Account {
  return {
    principalX: X_PAISE,
    feePercent: 0.05,
    positionSizeCap: 0.25,
    phase: 'BOOTSTRAP',
    investableCorpus: X_PAISE,
    setAside: 0,
    cashWithdrawn: 0,
    realizedPnL: 0,
    feesPaid: 0,
    aiEnabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 't-1',
    symbol: 'NIFTY',
    instrument: 'CE',
    expiry: '2026-05-29',
    lotSize: 1,
    qty: 1,
    entryPrice: rupeesToPaise(50_000),
    entryAt: '2026-05-01T09:30:00.000Z',
    status: 'OPEN',
    ...overrides,
  };
}

const NOW = '2026-05-02T10:00:00.000Z';
const OPTS = { withdrawalId: 'w-1', now: NOW };

// ─── money helpers ────────────────────────────────────────────────────

describe('money', () => {
  it('rupeesToPaise rounds to integer paise', () => {
    expect(rupeesToPaise(100)).toBe(10_000);
    expect(rupeesToPaise(100.5)).toBe(10_050);
    expect(rupeesToPaise(100.005)).toBe(10_001); // round half-up
  });

  it('paiseToRupees inverts rupeesToPaise for whole rupees', () => {
    expect(paiseToRupees(10_000)).toBe(100);
  });

  it('applyRate rounds to nearest paisa', () => {
    expect(applyRate(20_000_00, 0.05)).toBe(100_000); // 20,000 * 5% = 1,000 = 100,000 paise
    expect(applyRate(1, 0.5)).toBe(1); // 0.5 rounds up to 1
  });

  it('formatINR renders Indian digit grouping with two-decimal paise', () => {
    expect(formatINR(0)).toBe('₹0.00');
    expect(formatINR(100)).toBe('₹1.00');
    expect(formatINR(123_45)).toBe('₹123.45');
    expect(formatINR(rupeesToPaise(1_00_000))).toBe('₹1,00,000.00');
    expect(formatINR(rupeesToPaise(2_50_00_000))).toBe('₹2,50,00,000.00');
    expect(formatINR(-100)).toBe('-₹1.00');
  });
});

// ─── R1 — bootstrap profit and the 2X transition ──────────────────────

describe('R1: BOOTSTRAP → SELF_SUSTAINING when realizedPnL ≥ 2X', () => {
  it('a single profitable bootstrap close that does not cross 2X stays BOOTSTRAP', () => {
    // Spec §3 worked example "Bootstrap, profitable trade":
    // Buy 50,000 → sell 70,000. gross = 20,000.
    const account = bootstrapAccount();
    const opening: Trade = trade({
      entryPrice: rupeesToPaise(50_000),
      exitPrice: rupeesToPaise(70_000),
    });
    // Caller has already debited entry capital at open:
    const debited: Account = {
      ...account,
      investableCorpus: account.investableCorpus - rupeesToPaise(50_000),
    };

    const result = applyRulesOnClose(debited, opening, OPTS);

    expect(result.account.phase).toBe('BOOTSTRAP');
    // Profit share applies on every profitable close: fee = 5% × 20,000 = 1,000.
    // Corpus = 100,000 − 50,000 + 70,000 − 1,000 = 119,000.
    expect(result.account.investableCorpus).toBe(rupeesToPaise(119_000));
    expect(result.account.realizedPnL).toBe(rupeesToPaise(19_000));
    expect(result.account.feesPaid).toBe(rupeesToPaise(1_000));
    expect(result.account.setAside).toBe(0);
    expect(result.queuedWithdrawal).toBeUndefined();
    expect(result.firedRules).toEqual([]);
    expect(result.trade.status).toBe('CLOSED');
    expect(result.trade.fees).toBe(rupeesToPaise(1_000));
    expect(result.trade.grossPnL).toBe(rupeesToPaise(20_000));
    expect(result.trade.netPnL).toBe(rupeesToPaise(19_000));
  });

  it('a close that crosses 2X fires R1 — principalX moves to setAside, phase → SELF_SUSTAINING', () => {
    // Setup: net realizedPnL is already at 2X−10k after prior wins. The new
    // close: gross 20k, fee 1k, net 19k. Cumulative net = 199k + ... wait.
    // We use prior 190k as already-net so the new net just needs to add ≥ 10k.
    const account = bootstrapAccount({
      realizedPnL: rupeesToPaise(190_000),
      investableCorpus: rupeesToPaise(290_000),
    });
    const debited: Account = {
      ...account,
      investableCorpus: account.investableCorpus - rupeesToPaise(80_000),
    };
    const opening: Trade = trade({
      entryPrice: rupeesToPaise(80_000),
      exitPrice: rupeesToPaise(100_000), // gross = 20k, fee 1k, net 19k
    });

    const result = applyRulesOnClose(debited, opening, OPTS);

    expect(result.firedRules).toContain('R1');
    expect(result.account.phase).toBe('SELF_SUSTAINING');
    expect(result.account.setAside).toBe(X_PAISE);
    // Pre-R1: corpus = 210,000 (debited) + 100,000 − 1,000 fee = 309,000.
    // R1 moves principal aside: 309,000 − 100,000 = 209,000.
    expect(result.account.investableCorpus).toBe(rupeesToPaise(209_000));
    // realizedPnL accumulates net: 190,000 + 19,000 = 209,000.
    expect(result.account.realizedPnL).toBe(rupeesToPaise(209_000));
    // The same close does NOT fire R2 — phase at close-start was BOOTSTRAP.
    expect(result.queuedWithdrawal).toBeUndefined();
    expect(result.account.feesPaid).toBe(rupeesToPaise(1_000));
  });

  it('R1 does not fire while realizedPnL is still below 2X even on a big win', () => {
    const account = bootstrapAccount({
      realizedPnL: 0,
      investableCorpus: rupeesToPaise(100_000),
    });
    const debited: Account = {
      ...account,
      investableCorpus: account.investableCorpus - rupeesToPaise(50_000),
    };
    const opening: Trade = trade({
      entryPrice: rupeesToPaise(50_000),
      exitPrice: rupeesToPaise(150_000), // gross = 100,000 = X, not yet 2X
    });

    const result = applyRulesOnClose(debited, opening, OPTS);

    expect(result.firedRules).toEqual([]);
    expect(result.account.phase).toBe('BOOTSTRAP');
    // gross = 100k, fee 5k, net = 95k. Below 2X (200k) so R1 stays put.
    expect(result.account.realizedPnL).toBe(rupeesToPaise(95_000));
  });
});

// ─── R2 — self-sustaining profit split ────────────────────────────────

describe('R2: SELF_SUSTAINING profitable close splits net 50/50', () => {
  it('queues PendingWithdrawal of net/2 and debits fees', () => {
    // Spec §3 worked example "Self-sustaining, profitable trade":
    // Pre-trade corpus 200,000; setAside 100,000. Buy 80,000 → sell 100,000.
    // gross = 20,000; fees = 1,000; net = 19,000; withdrawal = 9,500.
    const account = bootstrapAccount({
      phase: 'SELF_SUSTAINING',
      setAside: X_PAISE,
      investableCorpus: rupeesToPaise(200_000),
      realizedPnL: rupeesToPaise(200_000),
    });
    const debited: Account = {
      ...account,
      investableCorpus: account.investableCorpus - rupeesToPaise(80_000),
    };
    const opening: Trade = trade({
      entryPrice: rupeesToPaise(80_000),
      exitPrice: rupeesToPaise(100_000),
    });

    const result = applyRulesOnClose(debited, opening, OPTS);

    expect(result.firedRules).toEqual(['R2']);
    expect(result.account.phase).toBe('SELF_SUSTAINING');
    expect(result.account.feesPaid).toBe(rupeesToPaise(1_000));
    expect(result.queuedWithdrawal).toBeDefined();
    expect(result.queuedWithdrawal?.amount).toBe(rupeesToPaise(9_500));
    expect(result.queuedWithdrawal?.status).toBe('PENDING');
    expect(result.queuedWithdrawal?.fromTradeId).toBe(opening.id);
    // Corpus: 120,000 (post-debit) + 100,000 (exit) − 1,000 (fees) = 219,000.
    // The queued 9,500 sits inside the corpus until R5 confirms (D6).
    expect(result.account.investableCorpus).toBe(rupeesToPaise(219_000));
    expect(result.trade.fees).toBe(rupeesToPaise(1_000));
    expect(result.trade.netPnL).toBe(rupeesToPaise(19_000));
  });

  it('a self-sustaining loss debits the corpus and does not queue a withdrawal', () => {
    const account = bootstrapAccount({
      phase: 'SELF_SUSTAINING',
      setAside: X_PAISE,
      investableCorpus: rupeesToPaise(200_000),
      realizedPnL: rupeesToPaise(200_000),
    });
    const debited: Account = {
      ...account,
      investableCorpus: account.investableCorpus - rupeesToPaise(80_000),
    };
    const opening: Trade = trade({
      entryPrice: rupeesToPaise(80_000),
      exitPrice: rupeesToPaise(70_000),
    });

    const result = applyRulesOnClose(debited, opening, OPTS);

    expect(result.firedRules).not.toContain('R2');
    expect(result.queuedWithdrawal).toBeUndefined();
    expect(result.account.feesPaid).toBe(0);
    // Corpus: 120,000 + 70,000 = 190,000.
    expect(result.account.investableCorpus).toBe(rupeesToPaise(190_000));
    expect(result.account.realizedPnL).toBe(rupeesToPaise(190_000));
  });
});

// ─── R3 — lock floor ──────────────────────────────────────────────────

describe('R3: LOCKED when investableCorpus ≤ 0.5X', () => {
  it('a string of losses bringing corpus to 49,000 fires R3', () => {
    // Spec §3 worked example "Lock trigger". X = 100,000, lock floor = 50,000.
    const account = bootstrapAccount({
      investableCorpus: rupeesToPaise(50_000),
    });
    const debited: Account = {
      ...account,
      investableCorpus: account.investableCorpus - rupeesToPaise(40_000),
    };
    const opening: Trade = trade({
      entryPrice: rupeesToPaise(40_000),
      exitPrice: rupeesToPaise(39_000),
    });

    const result = applyRulesOnClose(debited, opening, OPTS);

    expect(result.firedRules).toContain('R3');
    expect(result.account.phase).toBe('LOCKED');
    expect(result.account.investableCorpus).toBe(rupeesToPaise(49_000));
  });

  it('does not fire R3 if corpus stays above the floor', () => {
    const account = bootstrapAccount({
      investableCorpus: rupeesToPaise(60_000),
    });
    const debited: Account = {
      ...account,
      investableCorpus: account.investableCorpus - rupeesToPaise(10_000),
    };
    const opening: Trade = trade({
      entryPrice: rupeesToPaise(10_000),
      exitPrice: rupeesToPaise(9_900),
    });

    const result = applyRulesOnClose(debited, opening, OPTS);

    expect(result.firedRules).not.toContain('R3');
    expect(result.account.phase).toBe('BOOTSTRAP');
  });
});

// ─── R4 — unlock ──────────────────────────────────────────────────────

describe('R4: unlock', () => {
  it('restores BOOTSTRAP if setAside was 0', () => {
    const locked = bootstrapAccount({
      phase: 'LOCKED',
      investableCorpus: rupeesToPaise(40_000),
    });
    const restored = unlock(locked, NOW);
    expect(restored.phase).toBe('BOOTSTRAP');
    expect(restored.lockOverrideAt).toBe(NOW);
  });

  it('restores SELF_SUSTAINING if principal was already set aside', () => {
    const locked = bootstrapAccount({
      phase: 'LOCKED',
      setAside: X_PAISE,
      investableCorpus: rupeesToPaise(30_000),
    });
    const restored = unlock(locked, NOW);
    expect(restored.phase).toBe('SELF_SUSTAINING');
    expect(restored.lockOverrideAt).toBe(NOW);
  });

  it('throws if account is not LOCKED', () => {
    expect(() => unlock(bootstrapAccount(), NOW)).toThrow();
  });
});

// ─── R5 — confirm / cancel withdrawal ─────────────────────────────────

describe('R5: confirmWithdrawal / cancelWithdrawal', () => {
  const w: PendingWithdrawal = {
    id: 'w-1',
    amount: rupeesToPaise(9_500),
    fromTradeId: 't-1',
    source: 'AUTO',
    createdAt: '2026-05-02T10:00:00.000Z',
    status: 'PENDING',
  };

  it('confirm reduces corpus and increments cashWithdrawn', () => {
    const acc = bootstrapAccount({
      phase: 'SELF_SUSTAINING',
      investableCorpus: rupeesToPaise(219_000),
    });
    const result = confirmWithdrawal(acc, w, NOW);
    expect(result.account.investableCorpus).toBe(rupeesToPaise(209_500));
    expect(result.account.cashWithdrawn).toBe(rupeesToPaise(9_500));
    expect(result.withdrawal.status).toBe('CONFIRMED');
    expect(result.withdrawal.decidedAt).toBe(NOW);
  });

  it('cancel leaves corpus unchanged and marks the withdrawal CANCELLED', () => {
    const acc = bootstrapAccount({
      phase: 'SELF_SUSTAINING',
      investableCorpus: rupeesToPaise(219_000),
    });
    const result = cancelWithdrawal(acc, w, NOW);
    expect(result.account.investableCorpus).toBe(rupeesToPaise(219_000));
    expect(result.account.cashWithdrawn).toBe(0);
    expect(result.withdrawal.status).toBe('CANCELLED');
    expect(result.withdrawal.decidedAt).toBe(NOW);
  });

  it('throws when confirming/cancelling a non-PENDING withdrawal', () => {
    const acc = bootstrapAccount();
    const confirmed: PendingWithdrawal = { ...w, status: 'CONFIRMED' };
    expect(() => confirmWithdrawal(acc, confirmed, NOW)).toThrow();
    expect(() => cancelWithdrawal(acc, confirmed, NOW)).toThrow();
  });
});

// ─── C1–C6 — evaluateDecision ─────────────────────────────────────────

const newTrade = (overrides: Partial<NewTradeInput> = {}): NewTradeInput => ({
  symbol: 'NIFTY',
  instrument: 'CE',
  strike: rupeesToPaise(20_000),
  expiry: '2026-05-29',
  lotSize: 1,
  qty: 1,
  entryPrice: rupeesToPaise(10_000),
  ...overrides,
});

const D_OPTS = { id: 'd-1', decidedAt: NOW };

describe('computeDecisionInputs', () => {
  it('computes capital required from entry × qty × lotSize', () => {
    const c = computeDecisionInputs(
      newTrade({ entryPrice: rupeesToPaise(100), qty: 2, lotSize: 50 }),
    );
    expect(c.capitalRequired).toBe(rupeesToPaise(10_000));
  });
});

describe('evaluateDecision', () => {
  it('GO when all checks pass in BOOTSTRAP', () => {
    const acc = bootstrapAccount();
    const snapshot = accountToSnapshot(acc);
    const d = evaluateDecision(newTrade({ entryPrice: rupeesToPaise(10_000) }), snapshot, [], D_OPTS);
    expect(d.verdict).toBe('GO');
    expect(d.checks.every((c) => c.status === 'OK')).toBe(true);
  });

  it('C1 BLOCKs when phase is LOCKED', () => {
    const acc = bootstrapAccount({ phase: 'LOCKED' });
    const d = evaluateDecision(newTrade(), accountToSnapshot(acc), [], D_OPTS);
    expect(d.verdict).toBe('BLOCK');
    expect(d.checks.find((c) => c.id === 'C1')?.status).toBe('BLOCK');
  });

  it('C2 BLOCKs when capitalRequired > investableCorpus', () => {
    const acc = bootstrapAccount({ investableCorpus: rupeesToPaise(5_000) });
    const d = evaluateDecision(
      newTrade({ entryPrice: rupeesToPaise(10_000) }),
      accountToSnapshot(acc),
      [],
      D_OPTS,
    );
    expect(d.verdict).toBe('BLOCK');
    expect(d.checks.find((c) => c.id === 'C2')?.status).toBe('BLOCK');
  });

  it('C5 WARNs when capital exceeds the position-size cap, OK when cap = 0', () => {
    const acc = bootstrapAccount({
      investableCorpus: rupeesToPaise(100_000),
      positionSizeCap: 0.25,
    });
    const big = newTrade({ entryPrice: rupeesToPaise(30_000) }); // 30k > 25k cap
    const d1 = evaluateDecision(big, accountToSnapshot(acc), [], D_OPTS);
    expect(d1.checks.find((c) => c.id === 'C5')?.status).toBe('WARN');

    const accNoCap = bootstrapAccount({ positionSizeCap: 0 });
    const d2 = evaluateDecision(big, accountToSnapshot(accNoCap), [], D_OPTS);
    expect(d2.checks.find((c) => c.id === 'C5')?.status).toBe('OK');
  });

  it('C6 WARNs when an OPEN trade with the same symbol exists', () => {
    const acc = bootstrapAccount();
    const open: Trade[] = [trade({ id: 't-existing', symbol: 'NIFTY', status: 'OPEN' })];
    const d = evaluateDecision(newTrade({ symbol: 'NIFTY' }), accountToSnapshot(acc), open, D_OPTS);
    expect(d.checks.find((c) => c.id === 'C6')?.status).toBe('WARN');
    expect(d.verdict).toBe('WARN');
  });

  it('verdict combines: BLOCK dominates WARN dominates GO', () => {
    const acc = bootstrapAccount({ phase: 'LOCKED' });
    const open: Trade[] = [trade({ id: 't-existing', symbol: 'NIFTY', status: 'OPEN' })];
    const d = evaluateDecision(newTrade({ symbol: 'NIFTY' }), accountToSnapshot(acc), open, D_OPTS);
    expect(d.verdict).toBe('BLOCK');
  });
});

// ─── end-to-end worked sequence ───────────────────────────────────────

describe('end-to-end: bootstrap → 2X → self-sustaining → split + confirm', () => {
  it('matches the spec §3 sequence', () => {
    let acc = bootstrapAccount();

    // Sequence of bootstrap profits totalling >= 200,000 NET. With a 5%
    // profit share on every profitable close, gross needs to be at least
    // 210,527 to net 200k. Use one big winner with gross = 220,000:
    //   fee = 11,000, net = 209,000 ≥ 2X target.
    acc = {
      ...acc,
      investableCorpus: acc.investableCorpus - rupeesToPaise(50_000),
    };
    const t1 = trade({
      id: 't-1',
      entryPrice: rupeesToPaise(50_000),
      exitPrice: rupeesToPaise(270_000), // gross 220k → net 209k
    });
    const r1 = applyRulesOnClose(acc, t1, { withdrawalId: 'w-1', now: NOW });
    expect(r1.firedRules).toEqual(['R1']);
    expect(r1.account.phase).toBe('SELF_SUSTAINING');
    expect(r1.account.setAside).toBe(X_PAISE);
    acc = r1.account;

    // Self-sustaining profitable close
    acc = {
      ...acc,
      investableCorpus: acc.investableCorpus - rupeesToPaise(80_000),
    };
    const t2 = trade({
      id: 't-2',
      entryPrice: rupeesToPaise(80_000),
      exitPrice: rupeesToPaise(100_000),
    });
    const r2 = applyRulesOnClose(acc, t2, { withdrawalId: 'w-2', now: NOW });
    expect(r2.firedRules).toEqual(['R2']);
    expect(r2.queuedWithdrawal?.amount).toBe(rupeesToPaise(9_500));
    acc = r2.account;
    const w = r2.queuedWithdrawal!;

    // User confirms the withdrawal
    const corpusBefore = acc.investableCorpus;
    const confirmed = confirmWithdrawal(acc, w, NOW);
    expect(confirmed.account.investableCorpus).toBe(corpusBefore - rupeesToPaise(9_500));
    expect(confirmed.account.cashWithdrawn).toBe(rupeesToPaise(9_500));
  });
});
