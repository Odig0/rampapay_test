# Rampa — payments reconciliation

Take-home for Rampa (brief in [BRIEF.md](BRIEF.md)). Nest.js + TypeScript + SQLite
(`better-sqlite3`, plain SQL, no ORM).

**Status:** step 1 (ingestion) is done. The double-entry ledger, balances and
breaks report come next.

## How to run

Requires Node.js 22+ and Yarn 1.

```bash
yarn install
yarn ingest   # loads data/ into rampa.db and prints a summary per file
yarn test     # unit + integration tests (in-memory SQLite)
```

Environment variables (optional):

| Variable   | Default    | Meaning                         |
|------------|------------|---------------------------------|
| `DATA_DIR` | `data`     | Folder with the four input files |
| `DB_PATH`  | `rampa.db` | SQLite file (`:memory:` works)  |

`rampa.db` is a generated artifact (git-ignored). Delete it to start from scratch.

## Ingestion (step 1)

Ingestion only loads and validates the files. It applies **no business
logic**: it does not sort events, match webhooks to deposits or check the
pay-out state machine. Events may arrive duplicated and out of order; that is
resolved in the next step, which reads these tables.

### Tables

One raw table per input file, keyed by its natural key:

| Table              | Primary key | Source file             |
|--------------------|-------------|-------------------------|
| `usdt_deposits`    | `tx_hash`   | `usdt_deposits.csv`     |
| `funding_webhooks` | `event_id`  | `funding_webhooks.json` |
| `payout_events`    | `event_id`  | `payout_events.json`    |
| `reference_rates`  | `ts_utc`    | `reference_rates.csv`   |

Plus two review tables: `ingest_conflicts` (same key, different content) and
`ingest_rejections` (rows that failed validation). The full schema is in
[src/database/schema.ts](src/database/schema.ts).

There is deliberately no foreign key from `funding_webhooks.deposit_tx_hash`
to `usdt_deposits`: a webhook for an unknown deposit is a reconciliation break
to report, not a row to drop, and the files can be loaded in any order.

### Money and time

- **Money is never a float.** Amounts are stored as integers in the smallest
  unit: Bs in cents (×10²), USDT in micro-USDT (×10⁶), rates ×10⁶. The
  conversion splits the decimal text instead of multiplying
  (`"48972.5"` → `"48972" + "50"` → `4897250`), and a value with more decimals
  than the unit allows is rejected rather than rounded.
- **Timestamps are normalized to UTC** in a fixed-width format
  (`2026-10-05T12:18:00Z`), so ordering the text equals ordering by time. The
  original value with its `-04:00` offset is kept in the `raw` column. A
  timestamp without an offset, or an impossible date, is rejected.

### Duplicates, conflicts and invalid rows

Each file is processed in one transaction. For every row:

1. **Validate** with a class-validator DTO (required fields, types, known
   pay-out type, amount > 0), then convert to integers and UTC. Failure →
   `invalid`, logged in `ingest_rejections`, not inserted.
2. `INSERT ... ON CONFLICT (key) DO NOTHING`. One row changed → `inserted`.
3. Otherwise the key already exists: compare the **normalized** values with the
   stored row. Equal → `duplicate` (ignored). Different → `conflict`, logged in
   `ingest_conflicts`; the original row is never overwritten.

Idempotency is enforced by the database (primary keys and unique constraints),
not by in-memory state, so re-ingesting the same files leaves exactly the same
rows — including in the two review tables.

### Run output

First run on an empty database, then a second run on the same files:

```
$ yarn ingest
┌─────────┬────────────────────┬──────┬──────────┬────────────┬───────────┬─────────┐
│ (index) │ source             │ read │ inserted │ duplicates │ conflicts │ invalid │
├─────────┼────────────────────┼──────┼──────────┼────────────┼───────────┼─────────┤
│ 0       │ 'usdt_deposits'    │ 5    │ 5        │ 0          │ 0         │ 0       │
│ 1       │ 'funding_webhooks' │ 4    │ 4        │ 0          │ 0         │ 0       │
│ 2       │ 'payout_events'    │ 53   │ 52       │ 1          │ 0         │ 0       │
│ 3       │ 'reference_rates'  │ 14   │ 14       │ 0          │ 0         │ 0       │
└─────────┴────────────────────┴──────┴──────────┴────────────┴───────────┴─────────┘

$ yarn ingest
┌─────────┬────────────────────┬──────┬──────────┬────────────┬───────────┬─────────┐
│ (index) │ source             │ read │ inserted │ duplicates │ conflicts │ invalid │
├─────────┼────────────────────┼──────┼──────────┼────────────┼───────────┼─────────┤
│ 0       │ 'usdt_deposits'    │ 5    │ 0        │ 5          │ 0         │ 0       │
│ 1       │ 'funding_webhooks' │ 4    │ 0        │ 4          │ 0         │ 0       │
│ 2       │ 'payout_events'    │ 53   │ 0        │ 53         │ 0         │ 0       │
│ 3       │ 'reference_rates'  │ 14   │ 0        │ 14         │ 0         │ 0       │
└─────────┴────────────────────┴──────┴──────────┴────────────┴───────────┴─────────┘
```

The one duplicate on the first run is `pe_0029`, delivered twice with
identical content.

### Known limitations (what I would change for production)

- The schema uses `CREATE TABLE IF NOT EXISTS`, which does not alter existing
  tables; production needs versioned migrations.
- The CSV parser handles simple files only (no quoted fields); production would
  use a CSV library.
- JSON amounts pass through `JSON.parse` as floats before being converted. This
  is exact for these magnitudes; production would parse numbers as text.
- Prepared statements are created per row for readability; they would be
  prepared once per file.
