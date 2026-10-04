import { IsISO8601 } from 'class-validator';
import { RATE_DECIMALS, toMinorUnits } from '../money';
import { toUtc } from '../timestamps';
import { IsPositiveDecimalString } from './is-positive-decimal-string';

// One row of reference_rates.csv. Every CSV value is a string.
export class ReferenceRateDto {
  @IsISO8601({ strict: true })
  timestamp: string;

  @IsPositiveDecimalString()
  usdt_bs: string;
}

// Columns of the reference_rates table (except raw).
export type ReferenceRateRecord = {
  ts_utc: string;
  usdt_bs_micro: number;
};

export function toReferenceRateRecord(
  dto: ReferenceRateDto,
): ReferenceRateRecord {
  return {
    ts_utc: toUtc(dto.timestamp),
    usdt_bs_micro: toMinorUnits(dto.usdt_bs, RATE_DECIMALS),
  };
}
