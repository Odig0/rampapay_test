import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { DATABASE, openDatabase } from '../database/database';
import { IngestionService, IngestSummary } from './ingestion.service';
import { IngestSource, PAYOUT_EVENTS, USDT_DEPOSITS } from './sources';

const DATA_DIR = join(__dirname, '..', '..', 'data');

const TABLES = [
  'usdt_deposits',
  'funding_webhooks',
  'payout_events',
  'reference_rates',
  'ingest_conflicts',
  'ingest_rejections',
];

const payout = {
  event_id: 'pe_1',
  payout_id: 'P1',
  type: 'CONFIRM',
  amount_bs: 6200,
  timestamp: '2026-10-05T08:40:00-04:00',
};

describe('IngestionService', () => {
  let db: Database.Database;
  let service: IngestionService;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    const moduleRef = await Test.createTestingModule({
      providers: [IngestionService, { provide: DATABASE, useValue: db }],
    }).compile();
    service = moduleRef.get(IngestionService);
  });

  afterEach(() => {
    db.close();
  });

  function countRows(table: string): number {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number;
    };
    return row.n;
  }

  function countAllTables(): Record<string, number> {
    return Object.fromEntries(TABLES.map((table) => [table, countRows(table)]));
  }

  function ingestPayouts(events: object[]): IngestSummary {
    return service.ingestText(PAYOUT_EVENTS, JSON.stringify(events));
  }

  it('ingesting the provided files twice leaves the same rows and reports only duplicates', () => {
    const first = service.ingestAll(DATA_DIR);
    const rowsAfterFirst = countAllTables();

    const second = service.ingestAll(DATA_DIR);

    expect(first).toEqual([
      {
        source: 'usdt_deposits',
        read: 5,
        inserted: 5,
        duplicates: 0,
        conflicts: 0,
        invalid: 0,
      },
      {
        source: 'funding_webhooks',
        read: 4,
        inserted: 4,
        duplicates: 0,
        conflicts: 0,
        invalid: 0,
      },
      // pe_0029 appears twice in the file with identical content.
      {
        source: 'payout_events',
        read: 53,
        inserted: 52,
        duplicates: 1,
        conflicts: 0,
        invalid: 0,
      },
      {
        source: 'reference_rates',
        read: 14,
        inserted: 14,
        duplicates: 0,
        conflicts: 0,
        invalid: 0,
      },
    ]);
    expect(countAllTables()).toEqual(rowsAfterFirst);
    for (const summary of second) {
      expect(summary).toMatchObject({
        inserted: 0,
        duplicates: summary.read,
        conflicts: 0,
        invalid: 0,
      });
    }
  });

  it('stores an event repeated in the same file only once', () => {
    const summary = ingestPayouts([payout, payout]);

    expect(summary).toMatchObject({ read: 2, inserted: 1, duplicates: 1 });
    expect(countRows('payout_events')).toBe(1);
  });

  it('ignores a UTF-8 BOM at the start of the file', () => {
    const bom = String.fromCharCode(0xfeff);

    const summary = service.ingestText(
      USDT_DEPOSITS,
      bom +
        'tx_hash,amount_usdt,timestamp\n0xabc,5000.00,2026-10-05T08:10:00-04:00',
    );

    expect(summary).toMatchObject({ inserted: 1, invalid: 0 });
  });

  it('treats the same values written differently as a duplicate, not a conflict', () => {
    const header = 'tx_hash,amount_usdt,timestamp\n';
    service.ingestText(
      USDT_DEPOSITS,
      header + '0xabc,5000.00,2026-10-05T08:10:00-04:00',
    );

    const summary = service.ingestText(
      USDT_DEPOSITS,
      header + '0xabc,5000,2026-10-05T12:10:00Z',
    );

    expect(summary).toMatchObject({ duplicates: 1, conflicts: 0 });
  });

  it('logs a conflict for the same key with different content and keeps the original row', () => {
    ingestPayouts([payout]);

    const summary = ingestPayouts([{ ...payout, amount_bs: 9999 }]);

    expect(summary).toMatchObject({ inserted: 0, duplicates: 0, conflicts: 1 });
    const stored = db
      .prepare(
        `SELECT amount_bs_cents FROM payout_events WHERE event_id = 'pe_1'`,
      )
      .get();
    expect(stored).toEqual({ amount_bs_cents: 620000 });

    const conflicts = db.prepare(`SELECT * FROM ingest_conflicts`).all();
    expect(conflicts).toEqual([
      {
        id: 1,
        source: 'payout_events',
        natural_key: 'pe_1',
        existing_raw: JSON.stringify(payout),
        incoming_raw: JSON.stringify({ ...payout, amount_bs: 9999 }),
      },
    ]);

    // Seeing the same conflicting version again does not log it twice.
    ingestPayouts([{ ...payout, amount_bs: 9999 }]);
    expect(countRows('ingest_conflicts')).toBe(1);
  });

  it('reports an invalid row, logs it in ingest_rejections and does not insert it', () => {
    const invalid = { ...payout, event_id: 'pe_2', amount_bs: 0 };

    const summary = ingestPayouts([payout, invalid]);

    expect(summary).toMatchObject({ read: 2, inserted: 1, invalid: 1 });
    expect(countRows('payout_events')).toBe(1);
    expect(
      db
        .prepare(
          `SELECT source, row_number, reason, raw FROM ingest_rejections`,
        )
        .all(),
    ).toEqual([
      {
        source: 'payout_events',
        row_number: 2,
        reason: 'amount_bs must be a positive number',
        raw: JSON.stringify(invalid),
      },
    ]);

    ingestPayouts([payout, invalid]);
    expect(countRows('ingest_rejections')).toBe(1);
  });

  it('rolls back the whole file if an insert fails unexpectedly', () => {
    // Simulates a bug that lets a zero amount through validation: the
    // database CHECK constraint rejects it and the first row is undone too.
    const buggySource: IngestSource = {
      ...PAYOUT_EVENTS,
      parseRow: (row) => {
        const parsed = PAYOUT_EVENTS.parseRow(row);
        return row.rowNumber === 2 && parsed.ok
          ? { ok: true, record: { ...parsed.record, amount_bs_cents: 0 } }
          : parsed;
      },
    };
    const events = [payout, { ...payout, event_id: 'pe_2' }];

    expect(() =>
      service.ingestText(buggySource, JSON.stringify(events)),
    ).toThrow('CHECK constraint failed');
    expect(countRows('payout_events')).toBe(0);
  });
});
