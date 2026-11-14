// Testes sem rede: hash do ledger, regra de divisão (mesmos vetores do contrato) e filtro do relayer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, batchSummary, readLedger, receipt, splitAmount } from '../lib.mjs';
import { checkDelegate } from '../relay.mjs';

test('hash do ledger é sha256 hex estável e o recibo segue BMZ1', () => {
  const a = batchSummary(readLedger(), '1', 'PYXXX2600001');
  const b = batchSummary([...readLedger()].reverse(), '1', 'PYXXX2600001');
  assert.match(a.ledgerHash, /^[0-9a-f]{64}$/);
  assert.equal(a.ledgerHash, b.ledgerHash, 'ordem das linhas não muda o hash');
  assert.equal(a.amount, 2_000_000n);
  assert.equal(receipt('1', a.ledgerHash), `BMZ1:1:${a.ledgerHash}`);
});

test('divisão em JS bate com os vetores compartilhados com o contrato', () => {
  const vectors = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'split-vectors.json'), 'utf8'));
  for (const v of vectors.filter((x) => x.shares)) {
    const got = splitAmount(BigInt(v.amount), v.bps, v.remainder_index).map(String);
    assert.deepEqual(got, v.shares, `amount=${v.amount}`);
  }
});

const state = { accounts: { registry: 'registry.bmz.testnet' } };
const sd = (receiverId, methodName, deposit = 0n) => ({
  delegateAction: { senderId: 'mc.bmz.testnet', receiverId, actions: [{ functionCall: { methodName, deposit } }] },
});

test('relayer só paga confirm_share no contrato da faixa', () => {
  assert.equal(checkDelegate(state, sd('registry.bmz.testnet', 'confirm_share')), 'mc.bmz.testnet');
  assert.throws(() => checkDelegate(state, sd('outro.testnet', 'confirm_share')), /destino/);
  assert.throws(() => checkDelegate(state, sd('registry.bmz.testnet', 'distribute')), /não permitido/);
  assert.throws(() => checkDelegate(state, sd('registry.bmz.testnet', 'confirm_share', 5n)), /depósito/);
});
