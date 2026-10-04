import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
} from 'class-validator';
import { BS_DECIMALS, toMinorUnits } from '../money';
import { toUtc } from '../timestamps';

// Keep in sync with the CHECK constraint on payout_events.type in schema.ts.
export const PAYOUT_EVENT_TYPES = [
  'PREVIEW',
  'CONFIRM',
  'COMPLETED',
  'FAILED',
  'REVERSED',
] as const;
export type PayoutEventType = (typeof PAYOUT_EVENT_TYPES)[number];

// One element of payout_events.json. Amounts arrive as JSON numbers.
// Only the shape is validated here; the PREVIEW -> CONFIRM -> ... state
// machine is business logic and is checked later, not at ingestion.
export class PayoutEventDto {
  @IsString()
  @IsNotEmpty()
  event_id: string;

  @IsString()
  @IsNotEmpty()
  payout_id: string;

  @IsIn(PAYOUT_EVENT_TYPES)
  type: PayoutEventType;

  @IsNumber()
  @IsPositive()
  amount_bs: number;

  @IsISO8601({ strict: true })
  timestamp: string;
}

// Columns of the payout_events table (except raw).
export type PayoutEventRecord = {
  event_id: string;
  payout_id: string;
  type: PayoutEventType;
  amount_bs_cents: number;
  ts_utc: string;
};

export function toPayoutEventRecord(dto: PayoutEventDto): PayoutEventRecord {
  return {
    event_id: dto.event_id,
    payout_id: dto.payout_id,
    type: dto.type,
    amount_bs_cents: toMinorUnits(dto.amount_bs, BS_DECIMALS),
    ts_utc: toUtc(dto.timestamp),
  };
}
