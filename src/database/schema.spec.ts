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
});
