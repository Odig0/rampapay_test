import {
  FundingWebhookDto,
  toFundingWebhookRecord,
} from './dto/funding-webhook.dto';
import { PayoutEventDto, toPayoutEventRecord } from './dto/payout-event.dto';
import {
  ReferenceRateDto,
  toReferenceRateRecord,
} from './dto/reference-rate.dto';
import { UsdtDepositDto, toUsdtDepositRecord } from './dto/usdt-deposit.dto';
import { RawRow } from './file-parsers';
import { parseRow } from './row-parser';

function rowOf(fields: Record<string, unknown>): RawRow {
  return { rowNumber: 1, raw: JSON.stringify(fields), fields };
}

const validPayout = {
  event_id: 'pe_0001',
  payout_id: 'P001',
  type: 'PREVIEW',
  amount_bs: 6200.0,
  timestamp: '2026-10-05T08:40:00-04:00',
};

function parsePayout(overrides: Record<string, unknown>) {
  return parseRow(
    rowOf({ ...validPayout, ...overrides }),
    PayoutEventDto,
    toPayoutEventRecord,
  );
}

describe('parseRow', () => {
  describe('CSV sources (all values are strings)', () => {
    it('converts a valid deposit', () => {
      const result = parseRow(
        rowOf({
          tx_hash: '0x33a1',
          amount_usdt: '5000.00',
          timestamp: '2026-10-05T08:10:00-04:00',
        }),
        UsdtDepositDto,
        toUsdtDepositRecord,
      );

      expect(result).toEqual({
        ok: true,
        record: {
          tx_hash: '0x33a1',
          amount_usdt_micro: 5_000_000_000,
          ts_utc: '2026-10-05T12:10:00Z',
        },
      });
    });

    it('converts a valid reference rate', () => {
      const result = parseRow(
        rowOf({ timestamp: '2026-10-05T07:00:00-04:00', usdt_bs: '9.8467' }),
        ReferenceRateDto,
        toReferenceRateRecord,
      );

      expect(result).toEqual({
        ok: true,
        record: { ts_utc: '2026-10-05T11:00:00Z', usdt_bs_micro: 9_846_700 },
      });
    });

    it.each(['0', '0.00', '-5', 'abc', ''])(
      'rejects deposit amount %p',
      (amount) => {
        const result = parseRow(
          rowOf({
            tx_hash: '0x33a1',
            amount_usdt: amount,
            timestamp: '2026-10-05T08:10:00-04:00',
          }),
          UsdtDepositDto,
          toUsdtDepositRecord,
        );

        expect(result).toEqual({
          ok: false,
          reason: 'amount_usdt must be a positive decimal number',
        });
      },
    );
  });

  describe('JSON sources (amounts are numbers)', () => {
    it('converts a valid funding webhook', () => {
      const result = parseRow(
        rowOf({
          event_id: 'fw_001',
          deposit_tx_hash: '0x33a1',
          amount_usdt: 5000.0,
          rate: 9.7945,
          amount_bs: 48972.5,
          timestamp: '2026-10-05T08:18:00-04:00',
        }),
        FundingWebhookDto,
        toFundingWebhookRecord,
      );

      expect(result).toEqual({
        ok: true,
        record: {
          event_id: 'fw_001',
          deposit_tx_hash: '0x33a1',
          amount_usdt_micro: 5_000_000_000,
          rate_micro: 9_794_500,
          amount_bs_cents: 4_897_250,
          ts_utc: '2026-10-05T12:18:00Z',
        },
      });
    });

    it('accepts every known pay-out type', () => {
      for (const type of [
        'PREVIEW',
        'CONFIRM',
        'COMPLETED',
        'FAILED',
        'REVERSED',
      ]) {
        expect(parsePayout({ type }).ok).toBe(true);
      }
    });

    it('rejects an unknown pay-out type', () => {
      const result = parsePayout({ type: 'CANCELLED' });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toContain('type must be one of');
    });

    it('rejects a zero or negative amount with a clear message', () => {
      expect(parsePayout({ amount_bs: 0 })).toEqual({
        ok: false,
        reason: 'amount_bs must be a positive number',
      });
      expect(parsePayout({ amount_bs: -100 }).ok).toBe(false);
    });

    it('rejects an amount sent as a string', () => {
      const result = parsePayout({ amount_bs: '6200.00' });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toContain(
        'amount_bs must be a number',
      );
    });

    it('reports every missing field', () => {
      const result = parseRow(rowOf({}), PayoutEventDto, toPayoutEventRecord);

      expect(result.ok).toBe(false);
      for (const field of [
        'event_id',
        'payout_id',
        'type',
        'amount_bs',
        'timestamp',
      ]) {
        expect(!result.ok && result.reason).toContain(field);
      }
    });
  });

  describe('errors from the conversion step also make the row invalid', () => {
    it('rejects more decimals than the unit allows', () => {
      expect(parsePayout({ amount_bs: 10.005 })).toEqual({
        ok: false,
        reason: 'more than 2 decimals: "10.005"',
      });
    });

    it('rejects a timestamp without offset', () => {
      const result = parsePayout({ timestamp: '2026-10-05T08:40:00' });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toContain('with offset');
    });
  });

  it('passes through a parse error from the file reader', () => {
    const row: RawRow = {
      rowNumber: 3,
      raw: '1,2,3',
      fields: null,
      parseError: 'expected 2 columns, found 3',
    };

    expect(parseRow(row, UsdtDepositDto, toUsdtDepositRecord)).toEqual({
      ok: false,
      reason: 'expected 2 columns, found 3',
    });
  });
});
