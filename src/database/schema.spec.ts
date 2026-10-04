import Database from 'better-sqlite3';
import { openDatabase } from './database';
import { SCHEMA_SQL } from './schema';

describe('schema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates all tables', () => {
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
      )
      .all()
      .map((row: { name: string }) => row.name);

    expect(tables).toEqual([
      'funding_webhooks',
      'ingest_conflicts',
      'ingest_rejections',
      'ledger_accounts',
      'ledger_entries',
      'ledger_lines',
      'payout_events',
      'reference_rates',
      'usdt_deposits',
    ]);
  });

  it('can be applied again on an existing database', () => {
    expect(() => db.exec(SCHEMA_SQL)).not.toThrow();
  });

  it('rejects a non-integer amount (STRICT)', () => {
    const insert = db.prepare(
      `INSERT INTO usdt_deposits (tx_hash, amount_usdt_micro, ts_utc, raw)
       VALUES (?, ?, ?, ?)`,
    );

    expect(() =>
      insert.run('0xabc', 5000.5, '2026-10-05T12:10:00Z', 'raw'),
    ).toThrow();
  });

  it('rejects an unknown payout type and a non-positive amount (CHECK)', () => {
    const insert = db.prepare(
      `INSERT INTO payout_events (event_id, payout_id, type, amount_bs_cents, ts_utc, raw)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    expect(() =>
      insert.run('pe_1', 'P1', 'CANCELLED', 100, '2026-10-05T12:10:00Z', 'raw'),
    ).toThrow();
    expect(() =>
      insert.run('pe_2', 'P1', 'PREVIEW', 0, '2026-10-05T12:10:00Z', 'raw'),
    ).toThrow();
  });

  describe('ledger', () => {
    function insertEntry(): number {
      const result = db
        .prepare(
          `INSERT INTO ledger_entries (entry_key, type, effective_at, source_table, source_id)
           VALUES ('deposit:0xabc', 'DEPOSIT', '2026-10-05T12:10:00Z', 'usdt_deposits', '0xabc')`,
        )
        .run();
      return Number(result.lastInsertRowid);
    }

    function insertLine(entryId: number, account: string, currency: string) {
      db.prepare(
        `INSERT INTO ledger_lines (entry_id, account, currency, direction, amount_minor)
         VALUES (?, ?, ?, 'DEBIT', 100)`,
      ).run(entryId, account, currency);
    }

    it('seeds the six accounts once, even if the schema runs again', () => {
      db.exec(SCHEMA_SQL);

      expect(
        db
          .prepare(`SELECT code, currency FROM ledger_accounts ORDER BY code`)
          .all(),
      ).toEqual([
        { code: 'bs:conversion', currency: 'BS' },
        { code: 'bs:paid_out', currency: 'BS' },
        { code: 'bs:provider_available', currency: 'BS' },
        { code: 'usdt:conversion', currency: 'USDT' },
        { code: 'usdt:partner_funding', currency: 'USDT' },
        { code: 'usdt:pending_conversion', currency: 'USDT' },
      ]);
    });

    it('accepts a line in the currency of its account', () => {
      const entryId = insertEntry();

      expect(() =>
        insertLine(entryId, 'usdt:pending_conversion', 'USDT'),
      ).not.toThrow();
    });

    it('rejects a line in a currency the account does not hold, or an unknown account', () => {
      const entryId = insertEntry();

      expect(() => insertLine(entryId, 'bs:paid_out', 'USDT')).toThrow(
        'FOREIGN KEY constraint failed',
      );
      expect(() => insertLine(entryId, 'bs:typo', 'BS')).toThrow(
        'FOREIGN KEY constraint failed',
      );
    });

    it('rejects a line for an entry that does not exist', () => {
      expect(() => insertLine(999, 'bs:paid_out', 'BS')).toThrow(
        'FOREIGN KEY constraint failed',
      );
    });

    it('is append-only: UPDATE and DELETE are rejected', () => {
      const entryId = insertEntry();
      insertLine(entryId, 'bs:paid_out', 'BS');

      for (const sql of [
        `UPDATE ledger_entries SET effective_at = 'x'`,
        `DELETE FROM ledger_entries`,
        `UPDATE ledger_lines SET amount_minor = 1`,
        `DELETE FROM ledger_lines`,
      ]) {
        expect(() => db.exec(sql)).toThrow('ledger is append-only');
      }
    });
  });
});
