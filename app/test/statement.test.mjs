import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { expectedReceiptReference, formatTestUsdc } from '../statement.mjs';

test('only an initiated distribution has a derived, unverified receipt reference', () => {
  for (const status of ['Reserved', 'Funded', 'Approved', 'RefundPendingFunded', 'RefundPendingApproved', 'Refunded']) {
    assert.equal(expectedReceiptReference({ status, batch_id: 'm1', ledger_hash: 'abc' }), '');
  }
  assert.equal(expectedReceiptReference({ status: 'Paid', batch_id: 'm1', ledger_hash: 'abc' }), 'BMZ1:m1:abc');
});

test('test-token amounts retain all six decimals and large integer precision', () => {
  assert.equal(formatTestUsdc('1'), '0.000001');
  assert.equal(formatTestUsdc('2000000'), '2.00');
  assert.equal(formatTestUsdc('9007199254740993123456'), '9007199254740993.123456');
  assert.throws(() => formatTestUsdc('-1'));
});
