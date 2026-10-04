import { ACCOUNTS } from '../../ledger/accounts';
import { Break } from '../breaks';
import { boliviaTime, formatBs } from '../format';
import { ReconciliationSnapshot } from '../snapshot';

// Walks the provider balance entry by entry and reports every interval in
// which it was negative: when it started, when it ended (or that it is still
// negative at the cut-off), the minimum, and the entry that caused it.
export function checkNegativeProviderBalance(
  snapshot: ReconciliationSnapshot,
): Break[] {
  const breaks: Break[] = [];
  let balance = 0;
  let open: { start: string; causedBy: string; minimum: number } | null = null;

  const close = (end: string | null) => {
    if (open === null) return;
    const until = end === null ? 'the cut-off' : boliviaTime(end);
    breaks.push({
      code: 'NEGATIVE_BALANCE',
      severity: 'HIGH',
      ref: open.causedBy,
      at: open.start,
      message:
        `${ACCOUNTS.providerAvailable.code} was negative from ${boliviaTime(open.start)} ` +
        `to ${until}${end === null ? ' (still negative)' : ''}, ` +
        `minimum ${formatBs(open.minimum)}, caused by ${open.causedBy}`,
    });
    open = null;
  };

  for (const movement of snapshot.providerBalanceMovements) {
    balance += movement.amount_minor;
    if (balance < 0) {
      if (open === null) {
        open = {
          start: movement.effective_at,
          causedBy: movement.entry_key,
          minimum: balance,
        };
      } else {
        open.minimum = Math.min(open.minimum, balance);
      }
    } else {
      close(movement.effective_at);
    }
  }
  close(null);

  return breaks;
}
