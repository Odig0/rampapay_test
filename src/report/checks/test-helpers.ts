// Builders for check tests. Not used by production code.
import { FundingWebhookRecord } from '../../ingestion/dto/funding-webhook.dto';
import {
  PayoutEventRecord,
  PayoutEventType,
} from '../../ingestion/dto/payout-event.dto';
import { UsdtDepositRecord } from '../../ingestion/dto/usdt-deposit.dto';
import { ReconciliationSnapshot } from '../snapshot';

// 20:00 Bolivia time.
export const AS_OF = '2026-10-06T00:00:00Z';

export function snapshot(
  overrides: Partial<ReconciliationSnapshot> = {},
): ReconciliationSnapshot {
  return {
    asOf: AS_OF,
    deposits: [],
    webhooks: [],
    payoutEvents: [],
    rates: [],
    providerBalanceMovements: [],
    conflicts: [],
    rejections: [],
    ...overrides,
  };
}

// Bolivia time "HH:MM" -> UTC timestamp on 5 October 2026.
export function utc(boliviaTime: string): string {
  const [hours, minutes] = boliviaTime.split(':').map(Number);
  return (
    new Date(Date.UTC(2026, 9, 5, hours + 4, minutes))
      .toISOString()
      .slice(0, 19) + 'Z'
  );
}

export function deposit(
  overrides: Partial<UsdtDepositRecord> = {},
): UsdtDepositRecord {
  return {
    tx_hash: '0xdep',
    amount_usdt_micro: 2_500_000_000,
    ts_utc: utc('17:05'),
    ...overrides,
  };
}

// Defaults are fw_004 from the real data: 2500 USDT x 9.7606 = 24401.50 Bs.
export function webhook(
  overrides: Partial<FundingWebhookRecord> = {},
): FundingWebhookRecord {
  return {
    event_id: 'fw_x',
    deposit_tx_hash: '0xdep',
    amount_usdt_micro: 2_500_000_000,
    rate_micro: 9_760_600,
    amount_bs_cents: 2_440_150,
    ts_utc: utc('17:10'),
    ...overrides,
  };
}

export function payoutEvent(
  eventId: string,
  payoutId: string,
  type: PayoutEventType,
  time: string,
  amount: number,
): PayoutEventRecord {
  return {
    event_id: eventId,
    payout_id: payoutId,
    type,
    amount_bs_cents: amount,
    ts_utc: utc(time),
  };
}
