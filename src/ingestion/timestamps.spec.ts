import { toUtc } from './timestamps';

describe('toUtc', () => {
  it('converts a UTC-4 timestamp to UTC', () => {
    expect(toUtc('2026-10-05T08:18:00-04:00')).toBe('2026-10-05T12:18:00Z');
  });

  it('moves to the next day when crossing midnight in UTC', () => {
    expect(toUtc('2026-10-05T22:30:00-04:00')).toBe('2026-10-06T02:30:00Z');
  });

  it('keeps timestamps that are already in UTC', () => {
    expect(toUtc('2026-10-05T12:18:00Z')).toBe('2026-10-05T12:18:00Z');
  });

  it('produces text that sorts in time order even if offsets differ', () => {
    const later = toUtc('2026-10-05T23:30:00-04:00'); // 03:30 UTC on the 6th
    const earlier = toUtc('2026-10-06T02:00:00Z');
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it.each([
    '2026-10-05T08:18:00', // no offset
    '2026-10-05', // no time
    '2026-10-05 08:18:00-04:00', // space instead of T
    '2026-13-01T00:00:00Z', // month 13
    '2026-02-30T00:00:00-04:00', // JS would roll over to March 2
    '2026-10-05T24:00:00Z', // JS would roll over to the next day
    'yesterday',
  ])('rejects %p', (input) => {
    expect(() => toUtc(input)).toThrow();
  });
});
