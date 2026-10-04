import {
  FundingWebhookRecord,
  PayoutEventRecord,
  ReferenceRateRecord,
  UsdtDepositRecord,
} from '../database/rows';
import { AccountMovement } from '../ledger/ledger.service';

export interface IngestConflict {
  source: string;
  natural_key: string;
  existing_raw: string;
  incoming_raw: string;
}

export interface IngestRejection {
  source: string;
  row_number: number;
  reason: string;
  raw: string;
}

// Everything known at the cut-off time, read from the raw tables and the
// ledger. Events after asOf are excluded, as if the report had been run at
// that moment. Rows are sorted by time (ties by id) so every computation is
// deterministic.
export interface ReconciliationSnapshot {
  asOf: string; // UTC, same format as ts_utc
  deposits: UsdtDepositRecord[];
  webhooks: FundingWebhookRecord[];
  payoutEvents: PayoutEventRecord[];
  rates: ReferenceRateRecord[];
  // Entries that moved bs:provider_available, in time order.
  providerBalanceMovements: AccountMovement[];
  // Ingestion review tables have no event time: all rows are included.
  conflicts: IngestConflict[];
  rejections: IngestRejection[];
}
