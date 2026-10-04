import { sortBreaks } from '../breaks';
import { checkNegativeProviderBalance } from './balance.checks';
import {
  checkConversionRates,
  checkLateFundingWebhooks,
  checkUnconvertedDeposits,
} from './funding.checks';
import { checkIngestConflicts, checkIngestRejections } from './ingest.checks';
import { checkReversedPayouts, checkStuckPayouts } from './payout.checks';
import { runChecks } from '.';
import { payoutEvent, snapshot, utc, webhook } from './test-helpers';

describe('checkUnconvertedDeposits', () => {
  it('flags a deposit with no webhook after more than 10 minutes', () => {
    const breaks = checkUnconvertedDeposits(
      snapshot({
        deposits: [
          {
            tx_hash: '0xold',
            amount_usdt_micro: 1_000_000,
            ts_utc: utc('19:49'),
          },
        ],
      }),
    );

    expect(breaks.map((b) => b.ref)).toEqual(['0xold']);
  });

  it('does not flag a deposit exactly 10 minutes old, or one that was funded', () => {
    const breaks = checkUnconvertedDeposits(
      snapshot({
        deposits: [
          {
            tx_hash: '0xrecent',
            amount_usdt_micro: 1_000_000,
            ts_utc: utc('19:50'),
          },
          {
            tx_hash: '0xdep',
            amount_usdt_micro: 1_000_000,
            ts_utc: utc('12:00'),
          },
        ],
        webhooks: [webhook({ deposit_tx_hash: '0xdep', ts_utc: utc('12:05') })],
      }),
    );

    expect(breaks).toEqual([]);
  });
});

describe('checkLateFundingWebhooks', () => {
  const deposit = {
    tx_hash: '0xdep',
    amount_usdt_micro: 1_000_000,
    ts_utc: utc('12:00'),
  };

  it('flags a webhook more than 10 minutes after its deposit, but not at exactly 10', () => {
    const breaks = checkLateFundingWebhooks(
      snapshot({
        deposits: [deposit],
        webhooks: [
          webhook({ event_id: 'fw_ontime', ts_utc: utc('12:10') }),
          webhook({ event_id: 'fw_late', ts_utc: utc('12:11') }),
        ],
      }),
    );

    expect(breaks.map((b) => b.ref)).toEqual(['fw_late']);
  });
});

describe('checkConversionRates', () => {
  // Real reference rates around fw_004 (17:10).
  const rates = [
    { ts_utc: utc('14:00'), usdt_bs_micro: 9_826_100 },
    { ts_utc: utc('17:00'), usdt_bs_micro: 9_804_700 },
    { ts_utc: utc('18:00'), usdt_bs_micro: 9_795_100 },
  ];

  it('uses the rate in effect at the webhook, not at the deposit: fw_004 is fine', () => {
    // Against 17:00 (9.8047) the spread is 0.45%. Against 14:00 (9.8261,
    // when the deposit was sent) it would be 0.67%, a false positive.
    expect(
      checkConversionRates(
        snapshot({ rates, webhooks: [webhook({ event_id: 'fw_004' })] }),
      ),
    ).toEqual([]);
  });

  it('flags a rate more than 0.5% below the reference', () => {
    const breaks = checkConversionRates(
      snapshot({ rates, webhooks: [webhook({ rate_micro: 9_700_000 })] }),
    );

    expect(breaks).toEqual([
      expect.objectContaining({
        code: 'RATE_OUT_OF_RANGE',
        message:
          'rate 9.7000 is 1.07% below the reference 9.8047 of 17:00 (max spread 0.50%)',
      }),
    ]);
  });

  it('accepts a spread of exactly 0.5% and flags anything beyond it', () => {
    const reference = [{ ts_utc: utc('17:00'), usdt_bs_micro: 10_000_000 }];

    expect(
      checkConversionRates(
        snapshot({
          rates: reference,
          webhooks: [webhook({ rate_micro: 9_950_000 })],
        }),
      ),
    ).toEqual([]);
    expect(
      checkConversionRates(
        snapshot({
          rates: reference,
          webhooks: [webhook({ rate_micro: 9_949_999 })],
        }),
      ),
    ).toHaveLength(1);
  });

  it('reports a webhook with no reference rate before it', () => {
    const breaks = checkConversionRates(
      snapshot({ rates, webhooks: [webhook({ ts_utc: utc('13:00') })] }),
    );

    expect(breaks.map((b) => b.code)).toEqual(['RATE_MISSING_REFERENCE']);
  });
});

describe('checkNegativeProviderBalance', () => {
  function movement(entryKey: string, time: string, amount: number) {
    return {
      entry_key: entryKey,
      effective_at: utc(time),
      amount_minor: amount,
    };
  }

  it('reports each negative interval with start, end, minimum and cause', () => {
    const breaks = checkNegativeProviderBalance(
      snapshot({
        providerBalanceMovements: [
          movement('funding:fw_1', '10:00', 1_000),
          movement('payout:P1:COMPLETED', '11:00', -1_500), // -500
          movement('payout:P2:COMPLETED', '11:30', -300), // -800
          movement('funding:fw_2', '12:00', 2_000), // 1200
          movement('payout:P3:COMPLETED', '13:00', -1_300), // -100, never recovers
        ],
      }),
    );

    expect(breaks.map((b) => [b.ref, b.at, b.message])).toEqual([
      [
        'payout:P1:COMPLETED',
        utc('11:00'),
        'bs:provider_available was negative from 11:00 to 12:00, minimum -8.00 Bs, caused by payout:P1:COMPLETED',
      ],
      [
        'payout:P3:COMPLETED',
        utc('13:00'),
        'bs:provider_available was negative from 13:00 to the cut-off (still negative), minimum -1.00 Bs, caused by payout:P3:COMPLETED',
      ],
    ]);
  });

  it('does not flag a balance that touches zero', () => {
    const breaks = checkNegativeProviderBalance(
      snapshot({
        providerBalanceMovements: [
          movement('funding:fw_1', '10:00', 1_000),
          movement('payout:P1:COMPLETED', '11:00', -1_000),
        ],
      }),
    );

    expect(breaks).toEqual([]);
  });
});

describe('payout checks', () => {
  // Real histories of P007 (FAILED), P009 (PREVIEW that expires) and P016
  // (FAILED): none of them is a break.
  const realNonBreaks = [
    payoutEvent('pe_0020', 'P007', 'PREVIEW', '11:50', 500_000),
    payoutEvent('pe_0021', 'P007', 'CONFIRM', '11:51', 500_000),
    payoutEvent('pe_0022', 'P007', 'FAILED', '11:54', 500_000),
    payoutEvent('pe_0026', 'P009', 'PREVIEW', '12:50', 275_025),
    payoutEvent('pe_0045', 'P016', 'PREVIEW', '18:05', 410_000),
    payoutEvent('pe_0046', 'P016', 'CONFIRM', '18:06', 410_000),
    payoutEvent('pe_0047', 'P016', 'FAILED', '18:09', 410_000),
  ];

  it('P007, P009 and P016 produce no breaks at all', () => {
    expect(runChecks(snapshot({ payoutEvents: realNonBreaks }))).toEqual([]);
  });

  it('flags a CONFIRM with no final state after more than 15 minutes, but not at exactly 15', () => {
    const breaks = checkStuckPayouts(
      snapshot({
        payoutEvents: [
          payoutEvent('pe_1', 'P1', 'CONFIRM', '19:44', 100_00),
          payoutEvent('pe_2', 'P2', 'CONFIRM', '19:45', 100_00),
        ],
      }),
    );

    expect(breaks.map((b) => b.ref)).toEqual(['P1']);
  });

  it('flags every reversed pay-out for human review', () => {
    const breaks = checkReversedPayouts(
      snapshot({
        payoutEvents: [
          payoutEvent('pe_1', 'P1', 'COMPLETED', '11:06', 310_000),
          payoutEvent('pe_2', 'P1', 'REVERSED', '18:30', 310_000),
        ],
      }),
    );

    expect(breaks.map((b) => [b.code, b.ref])).toEqual([
      ['PAYOUT_REVERSED', 'P1'],
    ]);
  });
});

describe('ingest checks', () => {
  it('turns every conflict and rejection into a break', () => {
    const s = snapshot({
      conflicts: [
        {
          source: 'payout_events',
          natural_key: 'pe_1',
          existing_raw: '{"a":1}',
          incoming_raw: '{"a":2}',
        },
      ],
      rejections: [
        {
          source: 'usdt_deposits',
          row_number: 3,
          reason: 'amount_usdt must be a positive decimal number',
          raw: '0xabc,0,2026-10-05T10:00:00-04:00',
        },
      ],
    });

    expect(checkIngestConflicts(s).map((b) => [b.code, b.ref])).toEqual([
      ['INGEST_CONFLICT', 'payout_events:pe_1'],
    ]);
    expect(checkIngestRejections(s).map((b) => [b.code, b.ref])).toEqual([
      ['INGEST_REJECTED', 'usdt_deposits:row 3'],
    ]);
  });
});

describe('sortBreaks', () => {
  it('orders by severity, then time (no time last), then code and ref', () => {
    const base = { message: '' };
    const sorted = sortBreaks([
      { ...base, code: 'B', severity: 'MEDIUM', ref: '1', at: utc('09:00') },
      { ...base, code: 'A', severity: 'HIGH', ref: '2', at: null },
      { ...base, code: 'A', severity: 'HIGH', ref: '1', at: utc('10:00') },
      { ...base, code: 'C', severity: 'HIGH', ref: '1', at: utc('09:00') },
    ]);

    expect(sorted.map((b) => `${b.severity}:${b.code}:${b.ref}`)).toEqual([
      'HIGH:C:1',
      'HIGH:A:1',
      'HIGH:A:2',
      'MEDIUM:B:1',
    ]);
  });
});
