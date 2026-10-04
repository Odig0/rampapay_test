// One row as read from a file, before validation.
export interface RawRow {
  // Line number in the CSV file (header is line 1) or 1-based position in
  // the JSON array. Only used to point a human at the right row.
  rowNumber: number;
  // The row exactly as received; this is what gets stored in the raw column.
  raw: string;
  // Field name -> value. null when the row could not even be split into fields.
  fields: Record<string, unknown> | null;
  parseError?: string;
}

// Minimal CSV parser for simple files: comma separated, first line is the
// header, no quoted fields. Accepts \n and \r\n and skips empty lines
// (including the usual trailing one).
export function parseCsv(text: string): RawRow[] {
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',').map((name) => name.trim());
  const rows: RawRow[] = [];

  lines.slice(1).forEach((line, index) => {
    if (line.trim() === '') {
      return;
    }
    const rowNumber = index + 2;
    const values = line.split(',').map((value) => value.trim());

    if (values.length !== header.length) {
      rows.push({
        rowNumber,
        raw: line,
        fields: null,
        parseError: `expected ${header.length} columns, found ${values.length}`,
      });
      return;
    }

    const fields: Record<string, unknown> = {};
    header.forEach((name, column) => {
      fields[name] = values[column];
    });
    rows.push({ rowNumber, raw: line, fields });
  });

  return rows;
}

// The JSON files are an array of objects. A file that is not valid JSON or
// not an array cannot be ingested at all, so that is an error for the whole
// file; a single element that is not an object is only an invalid row.
export function parseJsonArray(text: string): RawRow[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('expected a JSON array at the top level');
  }

  return parsed.map((element: unknown, index) => {
    const isObject =
      typeof element === 'object' &&
      element !== null &&
      !Array.isArray(element);
    return {
      rowNumber: index + 1,
      raw: JSON.stringify(element),
      fields: isObject ? (element as Record<string, unknown>) : null,
      parseError: isObject ? undefined : 'element is not a JSON object',
    };
  });
}
