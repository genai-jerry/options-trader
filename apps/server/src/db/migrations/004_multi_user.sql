-- 004_multi_user — turn the app into a multi-tenant store.
--
-- Adds users + sessions tables, then re-keys every data table by user_id.
-- The three singletons (account, zerodha_sessions, zerodha_credentials)
-- were CHECK (id = 1); SQLite can't drop a CHECK in place, so each is
-- recreated with user_id as the primary key.
--
-- All pre-existing data is migrated to a single placeholder user
-- (id='legacy', email='legacy@local'). After this migration:
--   - A fresh DB has zero users; the first Google login creates one.
--   - An upgraded DB has the legacy user holding all old rows. The user
--     can JSON-export from /api/backup/export, log in, then re-import.
--
-- The migration is wrapped in a transaction by the runner.

-- ── users + sessions ─────────────────────────────────────────────────
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  google_sub      TEXT UNIQUE,
  email           TEXT NOT NULL,
  name            TEXT,
  picture         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at   TEXT
);
CREATE INDEX idx_users_email ON users(email);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Placeholder user for any pre-existing rows.
INSERT INTO users (id, email, name) VALUES ('legacy', 'legacy@local', 'Legacy data');

-- ── account ──────────────────────────────────────────────────────────
CREATE TABLE account_new (
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

INSERT INTO account_new (user_id, principal_x, fee_percent, position_size_cap, phase,
                         investable_corpus, set_aside, cash_withdrawn, realized_pnl,
                         fees_paid, ai_enabled, lock_override_at, created_at)
SELECT 'legacy', principal_x, fee_percent, position_size_cap, phase,
       investable_corpus, set_aside, cash_withdrawn, realized_pnl,
       fees_paid, ai_enabled, lock_override_at, created_at
  FROM account;

DROP TABLE account;
ALTER TABLE account_new RENAME TO account;

-- ── trades ───────────────────────────────────────────────────────────
ALTER TABLE trades ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
UPDATE trades SET user_id = 'legacy' WHERE user_id IS NULL;
CREATE INDEX idx_trades_user ON trades(user_id);

-- ── pending_withdrawals ──────────────────────────────────────────────
ALTER TABLE pending_withdrawals ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
UPDATE pending_withdrawals SET user_id = 'legacy' WHERE user_id IS NULL;
CREATE INDEX idx_withdrawals_user ON pending_withdrawals(user_id);

-- ── decisions ────────────────────────────────────────────────────────
ALTER TABLE decisions ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
UPDATE decisions SET user_id = 'legacy' WHERE user_id IS NULL;
CREATE INDEX idx_decisions_user ON decisions(user_id);

-- ── advisor_messages ─────────────────────────────────────────────────
ALTER TABLE advisor_messages ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
UPDATE advisor_messages SET user_id = 'legacy' WHERE user_id IS NULL;
CREATE INDEX idx_advisor_user ON advisor_messages(user_id);

-- ── zerodha_sessions (singleton → per-user) ──────────────────────────
CREATE TABLE zerodha_sessions_new (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  user_id_kite  TEXT,
  user_name     TEXT,
  access_token  TEXT,
  public_token  TEXT,
  login_at      TEXT,
  expires_at    TEXT
);
INSERT INTO zerodha_sessions_new (user_id, user_id_kite, user_name, access_token, public_token, login_at, expires_at)
SELECT 'legacy', user_id, user_name, access_token, public_token, login_at, expires_at
  FROM zerodha_sessions;
DROP TABLE zerodha_sessions;
ALTER TABLE zerodha_sessions_new RENAME TO zerodha_sessions;

-- ── zerodha_credentials (singleton → per-user) ───────────────────────
CREATE TABLE zerodha_credentials_new (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_key     TEXT,
  api_secret  TEXT,
  updated_at  TEXT
);
INSERT INTO zerodha_credentials_new (user_id, api_key, api_secret, updated_at)
SELECT 'legacy', api_key, api_secret, updated_at FROM zerodha_credentials;
DROP TABLE zerodha_credentials;
ALTER TABLE zerodha_credentials_new RENAME TO zerodha_credentials;
