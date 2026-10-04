import {
  FundingWebhookDto,
  toFundingWebhookRecord,
} from './dto/funding-webhook.dto';
import { PayoutEventDto, toPayoutEventRecord } from './dto/payout-event.dto';
import {
  ReferenceRateDto,
  toReferenceRateRecord,
} from './dto/reference-rate.dto';
import { UsdtDepositDto, toUsdtDepositRecord } from './dto/usdt-deposit.dto';
import { RawRow, parseCsv, parseJsonArray } from './file-parsers';
import { ParsedRow, parseRow } from './row-parser';

// Column name -> value, ready to bind to the SQL named parameters (@column).
export type DbRecord = Record<string, string | number>;

// Everything the ingestion service needs to know about one input file.
export interface IngestSource {
  // Table name; also stored as "source" in ingest_conflicts/ingest_rejections.
  name: string;
  fileName: string;
  // Natural key column, used to look up the existing row on a duplicate key.
  keyColumn: string;
  parseFile: (text: string) => RawRow[];
  parseRow: (row: RawRow) => ParsedRow<DbRecord>;
  // INSERT ... ON CONFLICT DO NOTHING: an existing key is never overwritten.
  insertSql: string;
  // Returns the stored row for a key (normalized columns + raw).
  selectByKeySql: string;
}

export const USDT_DEPOSITS: IngestSource = {
  name: 'usdt_deposits',
  fileName: 'usdt_deposits.csv',
  keyColumn: 'tx_hash',
  parseFile: parseCsv,
  parseRow: (row) => parseRow(row, UsdtDepositDto, toUsdtDepositRecord),
  insertSql: `
    INSERT INTO usdt_deposits (tx_hash, amount_usdt_micro, ts_utc, raw)
    VALUES (@tx_hash, @amount_usdt_micro, @ts_utc, @raw)
    ON CONFLICT (tx_hash) DO NOTHING`,
  selectByKeySql: `
    SELECT tx_hash, amount_usdt_micro, ts_utc, raw
    FROM usdt_deposits
    WHERE tx_hash = ?`,
};

export const FUNDING_WEBHOOKS: IngestSource = {
  name: 'funding_webhooks',
  fileName: 'funding_webhooks.json',
  keyColumn: 'event_id',
  parseFile: parseJsonArray,
  parseRow: (row) => parseRow(row, FundingWebhookDto, toFundingWebhookRecord),
  insertSql: `
    INSERT INTO funding_webhooks
      (event_id, deposit_tx_hash, amount_usdt_micro, rate_micro, amount_bs_cents, ts_utc, raw)
    VALUES
      (@event_id, @deposit_tx_hash, @amount_usdt_micro, @rate_micro, @amount_bs_cents, @ts_utc, @raw)
    ON CONFLICT (event_id) DO NOTHING`,
  selectByKeySql: `
    SELECT event_id, deposit_tx_hash, amount_usdt_micro, rate_micro, amount_bs_cents, ts_utc, raw
    FROM funding_webhooks
    WHERE event_id = ?`,
};

export const PAYOUT_EVENTS: IngestSource = {
  name: 'payout_events',
  fileName: 'payout_events.json',
  keyColumn: 'event_id',
  parseFile: parseJsonArray,
  parseRow: (row) => parseRow(row, PayoutEventDto, toPayoutEventRecord),
  insertSql: `
    INSERT INTO payout_events (event_id, payout_id, type, amount_bs_cents, ts_utc, raw)
    VALUES (@event_id, @payout_id, @type, @amount_bs_cents, @ts_utc, @raw)
    ON CONFLICT (event_id) DO NOTHING`,
  selectByKeySql: `
    SELECT event_id, payout_id, type, amount_bs_cents, ts_utc, raw
    FROM payout_events
    WHERE event_id = ?`,
};

export const REFERENCE_RATES: IngestSource = {
  name: 'reference_rates',
  fileName: 'reference_rates.csv',
  keyColumn: 'ts_utc',
  parseFile: parseCsv,
  parseRow: (row) => parseRow(row, ReferenceRateDto, toReferenceRateRecord),
  insertSql: `
    INSERT INTO reference_rates (ts_utc, usdt_bs_micro, raw)
    VALUES (@ts_utc, @usdt_bs_micro, @raw)
    ON CONFLICT (ts_utc) DO NOTHING`,
  selectByKeySql: `
    SELECT ts_utc, usdt_bs_micro, raw
    FROM reference_rates
    WHERE ts_utc = ?`,
};

// The order does not matter: there are no foreign keys between these tables.
export const SOURCES: IngestSource[] = [
  USDT_DEPOSITS,
  FUNDING_WEBHOOKS,
  PAYOUT_EVENTS,
  REFERENCE_RATES,
];
