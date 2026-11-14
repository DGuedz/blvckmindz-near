import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildVercelConfig, main, prepareVercel } from '../prepare-vercel.mjs';

const origin='https://music-payments-test.trycloudflare.com';
function temporary(t) {
  const folder=mkdtempSync(join(tmpdir(),'bmz-vercel-entry-'));
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  return folder;
}

test('entry configuration forwards every path to the one HTTPS origin and disables caching',()=>{
  const expected={version:2,framework:null,installCommand:null,buildCommand:null,
    routes:[{src:'/(.*)',dest:origin+'/$1',headers:{'Cache-Control':'no-store','x-vercel-enable-rewrite-caching':'0'}}]};
  assert.deepEqual(buildVercelConfig(origin),expected);
  assert.deepEqual(buildVercelConfig(origin+'/'),expected);
  for(const label of ['a','a--b','a'.repeat(63)]) {
    assert.equal(buildVercelConfig(`https://${label}.trycloudflare.com`).routes[0].dest,`https://${label}.trycloudflare.com/$1`);
  }
});

test('only a canonical trycloudflare HTTPS host is accepted; URL normalization cannot bypass the boundary',()=>{
  const invalid=[
    'http://music-payments-test.trycloudflare.com','HTTPS://music-payments-test.trycloudflare.com',
    'https://127.0.0.1','https://localhost','https://169.254.169.254','file:///tmp/demo',
    'https://evil.example','https://trycloudflare.com','https://sub.music-payments-test.trycloudflare.com',
    origin+'.evil',origin+'.',origin+':443',origin+':0443',origin+':8787',
    'https://user@music-payments-test.trycloudflare.com','https://user:pass@music-payments-test.trycloudflare.com',
    origin+'/path',origin+'//',origin+'/.',origin+'/../',origin+'/%2e',origin+'/%2f',
    origin+'?',origin+'?run=example',origin+'#',origin+'#example',
    origin+'\\@evil.example','https://%6dusic-payments-test.trycloudflare.com',
    'https://UPPER.trycloudflare.com','https://-bad.trycloudflare.com','https://bad-.trycloudflare.com',
    `https://${'a'.repeat(64)}.trycloudflare.com`,
    ' '+origin,origin+'\n',origin+'\r\nX-Test: injected',origin+'\0',origin+'\u00a0',
  ];
  for(const value of invalid)assert.throws(()=>buildVercelConfig(value),TypeError,value);
  for(const value of [undefined,null,true,42,[origin],{toString:()=>origin}])assert.throws(()=>buildVercelConfig(value),TypeError);
});

test('a fresh output contains only routing configuration and a small branded maintenance page',t=>{
  const folder=temporary(t),target=join(folder,'public-entry');
  // Private-looking neighbors must never be collected by the preparer.
  writeFileSync(join(folder,'.env'),'PRIVATE_FIXTURE_NOT_FOR_EXPORT');
  mkdirSync(join(folder,'.keys'));writeFileSync(join(folder,'.keys','state.json'),'PRIVATE_FIXTURE_NOT_FOR_EXPORT');
  mkdirSync(join(folder,'node_modules'));
  assert.equal(prepareVercel(origin,target),target);
  assert.deepEqual(readdirSync(target).sort(),['index.html','vercel.json']);
  assert.deepEqual(JSON.parse(readFileSync(join(target,'vercel.json'),'utf8')),buildVercelConfig(origin));
  const page=readFileSync(join(target,'index.html'),'utf8');
  assert.match(page,/BLVCK MINDZ/);assert.match(page,/temporarily unavailable/);
  assert.doesNotMatch(page,/PRIVATE_FIXTURE|\.keys|node_modules|process\.env|trycloudflare|localhost|<script/i);
  assert.ok(Buffer.byteLength(page)<2500);
});

test('existing directories, files and symlinks are refused without changing their contents',t=>{
  const folder=temporary(t),existing=join(folder,'existing');mkdirSync(existing);
  const marker=join(existing,'keep.txt');writeFileSync(marker,'preserve this');
  assert.throws(()=>prepareVercel(origin,existing),{code:'EEXIST'});
  assert.deepEqual(readdirSync(existing),['keep.txt']);assert.equal(readFileSync(marker,'utf8'),'preserve this');
  const file=join(folder,'existing-file');writeFileSync(file,'preserve this too');
  assert.throws(()=>prepareVercel(origin,file),{code:'EEXIST'});assert.equal(readFileSync(file,'utf8'),'preserve this too');
  const link=join(folder,'linked-output');symlinkSync(existing,link,'dir');
  assert.throws(()=>prepareVercel(origin,link),{code:'EEXIST'});assert.deepEqual(readdirSync(existing),['keep.txt']);
});

test('invalid input is refused before an output folder is created',t=>{
  const folder=temporary(t),target=join(folder,'invalid-entry');
  assert.throws(()=>prepareVercel('https://evil.example',target),TypeError);assert.equal(existsSync(target),false);
  for(const path of [undefined,null,'','   '])assert.throws(()=>prepareVercel(origin,path),TypeError);
  assert.throws(()=>main([]),/Usage:/);assert.throws(()=>main([origin]),/Usage:/);
});

test('the explicit Node CLI prepares the two-file entry and refuses overwriting it',t=>{
  const folder=temporary(t),target=join(folder,'cli-entry');
  const script=fileURLToPath(new URL('../prepare-vercel.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,origin,target],{cwd:folder,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Prepared public entry:/);
  assert.deepEqual(readdirSync(target).sort(),['index.html','vercel.json']);
  const before=readFileSync(join(target,'vercel.json'),'utf8');
  const repeated=spawnSync(process.execPath,[script,origin,target],{cwd:folder,encoding:'utf8'});
  assert.equal(repeated.status,1);assert.equal(readFileSync(join(target,'vercel.json'),'utf8'),before);
  assert.deepEqual(readdirSync(target).sort(),['index.html','vercel.json']);
});
