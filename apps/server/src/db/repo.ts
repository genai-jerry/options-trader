/**
 * Typed CRUD helpers around the SQLite database.
 *
 * Multi-tenancy: every per-user table carries a `user_id` column. Routes
 * obtain a `UserRepo` (via `createUserRepo(db, userId)`) so every query
 * is automatically scoped — there is no way to read another user's data.
 *
 * `createRepo(db)` is the system-level repo: it manages users + sessions
 * and exposes introspection. It does NOT have any per-user data methods.
 *
 * Money invariant reminder: every monetary column is INTEGER paise.
 */

import type { Database } from 'better-sqlite3';
import type {
  Account,
  AdvisorMessage,
  DecisionRecord,
  PendingWithdrawal,
  Phase,
  Trade,
  User,
  WithdrawalStatus,
} from '@options-trader/shared';

// ─── row shapes ───────────────────────────────────────────────────────

interface UserRow {
  id: string;
  google_sub: string | null;
  email: string;
  name: string | null;
  picture: string | null;
  created_at: string;
  last_login_at: string | null;
}

function rowToUser(row: UserRow): User {
  const u: User = { id: row.id, email: row.email, createdAt: row.created_at };
  if (row.name) u.name = row.name;
  if (row.picture) u.picture = row.picture;
  if (row.last_login_at) u.lastLoginAt = row.last_login_at;
  return u;
}

interface SessionRow {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

export interface FamilyMember {
  memberEmail: string;
  ownerUserId: string;
  memberUserId: string | null;
  invitedAt: string;
  acceptedAt: string | null;
}

interface FamilyMemberRow {
  member_email: string;
  owner_user_id: string;
  member_user_id: string | null;
  invited_at: string;
  accepted_at: string | null;
}

function rowToFamilyMember(row: FamilyMemberRow): FamilyMember {
  return {
    memberEmail: row.member_email,
    ownerUserId: row.owner_user_id,
    memberUserId: row.member_user_id,
    invitedAt: row.invited_at,
    acceptedAt: row.accepted_at,
  };
}

interface AccountRow {
  user_id: string;
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
  user_id: string;
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
  user_id: string;
  amount: number;
  from_trade_id: string | null;
  source: 'AUTO' | 'MANUAL';
  status: WithdrawalStatus;
  created_at: string;
  decided_at: string | null;
}

function rowToWithdrawal(row: WithdrawalRow): PendingWithdrawal {
  const w: PendingWithdrawal = {
    id: row.id,
    amount: row.amount,
    source: row.source,
    createdAt: row.created_at,
    status: row.status,
  };
  if (row.from_trade_id) w.fromTradeId = row.from_trade_id;
  if (row.decided_at) w.decidedAt = row.decided_at;
  return w;
}

interface DecisionRow {
  id: string;
  user_id: string;
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
  user_id: string;
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

export interface ZerodhaSession {
  userIdKite: string;
  userName: string;
  accessToken: string;
  publicToken: string;
  loginAt: string;
  expiresAt?: string;
}

interface ZerodhaSessionRow {
  user_id: string;
  user_id_kite: string | null;
  user_name: string | null;
  access_token: string | null;
  public_token: string | null;
  login_at: string | null;
  expires_at: string | null;
}

function rowToZerodhaSession(row: ZerodhaSessionRow): ZerodhaSession {
  const session: ZerodhaSession = {
    userIdKite: row.user_id_kite ?? '',
    userName: row.user_name ?? '',
    accessToken: row.access_token ?? '',
    publicToken: row.public_token ?? '',
    loginAt: row.login_at ?? '',
  };
  if (row.expires_at) session.expiresAt = row.expires_at;
  return session;
}

// ─── system repo (users, sessions, introspection) ─────────────────────

export function createRepo(db: Database) {
  return {
    tx<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    // ── users ──────────────────────────────────────────────────────────
    findUserByGoogleSub(sub: string): User | null {
      const row = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub) as
        | UserRow
        | undefined;
      return row ? rowToUser(row) : null;
    },

    getUserById(id: string): User | null {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
        | UserRow
        | undefined;
      return row ? rowToUser(row) : null;
    },

    insertUser(user: {
      id: string;
      googleSub: string;
      email: string;
      name?: string;
      picture?: string;
    }): User {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO users (id, google_sub, email, name, picture, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(user.id, user.googleSub, user.email, user.name ?? null, user.picture ?? null, now);

      // Seed an empty account row.
      db.prepare(
        `INSERT INTO account (user_id) VALUES (?)`,
      ).run(user.id);

      return this.getUserById(user.id)!;
    },

    touchUserLogin(userId: string, name?: string, picture?: string): void {
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE users SET last_login_at = ?,
                          name = COALESCE(?, name),
                          picture = COALESCE(?, picture)
          WHERE id = ?`,
      ).run(now, name ?? null, picture ?? null, userId);
    },

    // ── sessions ───────────────────────────────────────────────────────
    insertSession(s: { id: string; userId: string; expiresAt: string }): void {
      db.prepare(
        `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`,
      ).run(s.id, s.userId, s.expiresAt);
    },

    getSessionUserId(sessionId: string): string | null {
      const row = db
        .prepare(`SELECT user_id, expires_at FROM sessions WHERE id = ?`)
        .get(sessionId) as { user_id: string; expires_at: string } | undefined;
      if (!row) return null;
      if (new Date(row.expires_at).getTime() < Date.now()) {
        db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
        return null;
      }
      return row.user_id;
    },

    deleteSession(sessionId: string): void {
      db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
    },

    pruneExpiredSessions(): number {
      return db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(
        new Date().toISOString(),
      ).changes;
    },

    // ── family members ─────────────────────────────────────────────────

    findFamilyByMemberUserId(userId: string): FamilyMember | null {
      const row = db
        .prepare('SELECT * FROM family_members WHERE member_user_id = ?')
        .get(userId) as FamilyMemberRow | undefined;
      return row ? rowToFamilyMember(row) : null;
    },

    findFamilyByMemberEmail(email: string): FamilyMember | null {
      const row = db
        .prepare('SELECT * FROM family_members WHERE member_email = ?')
        .get(email.toLowerCase()) as FamilyMemberRow | undefined;
      return row ? rowToFamilyMember(row) : null;
    },

    listFamilyMembers(ownerUserId: string): FamilyMember[] {
      const rows = db
        .prepare('SELECT * FROM family_members WHERE owner_user_id = ? ORDER BY invited_at ASC')
        .all(ownerUserId) as FamilyMemberRow[];
      return rows.map(rowToFamilyMember);
    },

    /**
     * Add a new family invite. Throws on:
     *   - SqliteError (UNIQUE) if email is already in another family
     *   - 'self-invite' if owner tries to invite their own email
     */
    insertFamilyMember(opts: {
      ownerUserId: string;
      memberEmail: string;
      now: string;
    }): void {
      const owner = this.getUserById(opts.ownerUserId);
      const email = opts.memberEmail.trim().toLowerCase();
      if (owner && owner.email.toLowerCase() === email) {
        throw new Error('self-invite');
      }
      // If a user already exists with this email, link immediately.
      const existing = db
        .prepare('SELECT id FROM users WHERE LOWER(email) = ?')
        .get(email) as { id: string } | undefined;
      const memberUserId = existing?.id ?? null;
      const acceptedAt = existing ? opts.now : null;

      db.prepare(
        `INSERT INTO family_members (member_email, owner_user_id, member_user_id, invited_at, accepted_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(email, opts.ownerUserId, memberUserId, opts.now, acceptedAt);
    },

    /** Owner removes an invitee. */
    deleteFamilyMember(opts: { ownerUserId: string; memberEmail: string }): boolean {
      const result = db
        .prepare(
          'DELETE FROM family_members WHERE owner_user_id = ? AND member_email = ?',
        )
        .run(opts.ownerUserId, opts.memberEmail.trim().toLowerCase());
      return result.changes > 0;
    },

    /** Member leaves the family they're in. */
    leaveFamily(memberUserId: string): boolean {
      const result = db
        .prepare('DELETE FROM family_members WHERE member_user_id = ?')
        .run(memberUserId);
      return result.changes > 0;
    },

    /** Mark an invite as accepted by linking the member's user id. */
    linkFamilyMember(opts: { memberEmail: string; memberUserId: string; now: string }): void {
      db.prepare(
        `UPDATE family_members
            SET member_user_id = ?, accepted_at = COALESCE(accepted_at, ?)
          WHERE member_email = ?`,
      ).run(opts.memberUserId, opts.now, opts.memberEmail.toLowerCase());
    },

    // ── broker sync fan-out ────────────────────────────────────────────
    /** Every user with a stored Kite access token — the daily sync iterates this list. */
    listUserIdsWithKiteSession(): string[] {
      const rows = db
        .prepare(
          `SELECT user_id FROM zerodha_sessions WHERE access_token IS NOT NULL AND access_token != ''`,
        )
        .all() as { user_id: string }[];
      return rows.map((r) => r.user_id);
    },

    // ── introspection ──────────────────────────────────────────────────
    listTables(): string[] {
      const rows = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
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

// ─── per-user repo ────────────────────────────────────────────────────

export function createUserRepo(db: Database, userId: string) {
  return {
    userId,

    tx<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    // ── account ────────────────────────────────────────────────────────
    getAccount(): Account {
      const row = db.prepare('SELECT * FROM account WHERE user_id = ?').get(userId) as
        | AccountRow
        | undefined;
      if (!row) {
        // Defensive: create the row if missing.
        db.prepare('INSERT INTO account (user_id) VALUES (?)').run(userId);
        const fresh = db.prepare('SELECT * FROM account WHERE user_id = ?').get(userId) as AccountRow;
        return rowToAccount(fresh);
      }
      return rowToAccount(row);
    },

    putAccount(account: Account): void {
      db.prepare(
        `UPDATE account SET
          principal_x = ?, fee_percent = ?, position_size_cap = ?, phase = ?,
          investable_corpus = ?, set_aside = ?, cash_withdrawn = ?,
          realized_pnl = ?, fees_paid = ?, ai_enabled = ?, lock_override_at = ?
         WHERE user_id = ?`,
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
        userId,
      );
    },

    /**
     * Wipe this user's data and reset the account row. Schema version is
     * preserved. Sessions for this user are kept so the user stays logged in.
     */
    resetAll(): void {
      db.transaction(() => {
        db.prepare('DELETE FROM advisor_messages WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM decisions WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM pending_withdrawals WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM trades WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM zerodha_sessions WHERE user_id = ?').run(userId);
        db.prepare(
          `UPDATE zerodha_credentials SET api_key = NULL, api_secret = NULL, updated_at = NULL
            WHERE user_id = ?`,
        ).run(userId);
        db.prepare('DELETE FROM account WHERE user_id = ?').run(userId);
        db.prepare('INSERT INTO account (user_id) VALUES (?)').run(userId);
      })();
    },

    // ── trades ─────────────────────────────────────────────────────────
    countTrades(): number {
      return (db.prepare('SELECT COUNT(*) AS c FROM trades WHERE user_id = ?').get(userId) as {
        c: number;
      }).c;
    },
    getTradeById(id: string): Trade | null {
      const row = db
        .prepare('SELECT * FROM trades WHERE id = ? AND user_id = ?')
        .get(id, userId) as TradeRow | undefined;
      return row ? rowToTrade(row) : null;
    },
    listTrades(filter: { status?: 'OPEN' | 'CLOSED'; symbol?: string; instrument?: 'CE' | 'PE' | 'FUT' } = {}): Trade[] {
      const clauses: string[] = ['user_id = ?'];
      const params: unknown[] = [userId];
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
      const where = `WHERE ${clauses.join(' AND ')}`;
      const rows = db
        .prepare(`SELECT * FROM trades ${where} ORDER BY entry_at DESC`)
        .all(...params) as TradeRow[];
      return rows.map(rowToTrade);
    },

    insertTrade(trade: Trade): void {
      db.prepare(
        `INSERT INTO trades (
           id, user_id, symbol, instrument, strike, expiry, lot_size, qty,
           entry_price, entry_at, exit_price, exit_at, status,
           fees, gross_pnl, net_pnl, notes, agent_source
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        trade.id,
        userId,
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

    putTrade(trade: Trade): void {
      const result = db.prepare(
        `UPDATE trades SET
           symbol = ?, instrument = ?, strike = ?, expiry = ?, lot_size = ?,
           qty = ?, entry_price = ?, entry_at = ?, exit_price = ?, exit_at = ?,
           status = ?, fees = ?, gross_pnl = ?, net_pnl = ?, notes = ?,
           agent_source = ?
         WHERE id = ? AND user_id = ?`,
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
        userId,
      );
      if (result.changes === 0) throw new Error(`putTrade: trade ${trade.id} not found`);
    },

    // ── withdrawals ────────────────────────────────────────────────────
    listWithdrawals(filter: { status?: WithdrawalStatus } = {}): PendingWithdrawal[] {
      const clauses: string[] = ['user_id = ?'];
      const params: unknown[] = [userId];
      if (filter.status) {
        clauses.push('status = ?');
        params.push(filter.status);
      }
      const where = `WHERE ${clauses.join(' AND ')}`;
      const rows = db
        .prepare(`SELECT * FROM pending_withdrawals ${where} ORDER BY created_at DESC`)
        .all(...params) as WithdrawalRow[];
      return rows.map(rowToWithdrawal);
    },

    getWithdrawalById(id: string): PendingWithdrawal | null {
      const row = db
        .prepare('SELECT * FROM pending_withdrawals WHERE id = ? AND user_id = ?')
        .get(id, userId) as WithdrawalRow | undefined;
      return row ? rowToWithdrawal(row) : null;
    },

    insertWithdrawal(w: PendingWithdrawal): void {
      db.prepare(
        `INSERT INTO pending_withdrawals (id, user_id, amount, from_trade_id, source, status, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        w.id,
        userId,
        w.amount,
        w.fromTradeId ?? null,
        w.source,
        w.status,
        w.createdAt,
        w.decidedAt ?? null,
      );
    },

    putWithdrawal(w: PendingWithdrawal): void {
      const result = db.prepare(
        `UPDATE pending_withdrawals
            SET amount = ?, from_trade_id = ?, source = ?, status = ?, decided_at = ?
          WHERE id = ? AND user_id = ?`,
      ).run(
        w.amount,
        w.fromTradeId ?? null,
        w.source,
        w.status,
        w.decidedAt ?? null,
        w.id,
        userId,
      );
      if (result.changes === 0) throw new Error(`putWithdrawal: ${w.id} not found`);
    },

    // ── decisions ──────────────────────────────────────────────────────
    listDecisions(limit = 50): DecisionRecord[] {
      const rows = db
        .prepare('SELECT * FROM decisions WHERE user_id = ? ORDER BY decided_at DESC LIMIT ?')
        .all(userId, limit) as DecisionRow[];
      return rows.map(rowToDecision);
    },

    insertDecision(d: DecisionRecord): void {
      db.prepare(
        `INSERT INTO decisions (id, user_id, trade_id, input_json, checks_json, verdict, decided_at, accepted_by_user)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        d.id,
        userId,
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
        .prepare(
          'SELECT * FROM advisor_messages WHERE user_id = ? AND conversation_id = ? ORDER BY created_at ASC',
        )
        .all(userId, conversationId) as AdvisorMessageRow[];
      return rows.map(rowToAdvisorMessage);
    },

    listConversations(limit = 20): { conversationId: string; lastAt: string; turns: number }[] {
      const rows = db
        .prepare(
          `SELECT conversation_id AS conversationId,
                  MAX(created_at) AS lastAt,
                  COUNT(*)        AS turns
             FROM advisor_messages
            WHERE user_id = ?
            GROUP BY conversation_id
            ORDER BY lastAt DESC
            LIMIT ?`,
        )
        .all(userId, limit) as { conversationId: string; lastAt: string; turns: number }[];
      return rows;
    },

    insertAdvisorMessage(m: AdvisorMessage): void {
      db.prepare(
        `INSERT INTO advisor_messages (id, user_id, conversation_id, role, content, tool_payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        m.id,
        userId,
        m.conversationId,
        m.role,
        m.content,
        m.toolPayload ?? null,
        m.createdAt,
      );
    },

    // ── zerodha sessions ───────────────────────────────────────────────
    getZerodhaSession(): ZerodhaSession | null {
      const row = db
        .prepare('SELECT * FROM zerodha_sessions WHERE user_id = ?')
        .get(userId) as ZerodhaSessionRow | undefined;
      if (!row || !row.access_token) return null;
      return rowToZerodhaSession(row);
    },

    putZerodhaSession(session: ZerodhaSession): void {
      db.prepare(
        `INSERT INTO zerodha_sessions (user_id, user_id_kite, user_name, access_token, public_token, login_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           user_id_kite = excluded.user_id_kite,
           user_name    = excluded.user_name,
           access_token = excluded.access_token,
           public_token = excluded.public_token,
           login_at     = excluded.login_at,
           expires_at   = excluded.expires_at`,
      ).run(
        userId,
        session.userIdKite,
        session.userName,
        session.accessToken,
        session.publicToken,
        session.loginAt,
        session.expiresAt ?? null,
      );
    },

    clearZerodhaSession(): void {
      db.prepare('DELETE FROM zerodha_sessions WHERE user_id = ?').run(userId);
    },

    // ── zerodha credentials ────────────────────────────────────────────
    getZerodhaCredentials(): { apiKey: string; apiSecret: string; updatedAt: string | null } | null {
      const row = db
        .prepare('SELECT api_key, api_secret, updated_at FROM zerodha_credentials WHERE user_id = ?')
        .get(userId) as { api_key: string | null; api_secret: string | null; updated_at: string | null } | undefined;
      if (!row || !row.api_key || !row.api_secret) return null;
      return { apiKey: row.api_key, apiSecret: row.api_secret, updatedAt: row.updated_at };
    },

    putZerodhaCredentials(apiKey: string, apiSecret: string, now: string): void {
      db.prepare(
        `INSERT INTO zerodha_credentials (user_id, api_key, api_secret, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           api_key    = excluded.api_key,
           api_secret = excluded.api_secret,
           updated_at = excluded.updated_at`,
      ).run(userId, apiKey, apiSecret, now);
    },

    clearZerodhaCredentials(): void {
      db.prepare(
        `UPDATE zerodha_credentials
            SET api_key = NULL, api_secret = NULL, updated_at = NULL
          WHERE user_id = ?`,
      ).run(userId);
    },

    // ── broker trades (Kite fills, snapshotted daily) ──────────────────
    upsertBrokerTrades(rows: BrokerTradeUpsertRow[], syncedAt: string): number {
      if (rows.length === 0) return 0;
      const stmt = db.prepare(
        `INSERT INTO broker_trades (
           user_id, trade_id, order_id, exchange_order_id, tradingsymbol, exchange,
           instrument_token, transaction_type, product, quantity, average_price_paise,
           fill_timestamp, exchange_timestamp, order_timestamp, trade_date, synced_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, trade_id) DO UPDATE SET
           order_id            = excluded.order_id,
           exchange_order_id   = excluded.exchange_order_id,
           tradingsymbol       = excluded.tradingsymbol,
           exchange            = excluded.exchange,
           instrument_token    = excluded.instrument_token,
           transaction_type    = excluded.transaction_type,
           product             = excluded.product,
           quantity            = excluded.quantity,
           average_price_paise = excluded.average_price_paise,
           fill_timestamp      = excluded.fill_timestamp,
           exchange_timestamp  = excluded.exchange_timestamp,
           order_timestamp     = excluded.order_timestamp,
           trade_date          = excluded.trade_date,
           synced_at           = excluded.synced_at`,
      );
      let inserted = 0;
      const tx = db.transaction((batch: BrokerTradeUpsertRow[]) => {
        for (const r of batch) {
          const result = stmt.run(
            userId,
            r.tradeId,
            r.orderId,
            r.exchangeOrderId ?? null,
            r.tradingsymbol,
            r.exchange,
            r.instrumentToken ?? null,
            r.transactionType,
            r.product ?? null,
            r.quantity,
            r.averagePricePaise,
            r.fillTimestamp ?? null,
            r.exchangeTimestamp ?? null,
            r.orderTimestamp ?? null,
            r.tradeDate,
            syncedAt,
          );
          if (result.changes > 0) inserted += 1;
        }
      });
      tx(rows);
      return inserted;
    },

    listBrokerTrades(filter: { fromDate?: string; toDate?: string } = {}): BrokerTrade[] {
      const where: string[] = ['user_id = ?'];
      const args: (string | number)[] = [userId];
      if (filter.fromDate) {
        where.push('trade_date >= ?');
        args.push(filter.fromDate);
      }
      if (filter.toDate) {
        where.push('trade_date <= ?');
        args.push(filter.toDate);
      }
      const rows = db
        .prepare(
          `SELECT * FROM broker_trades
            WHERE ${where.join(' AND ')}
            ORDER BY COALESCE(fill_timestamp, exchange_timestamp, order_timestamp) DESC`,
        )
        .all(...args) as BrokerTradeRow[];
      return rows.map(rowToBrokerTrade);
    },

    getBrokerTradeSync(): BrokerTradeSync | null {
      const row = db
        .prepare('SELECT * FROM broker_trade_syncs WHERE user_id = ?')
        .get(userId) as BrokerTradeSyncRow | undefined;
      return row ? rowToBrokerTradeSync(row) : null;
    },

    recordBrokerTradeSyncSuccess(at: string, fillsTotal: number): void {
      db.prepare(
        `INSERT INTO broker_trade_syncs (user_id, last_success_at, last_attempt_at, last_error, fills_total)
         VALUES (?, ?, ?, NULL, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           last_success_at = excluded.last_success_at,
           last_attempt_at = excluded.last_attempt_at,
           last_error      = NULL,
           fills_total     = excluded.fills_total`,
      ).run(userId, at, at, fillsTotal);
    },

    recordBrokerTradeSyncFailure(at: string, error: string): void {
      db.prepare(
        `INSERT INTO broker_trade_syncs (user_id, last_attempt_at, last_error, fills_total)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(user_id) DO UPDATE SET
           last_attempt_at = excluded.last_attempt_at,
           last_error      = excluded.last_error`,
      ).run(userId, at, error);
    },
  };
}

export type UserRepo = ReturnType<typeof createUserRepo>;

// ─── broker_trades types ──────────────────────────────────────────────

export interface BrokerTradeUpsertRow {
  tradeId: string;
  orderId: string;
  exchangeOrderId?: string;
  tradingsymbol: string;
  exchange: string;
  instrumentToken?: number;
  transactionType: 'BUY' | 'SELL';
  product?: string;
  quantity: number;
  /** Integer paise. */
  averagePricePaise: number;
  fillTimestamp?: string;
  exchangeTimestamp?: string;
  orderTimestamp?: string;
  /** YYYY-MM-DD in IST. */
  tradeDate: string;
}

export interface BrokerTrade {
  tradeId: string;
  orderId: string;
  exchangeOrderId: string | null;
  tradingsymbol: string;
  exchange: string;
  instrumentToken: number | null;
  transactionType: 'BUY' | 'SELL';
  product: string | null;
  quantity: number;
  averagePricePaise: number;
  fillTimestamp: string | null;
  exchangeTimestamp: string | null;
  orderTimestamp: string | null;
  tradeDate: string;
  syncedAt: string;
}

interface BrokerTradeRow {
  user_id: string;
  trade_id: string;
  order_id: string;
  exchange_order_id: string | null;
  tradingsymbol: string;
  exchange: string;
  instrument_token: number | null;
  transaction_type: 'BUY' | 'SELL';
  product: string | null;
  quantity: number;
  average_price_paise: number;
  fill_timestamp: string | null;
  exchange_timestamp: string | null;
  order_timestamp: string | null;
  trade_date: string;
  synced_at: string;
}

function rowToBrokerTrade(row: BrokerTradeRow): BrokerTrade {
  return {
    tradeId: row.trade_id,
    orderId: row.order_id,
    exchangeOrderId: row.exchange_order_id,
    tradingsymbol: row.tradingsymbol,
    exchange: row.exchange,
    instrumentToken: row.instrument_token,
    transactionType: row.transaction_type,
    product: row.product,
    quantity: row.quantity,
    averagePricePaise: row.average_price_paise,
    fillTimestamp: row.fill_timestamp,
    exchangeTimestamp: row.exchange_timestamp,
    orderTimestamp: row.order_timestamp,
    tradeDate: row.trade_date,
    syncedAt: row.synced_at,
  };
}

export interface BrokerTradeSync {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  fillsTotal: number;
}

interface BrokerTradeSyncRow {
  user_id: string;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  fills_total: number;
}

function rowToBrokerTradeSync(row: BrokerTradeSyncRow): BrokerTradeSync {
  return {
    lastSuccessAt: row.last_success_at,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
    fillsTotal: row.fills_total,
  };
}
