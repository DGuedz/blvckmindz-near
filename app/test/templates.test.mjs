import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_TEMPLATES, matchesRecordedTemplate } from '../templates.mjs';
import { parseTestUsdc, composeRight, allocateMoney } from '../split-engine.mjs';

test('each sample binds identifier, right, invoice and proof batch to the same case', () => {
  for (const [key, amount, batch] of [['master','2.00','m1'],['publishing','1.00','e1']]) {
    const t = SAMPLE_TEMPLATES[key];
    assert.equal(t.amount,amount); assert.equal(t.batchId,batch);
    assert.equal(matchesRecordedTemplate(t,{code:t.code,amount:parseTestUsdc(amount),weights:t.weights}),true);
    const rows=composeRight('label',t.deal,t.weights.map((bps,i)=>({key:t.roles[i],bps})));
    assert.equal(allocateMoney(parseTestUsdc(amount),rows,'label').parts.reduce((a,b)=>a+b,0n),parseTestUsdc(amount));
  }
});
test('a changed identifier, amount or split cannot reuse the recorded payment claim', () => {
  const t=SAMPLE_TEMPLATES.master, sample={code:t.code,amount:2000000n,weights:[7000,3000]};
  for(const edit of [{code:'OTHER'},{amount:3000000n},{weights:[6000,4000]},{weights:[7000]}]) {
    assert.equal(matchesRecordedTemplate(t,{...sample,...edit}),false);
  }
});
