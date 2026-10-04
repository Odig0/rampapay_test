import {
  LedgerEntry,
  assertBalanced,
  fundingEntry,
  payoutEntry,
} from './entries';

describe('entries', () => {
  it('posts a funding webhook as one entry with four lines, two per currency', () => {
    const entry = fundingEntry({
      event_id: 'fw_001',
      deposit_tx_hash: '0xabc',
      amount_usdt_micro: 5_000_000_000,
      rate_micro: 9_794_500,
      amount_bs_cents: 4_897_250,
      ts_utc: '2026-10-05T12:18:00Z',
    });

    expect(entry.entry_key).toBe('funding:fw_001');
    expect(entry.lines).toEqual([
      {
        account: 'usdt:conversion',
        currency: 'USDT',
        direction: 'DEBIT',
        amount_minor: 5_000_000_000,
      },
      {
        account: 'usdt:pending_conversion',
        currency: 'USDT',
        direction: 'CREDIT',
        amount_minor: 5_000_000_000,
      },
      {
        account: 'bs:provider_available',
        currency: 'BS',
        direction: 'DEBIT',
        amount_minor: 4_897_250,
      },
      {
        account: 'bs:conversion',
        currency: 'BS',
        direction: 'CREDIT',
        amount_minor: 4_897_250,
      },
    ]);
  });

  it('keys pay-out entries by payout_id and type, not by event_id', () => {
    const entry = payoutEntry({
      event_id: 'pe_0003',
      payout_id: 'P001',
      type: 'COMPLETED',
      amount_bs_cents: 620_000,
      ts_utc: '2026-10-05T12:46:00Z',
    });

    expect(entry.entry_key).toBe('payout:P001:COMPLETED');
    expect(entry.source_id).toBe('pe_0003');
  });

  it('rejects an entry whose debits and credits differ in a currency', () => {
    const entry: LedgerEntry = {
      entry_key: 'broken',
      type: 'FUNDING',
      effective_at: '2026-10-05T12:18:00Z',
      source_table: 'funding_webhooks',
      source_id: 'fw_x',
      lines: [
        {
          account: 'usdt:conversion',
          currency: 'USDT',
          direction: 'DEBIT',
          amount_minor: 100,
        },
        {
          account: 'usdt:pending_conversion',
          currency: 'USDT',
          direction: 'CREDIT',
          amount_minor: 60,
        },
        // Debits and credits add up to 100 overall, but mixing currencies
        // is meaningless: neither USDT nor Bs balances on its own.
        {
          account: 'bs:conversion',
          currency: 'BS',
          direction: 'CREDIT',
          amount_minor: 40,
        },
      ],
    };

    expect(() => assertBalanced(entry)).toThrow(
      'unbalanced entry broken: USDT is off by 40',
    );
  });
});
