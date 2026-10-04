import {
  BS_DECIMALS,
  RATE_DECIMALS,
  USDT_DECIMALS,
  formatMinorUnits,
  toMinorUnits,
} from './money';

describe('toMinorUnits', () => {
  it('converts strings and numbers to integers in the smallest unit', () => {
    expect(toMinorUnits('5000.00', USDT_DECIMALS)).toBe(5_000_000_000);
    expect(toMinorUnits(48972.5, BS_DECIMALS)).toBe(4_897_250);
    expect(toMinorUnits(9.7945, RATE_DECIMALS)).toBe(9_794_500);
    expect(toMinorUnits(5000, BS_DECIMALS)).toBe(500_000);
  });

  it('is exact where float multiplication is not', () => {
    // 4.35 * 100 === 434.99999999999994 in JavaScript.
    expect(toMinorUnits(4.35, BS_DECIMALS)).toBe(435);
  });

  it('keeps the sign and zero, so validators can decide what is allowed', () => {
    expect(toMinorUnits('-12.5', BS_DECIMALS)).toBe(-1250);
    expect(toMinorUnits(0, BS_DECIMALS)).toBe(0);
  });

  it('rejects more decimals than the unit allows instead of rounding', () => {
    expect(() => toMinorUnits('10.005', BS_DECIMALS)).toThrow(
      'more than 2 decimals',
    );
  });

  it.each(['', 'abc', '12.', '.5', '1e+21', '1,000.00', ' 5'])(
    'rejects malformed input %p',
    (input) => {
      expect(() => toMinorUnits(input, BS_DECIMALS)).toThrow();
    },
  );

  it('rejects amounts beyond the safe integer range', () => {
    expect(() => toMinorUnits('99999999999999', USDT_DECIMALS)).toThrow(
      'too large',
    );
  });
});

describe('formatMinorUnits', () => {
  it('formats amounts with the requested number of decimals', () => {
    expect(formatMinorUnits(1_500_000_000, USDT_DECIMALS, 2)).toBe('1500.00');
    expect(formatMinorUnits(1_212_095, BS_DECIMALS, 2)).toBe('12120.95');
    expect(formatMinorUnits(-14_162_650, BS_DECIMALS, 2)).toBe('-141626.50');
    expect(formatMinorUnits(5, BS_DECIMALS, 2)).toBe('0.05');
    expect(formatMinorUnits(0, BS_DECIMALS, 2)).toBe('0.00');
  });

  it('rounds half up when showing fewer decimals than stored', () => {
    expect(formatMinorUnits(1_234_999, USDT_DECIMALS, 2)).toBe('1.23');
    expect(formatMinorUnits(1_235_000, USDT_DECIMALS, 2)).toBe('1.24');
    expect(formatMinorUnits(-1, USDT_DECIMALS, 2)).toBe('0.00');
  });
});
