import {
  PayoutEventRecord,
  PayoutEventType,
} from '../ingestion/dto/payout-event.dto';
import { derivePayouts } from './payouts';

let nextId = 0;
function event(
  payoutId: string,
  type: PayoutEventType,
  time: string,
  amount = 100_00,
): PayoutEventRecord {
  nextId += 1;
  return {
    event_id: `pe_${String(nextId).padStart(3, '0')}`,
    payout_id: payoutId,
    type,
    amount_bs_cents: amount,
    ts_utc: `2026-10-05T${time}:00Z`,
  };
}

function statuses(events: PayoutEventRecord[]) {
  return Object.fromEntries(
    derivePayouts(events).map((p) => [p.payout_id, p.status]),
  );
}

describe('derivePayouts', () => {
  it('derives each status from the furthest stage reached', () => {
    const events = [
      event('P1', 'PREVIEW', '10:00'),
      event('P1', 'CONFIRM', '10:01'),
      event('P1', 'COMPLETED', '10:05'),
      event('P2', 'PREVIEW', '11:00'),
      event('P2', 'CONFIRM', '11:01'),
      event('P2', 'COMPLETED', '11:05'),
      event('P2', 'REVERSED', '15:00'),
      event('P3', 'PREVIEW', '12:00'),
      event('P3', 'CONFIRM', '12:01'),
      event('P3', 'FAILED', '12:04'),
      event('P4', 'PREVIEW', '13:00'),
      event('P5', 'PREVIEW', '14:00'),
      event('P5', 'CONFIRM', '14:01'),
    ];

    expect(statuses(events)).toEqual({
      P1: 'COMPLETED',
      P2: 'REVERSED',
      P3: 'FAILED',
      P4: 'EXPIRED',
      P5: 'PENDING',
    });
  });

  it('gives the same result regardless of arrival order', () => {
    const events = [
      event('P1', 'PREVIEW', '10:00'),
      event('P1', 'CONFIRM', '10:01'),
      event('P1', 'COMPLETED', '10:05'),
      event('P2', 'CONFIRM', '11:01'),
    ];

    expect(derivePayouts([...events].reverse())).toEqual(derivePayouts(events));
  });

  it('uses the amount of the event that sets the status', () => {
    const [payout] = derivePayouts([
      event('P1', 'PREVIEW', '10:00', 100_00),
      event('P1', 'CONFIRM', '10:01', 120_00),
    ]);

    expect(payout).toMatchObject({
      status: 'PENDING',
      amount_bs_cents: 120_00,
    });
  });

  it('keeps the earliest event of each type and all events in time order', () => {
    const late = event('P1', 'COMPLETED', '10:09');
    const early = event('P1', 'COMPLETED', '10:05');
    const confirm = event('P1', 'CONFIRM', '10:01');

    const [payout] = derivePayouts([late, early, confirm]);

    expect(payout.firstOfType.COMPLETED).toBe(early);
    expect(payout.events).toEqual([confirm, early, late]);
  });
});
