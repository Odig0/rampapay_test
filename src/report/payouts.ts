import { PayoutEventRecord, PayoutEventType } from '../database/rows';

// Where a pay-out stands at the cut-off:
//   COMPLETED  money left the provider balance
//   REVERSED   completed, then the money came back
//   FAILED     confirmed but not paid; no money moved
//   EXPIRED    PREVIEW never confirmed; no financial effect
//   PENDING    CONFIRM without COMPLETED or FAILED yet
export type PayoutStatus =
  'COMPLETED' | 'REVERSED' | 'FAILED' | 'EXPIRED' | 'PENDING';

export const PAYOUT_STATUSES: PayoutStatus[] = [
  'COMPLETED',
  'REVERSED',
  'FAILED',
  'EXPIRED',
  'PENDING',
];

export interface Payout {
  payout_id: string;
  status: PayoutStatus;
  // Amount of the event that set the status (e.g. the CONFIRM for PENDING).
  amount_bs_cents: number;
  // All events of the pay-out, sorted by time.
  events: PayoutEventRecord[];
  // Earliest event of each type, if any.
  firstOfType: Partial<Record<PayoutEventType, PayoutEventRecord>>;
}

// Groups events by pay-out and derives each pay-out's status. The status is
// the furthest stage reached, so it does not depend on arrival order:
// REVERSED > COMPLETED > FAILED > CONFIRM (pending) > PREVIEW (expired).
// Inconsistent histories (e.g. COMPLETED and FAILED) still get a status here;
// they are reported as breaks separately.
export function derivePayouts(events: PayoutEventRecord[]): Payout[] {
  const byPayout = new Map<string, PayoutEventRecord[]>();
  for (const event of sortByTime(events)) {
    const list = byPayout.get(event.payout_id) ?? [];
    list.push(event);
    byPayout.set(event.payout_id, list);
  }

  return [...byPayout.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([payoutId, payoutEvents]) => toPayout(payoutId, payoutEvents));
}

function toPayout(payoutId: string, events: PayoutEventRecord[]): Payout {
  const firstOfType: Payout['firstOfType'] = {};
  for (const event of events) {
    firstOfType[event.type] ??= event;
  }

  const { status, decidingEvent } = statusOf(firstOfType, events[0]);
  return {
    payout_id: payoutId,
    status,
    amount_bs_cents: decidingEvent.amount_bs_cents,
    events,
    firstOfType,
  };
}

function statusOf(
  first: Payout['firstOfType'],
  earliest: PayoutEventRecord,
): { status: PayoutStatus; decidingEvent: PayoutEventRecord } {
  if (first.REVERSED) {
    return { status: 'REVERSED', decidingEvent: first.REVERSED };
  }
  if (first.COMPLETED) {
    return { status: 'COMPLETED', decidingEvent: first.COMPLETED };
  }
  if (first.FAILED) {
    return { status: 'FAILED', decidingEvent: first.FAILED };
  }
  if (first.CONFIRM) {
    return { status: 'PENDING', decidingEvent: first.CONFIRM };
  }
  return { status: 'EXPIRED', decidingEvent: first.PREVIEW ?? earliest };
}

function sortByTime(events: PayoutEventRecord[]): PayoutEventRecord[] {
  return [...events].sort(
    (a, b) =>
      a.ts_utc.localeCompare(b.ts_utc) || a.event_id.localeCompare(b.event_id),
  );
}
