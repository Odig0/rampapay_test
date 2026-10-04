import { FundingWebhookRecord } from '../ingestion/dto/funding-webhook.dto';
import { PayoutEventRecord } from '../ingestion/dto/payout-event.dto';
import { UsdtDepositRecord } from '../ingestion/dto/usdt-deposit.dto';
import { ACCOUNTS, Account, Currency } from './accounts';

export type EntryType =
  'DEPOSIT' | 'FUNDING' | 'PAYOUT_COMPLETED' | 'PAYOUT_REVERSED';

export interface LedgerLine {
  account: string;
  currency: Currency;
  direction: 'DEBIT' | 'CREDIT';
  amount_minor: number; // always > 0, in micro-USDT or Bs cents
}

export interface LedgerEntry {
  entry_key: string;
  type: EntryType;
  effective_at: string;
  source_table: string;
  source_id: string;
  lines: LedgerLine[];
}

// Pay-out events that move money. PREVIEW, CONFIRM and FAILED do not: the
// provider does not reserve balance before COMPLETED.
export type PostablePayoutEvent = PayoutEventRecord & {
  type: 'COMPLETED' | 'REVERSED';
};

function debit(account: Account, amount: number): LedgerLine {
  return { ...lineAccount(account), direction: 'DEBIT', amount_minor: amount };
}

function credit(account: Account, amount: number): LedgerLine {
  return { ...lineAccount(account), direction: 'CREDIT', amount_minor: amount };
}

function lineAccount(account: Account) {
  return { account: account.code, currency: account.currency };
}

// The functions below turn one source event into one journal entry. They use
// the amounts reported in the event as-is: the ledger records what happened,
// it does not judge it (anomalies are reported separately).

// USDT sent on-chain to the provider: now waiting to be converted.
export function depositEntry(deposit: UsdtDepositRecord): LedgerEntry {
  return {
    entry_key: `deposit:${deposit.tx_hash}`,
    type: 'DEPOSIT',
    effective_at: deposit.ts_utc,
    source_table: 'usdt_deposits',
    source_id: deposit.tx_hash,
    lines: [
      debit(ACCOUNTS.pendingConversion, deposit.amount_usdt_micro),
      credit(ACCOUNTS.partnerFunding, deposit.amount_usdt_micro),
    ],
  };
}

// The provider converted USDT to Bs. One entry, two currencies; each currency
// balances on its own.
export function fundingEntry(webhook: FundingWebhookRecord): LedgerEntry {
  return {
    entry_key: `funding:${webhook.event_id}`,
    type: 'FUNDING',
    effective_at: webhook.ts_utc,
    source_table: 'funding_webhooks',
    source_id: webhook.event_id,
    lines: [
      debit(ACCOUNTS.usdtConversion, webhook.amount_usdt_micro),
      credit(ACCOUNTS.pendingConversion, webhook.amount_usdt_micro),
      debit(ACCOUNTS.providerAvailable, webhook.amount_bs_cents),
      credit(ACCOUNTS.bsConversion, webhook.amount_bs_cents),
    ],
  };
}

// COMPLETED debits the provider balance; REVERSED gives the money back.
// The key uses payout_id + type, not event_id, so a second COMPLETED for the
// same pay-out (even with a different event_id) cannot debit twice.
export function payoutEntry(event: PostablePayoutEvent): LedgerEntry {
  const completed = event.type === 'COMPLETED';
  const amount = event.amount_bs_cents;
  return {
    entry_key: `payout:${event.payout_id}:${event.type}`,
    type: completed ? 'PAYOUT_COMPLETED' : 'PAYOUT_REVERSED',
    effective_at: event.ts_utc,
    source_table: 'payout_events',
    source_id: event.event_id,
    lines: completed
      ? [
          debit(ACCOUNTS.paidOut, amount),
          credit(ACCOUNTS.providerAvailable, amount),
        ]
      : [
          debit(ACCOUNTS.providerAvailable, amount),
          credit(ACCOUNTS.paidOut, amount),
        ],
  };
}

// Double-entry invariant: per currency, debits equal credits. The database
// cannot check this across rows, so it is checked before every insert.
export function assertBalanced(entry: LedgerEntry): void {
  const net = new Map<Currency, number>();
  for (const line of entry.lines) {
    const signed =
      line.direction === 'DEBIT' ? line.amount_minor : -line.amount_minor;
    net.set(line.currency, (net.get(line.currency) ?? 0) + signed);
  }
  for (const [currency, amount] of net) {
    if (amount !== 0) {
      throw new Error(
        `unbalanced entry ${entry.entry_key}: ${currency} is off by ${amount}`,
      );
    }
  }
}
