import { Break } from '../breaks';
import { ReconciliationSnapshot } from '../snapshot';

// Same natural key, different content: one of the two versions is wrong and
// only a human can tell which.
export function checkIngestConflicts(
  snapshot: ReconciliationSnapshot,
): Break[] {
  return snapshot.conflicts.map((conflict) => ({
    code: 'INGEST_CONFLICT',
    severity: 'HIGH',
    ref: `${conflict.source}:${conflict.natural_key}`,
    at: null,
    message: `kept ${conflict.existing_raw}, ignored ${conflict.incoming_raw}`,
  }));
}

// Rows that failed validation were not ingested: data may be missing.
export function checkIngestRejections(
  snapshot: ReconciliationSnapshot,
): Break[] {
  return snapshot.rejections.map((rejection) => ({
    code: 'INGEST_REJECTED',
    severity: 'MEDIUM',
    ref: `${rejection.source}:row ${rejection.row_number}`,
    at: null,
    message: `${rejection.reason}: ${rejection.raw}`,
  }));
}
