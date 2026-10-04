import { Test } from '@nestjs/testing';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATABASE, openDatabase } from '../database/database';
import { IngestionService } from '../ingestion/ingestion.service';
import { PAYOUT_EVENTS, SOURCES, USDT_DEPOSITS } from '../ingestion/sources';
import { toUtc } from '../common/timestamps';
import { LedgerService } from './ledger.service';

const DATA_DIR = join(__dirname, '..', '..', 'data');
// Report time from the brief: 20:00 Bolivia time (UTC-4).
const REPORT_AS_OF = toUtc('2026-10-05T20:00:00-04:00');
const END_OF_TIME = '9999-12-31T23:59:59Z';

interface Services {
  db: Database.Database;
  ingestion: IngestionService;
  ledger: LedgerService;
}

async function createServices(): Promise<Services> {
  const db = openDatabase(':memory:');
  const moduleRef = await Test.createTestingModule({
    providers: [
      IngestionService,
      LedgerService,
      { provide: DATABASE, useValue: db },
    ],
  }).compile();
  return {
    db,
    ingestion: moduleRef.get(IngestionService),
    ledger: moduleRef.get(LedgerService),
  };
}

// Balance per account as { code: balance_minor }, easier to assert on.
function balancesByAccount(ledger: LedgerService, asOf = END_OF_TIME) {
  return Object.fromEntries(
    ledger.getBalances(asOf).map((b) => [b.account, b.balance_minor]),
  );
}

function countEntries(db: Database.Database): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ledger_entries`).get() as {
      n: number;
    }
  ).n;
}

// Same rows as the real file, in reverse order (CSV header stays first).
function reversedFile(fileName: string): string {
  const text = readFileSync(join(DATA_DIR, fileName), 'utf8');
  if (fileName.endsWith('.json')) {
    return JSON.stringify((JSON.parse(text) as unknown[]).reverse());
  }
  const [header, ...lines] = text.split(/\r?\n/).filter((line) => line !== '');
  return [header, ...lines.reverse()].join('\n');
}

const completed = {
  event_id: 'pe_1',
  payout_id: 'P1',
  type: 'COMPLETED',
  amount_bs: 1000,
  timestamp: '2026-10-05T10:00:00-04:00',
};

describe('LedgerService', () => {
  let services: Services;

  beforeEach(async () => {
    services = await createServices();
  });

  afterEach(() => {
    services.db.close();
  });

  describe('with the provided files', () => {
    beforeEach(() => {
      services.ingestion.ingestAll(DATA_DIR);
    });

    it('produces the expected balances at 20:00 Bolivia time', () => {
      services.ledger.postAll();

      expect(balancesByAccount(services.ledger, REPORT_AS_OF)).toEqual({
        'usdt:partner_funding': -16_000_000_000, // 16,000.00 USDT deposited
        'usdt:pending_conversion': 1_500_000_000, // 1,500.00 USDT
        'usdt:conversion': 14_500_000_000, // 14,500.00 USDT converted
        'bs:conversion': -14_162_650, // 141,626.50 Bs received
        'bs:provider_available': 1_212_095, // 12,120.95 Bs
        'bs:paid_out': 12_950_555, // 129,505.55 Bs
      });
    });

    it('keeps debits equal to credits per currency in every entry', () => {
      services.ledger.postAll();

      const unbalanced = services.db
        .prepare(
          `SELECT entry_id, currency,
                  SUM(CASE direction WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor END) AS net
           FROM ledger_lines
           GROUP BY entry_id, currency
           HAVING net != 0`,
        )
        .all();

      // 5 deposits + 4 funding webhooks + 14 COMPLETED + 1 REVERSED.
      expect(countEntries(services.db)).toBe(24);
      expect(unbalanced).toEqual([]);
    });

    it('posting twice changes neither the entries nor the balances', () => {
      const first = services.ledger.postAll();
      const balancesAfterFirst = balancesByAccount(services.ledger);

      const second = services.ledger.postAll();

      expect(first).toEqual({ posted: 24, skipped: 0 });
      expect(second).toEqual({ posted: 0, skipped: 24 });
      expect(countEntries(services.db)).toBe(24);
      expect(balancesByAccount(services.ledger)).toEqual(balancesAfterFirst);
    });
  });

  it('gives the same balances when the events are ingested in reverse order', async () => {
    services.ingestion.ingestAll(DATA_DIR);
    services.ledger.postAll();

    const reversed = await createServices();
    for (const source of SOURCES) {
      reversed.ingestion.ingestText(source, reversedFile(source.fileName));
    }
    reversed.ledger.postAll();

    expect(balancesByAccount(reversed.ledger)).toEqual(
      balancesByAccount(services.ledger),
    );
    reversed.db.close();
  });

  it('a REVERSED pay-out returns the funds to bs:provider_available', () => {
    services.ingestion.ingestText(
      PAYOUT_EVENTS,
      JSON.stringify([
        completed,
        {
          ...completed,
          event_id: 'pe_2',
          type: 'REVERSED',
          timestamp: '2026-10-05T12:00:00-04:00',
        },
      ]),
    );
    services.ledger.postAll();

    // Between COMPLETED (10:00) and REVERSED (12:00): money is out.
    expect(
      balancesByAccount(services.ledger, toUtc('2026-10-05T11:00:00-04:00')),
    ).toMatchObject({
      'bs:provider_available': -100_000,
      'bs:paid_out': 100_000,
    });
    // After REVERSED: back to where it started.
    expect(balancesByAccount(services.ledger)).toMatchObject({
      'bs:provider_available': 0,
      'bs:paid_out': 0,
    });
  });

  it('two COMPLETED events with different event_id for the same pay-out post a single entry', () => {
    const later = {
      ...completed,
      event_id: 'pe_0',
      amount_bs: 2000,
      timestamp: '2026-10-05T10:05:00-04:00',
    };
    // Ingested later-first on purpose: the earliest event still wins.
    services.ingestion.ingestText(
      PAYOUT_EVENTS,
      JSON.stringify([later, completed]),
    );

    const summary = services.ledger.postAll();

    expect(summary).toEqual({ posted: 1, skipped: 1 });
    expect(
      services.db
        .prepare(`SELECT entry_key, source_id FROM ledger_entries`)
        .all(),
    ).toEqual([{ entry_key: 'payout:P1:COMPLETED', source_id: 'pe_1' }]);
    expect(balancesByAccount(services.ledger)['bs:paid_out']).toBe(100_000);
  });

  it('counts entries effective at the cut-off and ignores later ones', () => {
    services.ingestion.ingestText(
      USDT_DEPOSITS,
      [
        'tx_hash,amount_usdt,timestamp',
        '0xat,100.00,2026-10-05T20:00:00-04:00',
        '0xafter,50.00,2026-10-05T20:00:01-04:00',
      ].join('\n'),
    );
    services.ledger.postAll();

    expect(
      balancesByAccount(services.ledger, REPORT_AS_OF)[
        'usdt:pending_conversion'
      ],
    ).toBe(100_000_000);
  });
});
