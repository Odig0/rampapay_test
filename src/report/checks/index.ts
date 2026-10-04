import { Break, sortBreaks } from '../breaks';
import { ReconciliationSnapshot } from '../snapshot';
import { checkNegativeProviderBalance } from './balance.checks';
import {
  checkConversionRates,
  checkLateFundingWebhooks,
  checkUnconvertedDeposits,
} from './funding.checks';
import { checkIngestConflicts, checkIngestRejections } from './ingest.checks';
import { checkReversedPayouts, checkStuckPayouts } from './payout.checks';

export type Check = (snapshot: ReconciliationSnapshot) => Break[];

// Adding a check = writing a pure function and listing it here.
export const CHECKS: Check[] = [
  checkUnconvertedDeposits,
  checkLateFundingWebhooks,
  checkConversionRates,
  checkNegativeProviderBalance,
  checkStuckPayouts,
  checkReversedPayouts,
  checkIngestConflicts,
  checkIngestRejections,
];

export function runChecks(snapshot: ReconciliationSnapshot): Break[] {
  return sortBreaks(CHECKS.flatMap((check) => check(snapshot)));
}
