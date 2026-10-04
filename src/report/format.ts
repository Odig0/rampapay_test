import {
  BS_DECIMALS,
  RATE_DECIMALS,
  USDT_DECIMALS,
  formatMinorUnits,
} from '../ingestion/money';

// Helpers to write break messages with concrete, readable numbers.

// Bolivia is UTC-4 all year (no daylight saving time).
const BOLIVIA_OFFSET_MS = -4 * 60 * 60 * 1000;

export function formatBs(cents: number): string {
  return `${formatMinorUnits(cents, BS_DECIMALS, 2)} Bs`;
}

export function formatUsdt(micro: number): string {
  return `${formatMinorUnits(micro, USDT_DECIMALS, 2)} USDT`;
}

export function formatRate(rateMicro: number): string {
  return formatMinorUnits(rateMicro, RATE_DECIMALS, 4);
}

// Basis points as a percentage: 120 -> "1.20%".
export function formatBps(bps: number): string {
  return `${formatMinorUnits(bps, 2, 2)}%`;
}

// "2026-10-06T00:00:00Z" -> "2026-10-05T20:00:00-04:00".
export function boliviaTimestamp(utc: string): string {
  const shifted = new Date(Date.parse(utc) + BOLIVIA_OFFSET_MS);
  return shifted.toISOString().slice(0, 19) + '-04:00';
}

// "2026-10-05T20:26:00Z" -> "16:26" (Bolivia time). The data covers one day,
// so the time of day is enough in messages.
export function boliviaTime(utc: string): string {
  return boliviaTimestamp(utc).slice(11, 16);
}

export function minutesBetween(fromUtc: string, toUtc: string): number {
  return (Date.parse(toUtc) - Date.parse(fromUtc)) / 60_000;
}

// For display: 140.5 minutes -> "140 min".
export function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes)} min`;
}
