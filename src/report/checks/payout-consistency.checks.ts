import { PayoutEventType } from '../../database/rows';
import { Break, MAX_PAYOUT_FINALIZATION_MINUTES, Severity } from '../breaks';
import {
  boliviaTime,
  formatBs,
  formatMinutes,
  minutesBetween,
} from '../format';
import { Payout, derivePayouts } from '../payouts';
import { ReconciliationSnapshot } from '../snapshot';

// Lifecycle rules: PREVIEW -> CONFIRM -> COMPLETED | FAILED, and only a
// COMPLETED pay-out can be REVERSED. Checked on which events exist (not on
// arrival order, which is not guaranteed).
export function checkPayoutTransitions(
  snapshot: ReconciliationSnapshot,
): Break[] {
  const breaks: Break[] = [];

  for (const payout of derivePayouts(snapshot.payoutEvents)) {
    const { CONFIRM, COMPLETED, FAILED, REVERSED } = payout.firstOfType;
    const flag = (severity: Severity, at: string, problem: string) =>
      breaks.push({
        code: 'PAYOUT_INVALID_TRANSITION',
        severity,
        ref: payout.payout_id,
        at,
        message: problem,
      });

    if (COMPLETED && FAILED) {
      flag(
        'HIGH',
        COMPLETED.ts_utc,
        `both COMPLETED (${boliviaTime(COMPLETED.ts_utc)}) and FAILED ` +
          `(${boliviaTime(FAILED.ts_utc)}); the ledger treats it as paid`,
      );
    }
    if (REVERSED && !COMPLETED) {
      flag(
        'HIGH',
        REVERSED.ts_utc,
        `REVERSED without COMPLETED: ${formatBs(REVERSED.amount_bs_cents)} ` +
          `returned that was never paid out`,
      );
    }
    for (const final of [COMPLETED, FAILED]) {
      if (final && !CONFIRM) {
        flag('MEDIUM', final.ts_utc, `${final.type} without CONFIRM`);
      }
    }
  }
  return breaks;
}

// All events of a pay-out should carry the same amount.
export function checkPayoutAmounts(snapshot: ReconciliationSnapshot): Break[] {
  return derivePayouts(snapshot.payoutEvents)
    .filter(
      (payout) => new Set(payout.events.map((e) => e.amount_bs_cents)).size > 1,
    )
    .map((payout) => ({
      code: 'PAYOUT_AMOUNT_MISMATCH',
      severity: 'HIGH',
      ref: payout.payout_id,
      at: payout.events[0].ts_utc,
      message: `amounts differ between events: ${payout.events
        .map((e) => `${e.type} ${formatBs(e.amount_bs_cents)}`)
        .join(', ')}`,
    }));
}

// Two different events (event_id) of a posted type for the same pay-out.
// The ledger keys pay-outs by payout_id + type, so only the earliest was
// posted; the other one needs review.
const POSTED_TYPES: PayoutEventType[] = ['COMPLETED', 'REVERSED'];

export function checkDuplicatePayoutEvents(
  snapshot: ReconciliationSnapshot,
): Break[] {
  const breaks: Break[] = [];

  for (const payout of derivePayouts(snapshot.payoutEvents)) {
    for (const type of POSTED_TYPES) {
      const [posted, ...ignored] = payout.events.filter((e) => e.type === type);
      for (const event of ignored) {
        breaks.push({
          code: 'PAYOUT_DUPLICATE_EVENT',
          severity: 'MEDIUM',
          ref: event.event_id,
          at: event.ts_utc,
          message:
            `second ${type} for ${payout.payout_id} (${formatBs(event.amount_bs_cents)}); ` +
            `not posted, the ledger used ${posted.event_id}`,
        });
      }
    }
  }
  return breaks;
}

// A final state that arrived, but more than 15 minutes after CONFIRM.
export function checkSlowPayouts(snapshot: ReconciliationSnapshot): Break[] {
  const breaks: Break[] = [];

  for (const payout of derivePayouts(snapshot.payoutEvents)) {
    const confirm = payout.firstOfType.CONFIRM;
    const final = firstFinalEvent(payout);
    if (!confirm || !final) {
      continue;
    }
    const delay = minutesBetween(confirm.ts_utc, final.ts_utc);
    if (delay > MAX_PAYOUT_FINALIZATION_MINUTES) {
      breaks.push({
        code: 'PAYOUT_SLOW',
        severity: 'MEDIUM',
        ref: payout.payout_id,
        at: final.ts_utc,
        message:
          `${final.type} at ${boliviaTime(final.ts_utc)} arrived ${formatMinutes(delay)} ` +
          `after CONFIRM at ${boliviaTime(confirm.ts_utc)} ` +
          `(limit ${MAX_PAYOUT_FINALIZATION_MINUTES} min)`,
      });
    }
  }
  return breaks;
}

function firstFinalEvent(payout: Payout) {
  return payout.events.find(
    (e) => e.type === 'COMPLETED' || e.type === 'FAILED',
  );
}
