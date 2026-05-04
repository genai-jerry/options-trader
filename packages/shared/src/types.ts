/**
 * Canonical types shared between apps/web and apps/server.
 *
 * Money invariant: every monetary field is integer paise. The view layer
 * formats to rupees; nothing else is allowed to convert.
 */

export type Phase = 'BOOTSTRAP' | 'SELF_SUSTAINING' | 'LOCKED';

export interface Account {
  /** Locked after the first trade is recorded. */
  principalX: number | null;
  /** 0..1 — applied only to profitable closes. Default 0.05. */
  feePercent: number;
  /** 0..1 — soft-cap WARN. 0 disables the check. Default 0.25. */
  positionSizeCap: number;
  phase: Phase;
  investableCorpus: number;
  setAside: number;
  cashWithdrawn: number;
  realizedPnL: number;
  feesPaid: number;
  /** Whether the AI advisor is enabled. */
  aiEnabled: boolean;
  /** ISO timestamp; set when the user manually unlocks (R4). */
  lockOverrideAt?: string;
  createdAt: string;
}

export type WithdrawalStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';
export type WithdrawalSource = 'AUTO' | 'MANUAL';

export interface PendingWithdrawal {
  id: string;
  amount: number;
  /** Set for AUTO withdrawals (R2-driven). Absent for MANUAL ones. */
  fromTradeId?: string;
  source: WithdrawalSource;
  createdAt: string;
  decidedAt?: string;
  status: WithdrawalStatus;
}

export type Instrument = 'CE' | 'PE' | 'FUT';
export type TradeStatus = 'OPEN' | 'CLOSED';

export interface Trade {
  id: string;
  symbol: string;
  instrument: Instrument;
  /** Required for CE/PE; omitted for FUT. */
  strike?: number;
  /** ISO date (YYYY-MM-DD). */
  expiry: string;
  lotSize: number;
  /** Number of lots. */
  qty: number;
  entryPrice: number;
  entryAt: string;
  exitPrice?: number;
  exitAt?: string;
  status: TradeStatus;
  fees?: number;
  grossPnL?: number;
  netPnL?: number;
  notes?: string;
  agentSource?: string;
}

export interface NewTradeInput {
  symbol: string;
  instrument: Instrument;
  strike?: number;
  expiry: string;
  lotSize: number;
  qty: number;
  entryPrice: number;
  expectedExit: number;
  maxAcceptableLoss: number;
  notes?: string;
  agentSource?: string;
}

export type CheckId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6';
export type CheckStatus = 'OK' | 'WARN' | 'BLOCK';
export type Verdict = 'GO' | 'WARN' | 'BLOCK';

export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  reason: string;
}

export interface DecisionRecord {
  id: string;
  /** Set if the user accepted and a trade was opened. */
  tradeId?: string;
  input: NewTradeInput;
  checks: CheckResult[];
  verdict: Verdict;
  decidedAt: string;
  acceptedByUser: boolean;
}

export interface AccountSnapshot {
  phase: Phase;
  principalX: number | null;
  investableCorpus: number;
  setAside: number;
  cashWithdrawn: number;
  realizedPnL: number;
  feesPaid: number;
  feePercent: number;
  positionSizeCap: number;
  /** principalX != null ? investableCorpus - 0.5 * principalX : null */
  lockFloorDistance: number | null;
}

export interface AdvisorMessage {
  id: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
  /** Optional tool-call payload, JSON-encoded. */
  toolPayload?: string;
}
