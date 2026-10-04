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

    it('reports exactly the six expected breaks, in a stable order', () => {
      expect(report.getBreaks(REPORT_AS_OF)).toEqual([
        {
          code: 'RATE_OUT_OF_RANGE',
          severity: 'HIGH',
          ref: 'fw_003',
          at: '2026-10-05T16:36:00Z',
          message:
            'rate 9.7168 is 1.20% below the reference 9.8348 of 12:00 (max spread 0.50%)',
        },
        {
          code: 'NEGATIVE_BALANCE',
          severity: 'HIGH',
          ref: 'payout:P014:COMPLETED',
          at: '2026-10-05T20:26:00Z',
          message:
            'bs:provider_available was negative from 16:26 to 17:10, minimum -2480.55 Bs, caused by payout:P014:COMPLETED',
        },
        {
          code: 'DEPOSIT_NOT_CONVERTED',
          severity: 'HIGH',
          ref: '0x12a750139ca2e4c14287bb6ed9ece9ee75b556a911f19f91c2f0d59ef40e7597',
          at: '2026-10-05T21:40:00Z',
          message:
            '1500.00 USDT deposited at 17:40 has no funding webhook after 140 min (limit 10 min)',
        },
        {
          code: 'FUNDING_LATE',
          severity: 'MEDIUM',
          ref: 'fw_004',
          at: '2026-10-05T21:10:00Z',
          message:
            'funding webhook at 17:10 arrived 145 min after its deposit at 14:45 (limit 10 min)',
        },
        {
          code: 'PAYOUT_REVERSED',
          severity: 'MEDIUM',
          ref: 'P005',
          at: '2026-10-05T22:30:00Z',
          message:
            '3100.00 Bs completed at 11:06 and reversed at 18:30; needs human review',
        },
        {
          code: 'PAYOUT_STUCK',
          severity: 'MEDIUM',
          ref: 'P018',
          at: '2026-10-05T23:11:00Z',
          message:
            '3900.00 Bs confirmed at 19:11 has no final state after 49 min (limit 15 min)',
        },
      ]);
    });

    it('builds the full report with decimal strings and break counts', () => {
      const built = report.buildReport(REPORT_AS_OF);

      expect(built).toMatchObject({
        asOf: '2026-10-05T20:00:00-04:00',
        asOfUtc: '2026-10-06T00:00:00Z',
        balances: {
          usdtNotConverted: { amount: '1500.00', currency: 'USDT' },
          bsAvailableAtProvider: { amount: '12120.95', currency: 'BS' },
          bsPaidOut: { amount: '129505.55', currency: 'BS' },
          bsInPendingPayouts: { amount: '3900.00', currency: 'BS' },
        },
        payouts: {
          PENDING: { count: 1, amount: { amount: '3900.00', currency: 'BS' } },
        },
        breakCount: { HIGH: 3, MEDIUM: 3 },
      });
      expect(built.breaks).toHaveLength(6);
    });

    it('gives the same report when everything is ingested and posted again', () => {
      const before = report.getBreaks(REPORT_AS_OF);

      ingestion.ingestAll(DATA_DIR);
      ledger.postAll();

      expect(report.getBreaks(REPORT_AS_OF)).toEqual(before);
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
