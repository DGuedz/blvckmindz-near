import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, linkSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishLiveRun } from '../run-report.mjs';

const recorded=JSON.parse(readFileSync(new URL('../../evidence/live-runs/39b1ac21-9abf-4dbb-b9c1-669b576b3fbe.json',import.meta.url),'utf8'));
const clone=()=>structuredClone(recorded);
const fields=['network','requestId','template','status','step','txs','startedAt','finishedAt','batchId','amount','ledgerHash','ledger','proof'];
function root(t) {
  const directory=mkdtempSync(join(tmpdir(),'bmz-public-report-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));return directory;
}
function files(directory) {
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(directory,entry.name)):[join(directory,entry.name)]);
}

test('a public report preserves the real testnet proof and excludes operational or unknown fields',t=>{
  const directory=root(t),run=clone(),canary='INTERNAL_EXPORT_TEST_CANARY';
  Object.assign(run,{operatorReviewRequired:false,evidencePublished:false,evidenceError:canary,unknownField:canary});
  run.txs[0].unknownField=canary;run.ledger[0].unknownField=canary;
  run.proof.unknownField=canary;run.proof.rows[0].unknownField=canary;run.proof.checks.unknownField=canary;
  publishLiveRun(directory,run);
  const result=JSON.parse(readFileSync(join(directory,'evidence','live-runs',`${run.requestId}.json`),'utf8'));
  assert.deepEqual(Object.keys(result).sort(),[...fields].sort());
  assert.equal(result.ledgerHash,recorded.ledgerHash);assert.equal(result.batchId,recorded.batchId);
  assert.deepEqual(result.ledger,recorded.ledger);assert.deepEqual(result.txs,recorded.txs);assert.deepEqual(result.proof,recorded.proof);
  const summary=JSON.parse(readFileSync(join(directory,'evidence','provas.json'),'utf8'));
  assert.deepEqual(summary.report,recorded.proof);assert.equal(summary.run_id,recorded.requestId);
  const output=files(directory);
  assert.equal(output.length,5);
  for(const path of output) {
    const content=readFileSync(path,'utf8');
    assert.ok(!content.includes(canary),path);assert.ok(!content.includes('operatorReviewRequired'),path);assert.ok(!content.includes('evidencePublished'),path);assert.ok(!content.includes('evidenceError'),path);
    assert.equal(statSync(path).mode&0o777,0o644,path);assert.ok(!path.endsWith('.tmp'));
  }
  assert.equal(run.evidencePublished,false);assert.equal(run.unknownField,canary); // Publishing does not mutate operational state.
});

test('JSON reports replace files atomically instead of truncating an existing inode',t=>{
  const directory=root(t),run=clone(),evidence=join(directory,'evidence'),live=join(evidence,'live-runs');
  mkdirSync(live,{recursive:true});
  for(const [target,backup] of [[join(evidence,'provas.json'),join(directory,'old-summary')],[join(live,`${run.requestId}.json`),join(directory,'old-run')]]) {
    writeFileSync(target,'old-complete-report');linkSync(target,backup);
  }
  publishLiveRun(directory,run);
  assert.equal(readFileSync(join(directory,'old-summary'),'utf8'),'old-complete-report');
  assert.equal(readFileSync(join(directory,'old-run'),'utf8'),'old-complete-report');
  assert.equal(JSON.parse(readFileSync(join(evidence,'provas.json'),'utf8')).report.tx,run.proof.tx);
  assert.equal(JSON.parse(readFileSync(join(live,`${run.requestId}.json`),'utf8')).ledgerHash,run.ledgerHash);
  assert.ok(files(directory).every(path=>!path.endsWith('.tmp')));
});

test('invalid IDs, mismatched payouts, batches or incomplete proofs fail before any output is written',t=>{
  const corruptions=[
    run=>{run.requestId='../outside';},
    run=>{run.requestId='11111111-1111-1111-8111-111111111111';},
    run=>{run.status='running';},
    run=>{run.network='mainnet';},
    run=>{run.proof.tx=run.txs[0].hash;},
    run=>{run.proof.batchId='other-batch';},
    run=>{run.txs.push({...run.txs.find(tx=>tx.step==='distributing')});},
    run=>{run.amount='1';},
    run=>{run.proof.rows[0].actual='0';},
    run=>{run.proof.checks.transaction=false;},
    run=>{run.ledger[0].batchId='other-batch';},
    run=>{run.proof.block={unknownField:'INTERNAL_EXPORT_TEST_CANARY'};},
  ];
  for(const corrupt of corruptions) {
    const directory=root(t),run=clone();corrupt(run);
    assert.throws(()=>publishLiveRun(directory,run));
    assert.equal(existsSync(join(directory,'evidence')),false);
    assert.deepEqual(readdirSync(directory),[]);
  }
});
