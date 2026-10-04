// Number of decimals kept for each kind of value. Amounts are stored as
// integers in this unit: 5000.00 USDT -> 5_000_000_000 micro-USDT.
export const USDT_DECIMALS = 6;
export const BS_DECIMALS = 2;
export const RATE_DECIMALS = 6;

// Optional minus sign, digits, optional "." followed by digits.
// Rejects exponent notation ("1e+21"), "12." and ".5".
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

// Converts a decimal amount to an integer in its smallest unit using only
// string operations, so there is no floating-point arithmetic involved:
//   toMinorUnits("48972.5", 2) -> "48972" + "50" -> 4897250
// Throws instead of rounding when the value has more decimals than allowed.
export function toMinorUnits(value: string | number, decimals: number): number {
  // String(number) gives the shortest text that reads back as the same
  // number, e.g. String(29385.3) === "29385.3".
  const text = typeof value === 'number' ? String(value) : value;

  const match = DECIMAL_PATTERN.exec(text);
  if (!match) {
    throw new Error(`not a plain decimal number: "${text}"`);
  }

  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > decimals) {
    throw new Error(`more than ${decimals} decimals: "${text}"`);
  }

  const minorUnits = Number(sign + whole + fraction.padEnd(decimals, '0'));
  if (!Number.isSafeInteger(minorUnits)) {
    throw new Error(`amount too large: "${text}"`);
  }
  return minorUnits;
}

// Formats an integer amount in its smallest unit for display, e.g.
//   formatMinorUnits(1_500_000_000, 6, 2) -> "1500.00"
// When showing fewer decimals than stored, it rounds half up. Display only:
// stored values are never rounded.
export function formatMinorUnits(
  minorUnits: number,
  decimals: number,
  shownDecimals: number,
): string {
  const shown = Math.round(
    Math.abs(minorUnits) / 10 ** (decimals - shownDecimals),
  );
  const sign = minorUnits < 0 && shown > 0 ? '-' : '';
  const digits = String(shown).padStart(shownDecimals + 1, '0');
  return `${sign}${digits.slice(0, -shownDecimals)}.${digits.slice(-shownDecimals)}`;
}
