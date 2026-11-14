import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvLine } from '../csv.mjs';

test('CSV quotes delimiters and neutralizes spreadsheet formula prefixes', () => {
  assert.equal(csvLine(['label', 'music, producer', 'say "yes"', 'line\nbreak']), '"label","music, producer","say ""yes""","line\nbreak"');
  for (const value of ['=1+1', '  +1', '\t-1', '\r@SUM(A1)', '\u0000=1']) {
    assert.ok(csvCell(value).startsWith('"\''), `unsafe field: ${JSON.stringify(value)}`);
  }
  assert.equal(csvCell('42.00'), '"42.00"');
});
