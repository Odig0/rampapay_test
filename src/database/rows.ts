// Row types of the raw tables in schema.ts (all columns except raw).
// Ingestion writes these rows; the ledger and the report read them.

// Keep in sync with the CHECK constraint on payout_events.type in schema.ts.
export const PAYOUT_EVENT_TYPES = [
  'PREVIEW',
  'CONFIRM',
  'COMPLETED',
  'FAILED',
  'REVERSED',
] as const;
export type PayoutEventType = (typeof PAYOUT_EVENT_TYPES)[number];

export type UsdtDepositRecord = {
  tx_hash: string;
  amount_usdt_micro: number;
  ts_utc: string;
};

export type FundingWebhookRecord = {
  event_id: string;
  deposit_tx_hash: string;
  amount_usdt_micro: number;
  rate_micro: number;
  amount_bs_cents: number;
  ts_utc: string;
};

export type PayoutEventRecord = {
  event_id: string;
  payout_id: string;
  type: PayoutEventType;
  amount_bs_cents: number;
  ts_utc: string;
};

export type ReferenceRateRecord = {
  ts_utc: string;
  usdt_bs_micro: number;
};
