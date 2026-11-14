import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRejectedDuplicate } from '../payment-rejection.mjs';

const report={network:'testnet',contract:'rights.fixture.testnet',assetContract:'usdc.fixture.testnet',signer:'fixture.testnet',batchId:'demo-fixture',tx:'1'.repeat(43)};
const panic='lote não aprovado ou já pago';
const failure=(reason=panic)=>({Failure:{ActionError:{index:0,kind:{FunctionCallError:{ExecutionError:`Smart contract panicked: ${reason}`}}}}});
const args=batch=>Buffer.from(JSON.stringify({batch_id:batch})).toString('base64');
const receipt=(executor,status,logs=[])=>({outcome:{executor_id:executor,status,logs}});
const event=(standard,name,data,extra={})=>'EVENT_JSON:'+JSON.stringify({standard,event:name,data,...extra});
function fixture(change=()=>{}) {
  const tx={final_execution_status:'FINAL',transaction:{hash:report.tx,signer_id:report.signer,receiver_id:report.contract,actions:[{FunctionCall:{method_name:'distribute',args:args(report.batchId),deposit:'0',gas:200000000000000}}]},status:failure(),receipts_outcome:[receipt(report.contract,failure())]};
  const config={token_id:report.assetContract};
  const batch={batch_id:report.batchId,status:'Paid'};
  change({tx,config,batch});
  const requests=[];
  const fetchFn=async(_url,options)=>{
    const body=JSON.parse(options.body);requests.push(body);
    assert.ok(options.signal instanceof AbortSignal);
    let result;
    if(body.method==='EXPERIMENTAL_tx_status') {
      assert.equal(body.params.wait_until,'FINAL');assert.equal(body.params.tx_hash,report.tx);assert.equal(body.params.sender_account_id,report.signer);result=tx;
    } else {
      assert.equal(body.method,'query');assert.equal(body.params.finality,'final');assert.equal(body.params.account_id,report.contract);
      const value=body.params.method_name==='get_config'?config:batch;
      if(body.params.method_name==='get_batch')assert.deepEqual(JSON.parse(Buffer.from(body.params.args_base64,'base64').toString()),{batch_id:report.batchId});
      result={result:[...Buffer.from(JSON.stringify(value))]};
    }
    return{ok:true,json:async()=>({result})};
  };
  return{tx,config,batch,requests,fetchFn};
}
async function verify(f=fixture(),input=report) {
  return verifyRejectedDuplicate({report:input,rpcUrl:'https://test.rpc.fastnear.com',fetchFn:f.fetchFn});
}

test('the exact rejected call is bound to final testnet data and a paid batch',async()=>{
  const f=fixture(),result=await verify(f,{...report,evidenceError:'INTERNAL_REJECTION_TEST_CANARY',unknownField:'INTERNAL_REJECTION_TEST_CANARY'});
  assert.equal(result.matched,true);assert.ok(Object.values(result.checks).every(Boolean));
  assert.equal(result.panic,panic);assert.equal(result.tx,report.tx);assert.equal(result.contract,report.contract);assert.equal(result.batchId,report.batchId);
  assert.equal(f.requests.length,3);assert.ok(!JSON.stringify(result).includes('INTERNAL_REJECTION_TEST_CANARY'));
});

test('outer rejection alone and a rights-receipt rejection are supported',async()=>{
  assert.equal((await verify(fixture(({tx})=>{tx.receipts_outcome=[];}))).matched,true);
  assert.equal((await verify(fixture(({tx})=>{tx.status={SuccessValue:''};}))).matched,true);
});

test('a failure status cannot substitute for matching method, arguments, signer, receiver and zero deposit',async()=>{
  for(const change of [
    ({tx})=>{tx.transaction.actions[0].FunctionCall.args=args('different-batch');},
    ({tx})=>{tx.transaction.actions[0].FunctionCall.method_name='approve_batch';},
    ({tx})=>{tx.transaction.actions[0].FunctionCall.deposit='1';},
    ({tx})=>{tx.transaction.actions.push({Transfer:{deposit:'1'}});},
    ({tx})=>{tx.transaction.receiver_id='other.testnet';},
    ({tx})=>{tx.transaction.signer_id='other.testnet';},
    ({tx})=>{tx.transaction.hash='2'.repeat(43);},
    ({tx})=>{tx.transaction.actions[0].FunctionCall.args_base64=args('different-batch');},
    ({tx})=>{tx.transaction.actions[0].FunctionCall.args=Buffer.from(JSON.stringify({batch_id:report.batchId,extra:true})).toString('base64');},
  ])assert.equal((await verify(fixture(change))).matched,false);
});

test('out-of-gas, unauthorized callers and missing finality are not duplicate-rejection evidence',async()=>{
  for(const status of [failure('callerUnauthorized'),{Failure:{ActionError:{kind:{FunctionCallError:{HostError:'GasExceeded'}}}}}]) {
    const result=await verify(fixture(({tx})=>{tx.status=status;tx.receipts_outcome=[receipt(report.contract,status)];}));
    assert.equal(result.matched,false);assert.equal(result.checks.expectedPanic,false);assert.equal(result.panic,null);
  }
  assert.equal((await verify(fixture(({tx})=>{tx.final_execution_status='EXECUTED_OPTIMISTIC';}))).checks.finalized,false);
  assert.equal((await verify(fixture(({tx})=>{tx.status={SuccessValue:''};tx.receipts_outcome=[];}))).matched,false);
});

test('successful transfers or a new receipt invalidate rejection even when the outer status failed',async()=>{
  const transfer=event('nep141','ft_transfer',[{old_owner_id:report.contract,new_owner_id:'artist.fixture.testnet',amount:'800000'}]);
  const sent=await verify(fixture(({tx})=>{tx.receipts_outcome.push(receipt(report.assetContract,{SuccessValue:''},[transfer]));}));
  assert.equal(sent.checks.expectedPanic,true);assert.equal(sent.checks.noTransfers,false);assert.equal(sent.matched,false);
  const emitted=await verify(fixture(({tx})=>{tx.receipts_outcome.push(receipt(report.contract,{SuccessValue:''},[event('bmz','receipt',[{receipt:'BMZ1:any'}])]));}));
  assert.equal(emitted.checks.noReceipt,false);assert.equal(emitted.matched,false);
});

test('executor identity comes from RPC outcome metadata and cannot be overwritten by an event payload',async()=>{
  const transfer=extra=>event('nep141','ft_transfer',[{old_owner_id:report.contract,new_owner_id:'artist.fixture.testnet',amount:'800000'}],extra);
  const hidden=await verify(fixture(({tx})=>{tx.receipts_outcome.push(receipt(report.assetContract,{SuccessValue:''},[transfer({executor:'untrusted.testnet',rpcExecutor:'untrusted.testnet'})]));}));
  assert.equal(hidden.checks.noTransfers,false);assert.equal(hidden.matched,false);
  const impersonated=await verify(fixture(({tx})=>{tx.receipts_outcome.push(receipt('untrusted.testnet',{SuccessValue:''},[transfer({executor:report.assetContract,rpcExecutor:report.assetContract})]));}));
  assert.equal(impersonated.checks.noTransfers,true);assert.equal(impersonated.matched,true);
  const wrongPanic=await verify(fixture(({tx})=>{tx.receipts_outcome=[receipt('untrusted.testnet',failure())];}));
  assert.equal(wrongPanic.checks.expectedPanic,false);assert.equal(wrongPanic.matched,false);
});

test('failed token logs do not become successful payments, but malformed trusted events fail closed',async()=>{
  const failedTransfer=event('nep141','ft_transfer',[{old_owner_id:report.contract,new_owner_id:'artist.fixture.testnet',amount:'800000'}]);
  const rolledBack=await verify(fixture(({tx})=>{tx.receipts_outcome.push(receipt(report.assetContract,failure('token failure'),[failedTransfer]));}));
  assert.equal(rolledBack.checks.noTransfers,true);assert.equal(rolledBack.matched,true);
  const malformed=await verify(fixture(({tx})=>{tx.receipts_outcome.push(receipt(report.assetContract,{SuccessValue:''},['EVENT_JSON:{broken']));}));
  assert.equal(malformed.checks.eventIntegrity,false);assert.equal(malformed.matched,false);
});

test('the paid state and configured token must belong to the reported contract',async()=>{
  assert.equal((await verify(fixture(({batch})=>{batch.status='Funded';}))).checks.batchPaid,false);
  assert.equal((await verify(fixture(({batch})=>{batch.batch_id='other-batch';}))).checks.batchPaid,false);
  assert.equal((await verify(fixture(({config})=>{config.token_id='other.testnet';}))).checks.configuredToken,false);
});

test('mainnet, invalid public metadata and unapproved RPCs are refused before any read',async()=>{
  let reads=0;const fetchFn=async()=>{reads++;assert.fail('Invalid reports must not trigger reads');};
  for(const input of [{...report,network:'mainnet'},{...report,contract:'rights.near'},{...report,assetContract:'usdc.near'},{...report,batchId:'../outside'},{...report,tx:'not a hash'}]) {
    await assert.rejects(verifyRejectedDuplicate({report:input,fetchFn}));
  }
  await assert.rejects(verifyRejectedDuplicate({report,rpcUrl:'https://rpc.mainnet.near.org',fetchFn}));
  assert.equal(reads,0);
});
