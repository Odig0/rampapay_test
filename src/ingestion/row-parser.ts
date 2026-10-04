import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RawRow } from './file-parsers';

export type ParsedRow<TRecord> =
  { ok: true; record: TRecord } | { ok: false; reason: string };

// Turns a raw row into a database record, or explains why it is invalid.
//   1. The DTO checks the shape (required fields, types, allowed values, > 0).
//   2. toRecord converts to integers and UTC; if that throws, the row is
//      invalid too (e.g. too many decimals, timestamp without offset).
// ValidationPipe does step 1 for HTTP requests; here the input comes from
// files, so we call plainToInstance + validateSync ourselves.
export function parseRow<TDto extends object, TRecord>(
  row: RawRow,
  dtoClass: ClassConstructor<TDto>,
  toRecord: (dto: TDto) => TRecord,
): ParsedRow<TRecord> {
  if (row.fields === null) {
    return { ok: false, reason: row.parseError ?? 'row could not be parsed' };
  }

  const dto = plainToInstance(dtoClass, row.fields);
  const errors = validateSync(dto);
  if (errors.length > 0) {
    const messages = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
    return { ok: false, reason: messages.join('; ') };
  }

  try {
    return { ok: true, record: toRecord(dto) };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}
