// Read-only evidence for a rejected second distribute call. This module never signs.
const PANIC='lote não aprovado ou já pago';
const ACCOUNT=/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/;
const HASH=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RPCS=new Set(['https://test.rpc.fastnear.com','https://rpc.testnet.near.org','https://archival-rpc.testnet.near.org','https://testnet-rpc.intea.rs']);
const account=value=>typeof value==='string'&&ACCOUNT.test(value);
const failed=status=>status&&Object.hasOwn(status,'Failure')&&!Object.hasOwn(status,'SuccessValue')&&!Object.hasOwn(status,'SuccessReceiptId');
const successful=status=>status&&Object.hasOwn(status,'SuccessValue')&&!Object.hasOwn(status,'Failure');

function expectedPanic(status) {
  if(!failed(status))return false;
  const call=status.Failure?.ActionError?.kind?.FunctionCallError;
  const reason=call?.ExecutionError??call?.HostError?.GuestPanic?.panic_msg;
  return typeof reason==='string'&&reason.normalize('NFC').replace(/^Smart contract panicked:\s*/,'').trim()===PANIC;
}
function distributeArgs(call) {
  try {
    if(typeof call?.args==='string'&&typeof call?.args_base64==='string'&&call.args!==call.args_base64)return null;
    const encoded=call?.args_base64??call?.args;
    if(typeof encoded!=='string'||encoded.length>4096)return null;
    const bytes=Buffer.from(encoded,'base64');
    if(bytes.toString('base64')!==encoded)return null;
    const args=JSON.parse(bytes.toString('utf8'));
    return args&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).join(',')==='batch_id'?args:null;
  }catch{return null;}
}

export async function verifyRejectedDuplicate({report,rpcUrl='https://archival-rpc.testnet.near.org',fetchFn=fetch}) {
  if(!report||report.network!=='testnet'||!account(report.contract)||!account(report.assetContract)
      ||!account(report.signer)||typeof report.tx!=='string'||!HASH.test(report.tx)
      ||typeof report.batchId!=='string'||!/^[a-zA-Z0-9-]{1,40}$/.test(report.batchId)) {
    throw new Error('Use a public testnet rejection report with contract, token, signer, hash and batch.');
  }
  if(typeof rpcUrl!=='string'||!RPCS.has(rpcUrl.replace(/\/$/,'')))throw new Error('Use an allowed public testnet RPC.');
  async function rpc(method,params) {
    const response=await fetchFn(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},
      signal:AbortSignal.timeout(method==='query'?15000:25000),
      body:JSON.stringify({jsonrpc:'2.0',id:'duplicate-proof',method,params}),
    });
    if(!response.ok)throw new Error('Public testnet RPC unavailable.');
    const body=await response.json();
    if(body.error||!body.result)throw new Error('Public RPC did not return the requested rejection evidence.');
    return body.result;
  }
  async function view(method_name,args) {
    const value=await rpc('query',{request_type:'call_function',finality:'final',account_id:report.contract,method_name,args_base64:Buffer.from(JSON.stringify(args)).toString('base64')});
    if(value.error||!Array.isArray(value.result)||!value.result.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255))throw new Error('Contract evidence unavailable.');
    return JSON.parse(Buffer.from(value.result).toString('utf8'));
  }
  const [tx,config,batch]=await Promise.all([
    rpc('EXPERIMENTAL_tx_status',{tx_hash:report.tx,sender_account_id:report.signer,wait_until:'FINAL'}),
    view('get_config',{}),view('get_batch',{batch_id:report.batchId}),
  ]);
  const actions=tx.transaction?.actions;
  const action=Array.isArray(actions)&&actions.length===1&&actions[0]&&Object.keys(actions[0]).join(',')==='FunctionCall'?actions[0].FunctionCall:null;
  const args=distributeArgs(action);
  const outcomes=[...(Array.isArray(tx.receipts_outcome)?tx.receipts_outcome:[]),tx.transaction_outcome].filter(item=>item?.outcome);
  const failures=outcomes.filter(item=>failed(item.outcome.status));
  const contractPanic=failures.some(item=>item.outcome.executor_id===report.contract&&expectedPanic(item.outcome.status));
  // A top-level failure alone is usable; a contradictory failure from another
  // executor cannot impersonate a rights-contract panic.
  const rejected=contractPanic||(failures.length===0&&expectedPanic(tx.status));
  const events=[];let eventsWellFormed=true;
  for(const item of outcomes) {
    const outcome=item.outcome;
    if(!successful(outcome.status))continue;
    for(const line of Array.isArray(outcome.logs)?outcome.logs:[]) {
      if(typeof line!=='string'||!line.startsWith('EVENT_JSON:'))continue;
      try {
        const event=JSON.parse(line.slice(11));
        if(!event||typeof event!=='object'||Array.isArray(event))throw new Error('Invalid event');
        // Keep transport metadata outside the event payload: JSON cannot override executor.
        events.push({rpcExecutor:outcome.executor_id,event});
      }catch {if([report.contract,report.assetContract].includes(outcome.executor_id))eventsWellFormed=false;}
    }
  }
  const tokenEvents=events.filter(item=>item.rpcExecutor===report.assetContract&&item.event.standard==='nep141'&&item.event.event==='ft_transfer');
  for(const {event} of tokenEvents)if(!Array.isArray(event.data)||!event.data.length||!event.data.every(row=>typeof row?.old_owner_id==='string'&&typeof row.new_owner_id==='string'&&typeof row.amount==='string'&&/^\d+$/.test(row.amount)))eventsWellFormed=false;
  const transfers=tokenEvents.flatMap(({event})=>Array.isArray(event.data)?event.data:[]).filter(row=>row.old_owner_id===report.contract);
  const receipts=events.filter(item=>item.rpcExecutor===report.contract&&item.event.standard==='bmz'&&item.event.event==='receipt');
  const checks={
    transaction:tx.transaction?.hash===report.tx&&tx.transaction?.signer_id===report.signer,
    receiver:tx.transaction?.receiver_id===report.contract,
    action:action?.method_name==='distribute',
    arguments:args?.batch_id===report.batchId,
    zeroDeposit:action?.deposit==='0'||action?.deposit===0,
    finalized:tx.final_execution_status==='FINAL',
    configuredToken:config?.token_id===report.assetContract,
    batchPaid:batch?.batch_id===report.batchId&&batch.status==='Paid',
    expectedPanic:rejected,
    eventIntegrity:eventsWellFormed,
    noTransfers:transfers.length===0,
    noReceipt:receipts.length===0,
  };
  return {matched:Object.values(checks).every(Boolean),checks,tx:report.tx,contract:report.contract,batchId:report.batchId,checkedAt:new Date().toISOString(),panic:rejected?PANIC:null};
}
