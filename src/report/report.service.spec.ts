import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { DATABASE, openDatabase } from '../database/database';
import { IngestionService } from '../ingestion/ingestion.service';
import { PAYOUT_EVENTS } from '../ingestion/sources';
import { toUtc } from '../ingestion/timestamps';
import { LedgerService } from '../ledger/ledger.service';
import { ReportService } from './report.service';

const DATA_DIR = join(__dirname, '..', '..', 'data');
const REPORT_AS_OF = toUtc('2026-10-05T20:00:00-04:00');

describe('ReportService', () => {
  let db: Database.Database;
  let ingestion: IngestionService;
  let ledger: LedgerService;
  let report: ReportService;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    const moduleRef = await Test.createTestingModule({
      providers: [
        IngestionService,
        LedgerService,
        ReportService,
        { provide: DATABASE, useValue: db },
      ],
    }).compile();
    ingestion = moduleRef.get(IngestionService);
    ledger = moduleRef.get(LedgerService);
    report = moduleRef.get(ReportService);
  });

  afterEach(() => {
    db.close();
  });

  describe('with the provided files at 20:00 Bolivia time', () => {
    beforeEach(() => {
      ingestion.ingestAll(DATA_DIR);
      ledger.postAll();
    });

    it('reports the four balances from the brief', () => {
      expect(report.getBalances(REPORT_AS_OF)).toEqual({
        usdtNotConverted: 1_500_000_000, // 1,500.00 USDT
        bsAvailableAtProvider: 1_212_095, // 12,120.95 Bs
        bsPaidOut: 12_950_555, // 129,505.55 Bs
        bsInPendingPayouts: 390_000, // 3,900.00 Bs (P018)
      });
    });

    it('summarizes pay-outs by status', () => {
      expect(report.getPayoutSummary(REPORT_AS_OF)).toEqual({
        COMPLETED: { count: 13, amountBsCents: 12_950_555 },
        REVERSED: { count: 1, amountBsCents: 310_000 }, // P005
        FAILED: { count: 2, amountBsCents: 910_000 }, // P007, P016
        EXPIRED: { count: 1, amountBsCents: 275_025 }, // P009
        PENDING: { count: 1, amountBsCents: 390_000 }, // P018
      });
    });
  });

  it('ignores events after the cut-off: a pay-out completed at 20:05 is still pending at 20:00', () => {
    const confirm = {
      event_id: 'pe_1',
      payout_id: 'P1',
      type: 'CONFIRM',
      amount_bs: 500,
      timestamp: '2026-10-05T19:50:00-04:00',
    };
    const completed = {
      ...confirm,
      event_id: 'pe_2',
      type: 'COMPLETED',
      timestamp: '2026-10-05T20:05:00-04:00',
    };
    ingestion.ingestText(PAYOUT_EVENTS, JSON.stringify([confirm, completed]));
    ledger.postAll();

    expect(report.getBalances(REPORT_AS_OF)).toMatchObject({
      bsInPendingPayouts: 50_000,
      bsPaidOut: 0,
    });
  });
});
