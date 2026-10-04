import { Break, MAX_PAYOUT_FINALIZATION_MINUTES } from '../breaks';
import {
  boliviaTime,
  formatBs,
  formatMinutes,
  minutesBetween,
} from '../format';
import { derivePayouts } from '../payouts';
import { ReconciliationSnapshot } from '../snapshot';

// A confirmed pay-out with no final state more than 15 minutes after CONFIRM.
export function checkStuckPayouts(snapshot: ReconciliationSnapshot): Break[] {
  const breaks: Break[] = [];

  for (const payout of derivePayouts(snapshot.payoutEvents)) {
    const confirm = payout.firstOfType.CONFIRM;
    if (payout.status !== 'PENDING' || confirm === undefined) {
      continue;
    }
    const waited = minutesBetween(confirm.ts_utc, snapshot.asOf);
    if (waited > MAX_PAYOUT_FINALIZATION_MINUTES) {
      breaks.push({
        code: 'PAYOUT_STUCK',
        severity: 'MEDIUM',
        ref: payout.payout_id,
        at: confirm.ts_utc,
        message:
          `${formatBs(confirm.amount_bs_cents)} confirmed at ${boliviaTime(confirm.ts_utc)} ` +
          `has no final state after ${formatMinutes(waited)} ` +
          `(limit ${MAX_PAYOUT_FINALIZATION_MINUTES} min)`,
      });
    }
  }
  return breaks;
}

// Every reversal needs a human to confirm why the money came back.
export function checkReversedPayouts(
  snapshot: ReconciliationSnapshot,
): Break[] {
  const breaks: Break[] = [];

  for (const payout of derivePayouts(snapshot.payoutEvents)) {
    const reversed = payout.firstOfType.REVERSED;
    if (reversed === undefined) {
      continue;
    }
    const completed = payout.firstOfType.COMPLETED;
    const completedAt = completed
      ? ` completed at ${boliviaTime(completed.ts_utc)} and`
      : '';
    breaks.push({
      code: 'PAYOUT_REVERSED',
      severity: 'MEDIUM',
      ref: payout.payout_id,
      at: reversed.ts_utc,
      message:
        `${formatBs(reversed.amount_bs_cents)}${completedAt} reversed at ` +
        `${boliviaTime(reversed.ts_utc)}; needs human review`,
    });
  }
  return breaks;
}
