import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBatch, gateAction } from '../batch-policy.mjs';

test('reservation must match every invoice field and the gate fails closed', () => {
  const expected = { id: 'm1', payer: 'payer.testnet', tokenId: 'right', hash: 'hash', amount: 100n };
  const batch = { payer_id: expected.payer, token_id: expected.tokenId, ledger_hash: expected.hash, amount: '100', status: 'Reserved' };
  assert.equal(validateBatch(batch, expected), 'Reserved');
  for (const [field, bad] of [['payer_id', 'other'], ['token_id', 'other'], ['ledger_hash', 'other'], ['amount', '99']]) {
    assert.throws(() => validateBatch({ ...batch, [field]: bad }, expected), /diverge/);
  }
  assert.throws(() => gateAction('Reserved'), /não está financiado/);
  assert.throws(() => gateAction('Refunded'), /não está financiado/);
  assert.equal(gateAction('Funded'), 'check');
  assert.equal(gateAction('Approved'), 'already-processed');
  assert.equal(gateAction('Paid'), 'already-processed');
});
