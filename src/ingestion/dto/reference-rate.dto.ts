import { IsISO8601 } from 'class-validator';
import { ReferenceRateRecord } from '../../database/rows';
import { RATE_DECIMALS, toMinorUnits } from '../../common/money';
import { toUtc } from '../../common/timestamps';
import { IsPositiveDecimalString } from './is-positive-decimal-string';

// One row of reference_rates.csv. Every CSV value is a string.
export class ReferenceRateDto {
  @IsISO8601({ strict: true })
  timestamp: string;

  @IsPositiveDecimalString()
  usdt_bs: string;
}

export function toReferenceRateRecord(
  dto: ReferenceRateDto,
): ReferenceRateRecord {
  return {
    ts_utc: toUtc(dto.timestamp),
    usdt_bs_micro: toMinorUnits(dto.usdt_bs, RATE_DECIMALS),
  };
}
