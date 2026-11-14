import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDeploymentBuild } from '../deployment-build.mjs';

const RPC='https://test.rpc.fastnear.com';
// Empty WASM module and a module with an inert custom section; neither is executed.
const RIGHTS=Buffer.from([0,97,115,109,1,0,0,0]);
const TOKEN=Buffer.from([0,97,115,109,1,0,0,0,0,2,1,97]);
function fixture(t,change={}) {
  const directory=mkdtempSync(join(tmpdir(),'bmz-build-proof-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const contracts=[{accountId:'rights.fixture.testnet',wasmPath:join(directory,'rights.wasm')},{accountId:'usdc.fixture.testnet',wasmPath:join(directory,'token.wasm')}];
  writeFileSync(contracts[0].wasmPath,RIGHTS);writeFileSync(contracts[1].wasmPath,TOKEN);
  const calls=[];
  return {contracts,calls,fetchFn:async(url,options)=>{
    const request=JSON.parse(options.body);calls.push({url,request,signal:options.signal});
    if(change.httpError)return Response.json({error:'fixture unavailable'},{status:503});
    if(change.rpcError)return Response.json({error:{message:'fixture RPC error'}});
    const account=request.params.account_id;
    const code=account===contracts[0].accountId?(change.rightsBad?TOKEN:RIGHTS):(change.tokenBad?RIGHTS:TOKEN);
    return Response.json({result:{block_height:123,code_base64:code.toString('base64')}});
  }};
}
test('both rights and test-token bytecode must match their local build at finality final',async t=>{
  const f=fixture(t),report=await checkDeploymentBuild({...f,rpcUrl:RPC});
  assert.equal(report.matches,true);assert.equal(report.contracts.length,2);assert.equal(f.calls.length,2);
  assert.deepEqual(report.contracts.map(row=>row.account_id),f.contracts.map(row=>row.accountId));
  for(const {url,request,signal} of f.calls) {
    assert.equal(url,RPC);assert.equal(request.method,'query');assert.equal(request.params.request_type,'view_code');assert.equal(request.params.finality,'final');
    assert.ok(signal instanceof AbortSignal);assert.equal(signal.aborted,false);
  }
  for(const row of report.contracts){assert.match(row.local_wasm_sha256,/^[a-f0-9]{64}$/);assert.equal(row.local_wasm_sha256,row.deployed_wasm_sha256);assert.equal(row.block_height,123);assert.equal(Object.hasOwn(row,'wasmPath'),false);}
});
for(const kind of ['rightsBad','tokenBad'])test(`${kind} prevents enabling transactions even when the other build matches`,async t=>{
  const f=fixture(t,{[kind]:true});
  await assert.rejects(checkDeploymentBuild({...f,rpcUrl:RPC}),error=>{
    assert.equal(error.report.matches,false);assert.equal(error.report.contracts.length,2);
    assert.equal(error.report.contracts[kind==='rightsBad'?0:1].matches,false);
    assert.equal(error.report.contracts[kind==='rightsBad'?1:0].matches,true);
    return true;
  });
});
test('HTTP and JSON-RPC errors fail closed without a matching report',async t=>{
  for(const change of [{httpError:true},{rpcError:true}]) {
    const f=fixture(t,change);
    await assert.rejects(checkDeploymentBuild({...f,rpcUrl:RPC}),error=>{assert.equal(error.report,undefined);return /RPC/.test(error.message);});
  }
});
test('mainnet endpoints and account IDs are refused before local reads or network calls',async()=>{
  const fetchFn=async()=>assert.fail('No RPC calls are allowed for a rejected deployment.');
  await assert.rejects(checkDeploymentBuild({contracts:[{accountId:'rights.fixture.testnet',wasmPath:'/nonexistent-fixture.wasm'}],rpcUrl:'https://rpc.mainnet.near.org',fetchFn}),/testnet RPC/);
  await assert.rejects(checkDeploymentBuild({contracts:[{accountId:'rights.fixture.near',wasmPath:'/nonexistent-fixture.wasm'}],rpcUrl:RPC,fetchFn}),/testnet account/);
});
