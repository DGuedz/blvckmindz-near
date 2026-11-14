// Compare both local builds with public testnet bytecode. No signing keys required.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkDeploymentBuild } from './deployment-build.mjs';

async function main() {
  const claims=JSON.parse(readFileSync(new URL('../evidence/claims.json',import.meta.url),'utf8'));
  const contracts=[
    {accountId:claims.contract,wasmPath:fileURLToPath(new URL('../target/near/track_account/track_account.wasm',import.meta.url))},
    {accountId:claims.token??`usdc.${claims.label}`,wasmPath:fileURLToPath(new URL('../target/near/test_usdc/test_usdc.wasm',import.meta.url))},
  ];
  let checked;
  try {checked=await checkDeploymentBuild({contracts,rpcUrl:process.env.NEAR_RPC_URL??'https://test.rpc.fastnear.com'});}
  catch(error) {
    if(!error.report)throw error;
    checked=error.report;
  }
  const rights=checked.contracts[0];
  // Keep the original rights-contract fields for existing report consumers.
  const report={checked_at:checked.checked_at,network:checked.network,contract:rights.account_id,
    block_height:rights.block_height,local_wasm_sha256:rights.local_wasm_sha256,deployed_wasm_sha256:rights.deployed_wasm_sha256,
    matches:checked.matches,contracts:checked.contracts};
  if(process.argv.includes('--write'))writeFileSync(new URL('../evidence/BUILD-CHECK.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(!report.matches)process.exitCode=1;
}
await main().catch(error=>{console.error(error.message);process.exitCode=1;});
