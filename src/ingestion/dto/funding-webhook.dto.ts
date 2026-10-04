import {
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
} from 'class-validator';
import {
  BS_DECIMALS,
  RATE_DECIMALS,
  USDT_DECIMALS,
  toMinorUnits,
} from '../money';
import { toUtc } from '../timestamps';

// One element of funding_webhooks.json. Amounts arrive as JSON numbers, which
// is also the shape a future webhook endpoint would receive (ValidationPipe).
export class FundingWebhookDto {
  @IsString()
  @IsNotEmpty()
  event_id: string;

  @IsString()
  @IsNotEmpty()
  deposit_tx_hash: string;

  @IsNumber()
  @IsPositive()
  amount_usdt: number;

  @IsNumber()
  @IsPositive()
  rate: number;

  @IsNumber()
  @IsPositive()
  amount_bs: number;

  @IsISO8601({ strict: true })
  timestamp: string;
}

// Columns of the funding_webhooks table (except raw).
export interface FundingWebhookRecord {
  event_id: string;
  deposit_tx_hash: string;
  amount_usdt_micro: number;
  rate_micro: number;
  amount_bs_cents: number;
  ts_utc: string;
}

export function toFundingWebhookRecord(
  dto: FundingWebhookDto,
): FundingWebhookRecord {
  return {
    event_id: dto.event_id,
    deposit_tx_hash: dto.deposit_tx_hash,
    amount_usdt_micro: toMinorUnits(dto.amount_usdt, USDT_DECIMALS),
    rate_micro: toMinorUnits(dto.rate, RATE_DECIMALS),
    amount_bs_cents: toMinorUnits(dto.amount_bs, BS_DECIMALS),
    ts_utc: toUtc(dto.timestamp),
  };
}
