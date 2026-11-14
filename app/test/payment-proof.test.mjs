import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPayment } from '../payment-proof.mjs';

const contract = 'sample.testnet', token = 'token.testnet', hash = 'a'.repeat(64);
const evidence = { contract, claims: [{ id: 'pay_out_m1', tx: 'test-transaction', signer: 'label.testnet', expect: { batch: 'm1' } }] };
function fixture() {
  const outcome = (executor_id, event) => ({ outcome: { executor_id, status: { SuccessValue: '' }, logs: ['EVENT_JSON:' + JSON.stringify(event)] } });
  return {
    config: { owner_id: 'label.testnet', token_id: token },
    batch: { amount: '2000000', token_id: 'SAMPLE:master', ledger_hash: hash },
    right: { holders: [{account_id:'label.testnet',role:'label',bps:4000},{account_id:'artist.testnet',role:'performer',bps:4200},{account_id:'beat.testnet',role:'producer',bps:1800}] },
    tx: { transaction: { hash: 'test-transaction' }, status: { SuccessValue: '' }, receipts_outcome: [
      outcome(contract, {standard:'bmz',event:'receipt',data:[{receipt:`BMZ1:m1:${hash}`,token_id:'SAMPLE:master'}]}),
      ...[['label.testnet','800000'],['artist.testnet','840000'],['beat.testnet','360000']].map(([new_owner_id,amount]) => outcome(token,{standard:'nep141',event:'ft_transfer',data:[{old_owner_id:contract,new_owner_id,amount}]})),
    ] },
  };
}
function run(data) {
  return verifyPayment({evidence,batchId:'m1',rpcUrl:'https://example.invalid',fetchFn:async (_url, options) => {
    const request = JSON.parse(options.body);
    const result = request.method === 'query' ? {block_height:123,result:[...Buffer.from(JSON.stringify({get_batch:data.batch,get_config:data.config,get_right:data.right}[request.params.method_name]))]} : data.tx;
    return Response.json({result});
  }});
}
test('public payment proof matches the receipt, trusted token, recipients and exact amounts', async () => {
  const proof = await run(fixture());
  assert.equal(proof.matched,true); assert.equal(proof.rows.length,3); assert.equal(proof.amount,'2000000');
});
test('a receipt alone or a successful outer transaction does not prove payout', async () => {
  const data = fixture(); data.tx.receipts_outcome = data.tx.receipts_outcome.slice(0,1);
  const proof = await run(data); assert.equal(proof.checks.receipt,true); assert.equal(proof.matched,false);
});
test('wrong token logs, failed transfer outcomes and changed amounts fail verification', async () => {
  for (const mutate of [
    d => {d.tx.receipts_outcome[1].outcome.executor_id = 'fake.testnet';},
    d => {d.tx.receipts_outcome[2].outcome.status = {Failure:{error:'failed'}};},
    d => {const o=d.tx.receipts_outcome[3].outcome; const e=JSON.parse(o.logs[0].slice(11)); e.data[0].amount='359999'; o.logs[0]='EVENT_JSON:'+JSON.stringify(e);},
    d => {d.tx.receipts_outcome[0].outcome.executor_id = 'fake.testnet';},
  ]) { const d=fixture(); mutate(d); assert.equal((await run(d)).matched,false); }
});
test('unrecorded batches cannot be queried by the proof helper', async () => {
  await assert.rejects(verifyPayment({evidence,batchId:'unknown',rpcUrl:'https://example.invalid'}),/No recorded payout/);
});
test('a log cannot impersonate the trusted token or rights contract with an executor field', async () => {
  for (const index of [0,1]) {
    const data = fixture(), outcome = data.tx.receipts_outcome[index].outcome;
    const payload = JSON.parse(outcome.logs[0].slice(11));
    payload.executor = outcome.executor_id;
    outcome.executor_id = 'untrusted.testnet';
    outcome.logs[0] = 'EVENT_JSON:' + JSON.stringify(payload);
    const proof = await run(data);
    assert.equal(proof.matched,false);
    assert.equal(index === 0 ? proof.checks.receipt : proof.checks.amounts,false);
  }
});
test('malformed and non-object event logs do not replace valid transaction evidence', async () => {
  const data = fixture();
  data.tx.receipts_outcome.unshift({outcome:{executor_id:'untrusted.testnet',status:{SuccessValue:''},logs:[
    'EVENT_JSON:{','EVENT_JSON:null','EVENT_JSON:[]','EVENT_JSON:1','EVENT_JSON:"not an event"',
  ]}});
  assert.equal((await run(data)).matched,true);
  data.tx.receipts_outcome = data.tx.receipts_outcome.slice(0,1);
  assert.equal((await run(data)).matched,false);
});
