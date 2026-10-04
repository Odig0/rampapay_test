export type Currency = 'USDT' | 'BS';

export interface Account {
  code: string;
  currency: Currency;
}

// Must match the rows seeded into ledger_accounts in schema.ts. A typo here
// is caught by the (account, currency) foreign key on ledger_lines.
export const ACCOUNTS = {
  // USDT the partner prefunds us with (where the USDT comes from).
  partnerFunding: { code: 'usdt:partner_funding', currency: 'USDT' },
  // USDT sent to the provider's wallet and not yet converted to Bs.
  pendingConversion: { code: 'usdt:pending_conversion', currency: 'USDT' },
  // USDT that left through conversion.
  usdtConversion: { code: 'usdt:conversion', currency: 'USDT' },
  // Bs that came in through conversion.
  bsConversion: { code: 'bs:conversion', currency: 'BS' },
  // Bs balance held by the provider.
  providerAvailable: { code: 'bs:provider_available', currency: 'BS' },
  // Bs paid out to QR codes.
  paidOut: { code: 'bs:paid_out', currency: 'BS' },
} as const satisfies Record<string, Account>;
