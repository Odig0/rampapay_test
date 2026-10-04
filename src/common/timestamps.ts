// "2026-10-05T08:18:00-04:00" or "2026-10-05T12:18:00Z".
// The offset is required: without it JavaScript would assume the local time
// zone of the machine running the code.
const ISO_WITH_OFFSET =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(Z|([+-])(\d{2}):(\d{2}))$/;

// Converts an ISO 8601 timestamp with offset to UTC in a fixed-width format
// ("2026-10-05T12:18:00Z"), so sorting the text is sorting by time.
export function toUtc(value: string): string {
  const match = ISO_WITH_OFFSET.exec(value);
  if (!match) {
    throw new Error(`timestamp must be ISO 8601 with offset: "${value}"`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid timestamp: "${value}"`);
  }

  // JavaScript silently rolls over impossible dates ("02-30" becomes "03-02",
  // "24:00" becomes the next day). Going back to the original offset must
  // give exactly the wall-clock time we received.
  const [, wallClock, offset, sign, hours, minutes] = match;
  const offsetMinutes =
    offset === 'Z'
      ? 0
      : (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
  const roundTrip = new Date(date.getTime() + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, 19);
  if (roundTrip !== wallClock) {
    throw new Error(`invalid timestamp: "${value}"`);
  }

  return date.toISOString().slice(0, 19) + 'Z';
}
