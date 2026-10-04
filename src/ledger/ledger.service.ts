import { Inject, Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DATABASE } from '../database/database';
import { FundingWebhookRecord, UsdtDepositRecord } from '../database/rows';
import { Currency } from './accounts';
import {
  LedgerEntry,
  PostablePayoutEvent,
  assertBalanced,
  depositEntry,
  fundingEntry,
  payoutEntry,
} from './entries';

export interface PostingSummary {
  posted: number;
  // The entry_key already existed: the same event posted before, or another
  // event for the same pay-out and type (reported in the breaks step).
  skipped: number;
}

export interface AccountBalance {
  account: string;
  currency: Currency;
  balance_minor: number; // debits - credits, in micro-USDT or Bs cents
}

// Net effect of one entry on one account.
export interface AccountMovement {
  entry_key: string;
  effective_at: string;
  amount_minor: number; // debits - credits; negative lowers the balance
}

// Events are read in time order (ties broken by id) so that, within a run,
// the earliest event wins when two events share an entry_key, regardless of
// the order in which they were ingested.
const SELECT_DEPOSITS_SQL = `
  SELECT tx_hash, amount_usdt_micro, ts_utc
  FROM usdt_deposits
  ORDER BY ts_utc, tx_hash`;

const SELECT_FUNDING_WEBHOOKS_SQL = `
  SELECT event_id, deposit_tx_hash, amount_usdt_micro, rate_micro, amount_bs_cents, ts_utc
  FROM funding_webhooks
  ORDER BY ts_utc, event_id`;

const SELECT_POSTABLE_PAYOUT_EVENTS_SQL = `
  SELECT event_id, payout_id, type, amount_bs_cents, ts_utc
  FROM payout_events
  WHERE type IN ('COMPLETED', 'REVERSED')
  ORDER BY ts_utc, event_id`;

const INSERT_ENTRY_SQL = `
  INSERT INTO ledger_entries (entry_key, type, effective_at, source_table, source_id)
  VALUES (@entry_key, @type, @effective_at, @source_table, @source_id)
  ON CONFLICT (entry_key) DO NOTHING`;

const INSERT_LINE_SQL = `
  INSERT INTO ledger_lines (entry_id, account, currency, direction, amount_minor)
  VALUES (@entry_id, @account, @currency, @direction, @amount_minor)`;

// Every account appears, even with no lines (balance 0). Only entries
// effective at or before the cut-off count.
const SELECT_BALANCES_SQL = `
  SELECT
    a.code AS account,
    a.currency,
    COALESCE(SUM(
      CASE l.direction WHEN 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END
    ), 0) AS balance_minor
  FROM ledger_accounts a
  LEFT JOIN (
    SELECT lines.account, lines.direction, lines.amount_minor
    FROM ledger_lines lines
    JOIN ledger_entries entries ON entries.id = lines.entry_id
    WHERE entries.effective_at <= @as_of
  ) l ON l.account = a.code
  GROUP BY a.code, a.currency
  ORDER BY a.currency DESC, a.code`;

// One row per entry that touches the account, in time order. Ties are broken
// by entry_key (not by id) so the order does not depend on posting order.
const SELECT_MOVEMENTS_SQL = `
  SELECT
    e.entry_key,
    e.effective_at,
    SUM(CASE l.direction WHEN 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END)
      AS amount_minor
  FROM ledger_lines l
  JOIN ledger_entries e ON e.id = l.entry_id
  WHERE l.account = @account AND e.effective_at <= @as_of
  GROUP BY e.id
  ORDER BY e.effective_at, e.entry_key`;

// Builds the double-entry ledger from the ingested raw tables. Append-only and
// idempotent: each event maps to one entry_key, and posting again is a no-op.
// Each event is posted on its own, so the order of arrival does not matter;
// chronology comes from effective_at.
@Injectable()
export class LedgerService {
  constructor(@Inject(DATABASE) private readonly db: Database.Database) {}

  postAll(): PostingSummary {
    const summary: PostingSummary = { posted: 0, skipped: 0 };

    const postEverything = this.db.transaction(() => {
      for (const entry of this.buildEntries()) {
        if (this.postEntry(entry)) {
          summary.posted += 1;
        } else {
          summary.skipped += 1;
        }
      }
    });
    postEverything();

    return summary;
  }

  // asOf is a UTC timestamp in the same format as effective_at
  // (e.g. "2026-10-06T00:00:00Z"); it is inclusive.
  getBalances(asOf: string): AccountBalance[] {
    return this.db
      .prepare(SELECT_BALANCES_SQL)
      .all({ as_of: asOf }) as AccountBalance[];
  }

  getMovements(account: string, asOf: string): AccountMovement[] {
    return this.db
      .prepare(SELECT_MOVEMENTS_SQL)
      .all({ account, as_of: asOf }) as AccountMovement[];
  }

  private buildEntries(): LedgerEntry[] {
    const deposits = this.db
      .prepare(SELECT_DEPOSITS_SQL)
      .all() as UsdtDepositRecord[];
    const webhooks = this.db
      .prepare(SELECT_FUNDING_WEBHOOKS_SQL)
      .all() as FundingWebhookRecord[];
    const payoutEvents = this.db
      .prepare(SELECT_POSTABLE_PAYOUT_EVENTS_SQL)
      .all() as PostablePayoutEvent[];

    return [
      ...deposits.map(depositEntry),
      ...webhooks.map(fundingEntry),
      ...payoutEvents.map(payoutEntry),
    ];
  }

  // Inserts the entry and its lines. Returns false if the entry_key exists.
  private postEntry(entry: LedgerEntry): boolean {
    assertBalanced(entry);

    const { lines, ...header } = entry;
    const result = this.db.prepare(INSERT_ENTRY_SQL).run(header);
    if (result.changes === 0) {
      return false;
    }

    const insertLine = this.db.prepare(INSERT_LINE_SQL);
    for (const line of lines) {
      insertLine.run({ entry_id: result.lastInsertRowid, ...line });
    }
    return true;
  }
}
