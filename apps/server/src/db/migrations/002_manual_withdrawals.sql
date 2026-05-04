-- 002_manual_withdrawals — let users manually withdraw cash from the
-- corpus. Two changes to pending_withdrawals:
--   1. from_trade_id becomes nullable (manual withdrawals have no source
--      trade).
--   2. add a `source` column to distinguish AUTO (R2 split) from MANUAL
--      (user-initiated).
--
-- SQLite can't drop NOT NULL via ALTER TABLE, so we recreate. All
-- existing rows are R2-driven, so they get source='AUTO'.

CREATE TABLE pending_withdrawals_new (
  id            TEXT    PRIMARY KEY,
  amount        INTEGER NOT NULL CHECK (amount >= 0),
  from_trade_id TEXT    REFERENCES trades(id) ON DELETE RESTRICT,
  source        TEXT    NOT NULL DEFAULT 'AUTO' CHECK (source IN ('AUTO','MANUAL')),
  status        TEXT    NOT NULL CHECK (status IN ('PENDING','CONFIRMED','CANCELLED')),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at    TEXT
);

INSERT INTO pending_withdrawals_new (id, amount, from_trade_id, source, status, created_at, decided_at)
SELECT id, amount, from_trade_id, 'AUTO', status, created_at, decided_at
  FROM pending_withdrawals;

DROP TABLE pending_withdrawals;
ALTER TABLE pending_withdrawals_new RENAME TO pending_withdrawals;

CREATE INDEX idx_withdrawals_status ON pending_withdrawals(status);
CREATE INDEX idx_withdrawals_source ON pending_withdrawals(source);
