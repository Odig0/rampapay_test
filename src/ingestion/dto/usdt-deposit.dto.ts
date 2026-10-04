import { IsISO8601, IsNotEmpty, IsString } from 'class-validator';
import { USDT_DECIMALS, toMinorUnits } from '../money';
import { toUtc } from '../timestamps';
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

// Columns of the usdt_deposits table (except raw).
export type UsdtDepositRecord = {
  tx_hash: string;
  amount_usdt_micro: number;
  ts_utc: string;
};

export function toUsdtDepositRecord(dto: UsdtDepositDto): UsdtDepositRecord {
  return {
    tx_hash: dto.tx_hash,
    amount_usdt_micro: toMinorUnits(dto.amount_usdt, USDT_DECIMALS),
    ts_utc: toUtc(dto.timestamp),
  };
}
