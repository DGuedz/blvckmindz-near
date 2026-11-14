// Opt-in, loopback-only testnet demo. No client-supplied contracts, wallets or amounts.
import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { actions } from 'near-api-js';
import { ROOT, KEYS, RPC_URL, TGAS, near, account, view, batchSummary, readLedger } from './lib.mjs';
import { SAMPLE_TEMPLATES } from './templates.mjs';
import { verifyPayment } from './payment-proof.mjs';
import { publishLiveRun } from './run-report.mjs';
import { checkDeploymentBuild } from './deployment-build.mjs';

const ALLOWED_RPC = new Set(['https://test.rpc.fastnear.com', 'https://archival-rpc.testnet.near.org', 'https://testnet-rpc.intea.rs']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validateLiveRequest(body) {
  if (!body || Object.keys(body).sort().join(',') !== 'requestId,template' || !Object.hasOwn(SAMPLE_TEMPLATES,body.template) || typeof body.requestId !== 'string' || !UUID.test(body.requestId)) {
    throw new Error('Choose a fixed sample template and a new request ID.');
  }
  return { requestId: body.requestId, template: body.template };
}

export function assertTestnetState(state, rpc = RPC_URL) {
  if (!ALLOWED_RPC.has(rpc.replace(/\/$/, '')) || state.network !== 'testnet') throw new Error('This demo only supports the allowed public testnet RPCs.');
  const a = state.accounts;
  if (!a?.registry_v1 || !['root','registry','gate','mc','beat','distribuidora','usdc'].every((key) => typeof a[key] === 'string' && a[key].endsWith('.testnet'))) throw new Error('A fresh v2 testnet setup is required.');
  if (a.token !== a.usdc || a.usdc !== `usdc.${a.root}` || a.registry !== `rights.${a.root}`) throw new Error('Only the isolated demo contracts are accepted.');
}

export async function executeLiveSample({ state, templateId, requestId, send, read = view, checkBuild, verify = verifyPayment, onStep = () => {} }) {
  assertTestnetState(state);
  const t = SAMPLE_TEMPLATES[templateId];
  if (!Object.hasOwn(SAMPLE_TEMPLATES,templateId) || !UUID.test(requestId)) throw new Error('Invalid sample request.');
  const a = state.accounts, batchId = `demo-${requestId.replaceAll('-','')}`;
  const tokenId = `${t.code}:${t.right}`;
  const rows = readLedger(join(ROOT,'fixtures','demo-ledger-v2.csv')).filter((r) => r.batchId === t.batchId).map((r) => ({...r,batchId}));
  const { amount, ledgerHash } = batchSummary(rows,batchId,t.code,t.right);
  if (amount !== (templateId === 'master' ? 2000000n : 1000000n)) throw new Error('Sample ledger does not match the fixed invoice.');
  onStep('checking',{network:'testnet',batchId,amount:String(amount),ledgerHash});
  await checkBuild();
  const [config,right] = await Promise.all([read(a.registry,'get_config',{}),read(a.registry,'get_right',{token_id:tokenId})]);
  if (config.owner_id !== a.root || config.token_id !== a.usdc || config.gate_id !== a.gate) throw new Error('Contract configuration differs from the isolated test setup.');
  const expectedBps = templateId === 'master' ? [4000,4200,1800] : [2500,4500,3000];
  const expectedAccounts = [a.root,a.mc,a.beat];
  if (!right?.test_terms || right.holders?.length !== 3 || !right.holders.every((h,i) => h.account_id === expectedAccounts[i] && h.bps === expectedBps[i] && h.confirmed)) throw new Error('The fixed sample participants must be registered and confirmed before this demo can run.');
  if (await read(a.registry,'get_batch',{batch_id:batchId})) throw new Error('This batch already exists; inspect the saved run.');
  const txs = [];
  async function call(step,who,contract,method,args,gas,deposit=0n) {
    onStep(step,{txs});
    const result = await send(who,contract,method,args,gas,deposit);
    const tx = result?.transaction?.hash;
    if (!tx || !Object.hasOwn(result.status ?? {},'SuccessValue')) {
      if(tx)onStep(step,{txs,unconfirmedTransaction:{step,hash:tx,signer:who}});
      throw new Error(`Could not confirm ${step}. Operator review required before another run.`);
    }
    txs.push({step,hash:tx,signer:who});
    onStep(step,{txs});
    return result;
  }
  await call('reserving',a.root,a.registry,'reserve_batch',{batch_id:batchId,token_id:tokenId,payer_id:a.distribuidora,amount:String(amount),ledger_hash:ledgerHash},50n*TGAS,near(.05));
  await call('funding-test-payer',a.distribuidora,a.usdc,'faucet',{amount:String(amount)},30n*TGAS);
  await call('funding-invoice',a.distribuidora,a.usdc,'ft_transfer_call',{receiver_id:a.registry,amount:String(amount),msg:JSON.stringify({token_id:tokenId,batch_id:batchId,ledger_hash:ledgerHash})},100n*TGAS,1n);
  const funded = await read(a.registry,'get_batch',{batch_id:batchId});
  if (funded?.status !== 'Funded' || funded.ledger_hash !== ledgerHash || funded.amount !== String(amount) || funded.token_id !== tokenId || funded.payer_id !== a.distribuidora) throw new Error('Invoice was not funded exactly as reserved. Operator review required.');
  // Explicit server startup opt-in authorizes approval of only these fixed sample terms.
  await call('approving-sample',a.gate,a.registry,'approve_batch',{batch_id:batchId,ledger_hash:ledgerHash},30n*TGAS);
  const payout = await call('distributing',a.root,a.registry,'distribute',{batch_id:batchId},200n*TGAS);
  onStep('verifying',{txs});
  const evidence = {contract:a.registry,claims:[{id:`pay_out_${batchId}`,tx:payout.transaction.hash,signer:a.root,expect:{batch:batchId}}]};
  const proof = await verify({evidence,batchId,rpcUrl:RPC_URL,transactionRpcUrl:RPC_URL});
  if (!proof.matched) throw new Error('Payout submitted but transfers are not fully verified. Operator review required.');
  return {network:'testnet',requestId,template:templateId,batchId,amount:String(amount),ledgerHash,ledger:rows.map(r=>({...r,amount:String(r.amount)})),txs,proof,status:'verified'};
}

export async function createLiveDemo(state) {
  assertTestnetState(state);
  const checkBuild=()=>checkDeploymentBuild({rpcUrl:RPC_URL,contracts:[
    {accountId:state.accounts.registry,wasmPath:join(ROOT,'target/near/track_account/track_account.wasm')},
    {accountId:state.accounts.usdc,wasmPath:join(ROOT,'target/near/test_usdc/test_usdc.wasm')},
  ]});
  await checkBuild();
  const startupConfig=await view(state.accounts.registry,'get_config',{});
  if(startupConfig.owner_id!==state.accounts.root || startupConfig.token_id!==state.accounts.usdc || startupConfig.gate_id!==state.accounts.gate)throw new Error('Isolated demo configuration is not ready.');
  for(const template of Object.values(SAMPLE_TEMPLATES)) {
    const right=await view(state.accounts.registry,'get_right',{token_id:`${template.code}:${template.right}`});
    if(!right?.test_terms || right.holders?.length!==3 || !right.holders.every(h=>h.confirmed))throw new Error('Register and confirm the fixed samples before enabling testnet transactions.');
  }
  const send=(who,contractId,methodName,args,gas,deposit)=>account(state,who).signAndSendTransaction({receiverId:contractId,actions:[actions.functionCall(methodName,args,gas,deposit)]});
  return createRunStore({directory:KEYS,contract:state.accounts.registry,
    execute:(input,onStep)=>executeLiveSample({state,templateId:input.template,requestId:input.requestId,send,checkBuild,onStep}),
    publish:(run)=>publishLiveRun(ROOT,run),
  });
}

// Disk snapshots and an exclusive lock coordinate independent local server processes.
// Only public run metadata is stored here; signing remains outside this controller.
export function createRunStore({directory,contract,execute,publish=()=>{},limit=10}) {
  if(typeof directory!=='string'||typeof contract!=='string'||!contract.endsWith('.testnet')||typeof execute!=='function'||!Number.isInteger(limit)||limit<1||limit>10)throw new Error('Invalid local demo store.');
  mkdirSync(directory,{recursive:true,mode:0o700});
  const file=join(directory,'demo-runs.json'),lock=join(directory,'demo-run.lock');
  function readBook() {
    const book=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{contract,runs:{}};
    if(!book.runs||Array.isArray(book.runs)||typeof book.runs!=='object'||(book.contract&&book.contract!==contract)||Object.values(book.runs).some(run=>run.proof?.contract&&run.proof.contract!==contract))throw new Error('Archive the previous run book before switching the demo contract.');
    return {...book,contract};
  }
  function save(book) {
    const temporary=join(directory,`demo-runs.${process.pid}.${randomUUID()}.tmp`);
    try {writeFileSync(temporary,JSON.stringify(book,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temporary,file);}
    finally {if(existsSync(temporary))unlinkSync(temporary);}
  }
  function lockInfo() {try{return JSON.parse(readFileSync(lock,'utf8'));}catch{return null;}}
  function ownerAlive(owner) {
    if(!Number.isInteger(owner)||owner<=0)return false;
    try {process.kill(owner,0);return true;}catch(error){return error.code==='EPERM';}
  }
  const summary=run=>({requestId:run.requestId,template:run.template,status:run.status,step:run.step});
  const requiresReview=run=>run.status==='needs-review'||run.operatorReviewRequired===true||Boolean(run.evidenceError)||(run.status==='verified'&&run.evidencePublished===false);
  readBook(); // Refuse incompatible/corrupt state before accepting any request.
  return {
    info() {
      const runs=Object.values(readBook().runs),held=existsSync(lock),owner=held?lockInfo():null;
      const running=runs.filter(run=>run.status==='running');
      const active=running.length===1&&held&&owner?.requestId===running[0].requestId&&ownerAlive(owner.pid)?running[0]:null;
      const needsReview=runs.some(requiresReview)||running.some(run=>run!==active)||(held&&!active);
      return {enabled:true,remaining:Math.max(0,limit-runs.length),needsReview,activeRun:active?summary(active):null};
    },
    get(id) {const runs=readBook().runs;return Object.hasOwn(runs,id)?runs[id]:null;},
    start(body) {
      const input=validateLiveRequest(body);
      const existing=readBook().runs[input.requestId];
      if(existing) {
        if(existing.template!==input.template)throw new Error('Request ID belongs to another template.');
        return existing;
      }
      const token=randomUUID();
      let fd;
      try {fd=openSync(lock,'wx',0o600);}catch {throw new Error('Another run is active or needs operator review.');}
      try {writeFileSync(fd,JSON.stringify({requestId:input.requestId,pid:process.pid,token,contract})+'\n');}finally{closeSync(fd);}
      const release=()=>{if(lockInfo()?.token!==token)throw new Error('Demo lock changed; operator review required.');unlinkSync(lock);};
      const book=readBook();
      // Recheck under the lock: another process may have completed since our first read.
      const repeated=book.runs[input.requestId];
      if(repeated) {release();if(repeated.template!==input.template)throw new Error('Request ID belongs to another template.');return repeated;}
      if(Object.values(book.runs).some(run=>run.status==='running'||requiresReview(run))) {release();throw new Error('An interrupted run needs operator review.');}
      if(Object.keys(book.runs).length>=limit) {release();throw new Error('The ten-run test budget is exhausted.');}
      const run={...input,network:'testnet',status:'running',step:'checking',txs:[],startedAt:new Date().toISOString()};
      book.runs[input.requestId]=run;save(book);
      Promise.resolve().then(()=>execute(input,(step,details={})=>{Object.assign(run,{step},details);save(book);}))
        .then(async result=>{
          if(result.status!=='verified'||!result.proof?.matched)throw new Error('Payment verification incomplete.');
          Object.assign(run,result,{finishedAt:new Date().toISOString(),evidencePublished:false,operatorReviewRequired:false});save(book);
          // A local evidence-export failure must not relabel an already verified payment.
          try {await publish(run);run.evidencePublished=true;run.operatorReviewRequired=false;delete run.evidenceError;save(book);release();}
          catch {run.evidencePublished=false;run.operatorReviewRequired=true;run.evidenceError='Payment verified; local evidence export needs operator review.';save(book);}
        })
        .catch(()=>{
          if(run.status==='verified') {run.evidencePublished=false;run.operatorReviewRequired=true;run.evidenceError='Payment verified; local persistence needs operator review.';}
          else {run.status='needs-review';run.operatorReviewRequired=true;run.message='Run interrupted. Inspect the listed transactions before retrying. No automatic retry is allowed.';}
          try {save(book);}catch {} // Keep the lock if persistence itself fails; never retry a payment.
        });
      return run;
    },
  };
}
