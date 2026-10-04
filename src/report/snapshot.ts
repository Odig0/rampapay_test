import { FundingWebhookRecord } from '../ingestion/dto/funding-webhook.dto';
import { PayoutEventRecord } from '../ingestion/dto/payout-event.dto';
import { ReferenceRateRecord } from '../ingestion/dto/reference-rate.dto';
import { UsdtDepositRecord } from '../ingestion/dto/usdt-deposit.dto';

// Everything known at the cut-off time, read from the raw tables. Events
// after asOf are excluded, as if the report had been run at that moment.
// Rows are sorted by time (ties by id) so every computation is deterministic.
export interface ReconciliationSnapshot {
  asOf: string; // UTC, same format as ts_utc
  deposits: UsdtDepositRecord[];
  webhooks: FundingWebhookRecord[];
  payoutEvents: PayoutEventRecord[];
  rates: ReferenceRateRecord[];
}
