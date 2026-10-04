import {
  checkConversionAmounts,
  checkDuplicateWebhooks,
  checkWebhookDeposits,
} from './funding-consistency.checks';
import {
  checkDuplicatePayoutEvents,
  checkPayoutAmounts,
  checkPayoutTransitions,
  checkSlowPayouts,
} from './payout-consistency.checks';
import { deposit, payoutEvent, snapshot, webhook } from './test-helpers';

describe('checkWebhookDeposits', () => {
  it('accepts a webhook that matches its deposit', () => {
    expect(
      checkWebhookDeposits(
        snapshot({ deposits: [deposit()], webhooks: [webhook()] }),
      ),
    ).toEqual([]);
  });

  it('flags a webhook for a deposit that is not on-chain', () => {
    const breaks = checkWebhookDeposits(
      snapshot({ webhooks: [webhook({ deposit_tx_hash: '0xghost' })] }),
    );

    expect(breaks).toEqual([
      expect.objectContaining({
        code: 'FUNDING_UNKNOWN_DEPOSIT',
        message:
          '24401.50 Bs credited for deposit 0xghost, which is not in the on-chain deposits',
      }),
    ]);
  });

  it('flags a webhook whose USDT amount differs from the deposit', () => {
    const breaks = checkWebhookDeposits(
      snapshot({
        deposits: [deposit({ amount_usdt_micro: 2_000_000_000 })],
        webhooks: [webhook()],
      }),
    );

    expect(breaks.map((b) => [b.code, b.message])).toEqual([
      [
        'FUNDING_USDT_MISMATCH',
        'webhook converts 2500.00 USDT but the deposit was 2000.00 USDT',
      ],
    ]);
  });
});

describe('checkConversionAmounts', () => {
  it('accepts amount_bs = amount_usdt x rate (fw_004: 2500 x 9.7606 = 24401.50)', () => {
    expect(checkConversionAmounts(snapshot({ webhooks: [webhook()] }))).toEqual(
      [],
    );
  });

  it('tolerates rounding to the cent, but not more', () => {
    // 1.000001 USDT x 9.7606 = 9.76060976... Bs -> 9.76 is the rounded value.
    const rounded = webhook({
      amount_usdt_micro: 1_000_001,
      amount_bs_cents: 976,
    });
    const offByOneCent = webhook({
      amount_usdt_micro: 1_000_001,
      amount_bs_cents: 977,
    });

    expect(checkConversionAmounts(snapshot({ webhooks: [rounded] }))).toEqual(
      [],
    );
    expect(
      checkConversionAmounts(snapshot({ webhooks: [offByOneCent] })),
    ).toHaveLength(1);
  });

  it('flags a wrong amount with the expected value, using exact integer math', () => {
    const breaks = checkConversionAmounts(
      snapshot({ webhooks: [webhook({ amount_bs_cents: 2_440_000 })] }),
    );

    expect(breaks.map((b) => b.message)).toEqual([
      '24400.00 Bs credited, but 2500.00 USDT x 9.7606 = 24401.50 Bs',
    ]);
  });
});

describe('checkDuplicateWebhooks', () => {
  it('flags two different webhooks for the same deposit', () => {
    const breaks = checkDuplicateWebhooks(
      snapshot({
        webhooks: [
          webhook({ event_id: 'fw_1' }),
          webhook({ event_id: 'fw_2' }),
        ],
      }),
    );

    expect(breaks.map((b) => [b.code, b.ref, b.message])).toEqual([
      [
        'FUNDING_DUPLICATE',
        '0xdep',
        '2 funding webhooks for one deposit (fw_1, fw_2); all were credited',
      ],
    ]);
  });
});

describe('checkPayoutTransitions', () => {
  function problems(events: ReturnType<typeof payoutEvent>[]) {
    return checkPayoutTransitions(snapshot({ payoutEvents: events })).map(
      (b) => b.message,
    );
  }

  it('accepts the normal lifecycle, a failure and an expired preview', () => {
    expect(
      problems([
        payoutEvent('pe_1', 'P1', 'PREVIEW', '10:00', 100),
        payoutEvent('pe_2', 'P1', 'CONFIRM', '10:01', 100),
        payoutEvent('pe_3', 'P1', 'COMPLETED', '10:05', 100),
        payoutEvent('pe_4', 'P1', 'REVERSED', '12:00', 100),
        payoutEvent('pe_5', 'P2', 'CONFIRM', '11:01', 100),
        payoutEvent('pe_6', 'P2', 'FAILED', '11:04', 100),
        payoutEvent('pe_7', 'P3', 'PREVIEW', '11:30', 100),
      ]),
    ).toEqual([]);
  });

  it('flags COMPLETED or FAILED without CONFIRM', () => {
    expect(
      problems([
        payoutEvent('pe_1', 'P1', 'COMPLETED', '10:05', 100),
        payoutEvent('pe_2', 'P2', 'FAILED', '11:04', 100),
      ]),
    ).toEqual(['COMPLETED without CONFIRM', 'FAILED without CONFIRM']);
  });

  it('flags REVERSED without COMPLETED', () => {
    expect(
      problems([
        payoutEvent('pe_1', 'P1', 'CONFIRM', '10:01', 310_000),
        payoutEvent('pe_2', 'P1', 'REVERSED', '18:30', 310_000),
      ]),
    ).toEqual([
      'REVERSED without COMPLETED: 3100.00 Bs returned that was never paid out',
    ]);
  });

  it('flags COMPLETED and FAILED in the same pay-out', () => {
    expect(
      problems([
        payoutEvent('pe_1', 'P1', 'CONFIRM', '10:01', 100),
        payoutEvent('pe_2', 'P1', 'FAILED', '10:03', 100),
        payoutEvent('pe_3', 'P1', 'COMPLETED', '10:05', 100),
      ]),
    ).toEqual([
      'both COMPLETED (10:05) and FAILED (10:03); the ledger treats it as paid',
    ]);
  });
});

describe('checkPayoutAmounts', () => {
  it('flags events of one pay-out with different amounts', () => {
    const breaks = checkPayoutAmounts(
      snapshot({
        payoutEvents: [
          payoutEvent('pe_1', 'P1', 'CONFIRM', '10:01', 100_00),
          payoutEvent('pe_2', 'P1', 'COMPLETED', '10:05', 120_00),
        ],
      }),
    );

    expect(breaks.map((b) => b.message)).toEqual([
      'amounts differ between events: CONFIRM 100.00 Bs, COMPLETED 120.00 Bs',
    ]);
  });
});

describe('checkDuplicatePayoutEvents', () => {
  it('flags a second COMPLETED with another event_id and names the posted one', () => {
    const breaks = checkDuplicatePayoutEvents(
      snapshot({
        payoutEvents: [
          payoutEvent('pe_1', 'P1', 'CONFIRM', '10:01', 100_00),
          payoutEvent('pe_2', 'P1', 'COMPLETED', '10:05', 100_00),
          payoutEvent('pe_9', 'P1', 'COMPLETED', '10:07', 100_00),
        ],
      }),
    );

    expect(breaks.map((b) => [b.ref, b.message])).toEqual([
      [
        'pe_9',
        'second COMPLETED for P1 (100.00 Bs); not posted, the ledger used pe_2',
      ],
    ]);
  });
});

describe('checkSlowPayouts', () => {
  it('flags a final state more than 15 minutes after CONFIRM, but not at exactly 15', () => {
    const breaks = checkSlowPayouts(
      snapshot({
        payoutEvents: [
          payoutEvent('pe_1', 'P1', 'CONFIRM', '10:00', 100),
          payoutEvent('pe_2', 'P1', 'COMPLETED', '10:15', 100),
          payoutEvent('pe_3', 'P2', 'CONFIRM', '11:00', 100),
          payoutEvent('pe_4', 'P2', 'FAILED', '11:16', 100),
        ],
      }),
    );

    expect(breaks.map((b) => [b.ref, b.message])).toEqual([
      [
        'P2',
        'FAILED at 11:16 arrived 16 min after CONFIRM at 11:00 (limit 15 min)',
      ],
    ]);
  });
});
