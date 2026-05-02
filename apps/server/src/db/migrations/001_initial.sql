-- 001_initial — initial schema: account, trades, pending_withdrawals,
-- decisions, advisor_messages, zerodha_sessions.
-- The migration runner wraps this in a transaction.

CREATE TABLE IF NOT EXISTS account (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
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

CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);

CREATE TABLE IF NOT EXISTS pending_withdrawals (
  id            TEXT    PRIMARY KEY,
  amount        INTEGER NOT NULL CHECK (amount >= 0),
  from_trade_id TEXT    NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
  status        TEXT    NOT NULL CHECK (status IN ('PENDING','CONFIRMED','CANCELLED')),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON pending_withdrawals(status);

CREATE TABLE IF NOT EXISTS decisions (
  id              TEXT    PRIMARY KEY,
  trade_id        TEXT    REFERENCES trades(id) ON DELETE SET NULL,
  input_json      TEXT    NOT NULL,
  checks_json     TEXT    NOT NULL,
  verdict         TEXT    NOT NULL CHECK (verdict IN ('GO','WARN','BLOCK')),
  decided_at      TEXT    NOT NULL,
  accepted_by_user INTEGER NOT NULL CHECK (accepted_by_user IN (0,1))
);

CREATE TABLE IF NOT EXISTS advisor_messages (
  id              TEXT    PRIMARY KEY,
  conversation_id TEXT    NOT NULL,
  role            TEXT    NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  content         TEXT    NOT NULL,
  tool_payload    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_advisor_messages_conv
  ON advisor_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS zerodha_sessions (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  user_id       TEXT,
  user_name     TEXT,
  access_token  TEXT,
  public_token  TEXT,
  login_at      TEXT,
  expires_at    TEXT
);

-- Seed: ensure exactly one account row exists. principal_x stays NULL until
-- Settings sets it (D9). All money columns start at 0.
INSERT OR IGNORE INTO account (id) VALUES (1);
