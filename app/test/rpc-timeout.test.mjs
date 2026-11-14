import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { view } from '../lib.mjs';
import { createRunStore, executeLiveSample } from '../live-demo.mjs';

function immediateDeadline(t) {
  const durations=[];
  t.mock.method(AbortSignal,'timeout',milliseconds=>{
    durations.push(milliseconds);
    const controller=new AbortController();
    queueMicrotask(()=>controller.abort(new DOMException('Fixture deadline expired','TimeoutError')));
    return controller.signal;
  });
  return durations;
}
const stalledFetch=async(_url,{signal})=>new Promise((_resolve,reject)=>{
  if(signal.aborted)reject(signal.reason);
  else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
});

test('view requests carry a 15-second deadline while preserving optimistic finality and args',async t=>{
  const controller=new AbortController();let deadline,seen;
  t.mock.method(AbortSignal,'timeout',milliseconds=>{deadline=milliseconds;return controller.signal;});
  const result=await view('rights.fixture.testnet','get_batch',{batch_id:'fixture'},{fetchFn:async(url,options)=>{
    seen={url,options};return{json:async()=>({result:{result:[...Buffer.from(JSON.stringify({status:'Funded'}))]}})};
  }});
  assert.equal(deadline,15000);assert.equal(seen.options.signal,controller.signal);
  const request=JSON.parse(seen.options.body);
  assert.equal(request.params.finality,'optimistic');
  assert.equal(request.params.account_id,'rights.fixture.testnet');
  assert.equal(request.params.method_name,'get_batch');
  assert.deepEqual(JSON.parse(Buffer.from(request.params.args_base64,'base64').toString()),{batch_id:'fixture'});
  assert.deepEqual(result,{status:'Funded'});
});

test('a view deadline aborts the pending read instead of waiting indefinitely',async t=>{
  const durations=immediateDeadline(t);
  await assert.rejects(view('rights.fixture.testnet','get_config',{}, {fetchFn:stalledFetch}),error=>error.name==='TimeoutError');
  assert.deepEqual(durations,[15000]);
});

test('a preflight read timeout keeps the invoice and requests review with zero broadcasts',async t=>{
  const durations=immediateDeadline(t);
  const directory=mkdtempSync(join(tmpdir(),'bmz-read-timeout-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const accounts={root:'fixture.testnet',registry:'rights.fixture.testnet',registry_v1:'registry.fixture.testnet',gate:'gate.fixture.testnet',mc:'mc.fixture.testnet',beat:'beat.fixture.testnet',distribuidora:'distribuidora.fixture.testnet',usdc:'usdc.fixture.testnet',token:'usdc.fixture.testnet'};
  let sends=0;
  const store=createRunStore({directory,contract:accounts.registry,
    execute:(input,onStep)=>executeLiveSample({state:{network:'testnet',accounts},templateId:input.template,requestId:input.requestId,onStep,checkBuild:async()=>{},
      read:(contract,method,args)=>view(contract,method,args,{fetchFn:stalledFetch}),
      send:async()=>{sends++;assert.fail('No transaction may be sent after a preflight read timeout');},
    }),
  });
  const request={requestId:'11111111-1111-4111-8111-111111111111',template:'master'};
  store.start(request);
  for(let i=0;i<50&&store.get(request.requestId).status==='running';i++)await new Promise(resolve=>setImmediate(resolve));
  const run=store.get(request.requestId);
  assert.equal(run.status,'needs-review');assert.match(run.batchId,/^demo-/);assert.match(run.ledgerHash,/^[0-9a-f]{64}$/);
  assert.equal(run.amount,'2000000');assert.equal(sends,0);assert.deepEqual(run.txs,[]);
  assert.equal(store.info().needsReview,true);assert.equal(store.info().activeRun,null);
  assert.equal(store.start(request).status,'needs-review');assert.equal(sends,0);
  assert.throws(()=>store.start({...request,requestId:'22222222-2222-4222-8222-222222222222'}),/active|review/);
  assert.deepEqual(durations,[15000,15000]);
});
