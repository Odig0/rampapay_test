// Thresholds from the brief.
export const MAX_FUNDING_DELAY_MINUTES = 10; // deposit -> funding webhook
export const MAX_PAYOUT_FINALIZATION_MINUTES = 15; // CONFIRM -> final state
export const MAX_SPREAD_BPS = 50; // 0.50 %, in basis points (1 bp = 0.01 %)

// HIGH: money is missing, wrong or at risk. MEDIUM: late, or needs a look.
export type Severity = 'HIGH' | 'MEDIUM';

export interface Break {
  code: string;
  severity: Severity;
  ref: string; // what it is about: tx_hash, event_id, payout_id, entry_key...
  at: string | null; // UTC moment it refers to; null if it has no time
  message: string; // human-readable reason with the concrete numbers
}

const SEVERITY_ORDER: Record<Severity, number> = { HIGH: 0, MEDIUM: 1 };

// Deterministic output order: severity, then time (no time last), code, ref.
export function sortBreaks(breaks: Break[]): Break[] {
  return [...breaks].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      compareTimes(a.at, b.at) ||
      a.code.localeCompare(b.code) ||
      a.ref.localeCompare(b.ref),
  );
}

function compareTimes(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}
