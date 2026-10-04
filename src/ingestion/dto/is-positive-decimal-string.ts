import { ValidateBy, ValidationOptions } from 'class-validator';

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

// CSV values always arrive as text, so @IsPositive() (numbers only) does not
// apply. Accepts "5000.00"; rejects "0", "-5", "1e3", "abc" and non-strings.
export function IsPositiveDecimalString(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isPositiveDecimalString',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          PLAIN_DECIMAL.test(value) &&
          Number(value) > 0,
        defaultMessage: (args) =>
          `${args?.property} must be a positive decimal number`,
      },
    },
    options,
  );
}
