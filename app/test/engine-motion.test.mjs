import test from 'node:test';
import assert from 'node:assert/strict';
import { simulationFrame, liveFrame, SIMULATION_DURATION, visualAmount } from '../web/engine-motion.mjs';

test('simulation visits the agreement before money branches; elapsed time never creates a live proof', () => {
  const start = simulationFrame(0), agreement = simulationFrame(2000), split = simulationFrame(4000), end = simulationFrame(SIMULATION_DURATION);
  assert.equal(start.stage,0); assert.deepEqual(start.branches,[0,0,0]);
  assert.equal(agreement.stage,1); assert.deepEqual(agreement.branches,[0,0,0]);
  assert.equal(split.stage,2); assert.ok(split.branches[0] > split.branches[2]);
  assert.equal(end.complete,true); assert.deepEqual(end.branches,[1,1,1]);
  assert.equal(liveFrame({status:'running',step:'verifying',txs:[]}).verified,false);
});
test('a distribution hash or Paid-like state never credits recipients before transfer proof', () => {
  const txs = [{step:'funding-invoice',hash:'funding'},{step:'approving-sample',hash:'approval'},{step:'distributing',hash:'payout'}];
  const waiting = liveFrame({status:'running',step:'verifying',txs});
  assert.equal(waiting.funded,true); assert.equal(waiting.approved,true); assert.equal(waiting.distributed,true);
  assert.equal(waiting.verified,false); assert.equal(waiting.completed[4],false);
  assert.equal(liveFrame({status:'needs-review',step:'verifying',txs}).interrupted,true);
});
test('a receipt is only shown for matching proof of this batch and this payout', () => {
  const run = {status:'verified',step:'verifying',batchId:'invoice-a',amount:'2000000',txs:[{step:'distributing',hash:'payout-a'}],proof:{matched:true,checks:{transaction:true,receipt:true,amounts:true,total:true,recipients:true},batchId:'invoice-a',amount:'2000000',tx:'payout-a',rows:[800000,840000,360000].map(n=>({matched:true,expected:String(n),actual:String(n)}))}};
  assert.equal(liveFrame(run).verified,true);
  assert.equal(liveFrame(run,[800000n,840000n,360000n]).verified,true);
  assert.equal(liveFrame(run,[500000n,900000n,600000n]).verified,false);
  for (const proof of [{...run.proof,batchId:'other'}, {...run.proof,tx:'old-payout'}, {...run.proof,rows:[]}, {...run.proof,amount:'1000000'}, {...run.proof,rows:run.proof.rows.map((r,i)=>i? r : {...r,actual:'0'})}]) {
    assert.equal(liveFrame({...run,proof}).verified,false);
  }
});

test('visual abbreviations preserve the exact amount separately and never round the payment math',()=>{
  assert.deepEqual(visualAmount(2000000n),{text:'2.00',exact:'2.00',abbreviated:false});
  assert.deepEqual(visualAmount(1n),{text:'0.000001',exact:'0.000001',abbreviated:false});
  const maximum=visualAmount((1n<<64n)-1n);
  assert.equal(maximum.text,'18.44T');assert.equal(maximum.exact,'18446744073709.551615');assert.equal(maximum.abbreviated,true);
});

test('a received state is bound to the configured contract, asset, participants and invoice',()=>{
  const context={contract:'rights.example.testnet',assetContract:'usdc.example.testnet',tokenId:'sample:master',amount:'2000000',accounts:['example.testnet','mc.example.testnet','beat.example.testnet'],batchIds:['invoice-a']};
  const run={network:'testnet',status:'verified',step:'verifying',batchId:'invoice-a',amount:'2000000',txs:[{step:'distributing',hash:'payout-a'}],proof:{matched:true,contract:context.contract,assetContract:context.assetContract,tokenId:context.tokenId,batchId:'invoice-a',amount:'2000000',tx:'payout-a',checks:{transaction:true,receipt:true,amounts:true,total:true,recipients:true},rows:[800000,840000,360000].map((n,i)=>({account:context.accounts[i],matched:true,actual:String(n),expected:String(n)}))}};
  const parts=[800000n,840000n,360000n];
  assert.equal(liveFrame(run,parts,context).verified,true);
  for(const change of [{contract:'other.testnet'},{assetContract:'other.testnet'},{tokenId:'other:master'},{rows:run.proof.rows.map((r,i)=>i?r:{...r,account:'other.testnet'})},{checks:{...run.proof.checks,receipt:false}}]){
    assert.equal(liveFrame({...run,proof:{...run.proof,...change}},parts,context).verified,false);
  }
  assert.equal(liveFrame({...run,network:'mainnet'},parts,context).verified,false);
  assert.equal(liveFrame(run,parts,{...context,batchIds:['other-invoice']}).verified,false);
});
