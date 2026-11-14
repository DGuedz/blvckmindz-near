import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRunStore, executeLiveSample, demoRunLimit } from '../live-demo.mjs';

const contract='rights.fixture.testnet';
const id=n=>`${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const body=n=>({requestId:id(n),template:'master'});
const passed=input=>({...input,status:'verified',proof:{matched:true,contract},txs:[{step:'distributing',hash:'fixture-payout',signer:'fixture.testnet'}]});
function fixture(t,options={}) {
  const directory=mkdtempSync(join(tmpdir(),'bmz-demo-stress-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const args={directory,contract,execute:async input=>passed(input),publish:()=>{},...options};
  return {directory,store:createRunStore(args),second:()=>createRunStore(args)};
}
async function settle(store,requestId) {
  for(let i=0;i<100;i++) {
    const run=store.get(requestId);
    if(run.status!=='running')return run;
    await new Promise(resolve=>setImmediate(resolve));
  }
  throw new Error('Fixture executor did not settle.');
}

test('operator capacity is bounded, strict and never accepted from a browser request',()=>{
  assert.equal(demoRunLimit(),10);assert.equal(demoRunLimit('100'),100);assert.equal(demoRunLimit('1'),1);
  for(const value of ['0','101','-1','1.5',' 10','10 ','001','Infinity','1e2',100,null])assert.throws(()=>demoRunLimit(value));
});
test('raising capacity preserves old receipts and applies the cap to the same durable book',async t=>{
  const {store,directory}=fixture(t);
  for(let n=1;n<=5;n++){store.start(body(n));await settle(store,id(n));}
  const raised=createRunStore({directory,contract,limit:100,execute:async input=>passed(input)});
  assert.equal(raised.info().remaining,95);assert.equal(raised.get(id(1)).status,'verified');
  assert.equal(raised.start(body(1)).status,'verified');assert.equal(raised.info().remaining,95);
  for(let n=6;n<=100;n++){raised.start(body(n));await settle(raised,id(n));}
  assert.equal(raised.info().remaining,0);assert.throws(()=>raised.start(body(101)),/budget/);
  assert.equal(Object.keys(JSON.parse(readFileSync(join(directory,'demo-runs.json'),'utf8')).runs).length,100);
  assert.throws(()=>createRunStore({directory,contract,execute:async input=>passed(input),limit:101}));
});

test('fifty concurrent retries reuse one request; a second request never starts while it runs',async t=>{
  let executions=0,finish;
  const {store,second}=fixture(t,{execute:input=>{executions++;return new Promise(resolve=>{finish=()=>resolve(passed(input));});}});
  const neighbor=second();
  const first=store.start(body(1));
  for(let i=0;i<50;i++)assert.equal(neighbor.start(body(1)).requestId,first.requestId);
  assert.throws(()=>neighbor.start(body(2)),/active|review/);
  assert.throws(()=>neighbor.start({...body(1),template:'publishing'}),/another template/);
  assert.equal(neighbor.info().needsReview,false);
  assert.deepEqual(neighbor.info().activeRun,{requestId:id(1),template:'master',status:'running',step:'checking'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(executions,1);finish();
  await settle(store,id(1));
  assert.equal(neighbor.get(id(1)).status,'verified');
  assert.equal(neighbor.info().activeRun,null);
});

test('independent store instances preserve all ten runs and share one budget',async t=>{
  let executions=0;
  const {store,second,directory}=fixture(t,{execute:async input=>{executions++;return passed(input);}});
  const neighbor=second(); // Open before any runs, reproducing the stale-snapshot bug.
  for(let n=1;n<=10;n++) {
    (n%2?store:neighbor).start(body(n));
    await settle(store,id(n));
    assert.equal(neighbor.info().remaining,10-n);
  }
  assert.throws(()=>store.start(body(11)),/budget/);
  assert.throws(()=>neighbor.start(body(11)),/budget/);
  assert.equal(Object.keys(JSON.parse(readFileSync(join(directory,'demo-runs.json'),'utf8')).runs).length,10);
  assert.equal(executions,10);
  assert.equal(statSync(join(directory,'demo-runs.json')).mode&0o777,0o600);
});

test('an ambiguous broadcast keeps its invoice metadata and blocks automatic payment retry',async t=>{
  let executions=0;
  const {store,directory}=fixture(t,{execute:async(input,onStep)=>{
    executions++;onStep('distributing',{batchId:'fixture-batch',ledgerHash:'fixture-ledger',amount:'2000000',txs:[{step:'funding-invoice',hash:'funding-fixture',signer:'payer.fixture.testnet'}]});
    throw new Error('Simulated RPC connection loss after acceptance');
  }});
  store.start(body(1));const run=await settle(store,id(1));
  assert.equal(run.status,'needs-review');assert.equal(run.batchId,'fixture-batch');assert.equal(run.step,'distributing');
  assert.equal(run.txs[0].hash,'funding-fixture');
  assert.equal(store.info().needsReview,true);assert.equal(store.info().activeRun,null);
  assert.equal(store.start(body(1)).status,'needs-review');assert.equal(executions,1);
  assert.throws(()=>store.start(body(2)),/active|review/);
  unlinkSync(join(directory,'demo-run.lock')); // Even an accidentally lost lock cannot authorize a second payment.
  assert.equal(store.info().needsReview,true);assert.throws(()=>store.start(body(2)),/review/);
});

test('failure to export evidence preserves the verified payout and requires operator review',async t=>{
  let executions=0;
  const {store,directory}=fixture(t,{execute:async input=>{executions++;return passed(input);},publish:()=>{throw new Error('Simulated full evidence disk');}});
  store.start(body(1));const run=await settle(store,id(1));
  assert.equal(run.status,'verified');assert.equal(run.proof.matched,true);assert.equal(run.evidencePublished,false);
  assert.equal(store.info().needsReview,true);assert.equal(store.info().activeRun,null);
  assert.equal(store.start(body(1)).txs[0].hash,'fixture-payout');assert.equal(executions,1);
  assert.throws(()=>store.start(body(2)),/active|review/);
  unlinkSync(join(directory,'demo-run.lock'));
  assert.equal(store.info().needsReview,true);
  assert.equal(store.get(id(1)).operatorReviewRequired,true);
  assert.throws(()=>store.start(body(2)),/review/);
  assert.equal(executions,1);
});

test('an orphaned running record or a lock without a matching run is never treated as payable',t=>{
  const {directory,store}=fixture(t);
  writeFileSync(join(directory,'demo-run.lock'),JSON.stringify({requestId:id(1),pid:process.pid,token:'fixture',contract}));
  assert.equal(store.info().needsReview,true);assert.equal(store.info().activeRun,null);
  assert.throws(()=>store.start(body(1)),/active|review/);
  unlinkSync(join(directory,'demo-run.lock'));
  writeFileSync(join(directory,'demo-runs.json'),JSON.stringify({contract,runs:{[id(1)]:{...body(1),status:'running',step:'distributing'}}}));
  assert.equal(store.info().needsReview,true);assert.equal(store.info().activeRun,null);
  assert.throws(()=>store.start(body(2)),/review/);
});

test('the invoice fingerprint is persisted before the first transaction is sent',async()=>{
  const accounts={root:'fixture.testnet',registry:contract,registry_v1:'registry.fixture.testnet',gate:'gate.fixture.testnet',mc:'mc.fixture.testnet',beat:'beat.fixture.testnet',distribuidora:'distribuidora.fixture.testnet',usdc:'usdc.fixture.testnet',token:'usdc.fixture.testnet'};
  let metadata,sendCount=0,reservation;
  await executeLiveSample({state:{network:'testnet',accounts},templateId:'master',requestId:id(1),checkBuild:async()=>{},
    read:async(_c,method)=>method==='get_config'?{owner_id:accounts.root,token_id:accounts.usdc,gate_id:accounts.gate}:method==='get_right'?{test_terms:true,holders:[accounts.root,accounts.mc,accounts.beat].map((account_id,i)=>({account_id,bps:[4000,4200,1800][i],confirmed:true}))}:reservation?{...reservation,status:'Funded'}:null,
    onStep:(step,details)=>{if(step==='checking')metadata=details;},
    send:async(_who,_contract,method,args)=>{assert.match(metadata.ledgerHash,/^[0-9a-f]{64}$/);assert.equal(metadata.amount,'2000000');assert.match(metadata.batchId,/^demo-/);sendCount++;if(method==='reserve_batch')reservation=args;return{transaction:{hash:`fixture-${method}`},status:{SuccessValue:''}};},
    verify:async()=>({matched:true}),
  });
  assert.equal(sendCount,5);
});


test('different complete request IDs never share a batch just because their prefix matches',async()=>{
  const accounts={root:'fixture.testnet',registry:contract,registry_v1:'registry.fixture.testnet',gate:'gate.fixture.testnet',mc:'mc.fixture.testnet',beat:'beat.fixture.testnet',distribuidora:'distribuidora.fixture.testnet',usdc:'usdc.fixture.testnet',token:'usdc.fixture.testnet'};
  async function batch(requestId) {
    let captured;
    await assert.rejects(executeLiveSample({state:{network:'testnet',accounts},templateId:'master',requestId,
      onStep:(_step,details)=>{captured=details.batchId;},checkBuild:async()=>{throw new Error('Stop before network');},
      read:async()=>assert.fail('No public RPC reads in this stress test'),send:async()=>assert.fail('No transactions in this stress test'),
    }),/Stop before network/);
    return captured;
  }
  const first=await batch('aaaaaaaa-1111-4111-8111-111111111111');
  const second=await batch('aaaaaaaa-1111-4111-8111-111111111112');
  assert.notEqual(first,second);assert.ok(first.length<=40);assert.ok(second.length<=40);
});

test('a returned failed transaction hash remains inspectable without being marked confirmed',async()=>{
  const accounts={root:'fixture.testnet',registry:contract,registry_v1:'registry.fixture.testnet',gate:'gate.fixture.testnet',mc:'mc.fixture.testnet',beat:'beat.fixture.testnet',distribuidora:'distribuidora.fixture.testnet',usdc:'usdc.fixture.testnet',token:'usdc.fixture.testnet'};
  let details;
  await assert.rejects(executeLiveSample({state:{network:'testnet',accounts},templateId:'master',requestId:id(1),checkBuild:async()=>{},
    read:async(_c,method)=>method==='get_config'?{owner_id:accounts.root,token_id:accounts.usdc,gate_id:accounts.gate}:method==='get_right'?{test_terms:true,holders:[accounts.root,accounts.mc,accounts.beat].map((account_id,i)=>({account_id,bps:[4000,4200,1800][i],confirmed:true}))}:null,
    onStep:(_step,update)=>{if(update?.unconfirmedTransaction)details=update;},
    send:async()=>({transaction:{hash:'failed-fixture-tx'},status:{Failure:{}}}),
  }),/Could not confirm reserving/);
  assert.equal(details.txs.length,0);assert.deepEqual(details.unconfirmedTransaction,{step:'reserving',hash:'failed-fixture-tx',signer:accounts.root});
});


test('a real exited process cannot leave a running lock reported as an active execution',t=>{
  const {directory,store}=fixture(t);
  const exited=spawnSync(process.execPath,['-e',''],{stdio:'ignore'});
  assert.equal(exited.status,0);assert.ok(exited.pid>0);
  assert.throws(()=>process.kill(exited.pid,0),{code:'ESRCH'});
  writeFileSync(join(directory,'demo-runs.json'),JSON.stringify({contract,runs:{[id(1)]:{...body(1),status:'running',step:'distributing',batchId:'fixture-batch',txs:[]}}}));
  writeFileSync(join(directory,'demo-run.lock'),JSON.stringify({requestId:id(1),pid:exited.pid,token:'fixture',contract}));
  assert.equal(store.info().activeRun,null);assert.equal(store.info().needsReview,true);
  assert.equal(store.get(id(1)).batchId,'fixture-batch');
  assert.throws(()=>store.start(body(2)),/active|review/);
});
