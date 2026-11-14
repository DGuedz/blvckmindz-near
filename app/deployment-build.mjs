// Public testnet bytecode checks only. No account credentials or signing imports.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ALLOWED_RPC = new Set(['https://test.rpc.fastnear.com','https://archival-rpc.testnet.near.org','https://testnet-rpc.intea.rs']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function checkDeploymentBuild({contracts,rpcUrl,fetchFn=fetch}) {
  if(typeof rpcUrl!=='string'||!ALLOWED_RPC.has(rpcUrl.replace(/\/$/,'')))throw new Error('Build checks only support the allowed public testnet RPCs.');
  if(!Array.isArray(contracts)||contracts.length===0||typeof fetchFn!=='function')throw new Error('Supply the testnet contracts and their local WASM paths.');
  const accounts=new Set();
  for(const contract of contracts) {
    if(!contract||typeof contract.accountId!=='string'||!contract.accountId.endsWith('.testnet')||contract.accountId.length>64||!/^[a-z0-9._-]+$/.test(contract.accountId)||typeof contract.wasmPath!=='string'||!contract.wasmPath||accounts.has(contract.accountId))throw new Error('Each build check needs a distinct testnet account and a local WASM path.');
    accounts.add(contract.accountId);
  }
  // Read every local input before making any network request.
  const inputs=contracts.map(contract=>({...contract,local:readFileSync(contract.wasmPath)}));
  const checked=await Promise.all(inputs.map(async({accountId,local})=>{
    const response=await fetchFn(rpcUrl,{
      method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(15000),
      body:JSON.stringify({jsonrpc:'2.0',id:'deployment-build',method:'query',params:{request_type:'view_code',finality:'final',account_id:accountId}}),
    });
    if(!response.ok)throw new Error(`Public build RPC unavailable for ${accountId}.`);
    const body=await response.json();
    if(body.error||typeof body.result?.code_base64!=='string'||!body.result.code_base64)throw new Error(`RPC did not return deployed code for ${accountId}.`);
    const deployed=Buffer.from(body.result.code_base64,'base64');
    if(deployed.length===0)throw new Error(`RPC returned empty deployed code for ${accountId}.`);
    const localHash=hash(local),deployedHash=hash(deployed);
    return {account_id:accountId,block_height:body.result.block_height,local_wasm_sha256:localHash,deployed_wasm_sha256:deployedHash,matches:localHash===deployedHash};
  }));
  const report={checked_at:new Date().toISOString(),network:'testnet',matches:checked.every(item=>item.matches),contracts:checked};
  if(!report.matches) {
    const error=new Error(`Local and deployed WASM differ for ${checked.filter(item=>!item.matches).map(item=>item.account_id).join(', ')}.`);
    error.report=report;throw error;
  }
  return report;
}
