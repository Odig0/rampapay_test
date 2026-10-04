import { IsISO8601, IsNotEmpty, IsString } from 'class-validator';
import { UsdtDepositRecord } from '../../database/rows';
import { USDT_DECIMALS, toMinorUnits } from '../../common/money';
import { toUtc } from '../../common/timestamps';
import { IsPositiveDecimalString } from './is-positive-decimal-string';

// One row of usdt_deposits.csv. Every CSV value is a string.
export class UsdtDepositDto {
  @IsString()
  @IsNotEmpty()
  tx_hash: string;

  @IsPositiveDecimalString()
  amount_usdt: string;

  @IsISO8601({ strict: true })
  timestamp: string;
}

export function toUsdtDepositRecord(dto: UsdtDepositDto): UsdtDepositRecord {
  return {
    tx_hash: dto.tx_hash,
    amount_usdt_micro: toMinorUnits(dto.amount_usdt, USDT_DECIMALS),
    ts_utc: toUtc(dto.timestamp),
  };
}
