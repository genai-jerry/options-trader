/**
 * Typed CRUD helpers around the SQLite database.
 *
 * Money invariant reminder: every monetary column is INTEGER paise.
 * Helpers here translate snake_case columns to the camelCase shapes in
 * @options-trader/shared.
 */

import type { Database } from 'better-sqlite3';
import type {
  Account,
  AdvisorMessage,
  DecisionRecord,
  PendingWithdrawal,
  Phase,
  Trade,
  WithdrawalStatus,
} from '@options-trader/shared';

interface AccountRow {
  id: number;
  principal_x: number | null;
  fee_percent: number;
  position_size_cap: number;
  phase: Phase;
  investable_corpus: number;
  set_aside: number;
  cash_withdrawn: number;
  realized_pnl: number;
  fees_paid: number;
  ai_enabled: number;
  lock_override_at: string | null;
  created_at: string;
}

function rowToAccount(row: AccountRow): Account {
  const account: Account = {
    principalX: row.principal_x,
    feePercent: row.fee_percent,
    positionSizeCap: row.position_size_cap,
    phase: row.phase,
    investableCorpus: row.investable_corpus,
    setAside: row.set_aside,
    cashWithdrawn: row.cash_withdrawn,
    realizedPnL: row.realized_pnl,
    feesPaid: row.fees_paid,
    aiEnabled: row.ai_enabled === 1,
    createdAt: row.created_at,
  };
  if (row.lock_override_at) account.lockOverrideAt = row.lock_override_at;
  return account;
}

interface TradeRow {
  id: string;
  symbol: string;
  instrument: 'CE' | 'PE' | 'FUT';
  strike: number | null;
  expiry: string;
  lot_size: number;
  qty: number;
  entry_price: number;
  entry_at: string;
  exit_price: number | null;
  exit_at: string | null;
  status: 'OPEN' | 'CLOSED';
  fees: number | null;
  gross_pnl: number | null;
  net_pnl: number | null;
  notes: string | null;
  agent_source: string | null;
}

function rowToTrade(row: TradeRow): Trade {
  const t: Trade = {
    id: row.id,
    symbol: row.symbol,
    instrument: row.instrument,
    expiry: row.expiry,
    lotSize: row.lot_size,
    qty: row.qty,
    entryPrice: row.entry_price,
    entryAt: row.entry_at,
    status: row.status,
  };
  if (row.strike !== null) t.strike = row.strike;
  if (row.exit_price !== null) t.exitPrice = row.exit_price;
  if (row.exit_at !== null) t.exitAt = row.exit_at;
  if (row.fees !== null) t.fees = row.fees;
  if (row.gross_pnl !== null) t.grossPnL = row.gross_pnl;
  if (row.net_pnl !== null) t.netPnL = row.net_pnl;
  if (row.notes !== null) t.notes = row.notes;
  if (row.agent_source !== null) t.agentSource = row.agent_source;
  return t;
}

interface WithdrawalRow {
  id: string;
  amount: number;
  from_trade_id: string;
  status: WithdrawalStatus;
  created_at: string;
  decided_at: string | null;
}

function rowToWithdrawal(row: WithdrawalRow): PendingWithdrawal {
  const w: PendingWithdrawal = {
    id: row.id,
    amount: row.amount,
    fromTradeId: row.from_trade_id,
    createdAt: row.created_at,
    status: row.status,
  };
  if (row.decided_at) w.decidedAt = row.decided_at;
  return w;
}

interface DecisionRow {
  id: string;
  trade_id: string | null;
  input_json: string;
  checks_json: string;
  verdict: 'GO' | 'WARN' | 'BLOCK';
  decided_at: string;
  accepted_by_user: number;
}

function rowToDecision(row: DecisionRow): DecisionRecord {
  const d: DecisionRecord = {
    id: row.id,
    input: JSON.parse(row.input_json),
    checks: JSON.parse(row.checks_json),
    verdict: row.verdict,
    decidedAt: row.decided_at,
    acceptedByUser: row.accepted_by_user === 1,
  };
  if (row.trade_id) d.tradeId = row.trade_id;
  return d;
}

interface AdvisorMessageRow {
  id: string;
  conversation_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_payload: string | null;
  created_at: string;
}

function rowToAdvisorMessage(row: AdvisorMessageRow): AdvisorMessage {
  const m: AdvisorMessage = {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
  if (row.tool_payload) m.toolPayload = row.tool_payload;
  return m;
}

export function createRepo(db: Database) {
  return {
    // ── transactions ───────────────────────────────────────────────────
    /** Wrap multi-step writes in a transaction. */
    tx<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    // ── account ────────────────────────────────────────────────────────
    getAccount(): Account {
      const row = db.prepare('SELECT * FROM account WHERE id = 1').get() as AccountRow | undefined;
      if (!row) throw new Error('Account row missing — migration seed did not run.');
      return rowToAccount(row);
    },

    /** Replace the entire account row (used after rule-engine state transitions). */
    putAccount(account: Account): void {
      db.prepare(
        `UPDATE account SET
          principal_x = ?, fee_percent = ?, position_size_cap = ?, phase = ?,
          investable_corpus = ?, set_aside = ?, cash_withdrawn = ?,
          realized_pnl = ?, fees_paid = ?, ai_enabled = ?, lock_override_at = ?
         WHERE id = 1`,
      ).run(
        account.principalX,
        account.feePercent,
        account.positionSizeCap,
        account.phase,
        account.investableCorpus,
        account.setAside,
        account.cashWithdrawn,
        account.realizedPnL,
        account.feesPaid,
        account.aiEnabled ? 1 : 0,
        account.lockOverrideAt ?? null,
      );
    },

    /**
     * Wipe every domain table and re-seed an empty account row. Schema
     * version is preserved so migrations don't re-run unnecessarily.
     */
    resetAll(): void {
      db.transaction(() => {
        db.exec(`
          DELETE FROM advisor_messages;
          DELETE FROM decisions;
          DELETE FROM pending_withdrawals;
          DELETE FROM trades;
          DELETE FROM zerodha_sessions;
          DELETE FROM account;
          INSERT INTO account (id) VALUES (1);
        `);
      })();
    },

    // ── trades ─────────────────────────────────────────────────────────
    countTrades(): number {
      return (db.prepare('SELECT COUNT(*) AS c FROM trades').get() as { c: number }).c;
    },
    getTradeById(id: string): Trade | null {
      const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as TradeRow | undefined;
      return row ? rowToTrade(row) : null;
    },
    listTrades(filter: { status?: 'OPEN' | 'CLOSED'; symbol?: string; instrument?: 'CE' | 'PE' | 'FUT' } = {}): Trade[] {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filter.status) {
        clauses.push('status = ?');
        params.push(filter.status);
      }
      if (filter.symbol) {
        clauses.push('symbol = ?');
        params.push(filter.symbol);
      }
      if (filter.instrument) {
        clauses.push('instrument = ?');
        params.push(filter.instrument);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db.prepare(`SELECT * FROM trades ${where} ORDER BY entry_at DESC`).all(...params) as TradeRow[];
      return rows.map(rowToTrade);
    },

    insertTrade(trade: Trade): void {
      db.prepare(
        `INSERT INTO trades (
           id, symbol, instrument, strike, expiry, lot_size, qty,
           entry_price, entry_at, exit_price, exit_at, status,
           fees, gross_pnl, net_pnl, notes, agent_source
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        trade.id,
        trade.symbol,
        trade.instrument,
        trade.strike ?? null,
        trade.expiry,
        trade.lotSize,
        trade.qty,
        trade.entryPrice,
        trade.entryAt,
        trade.exitPrice ?? null,
        trade.exitAt ?? null,
        trade.status,
        trade.fees ?? null,
        trade.grossPnL ?? null,
        trade.netPnL ?? null,
        trade.notes ?? null,
        trade.agentSource ?? null,
      );
    },

    /** Replace an existing trade row (used to record a close). */
    putTrade(trade: Trade): void {
      const result = db.prepare(
        `UPDATE trades SET
           symbol = ?, instrument = ?, strike = ?, expiry = ?, lot_size = ?,
           qty = ?, entry_price = ?, entry_at = ?, exit_price = ?, exit_at = ?,
           status = ?, fees = ?, gross_pnl = ?, net_pnl = ?, notes = ?,
           agent_source = ?
         WHERE id = ?`,
      ).run(
        trade.symbol,
        trade.instrument,
        trade.strike ?? null,
        trade.expiry,
        trade.lotSize,
        trade.qty,
        trade.entryPrice,
        trade.entryAt,
        trade.exitPrice ?? null,
        trade.exitAt ?? null,
        trade.status,
        trade.fees ?? null,
        trade.grossPnL ?? null,
        trade.netPnL ?? null,
        trade.notes ?? null,
        trade.agentSource ?? null,
        trade.id,
      );
      if (result.changes === 0) throw new Error(`putTrade: trade ${trade.id} not found`);
    },

    // ── withdrawals ────────────────────────────────────────────────────
    listWithdrawals(filter: { status?: WithdrawalStatus } = {}): PendingWithdrawal[] {
      const where = filter.status ? 'WHERE status = ?' : '';
      const params = filter.status ? [filter.status] : [];
      const rows = db
        .prepare(`SELECT * FROM pending_withdrawals ${where} ORDER BY created_at DESC`)
        .all(...params) as WithdrawalRow[];
      return rows.map(rowToWithdrawal);
    },

    getWithdrawalById(id: string): PendingWithdrawal | null {
      const row = db
        .prepare('SELECT * FROM pending_withdrawals WHERE id = ?')
        .get(id) as WithdrawalRow | undefined;
      return row ? rowToWithdrawal(row) : null;
    },

    insertWithdrawal(w: PendingWithdrawal): void {
      db.prepare(
        `INSERT INTO pending_withdrawals (id, amount, from_trade_id, status, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(w.id, w.amount, w.fromTradeId, w.status, w.createdAt, w.decidedAt ?? null);
    },

    putWithdrawal(w: PendingWithdrawal): void {
      const result = db.prepare(
        `UPDATE pending_withdrawals
            SET amount = ?, from_trade_id = ?, status = ?, decided_at = ?
          WHERE id = ?`,
      ).run(w.amount, w.fromTradeId, w.status, w.decidedAt ?? null, w.id);
      if (result.changes === 0) throw new Error(`putWithdrawal: ${w.id} not found`);
    },

    // ── decisions ──────────────────────────────────────────────────────
    listDecisions(limit = 50): DecisionRecord[] {
      const rows = db
        .prepare('SELECT * FROM decisions ORDER BY decided_at DESC LIMIT ?')
        .all(limit) as DecisionRow[];
      return rows.map(rowToDecision);
    },

    insertDecision(d: DecisionRecord): void {
      db.prepare(
        `INSERT INTO decisions (id, trade_id, input_json, checks_json, verdict, decided_at, accepted_by_user)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        d.id,
        d.tradeId ?? null,
        JSON.stringify(d.input),
        JSON.stringify(d.checks),
        d.verdict,
        d.decidedAt,
        d.acceptedByUser ? 1 : 0,
      );
    },

    // ── advisor messages ───────────────────────────────────────────────
    listAdvisorMessages(conversationId: string): AdvisorMessage[] {
      const rows = db
        .prepare('SELECT * FROM advisor_messages WHERE conversation_id = ? ORDER BY created_at ASC')
        .all(conversationId) as AdvisorMessageRow[];
      return rows.map(rowToAdvisorMessage);
    },

    // ── introspection (used by /api/health/db) ─────────────────────────
    listTables(): string[] {
      const rows = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[];
      return rows.map((r) => r.name);
    },
    schemaVersion(): number {
      const row = db
        .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_versions')
        .get() as { v: number };
      return row.v;
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
