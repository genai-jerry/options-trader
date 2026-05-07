-- 006_broker_trades — per-fill cache of Zerodha Kite trades.
--
-- Kite's /trades endpoint only returns fills for the current trading day.
-- We snapshot the result every evening at 18:00 IST so the user
-- accumulates a multi-day history. Rows are a read-only mirror of broker
-- state; the rules engine never reads this table.
--
-- Money invariant: average_price_paise is integer paise (multiplied by
-- 100 from Kite's decimal rupee value, rounded half-up).

CREATE TABLE broker_trades (
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_id            TEXT NOT NULL,
  order_id            TEXT NOT NULL,
  exchange_order_id   TEXT,
  tradingsymbol       TEXT NOT NULL,
  exchange            TEXT NOT NULL,
  instrument_token    INTEGER,
  transaction_type    TEXT NOT NULL CHECK (transaction_type IN ('BUY','SELL')),
  product             TEXT,
  quantity            INTEGER NOT NULL,
  average_price_paise INTEGER NOT NULL,
  fill_timestamp      TEXT,
  exchange_timestamp  TEXT,
  order_timestamp     TEXT,
  -- Trading day in IST (YYYY-MM-DD), derived from fill_timestamp at insert.
  trade_date          TEXT NOT NULL,
  synced_at           TEXT NOT NULL,
  PRIMARY KEY (user_id, trade_id)
);
CREATE INDEX idx_broker_trades_date   ON broker_trades(user_id, trade_date);
CREATE INDEX idx_broker_trades_symbol ON broker_trades(user_id, tradingsymbol);

-- One row per user. Tracks the last successful sync and the most recent
-- failure so the UI can show "Last synced: …" + a banner when the Kite
-- session has expired.
CREATE TABLE broker_trade_syncs (
  user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_success_at  TEXT,
  last_attempt_at  TEXT,
  last_error       TEXT,
  fills_total      INTEGER NOT NULL DEFAULT 0
);
