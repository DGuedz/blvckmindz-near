// Read-only CLI: no signing keys are loaded.
import { readFileSync } from 'node:fs';
import { verifyRejectedDuplicate } from './payment-rejection.mjs';
const file=process.argv[2];
if(!file)throw new Error('Pass an evidence/protection/<request-id>.json report.');
const report=JSON.parse(readFileSync(file,'utf8'));
const result=await verifyRejectedDuplicate({report,rpcUrl:process.env.NEAR_ARCHIVAL_RPC_URL??'https://archival-rpc.testnet.near.org'});
console.log(JSON.stringify(result,null,2));
if(!result.matched)process.exitCode=1;
