import { Inject, Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATABASE } from '../database/database';
import { RawRow } from './file-parsers';
import { DbRecord, IngestSource, SOURCES } from './sources';

export interface IngestSummary {
  source: string;
  read: number;
  inserted: number;
  duplicates: number; // same key, same content: ignored
  conflicts: number; // same key, different content: kept original, logged
  invalid: number; // failed validation: not inserted, logged
}

type RowOutcome = 'inserted' | 'duplicates' | 'conflicts' | 'invalid';

const INSERT_CONFLICT_SQL = `
  INSERT INTO ingest_conflicts (source, natural_key, existing_raw, incoming_raw)
  VALUES (@source, @natural_key, @existing_raw, @incoming_raw)
  ON CONFLICT (source, natural_key, incoming_raw) DO NOTHING`;

const INSERT_REJECTION_SQL = `
  INSERT INTO ingest_rejections (source, row_number, reason, raw)
  VALUES (@source, @row_number, @reason, @raw)
  ON CONFLICT (source, raw) DO NOTHING`;

// Loads the input files into their raw tables. No business logic here: rows
// are not sorted, matched or checked against the pay-out state machine.
// Idempotency comes from the database (primary keys + ON CONFLICT DO NOTHING),
// so ingesting the same files again leaves exactly the same rows.
@Injectable()
export class IngestionService {
  constructor(@Inject(DATABASE) private readonly db: Database.Database) {}

  ingestAll(dataDir: string): IngestSummary[] {
    return SOURCES.map((source) =>
      this.ingestFile(source, join(dataDir, source.fileName)),
    );
  }

  ingestFile(source: IngestSource, filePath: string): IngestSummary {
    return this.ingestText(source, readFileSync(filePath, 'utf8'));
  }

  // One transaction per file: either every row of the file is processed or,
  // if something unexpected throws, none of them is.
  ingestText(source: IngestSource, text: string): IngestSummary {
    const rows = source.parseFile(stripBom(text));
    const summary: IngestSummary = {
      source: source.name,
      read: rows.length,
      inserted: 0,
      duplicates: 0,
      conflicts: 0,
      invalid: 0,
    };

    const ingestRows = this.db.transaction(() => {
      for (const row of rows) {
        summary[this.ingestRow(source, row)] += 1;
      }
    });
    ingestRows();

    return summary;
  }

  private ingestRow(source: IngestSource, row: RawRow): RowOutcome {
    const parsed = source.parseRow(row);
    if (!parsed.ok) {
      this.db.prepare(INSERT_REJECTION_SQL).run({
        source: source.name,
        row_number: row.rowNumber,
        reason: parsed.reason,
        raw: row.raw,
      });
      return 'invalid';
    }

    const { changes } = this.db
      .prepare(source.insertSql)
      .run({ ...parsed.record, raw: row.raw });
    if (changes === 1) {
      return 'inserted';
    }

    // The key already exists. Compare normalized values, not raw text, so
    // "5000.0" and "5000.00" count as the same content.
    const key = parsed.record[source.keyColumn];
    const existing = this.db
      .prepare(source.selectByKeySql)
      .get(key) as DbRecord;
    if (hasSameValues(parsed.record, existing)) {
      return 'duplicates';
    }

    this.db.prepare(INSERT_CONFLICT_SQL).run({
      source: source.name,
      natural_key: String(key),
      existing_raw: existing.raw,
      incoming_raw: row.raw,
    });
    return 'conflicts';
  }
}

function hasSameValues(incoming: DbRecord, existing: DbRecord): boolean {
  return Object.keys(incoming).every(
    (column) => incoming[column] === existing[column],
  );
}

// Some Windows editors start UTF-8 files with an invisible BOM character
// (U+FEFF). Left in place, it would break JSON.parse and the first CSV header.
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
