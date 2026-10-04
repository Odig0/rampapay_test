import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { DATABASE, openDatabase } from '../database/database';
import { IngestionService } from '../ingestion/ingestion.service';
import { LedgerService } from '../ledger/ledger.service';
import { ReportController } from './report.controller';
import { ReconciliationReport, ReportService } from './report.service';

const DATA_DIR = join(__dirname, '..', '..', 'data');

// Real HTTP requests (Node's fetch) against the app on a random port, so the
// ValidationPipe on the query is exercised too.
describe('ReportController (GET /report)', () => {
  let db: Database.Database;
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    db = openDatabase(':memory:');
    const moduleRef = await Test.createTestingModule({
      controllers: [ReportController],
      providers: [
        IngestionService,
        LedgerService,
        ReportService,
        { provide: DATABASE, useValue: db },
      ],
    }).compile();
    moduleRef.get(IngestionService).ingestAll(DATA_DIR);
    moduleRef.get(LedgerService).postAll();

    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it('returns the report at 20:00 Bolivia time by default', async () => {
    const response = await fetch(`${baseUrl}/report`);
    const body = (await response.json()) as ReconciliationReport;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      asOf: '2026-10-05T20:00:00-04:00',
      balances: { bsInPendingPayouts: { amount: '3900.00', currency: 'BS' } },
      breakCount: { HIGH: 3, MEDIUM: 3 },
    });
  });

  it('accepts another cut-off time', async () => {
    const response = await fetch(
      `${baseUrl}/report?asOf=2026-10-05T12:00:00-04:00`,
    );
    const body = (await response.json()) as ReconciliationReport;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      asOf: '2026-10-05T12:00:00-04:00',
      asOfUtc: '2026-10-05T16:00:00Z',
      // By noon P001-P007 had happened: P007 failed, the other six completed
      // (P005 is reversed only at 18:30, after this cut-off).
      payouts: { COMPLETED: { count: 6 }, FAILED: { count: 1 } },
      breaks: [],
    });
  });

  it.each(['yesterday', '2026-10-05T20:00:00', '2026-02-30T20:00:00-04:00'])(
    'rejects an invalid asOf %p with 400',
    async (asOf) => {
      const response = await fetch(
        `${baseUrl}/report?asOf=${encodeURIComponent(asOf)}`,
      );
      const body = (await response.json()) as { message: string[] };

      expect(response.status).toBe(400);
      expect(body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('asOf')]),
      );
    },
  );
});
