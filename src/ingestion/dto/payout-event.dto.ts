import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
} from 'class-validator';
import { PAYOUT_EVENT_TYPES } from '../../database/rows';
import type { PayoutEventRecord, PayoutEventType } from '../../database/rows';
import { BS_DECIMALS, toMinorUnits } from '../../common/money';
import { toUtc } from '../../common/timestamps';

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

export function toPayoutEventRecord(dto: PayoutEventDto): PayoutEventRecord {
  return {
    event_id: dto.event_id,
    payout_id: dto.payout_id,
    type: dto.type,
    amount_bs_cents: toMinorUnits(dto.amount_bs, BS_DECIMALS),
    ts_utc: toUtc(dto.timestamp),
  };
}
