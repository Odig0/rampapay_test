import { parseCsv, parseJsonArray } from './file-parsers';

describe('parseCsv', () => {
  it('maps each line to an object using the header, with file line numbers', () => {
    const rows = parseCsv(
      'timestamp,usdt_bs\n2026-10-05T07:00:00-04:00,9.8467\n',
    );

    expect(rows).toEqual([
      {
        rowNumber: 2,
        raw: '2026-10-05T07:00:00-04:00,9.8467',
        fields: { timestamp: '2026-10-05T07:00:00-04:00', usdt_bs: '9.8467' },
      },
    ]);
  });

  it('accepts \\r\\n line endings and skips empty lines', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n\r\n3,4\r\n');

    expect(rows.map((row) => row.fields)).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
    expect(rows.map((row) => row.rowNumber)).toEqual([2, 4]);
  });

  it('reports a row with the wrong number of columns instead of guessing', () => {
    const [row] = parseCsv('a,b\n1,2,3');

    expect(row.fields).toBeNull();
    expect(row.parseError).toBe('expected 2 columns, found 3');
  });
});

describe('parseJsonArray', () => {
  it('returns one row per element, keeping the element as raw JSON', () => {
    const rows = parseJsonArray('[{"event_id":"pe_1"},{"event_id":"pe_2"}]');

    expect(rows.map((row) => row.rowNumber)).toEqual([1, 2]);
    expect(rows[0].raw).toBe('{"event_id":"pe_1"}');
    expect(rows[1].fields).toEqual({ event_id: 'pe_2' });
  });

  it('marks an element that is not an object as unparseable', () => {
    const [row] = parseJsonArray('[42]');

    expect(row.fields).toBeNull();
    expect(row.parseError).toBe('element is not a JSON object');
  });

  it('fails the whole file if it is not a JSON array', () => {
    expect(() => parseJsonArray('{"event_id":"pe_1"}')).toThrow('JSON array');
    expect(() => parseJsonArray('not json')).toThrow();
  });
});
