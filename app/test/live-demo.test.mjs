import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTestnetState, validateLiveRequest, executeLiveSample } from '../live-demo.mjs';

const requestId='11111111-1111-4111-8111-111111111111';
const a={root:'example.testnet',registry:'rights.example.testnet',registry_v1:'registry.example.testnet',gate:'gate.example.testnet',mc:'mc.example.testnet',beat:'beat.example.testnet',distribuidora:'distribuidora.example.testnet',usdc:'usdc.example.testnet',token:'usdc.example.testnet'};
const state={network:'testnet',accounts:a};
function fixture(change={}) {
  const sent=[];let reservation;
  const config={owner_id:a.root,token_id:a.token,gate_id:a.gate,...change.config};
  const right={test_terms:true,holders:[a.root,a.mc,a.beat].map((account_id,i)=>({account_id,bps:[4000,4200,1800][i],confirmed:true})),...change.right};
  return {sent,deps:{state,templateId:'master',requestId,checkBuild:async()=>{},
    read:async(_c,method)=>method==='get_config'?config:method==='get_right'?right:reservation?{...reservation,status:change.fundedStatus??'Funded'}:null,
    send:async(who,contract,method,args,gas,deposit)=>{sent.push({who,contract,method,args,gas,deposit});if(method==='reserve_batch')reservation=args;return{transaction:{hash:`tx-${method}`},status:{SuccessValue:''}};},
    verify:async()=>({matched:change.proofMatches??true,rows:[]}),
  }};
}
test('transaction demo rejects mainnet, external tokens and client-controlled payment fields',()=>{
  assert.throws(()=>assertTestnetState({...state,network:'mainnet'}));
  assert.throws(()=>assertTestnetState(state,'https://rpc.mainnet.near.org'));
  assert.throws(()=>assertTestnetState({...state,accounts:{...a,token:'other.testnet'}}));
  assert.deepEqual(validateLiveRequest({template:'master',requestId}),{template:'master',requestId});
  for(const body of [{template:'__proto__',requestId},{template:'master',requestId,amount:'999'},{template:'master',requestId:'wrong'}])assert.throws(()=>validateLiveRequest(body));
});
test('fixed testnet run reserves, funds, approves, distributes and verifies with fresh hashes',async()=>{
  const {deps,sent}=fixture();const result=await executeLiveSample(deps);
  assert.equal(result.status,'verified');assert.match(result.batchId,/^demo-/);assert.equal(result.txs.length,5);
  assert.deepEqual(sent.map(x=>x.method),['reserve_batch','faucet','ft_transfer_call','approve_batch','distribute']);
  assert.equal(sent[0].args.amount,'2000000');assert.equal(sent[2].args.receiver_id,a.registry);assert.equal(sent[3].who,a.gate);
  assert.equal(result.proof.matched,true);assert.equal(result.ledger.reduce((n,r)=>n+BigInt(r.amount),0n),2000000n);
});
test('unconfirmed participants, unexpected config or unfunded invoice prevent payout',async()=>{
  for(const change of [{config:{owner_id:'other.testnet'}},{right:{holders:[]}},{fundedStatus:'Reserved'}]) {
    const {deps,sent}=fixture(change);await assert.rejects(executeLiveSample(deps));
    assert.equal(sent.some(x=>x.method==='distribute'),false);
  }
});
test('a submitted payout is not called verified if transfer proof fails',async()=>{
  const {deps,sent}=fixture({proofMatches:false});await assert.rejects(executeLiveSample(deps),/not fully verified/);
  assert.equal(sent.filter(x=>x.method==='distribute').length,1);
});
