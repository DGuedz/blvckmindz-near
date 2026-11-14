import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composeRight, allocateMoney, parseTestUsdc, percentToBps } from '../split-engine.mjs';

test('interactive calculation matches all catalog/contract formula vectors', () => {
  const vectors = JSON.parse(readFileSync(new URL('../../fixtures/formula-vectors.json', import.meta.url)));
  for (const v of vectors) {
    const run = () => composeRight('eas', v.deal, v.side.map((bps, i) => ({ key: `p${i}`, bps })));
    if (v.error) assert.throws(run);
    else assert.deepEqual(run().map((r) => [r.key, r.bps]), v.rows);
  }
});
test('author and master examples preserve basis and cash totals', () => {
  for (const [d, weights, amount, expected] of [[2500, [6000, 4000], '1', ['250000', '450000', '300000']], [4000, [7000, 3000], '2', ['800000', '840000', '360000']]]) {
    const rows = composeRight('label', d, weights.map((bps, i) => ({ key: `p${i}`, bps })));
    const result = allocateMoney(parseTestUsdc(amount), rows, 'label');
    assert.deepEqual(result.parts.map(String), expected);
  }
});
test('cash rounding remains exact for tiny amounts and u64 maximum', () => {
  const rows = composeRight('label', 4000, [{key:'a',bps:3333},{key:'b',bps:6667}]);
  for (const amount of [0n, 1n, 2n, 1000001n, (1n << 64n) - 1n]) {
    const {parts} = allocateMoney(amount, rows, 'label');
    assert.equal(parts.reduce((a,b) => a+b,0n), amount);
  }
});
test('invalid percentages, incomplete agreements and excessive amounts are refused', () => {
  for (const value of ['-1','1e2','NaN','100.01','1.001']) assert.throws(() => percentToBps(value));
  assert.equal(percentToBps('33.33'),3333);
  for (const value of ['-1','0.0000001','18446744073709.551616']) assert.throws(() => parseTestUsdc(value));
  assert.throws(() => composeRight('label',2500,[{key:'a',bps:9000}]));
  assert.deepEqual(composeRight('label',2500,[{key:'label',bps:10000}]),[{key:'label',bps:10000}]);
});

// Reject oversized text before constructing an arbitrary-size integer.
test('oversized amount text is refused without processing it as contract money',()=>{assert.throws(()=>parseTestUsdc('9'.repeat(100000)),/contract limit/);});
