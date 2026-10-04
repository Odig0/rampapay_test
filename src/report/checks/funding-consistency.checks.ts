import { FundingWebhookRecord } from '../../database/rows';
import { Break } from '../breaks';
import { formatBs, formatRate, formatUsdt } from '../format';
import { ReconciliationSnapshot } from '../snapshot';

// A webhook must match a known deposit and convert the same USDT amount.
export function checkWebhookDeposits(
  snapshot: ReconciliationSnapshot,
): Break[] {
  const deposits = new Map(snapshot.deposits.map((d) => [d.tx_hash, d]));
  const breaks: Break[] = [];

  for (const webhook of snapshot.webhooks) {
    const deposit = deposits.get(webhook.deposit_tx_hash);
    if (deposit === undefined) {
      breaks.push({
        code: 'FUNDING_UNKNOWN_DEPOSIT',
        severity: 'HIGH',
        ref: webhook.event_id,
        at: webhook.ts_utc,
        message:
          `${formatBs(webhook.amount_bs_cents)} credited for deposit ` +
          `${webhook.deposit_tx_hash}, which is not in the on-chain deposits`,
      });
    } else if (deposit.amount_usdt_micro !== webhook.amount_usdt_micro) {
      breaks.push({
        code: 'FUNDING_USDT_MISMATCH',
        severity: 'HIGH',
        ref: webhook.event_id,
        at: webhook.ts_utc,
        message:
          `webhook converts ${formatUsdt(webhook.amount_usdt_micro)} but the deposit ` +
          `was ${formatUsdt(deposit.amount_usdt_micro)}`,
      });
    }
  }
  return breaks;
}

const MICRO_USDT_TIMES_MICRO_RATE_PER_CENT = 10n ** 10n; // 10^6 * 10^6 / 10^2

// amount_bs must equal amount_usdt x rate. micro-USDT x micro-rate can exceed
// Number.MAX_SAFE_INTEGER (5000 USDT x 9.79 ~ 4.9e16), so this uses BigInt.
// The provider rounds to cents, so up to half a cent of difference is fine.
export function checkConversionAmounts(
  snapshot: ReconciliationSnapshot,
): Break[] {
  const breaks: Break[] = [];

  for (const webhook of snapshot.webhooks) {
    const product =
      BigInt(webhook.amount_usdt_micro) * BigInt(webhook.rate_micro);
    const reported =
      BigInt(webhook.amount_bs_cents) * MICRO_USDT_TIMES_MICRO_RATE_PER_CENT;
    const difference =
      reported > product ? reported - product : product - reported;

    if (difference * 2n > MICRO_USDT_TIMES_MICRO_RATE_PER_CENT) {
      breaks.push({
        code: 'FUNDING_BS_MISMATCH',
        severity: 'HIGH',
        ref: webhook.event_id,
        at: webhook.ts_utc,
        message:
          `${formatBs(webhook.amount_bs_cents)} credited, but ` +
          `${formatUsdt(webhook.amount_usdt_micro)} x ${formatRate(webhook.rate_micro)} = ` +
          `${formatBs(expectedCents(product))}`,
      });
    }
  }
  return breaks;
}

// Rounded half up to the nearest cent.
function expectedCents(product: bigint): number {
  const half = MICRO_USDT_TIMES_MICRO_RATE_PER_CENT / 2n;
  return Number((product + half) / MICRO_USDT_TIMES_MICRO_RATE_PER_CENT);
}

// Each webhook has its own entry_key (funding:<event_id>), so two different
// webhooks for one deposit are both posted: the Bs would be credited twice.
export function checkDuplicateWebhooks(
  snapshot: ReconciliationSnapshot,
): Break[] {
  const byDeposit = new Map<string, FundingWebhookRecord[]>();
  for (const webhook of snapshot.webhooks) {
    const list = byDeposit.get(webhook.deposit_tx_hash) ?? [];
    list.push(webhook);
    byDeposit.set(webhook.deposit_tx_hash, list);
  }

  return [...byDeposit.entries()]
    .filter(([, webhooks]) => webhooks.length > 1)
    .map(([txHash, webhooks]) => ({
      code: 'FUNDING_DUPLICATE',
      severity: 'HIGH',
      ref: txHash,
      at: webhooks[1].ts_utc,
      message:
        `${webhooks.length} funding webhooks for one deposit ` +
        `(${webhooks.map((w) => w.event_id).join(', ')}); all were credited`,
    }));
}
