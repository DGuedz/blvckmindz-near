import { mkdirSync, writeFileSync, renameSync, unlinkSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { formatTestUsdc } from './statement.mjs';

const escape=(value)=>String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ACCOUNT=/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/;
const account=value=>typeof value==='string'&&ACCOUNT.test(value);
const hash=value=>typeof value==='string'&&HASH.test(value);
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value));
const CHECKS=['transaction','receipt','amounts','total','recipients'];
const FIELDS=['network','requestId','template','status','step','txs','startedAt','finishedAt','batchId','amount','ledgerHash','ledger','proof'];
const pick=(source,fields)=>Object.fromEntries(fields.filter(key=>Object.hasOwn(source??{},key)).map(key=>[key,source[key]]));
const micro=value=>typeof value==='string'&&/^(0|[1-9]\d{0,19})$/.test(value)&&BigInt(value)<=(1n<<64n)-1n;

function publicEnvelope(input) {
  if (!input || input.status !== 'verified' || input.proof?.matched !== true
      || input.network !== 'testnet' || typeof input.requestId !== 'string'
      || !UUID.test(input.requestId) || !['master','publishing'].includes(input.template)) {
    throw new Error('Only verified testnet runs with a valid request ID can be published.');
  }
  const run = pick(input,FIELDS);
  const proof = pick(input.proof,['checkedAt','contract','assetContract','batchId','tokenId','block','tx','amount','rows','checks','matched']);
  if (!Array.isArray(run.txs) || !Array.isArray(run.ledger) || !Array.isArray(proof.rows)) {
    throw new Error('Incomplete public run evidence.');
  }
  run.txs = run.txs.map(tx=>pick(tx,['step','hash','signer']));
  run.ledger = run.ledger.map(row=>pick(row,['batchId','period','isrc','right','store','territory','amount']));
  proof.rows = proof.rows.map(row=>pick(row,['account','role','bps','expected','actual','matched']));
  proof.checks = pick(proof.checks,CHECKS);
  run.proof = proof;

  const payouts = run.txs.filter(tx=>tx.step==='distributing');
  const matchingPayout = payouts.length === 1 && hash(payouts[0].hash) && payouts[0].hash === proof.tx;
  const matchingBatch = proof.batchId === run.batchId && typeof run.batchId === 'string'
    && /^[a-zA-Z0-9-]{1,40}$/.test(run.batchId);
  if (!matchingPayout || !matchingBatch) throw new Error('Payout transaction and batch must match this run.');
  if (!run.txs.every(tx=>typeof tx.step==='string' && hash(tx.hash) && account(tx.signer))
      || !account(proof.contract) || !account(proof.assetContract) || typeof proof.tokenId !== 'string') {
    throw new Error('Invalid public transaction metadata.');
  }
  if (typeof run.step !== 'string' || !timestamp(run.startedAt) || !timestamp(run.finishedAt)
      || !timestamp(proof.checkedAt) || !Number.isSafeInteger(proof.block) || proof.block < 1) {
    throw new Error('Invalid public evidence timestamps or block.');
  }
  if (!micro(run.amount) || run.amount === '0' || proof.amount !== run.amount
      || typeof run.ledgerHash !== 'string' || !/^[0-9a-f]{64}$/.test(run.ledgerHash)
      || CHECKS.some(key=>proof.checks[key]!==true)) {
    throw new Error('Incomplete verified payment evidence.');
  }
  const validRecipients = proof.rows.length > 0 && proof.rows.every(row=>account(row.account)
    && typeof row.role === 'string' && Number.isInteger(row.bps) && row.bps > 0
    && row.matched === true && micro(row.expected) && row.expected === row.actual);
  if (!validRecipients || proof.rows.reduce((sum,row)=>sum+BigInt(row.actual),0n) !== BigInt(run.amount)
      || proof.rows.reduce((sum,row)=>sum+row.bps,0) !== 10000) {
    throw new Error('Recipient amounts do not match this run.');
  }
  const validStatement = run.ledger.length > 0 && run.ledger.every(row=>row.batchId===run.batchId
    && typeof row.isrc==='string' && typeof row.right==='string'
    && `${row.isrc}:${row.right}`===proof.tokenId && micro(row.amount)
    && ['period','store','territory'].every(key=>typeof row[key]==='string'));
  if (!validStatement || run.ledger.reduce((sum,row)=>sum+BigInt(row.amount),0n) !== BigInt(run.amount)) {
    throw new Error('Statement rows do not match this run.');
  }
  return run;
}

function atomicPublicFile(file,content) {
  mkdirSync(dirname(file),{recursive:true});
  const temporary=`${file}.${randomUUID()}.tmp`;
  try {writeFileSync(temporary,content,{mode:0o644,flag:'wx'});chmodSync(temporary,0o644);renameSync(temporary,file);}
  finally {if(existsSync(temporary))unlinkSync(temporary);}
}

export function publishLiveRun(root,input) {
  const run=publicEnvelope(input); // Validate and remove operational fields before touching disk.
  const dir=join(root,'evidence'),folder=join(dir,'live-runs');
  atomicPublicFile(join(folder,run.requestId+'.json'),JSON.stringify(run,null,2)+'\n');
  const payout=run.txs.find(tx=>tx.step==='distributing');
  const lines=['# Testnet distribution','',`Contract: [${run.proof.contract}](https://testnet.nearblocks.io/address/${run.proof.contract})`,`Batch: ${run.batchId}`,`Checked: ${run.proof.checkedAt}`,'','Test token only; no commercial payment.','','| Recipient | Expected test USDC | Received test USDC |','|---|---|---|',...run.proof.rows.map(r=>`| ${r.account} | ${formatTestUsdc(r.expected)} | ${formatTestUsdc(r.actual)} |`),'',`[Open the distribution](https://testnet.nearblocks.io/txns/${payout.hash})`,'','## Transactions','',...run.txs.map(t=>`- ${t.step}: [${t.hash}](https://testnet.nearblocks.io/txns/${t.hash})`),'',`Ledger SHA-256: ${run.ledgerHash}`,'',`Recheck: cd app && npm run verify:live -- ../evidence/live-runs/${run.requestId}.json`,''];
  for(const name of ['LATEST-RUN.md','PROVAS.md'])atomicPublicFile(join(dir,name),lines.join('\n'));
  atomicPublicFile(join(dir,'provas.json'),JSON.stringify({source:'live-demo',checked_at:run.proof.checkedAt,contract:run.proof.contract,run_id:run.requestId,report:run.proof},null,2)+'\n');
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Testnet distribution · BLVCK MINDZ</title><link rel="stylesheet" href="/demo.css"><main><header class="masthead"><a class="brand" href="/">BLVCK MINDZ × NEAR</a><span>Testnet evidence</span></header><h1>Testnet distribution</h1><p>Verified ${escape(run.proof.checkedAt)} · Test tokens, no commercial payment.</p><p><code>${escape(run.proof.contract)}</code></p><table><thead><tr><th>Recipient</th><th>Expected test USDC</th><th>Received test USDC</th></tr></thead><tbody>${run.proof.rows.map(r=>`<tr><td><code>${escape(r.account)}</code></td><td>${formatTestUsdc(r.expected)}</td><td>${formatTestUsdc(r.actual)}</td></tr>`).join('')}</tbody></table><p><a href="https://testnet.nearblocks.io/txns/${encodeURIComponent(payout.hash)}" target="_blank" rel="noopener">Open this distribution on NEAR ↗</a><br><code>${escape(payout.hash)}</code></p><details><summary>All transactions</summary>${run.txs.map(t=>`<p>${escape(t.step)}: <a href="https://testnet.nearblocks.io/txns/${encodeURIComponent(t.hash)}">${escape(t.hash)}</a></p>`).join('')}</details><p>Ledger SHA-256: <code>${escape(run.ledgerHash)}</code></p><p><a href="/">Back to the demo</a></p></main></html>`;
  atomicPublicFile(join(dir,'provas.html'),html);
}
