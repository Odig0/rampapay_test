// Database schema. Every statement is idempotent (IF NOT EXISTS), so it is
// safe to run on every start-up against an existing database file.
//
// Conventions:
// - Money is stored as INTEGER in the smallest unit, never as REAL:
//     *_usdt_micro  USDT x 10^6
//     *_bs_cents    Bs   x 10^2
//     *_micro rates rate x 10^6
// - ts_utc is ISO 8601 in UTC with a fixed width ("2026-10-05T12:10:00Z"),
//   so ordering by the text column is the same as ordering by time.
// - raw keeps the original row exactly as received (CSV line or JSON object),
//   including the original -04:00 timestamp.
// - STRICT makes SQLite reject values of the wrong type instead of storing them.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS usdt_deposits (
  tx_hash           TEXT    PRIMARY KEY,
  amount_usdt_micro INTEGER NOT NULL CHECK (amount_usdt_micro > 0),
  ts_utc            TEXT    NOT NULL,
  raw               TEXT    NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS funding_webhooks (
  event_id          TEXT    PRIMARY KEY,
  deposit_tx_hash   TEXT    NOT NULL,
  amount_usdt_micro INTEGER NOT NULL CHECK (amount_usdt_micro > 0),
  rate_micro        INTEGER NOT NULL CHECK (rate_micro > 0),
  amount_bs_cents   INTEGER NOT NULL CHECK (amount_bs_cents > 0),
  ts_utc            TEXT    NOT NULL,
  raw               TEXT    NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS payout_events (
  event_id        TEXT    PRIMARY KEY,
  payout_id       TEXT    NOT NULL,
  type            TEXT    NOT NULL
                  CHECK (type IN ('PREVIEW', 'CONFIRM', 'COMPLETED', 'FAILED', 'REVERSED')),
  amount_bs_cents INTEGER NOT NULL CHECK (amount_bs_cents > 0),
  ts_utc          TEXT    NOT NULL,
  raw             TEXT    NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS reference_rates (
  ts_utc        TEXT    PRIMARY KEY,
  usdt_bs_micro INTEGER NOT NULL CHECK (usdt_bs_micro > 0),
  raw           TEXT    NOT NULL
) STRICT;

-- Same natural key, different content. The original row is never overwritten.
CREATE TABLE IF NOT EXISTS ingest_conflicts (
  id           INTEGER PRIMARY KEY,
  source       TEXT    NOT NULL,
  natural_key  TEXT    NOT NULL,
  existing_raw TEXT    NOT NULL,
  incoming_raw TEXT    NOT NULL,
  UNIQUE (source, natural_key, incoming_raw)
) STRICT;

-- Rows that failed format validation and were not inserted.
CREATE TABLE IF NOT EXISTS ingest_rejections (
  id         INTEGER PRIMARY KEY,
  source     TEXT    NOT NULL,
  row_number INTEGER NOT NULL,
  reason     TEXT    NOT NULL,
  raw        TEXT    NOT NULL,
  UNIQUE (source, raw)
) STRICT;
`;
