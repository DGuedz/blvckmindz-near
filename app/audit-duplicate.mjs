// Explicit operator-only test. The HTTP demo does not expose this script.
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { actions } from 'near-api-js';
import { ROOT, KEYS, RPC_URL, TGAS, loadState, account, view } from './lib.mjs';
import { assertTestnetState } from './live-demo.mjs';
import { verifyRejectedDuplicate } from './payment-rejection.mjs';

if(process.argv.length!==4||process.argv[2]!=='--submit-testnet')throw new Error('Usage: node audit-duplicate.mjs --submit-testnet <public-run.json>');
const run=JSON.parse(readFileSync(process.argv[3],'utf8'));
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(run.requestId)||run.network!=='testnet'||run.status!=='verified'||!run.proof?.matched)throw new Error('Use a verified public testnet run.');
const state=loadState();assertTestnetState(state);
const a=state.accounts;
if(run.proof.contract!==a.registry||run.proof.assetContract!==a.usdc)throw new Error('The public run does not belong to this isolated test deployment.');
const folder=join(ROOT,'evidence','protection'),file=join(folder,run.requestId+'.json');
if(existsSync(file)){
  const result=await verifyRejectedDuplicate({report:JSON.parse(readFileSync(file,'utf8')),rpcUrl:RPC_URL});
  console.log(JSON.stringify(result,null,2));if(!result.matched)process.exitCode=1;
}else{
  const lock=join(KEYS,'demo-run.lock'),token=randomUUID();
  const fd=openSync(lock,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify({requestId:run.requestId,pid:process.pid,token,purpose:'duplicate-payment-audit'})+'\n');}finally{closeSync(fd);}
  let confirmed=false;
  try{
    const before=await view(a.registry,'get_batch',{batch_id:run.batchId});
    if(before?.status!=='Paid'||before.ledger_hash!==run.ledgerHash)throw new Error('The exact original invoice must already be paid.');
    let outcome;
    try{
      outcome=await account(state,a.root).signAndSendTransaction({receiverId:a.registry,actions:[actions.functionCall('distribute',{batch_id:run.batchId},50n*TGAS,0n)]});
    }catch(error){outcome=error?.transactionResult;}
    const tx=outcome?.transaction?.hash;
    if(!tx)throw new Error('Audit outcome was not confirmed. Inspect the operator lock; no automatic retry.');
    const report={network:'testnet',contract:a.registry,assetContract:a.usdc,batchId:run.batchId,tx,signer:a.root,originalPayoutTx:run.proof.tx,originalRequestId:run.requestId};
    const result=await verifyRejectedDuplicate({report,rpcUrl:RPC_URL});
    if(!result.matched)throw new Error('Duplicate rejection did not match the expected on-chain evidence. Operator review required.');
    mkdirSync(folder,{recursive:true});
    writeFileSync(file,JSON.stringify({...report,verification:result},null,2)+'\n',{flag:'wx',mode:0o644});
    confirmed=true;
    console.log(JSON.stringify({...report,verification:result},null,2));
  }finally{
    if(confirmed&&JSON.parse(readFileSync(lock,'utf8')).token===token)unlinkSync(lock);
  }
}
