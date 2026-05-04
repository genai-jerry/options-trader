-- 003_zerodha_credentials — store Kite Connect API credentials in the DB
-- so they can be configured from the Settings UI instead of the .env file.
--
-- Singleton row (id=1). Values are stored in plaintext on disk; the SQLite
-- file should be protected at the filesystem layer (and the volume backed
-- up the same way you back up trade data).

CREATE TABLE IF NOT EXISTS zerodha_credentials (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  api_key     TEXT,
  api_secret  TEXT,
  updated_at  TEXT
);

INSERT OR IGNORE INTO zerodha_credentials (id) VALUES (1);
