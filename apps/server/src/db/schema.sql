-- Canonical schema for the options-trader backend.
--
-- Money invariant: every monetary column is INTEGER paise. No REAL/FLOAT.
-- The migration runner records applied versions in `schema_versions`.
--
-- This file is informational; the migration runner applies the files in
-- src/db/migrations/ in order. Keep this file in sync as a reference for
-- the live shape of the database.

CREATE TABLE IF NOT EXISTS schema_versions (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  applied_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  google_sub      TEXT UNIQUE,
  email           TEXT NOT NULL,
  name            TEXT,
  picture         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS account (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  principal_x       INTEGER,
  fee_percent       REAL    NOT NULL DEFAULT 0.05,
  position_size_cap REAL    NOT NULL DEFAULT 0.25,
  phase             TEXT    NOT NULL DEFAULT 'BOOTSTRAP'
                              CHECK (phase IN ('BOOTSTRAP','SELF_SUSTAINING','LOCKED')),
  investable_corpus INTEGER NOT NULL DEFAULT 0,
  set_aside         INTEGER NOT NULL DEFAULT 0,
  cash_withdrawn    INTEGER NOT NULL DEFAULT 0,
  realized_pnl      INTEGER NOT NULL DEFAULT 0,
  fees_paid         INTEGER NOT NULL DEFAULT 0,
  ai_enabled        INTEGER NOT NULL DEFAULT 1 CHECK (ai_enabled IN (0,1)),
  lock_override_at  TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS trades (
  id            TEXT    PRIMARY KEY,
  user_id       TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol        TEXT    NOT NULL,
  instrument    TEXT    NOT NULL CHECK (instrument IN ('CE','PE','FUT')),
  strike        INTEGER,
  expiry        TEXT    NOT NULL,
  lot_size      INTEGER NOT NULL CHECK (lot_size > 0),
  qty           INTEGER NOT NULL CHECK (qty > 0),
  entry_price   INTEGER NOT NULL,
  entry_at      TEXT    NOT NULL,
  exit_price    INTEGER,
  exit_at       TEXT,
  status        TEXT    NOT NULL CHECK (status IN ('OPEN','CLOSED')),
  fees          INTEGER,
  gross_pnl     INTEGER,
  net_pnl       INTEGER,
  notes         TEXT,
  agent_source  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_trades_user   ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);

CREATE TABLE IF NOT EXISTS pending_withdrawals (
  id            TEXT    PRIMARY KEY,
  user_id       TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount        INTEGER NOT NULL CHECK (amount >= 0),
  from_trade_id TEXT    REFERENCES trades(id) ON DELETE RESTRICT,
  source        TEXT    NOT NULL DEFAULT 'AUTO' CHECK (source IN ('AUTO','MANUAL')),
  status        TEXT    NOT NULL CHECK (status IN ('PENDING','CONFIRMED','CANCELLED')),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user   ON pending_withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON pending_withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_source ON pending_withdrawals(source);

CREATE TABLE IF NOT EXISTS decisions (
  id              TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_id        TEXT    REFERENCES trades(id) ON DELETE SET NULL,
  input_json      TEXT    NOT NULL,
  checks_json     TEXT    NOT NULL,
  verdict         TEXT    NOT NULL CHECK (verdict IN ('GO','WARN','BLOCK')),
  decided_at      TEXT    NOT NULL,
  accepted_by_user INTEGER NOT NULL CHECK (accepted_by_user IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_decisions_user ON decisions(user_id);

CREATE TABLE IF NOT EXISTS advisor_messages (
  id              TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT    NOT NULL,
  role            TEXT    NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  content         TEXT    NOT NULL,
  tool_payload    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_advisor_user ON advisor_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_advisor_messages_conv
  ON advisor_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS zerodha_sessions (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  user_id_kite  TEXT,
  user_name     TEXT,
  access_token  TEXT,
  public_token  TEXT,
  login_at      TEXT,
  expires_at    TEXT
);

CREATE TABLE IF NOT EXISTS zerodha_credentials (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_key     TEXT,
  api_secret  TEXT,
  updated_at  TEXT
);
