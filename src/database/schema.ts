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

-- ---------------------------------------------------------------------------
-- Double-entry ledger
-- ---------------------------------------------------------------------------

-- Chart of accounts. Each account holds a single currency.
CREATE TABLE IF NOT EXISTS ledger_accounts (
  code     TEXT PRIMARY KEY,
  currency TEXT NOT NULL CHECK (currency IN ('USDT', 'BS')),
  -- Target of the (account, currency) foreign key in ledger_lines.
  UNIQUE (code, currency)
) STRICT;

INSERT INTO ledger_accounts (code, currency) VALUES
  ('usdt:partner_funding',     'USDT'),
  ('usdt:pending_conversion',  'USDT'),
  ('usdt:conversion',          'USDT'),
  ('bs:conversion',            'BS'),
  ('bs:provider_available',    'BS'),
  ('bs:paid_out',              'BS')
ON CONFLICT (code) DO NOTHING;

-- One row per journal entry. entry_key is a business key
-- (e.g. "deposit:<tx_hash>", "payout:<payout_id>:COMPLETED"), so posting the
-- same event twice is a no-op.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id           INTEGER PRIMARY KEY,
  entry_key    TEXT    NOT NULL UNIQUE,
  type         TEXT    NOT NULL
               CHECK (type IN ('DEPOSIT', 'FUNDING', 'PAYOUT_COMPLETED', 'PAYOUT_REVERSED')),
  effective_at TEXT    NOT NULL, -- ts_utc of the source event
  source_table TEXT    NOT NULL,
  source_id    TEXT    NOT NULL  -- tx_hash or event_id in source_table
) STRICT;

-- Lines of an entry. amount_minor is always positive and in the smallest unit
-- of the currency (micro-USDT or Bs cents); the sign comes from direction.
CREATE TABLE IF NOT EXISTS ledger_lines (
  id           INTEGER PRIMARY KEY,
  entry_id     INTEGER NOT NULL REFERENCES ledger_entries (id),
  account      TEXT    NOT NULL,
  currency     TEXT    NOT NULL,
  direction    TEXT    NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  -- Rejects unknown accounts and lines in a currency the account does not hold.
  FOREIGN KEY (account, currency) REFERENCES ledger_accounts (code, currency)
) STRICT;

-- The ledger is append-only: corrections are new entries, never edits.
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_update
BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

CREATE TRIGGER IF NOT EXISTS ledger_entries_no_delete
BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

CREATE TRIGGER IF NOT EXISTS ledger_lines_no_update
BEFORE UPDATE ON ledger_lines
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

CREATE TRIGGER IF NOT EXISTS ledger_lines_no_delete
BEFORE DELETE ON ledger_lines
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
`;
