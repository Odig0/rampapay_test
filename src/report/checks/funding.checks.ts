import { ReferenceRateRecord } from '../../ingestion/dto/reference-rate.dto';
import { Break, MAX_FUNDING_DELAY_MINUTES, MAX_SPREAD_BPS } from '../breaks';
import {
  boliviaTime,
  formatBps,
  formatMinutes,
  formatRate,
  formatUsdt,
  minutesBetween,
} from '../format';
import { ReconciliationSnapshot } from '../snapshot';

// A deposit with no funding webhook more than 10 minutes after it was sent.
export function checkUnconvertedDeposits(
  snapshot: ReconciliationSnapshot,
): Break[] {
  const funded = new Set(snapshot.webhooks.map((w) => w.deposit_tx_hash));

  return snapshot.deposits
    .filter((deposit) => !funded.has(deposit.tx_hash))
    .map((deposit) => ({
      deposit,
      waited: minutesBetween(deposit.ts_utc, snapshot.asOf),
    }))
    .filter(({ waited }) => waited > MAX_FUNDING_DELAY_MINUTES)
    .map(({ deposit, waited }) => ({
      code: 'DEPOSIT_NOT_CONVERTED',
      severity: 'HIGH',
      ref: deposit.tx_hash,
      at: deposit.ts_utc,
      message:
        `${formatUsdt(deposit.amount_usdt_micro)} deposited at ${boliviaTime(deposit.ts_utc)} ` +
        `has no funding webhook after ${formatMinutes(waited)} ` +
        `(limit ${MAX_FUNDING_DELAY_MINUTES} min)`,
    }));
}

// A funding webhook that arrived more than 10 minutes after its deposit.
// Webhooks for unknown deposits are a different check.
export function checkLateFundingWebhooks(
  snapshot: ReconciliationSnapshot,
): Break[] {
  const depositTimes = new Map(
    snapshot.deposits.map((d) => [d.tx_hash, d.ts_utc]),
  );
  const breaks: Break[] = [];

  for (const webhook of snapshot.webhooks) {
    const depositTime = depositTimes.get(webhook.deposit_tx_hash);
    if (depositTime === undefined) {
      continue;
    }
    const delay = minutesBetween(depositTime, webhook.ts_utc);
    if (delay > MAX_FUNDING_DELAY_MINUTES) {
      breaks.push({
        code: 'FUNDING_LATE',
        severity: 'MEDIUM',
        ref: webhook.event_id,
        at: webhook.ts_utc,
        message:
          `funding webhook at ${boliviaTime(webhook.ts_utc)} arrived ${formatMinutes(delay)} ` +
          `after its deposit at ${boliviaTime(depositTime)} (limit ${MAX_FUNDING_DELAY_MINUTES} min)`,
      });
    }
  }
  return breaks;
}

// The provider converts at the reference rate in effect when it sends the
// webhook (the latest rate at or before that moment), less up to 0.5 %.
// Integer arithmetic only: the rate is out of range when
//   rate / reference < 1 - 50/10000   <=>   rate * 10000 < reference * 9950
export function checkConversionRates(
  snapshot: ReconciliationSnapshot,
): Break[] {
  const breaks: Break[] = [];

  for (const webhook of snapshot.webhooks) {
    const reference = latestRateAtOrBefore(snapshot.rates, webhook.ts_utc);
    if (reference === undefined) {
      breaks.push({
        code: 'RATE_MISSING_REFERENCE',
        severity: 'MEDIUM',
        ref: webhook.event_id,
        at: webhook.ts_utc,
        message: `no reference rate at or before ${boliviaTime(webhook.ts_utc)} to check rate ${formatRate(webhook.rate_micro)}`,
      });
      continue;
    }

    const rate = webhook.rate_micro;
    const ref = reference.usdt_bs_micro;
    if (rate * 10_000 < ref * (10_000 - MAX_SPREAD_BPS)) {
      const spreadBps = Math.round(((ref - rate) * 10_000) / ref); // display only
      breaks.push({
        code: 'RATE_OUT_OF_RANGE',
        severity: 'HIGH',
        ref: webhook.event_id,
        at: webhook.ts_utc,
        message:
          `rate ${formatRate(rate)} is ${formatBps(spreadBps)} below the reference ` +
          `${formatRate(ref)} of ${boliviaTime(reference.ts_utc)} (max spread ${formatBps(MAX_SPREAD_BPS)})`,
      });
    }
  }
  return breaks;
}

// rates must be sorted by ts_utc ascending.
function latestRateAtOrBefore(
  rates: ReferenceRateRecord[],
  utc: string,
): ReferenceRateRecord | undefined {
  let latest: ReferenceRateRecord | undefined;
  for (const rate of rates) {
    if (rate.ts_utc > utc) {
      break;
    }
    latest = rate;
  }
  return latest;
}
