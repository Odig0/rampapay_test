import { Inject, Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DATABASE } from '../database/database';
import {
  FundingWebhookRecord,
  PayoutEventRecord,
  ReferenceRateRecord,
  UsdtDepositRecord,
} from '../database/rows';
import { formatMinorUnits } from '../common/money';
import {
  ACCOUNTS,
  Account,
  CURRENCY_DECIMALS,
  Currency,
} from '../ledger/accounts';
import { LedgerService } from '../ledger/ledger.service';
import { Break, Severity } from './breaks';
import { runChecks } from './checks';
import { boliviaTimestamp } from './format';
import { PAYOUT_STATUSES, PayoutStatus, derivePayouts } from './payouts';
import {
  IngestConflict,
  IngestRejection,
  ReconciliationSnapshot,
} from './snapshot';

// The four balances from the brief. USDT in micro-USDT, Bs in cents.
export interface ReportBalances {
  usdtNotConverted: number;
  bsAvailableAtProvider: number;
  bsPaidOut: number;
  // Not from the ledger: the provider does not reserve balance on CONFIRM,
  // so this is computed from the pay-out events.
  bsInPendingPayouts: number;
}

export type PayoutSummary = Record<
  PayoutStatus,
  { count: number; amountBsCents: number }
>;

export interface Amount {
  amount: string; // decimal with 2 places, e.g. "3900.00"
  currency: Currency;
}

export interface ReconciliationReport {
  asOf: string; // Bolivia time, e.g. "2026-10-05T20:00:00-04:00"
  asOfUtc: string;
  balances: Record<keyof ReportBalances, Amount>;
  payouts: Record<PayoutStatus, { count: number; amount: Amount }>;
  breakCount: Record<Severity, number>;
  breaks: Break[];
}

const SELECT_DEPOSITS_SQL = `
  SELECT tx_hash, amount_usdt_micro, ts_utc
  FROM usdt_deposits
  WHERE ts_utc <= @as_of
  ORDER BY ts_utc, tx_hash`;

const SELECT_WEBHOOKS_SQL = `
  SELECT event_id, deposit_tx_hash, amount_usdt_micro, rate_micro, amount_bs_cents, ts_utc
  FROM funding_webhooks
  WHERE ts_utc <= @as_of
  ORDER BY ts_utc, event_id`;

const SELECT_PAYOUT_EVENTS_SQL = `
  SELECT event_id, payout_id, type, amount_bs_cents, ts_utc
  FROM payout_events
  WHERE ts_utc <= @as_of
  ORDER BY ts_utc, event_id`;

const SELECT_RATES_SQL = `
  SELECT ts_utc, usdt_bs_micro
  FROM reference_rates
  WHERE ts_utc <= @as_of
  ORDER BY ts_utc`;

const SELECT_CONFLICTS_SQL = `
  SELECT source, natural_key, existing_raw, incoming_raw
  FROM ingest_conflicts
  ORDER BY source, natural_key, incoming_raw`;

const SELECT_REJECTIONS_SQL = `
  SELECT source, row_number, reason, raw
  FROM ingest_rejections
  ORDER BY source, row_number, raw`;

// Builds the report from the raw tables and the ledger on every call. Nothing
// is stored, so running it again always gives the same result.
@Injectable()
export class ReportService {
  constructor(
    @Inject(DATABASE) private readonly db: Database.Database,
    private readonly ledger: LedgerService,
  ) {}

  loadSnapshot(asOf: string): ReconciliationSnapshot {
    const params = { as_of: asOf };
    return {
      asOf,
      deposits: this.db
        .prepare(SELECT_DEPOSITS_SQL)
        .all(params) as UsdtDepositRecord[],
      webhooks: this.db
        .prepare(SELECT_WEBHOOKS_SQL)
        .all(params) as FundingWebhookRecord[],
      payoutEvents: this.db
        .prepare(SELECT_PAYOUT_EVENTS_SQL)
        .all(params) as PayoutEventRecord[],
      rates: this.db
        .prepare(SELECT_RATES_SQL)
        .all(params) as ReferenceRateRecord[],
      providerBalanceMovements: this.ledger.getMovements(
        ACCOUNTS.providerAvailable.code,
        asOf,
      ),
      conflicts: this.db
        .prepare(SELECT_CONFLICTS_SQL)
        .all() as IngestConflict[],
      rejections: this.db
        .prepare(SELECT_REJECTIONS_SQL)
        .all() as IngestRejection[],
    };
  }

  getBreaks(asOf: string): Break[] {
    return runChecks(this.loadSnapshot(asOf));
  }

  getBalances(asOf: string): ReportBalances {
    const ledgerBalances = this.ledger.getBalances(asOf);
    const balanceOf = (account: Account) =>
      ledgerBalances.find((b) => b.account === account.code)?.balance_minor ??
      0;

    return {
      usdtNotConverted: balanceOf(ACCOUNTS.pendingConversion),
      bsAvailableAtProvider: balanceOf(ACCOUNTS.providerAvailable),
      bsPaidOut: balanceOf(ACCOUNTS.paidOut),
      bsInPendingPayouts: this.getPayoutSummary(asOf).PENDING.amountBsCents,
    };
  }

  getPayoutSummary(asOf: string): PayoutSummary {
    const summary = Object.fromEntries(
      PAYOUT_STATUSES.map((status) => [status, { count: 0, amountBsCents: 0 }]),
    ) as PayoutSummary;

    for (const payout of derivePayouts(this.loadSnapshot(asOf).payoutEvents)) {
      summary[payout.status].count += 1;
      summary[payout.status].amountBsCents += payout.amount_bs_cents;
    }
    return summary;
  }

  // The full report, ready to print or save as JSON. Amounts are decimal
  // strings (never floats). It contains no generation time, so the same data
  // always produces the same file.
  buildReport(asOf: string): ReconciliationReport {
    const balances = this.getBalances(asOf);
    const payouts = this.getPayoutSummary(asOf);
    const breaks = this.getBreaks(asOf);

    return {
      asOf: boliviaTimestamp(asOf),
      asOfUtc: asOf,
      balances: {
        usdtNotConverted: amount(balances.usdtNotConverted, 'USDT'),
        bsAvailableAtProvider: amount(balances.bsAvailableAtProvider, 'BS'),
        bsPaidOut: amount(balances.bsPaidOut, 'BS'),
        bsInPendingPayouts: amount(balances.bsInPendingPayouts, 'BS'),
      },
      payouts: Object.fromEntries(
        PAYOUT_STATUSES.map((status) => [
          status,
          {
            count: payouts[status].count,
            amount: amount(payouts[status].amountBsCents, 'BS'),
          },
        ]),
      ) as ReconciliationReport['payouts'],
      breakCount: {
        HIGH: breaks.filter((b) => b.severity === 'HIGH').length,
        MEDIUM: breaks.filter((b) => b.severity === 'MEDIUM').length,
      },
      breaks,
    };
  }
}

function amount(minorUnits: number, currency: Currency): Amount {
  return {
    amount: formatMinorUnits(minorUnits, CURRENCY_DECIMALS[currency], 2),
    currency,
  };
}
