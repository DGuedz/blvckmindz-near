import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,symlinkSync,unlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {PUBLIC_UI_FILES,staticVercelConfig,prepareStaticVercel} from '../prepare-static-vercel.mjs';
function setup(t){const dir=mkdtempSync(join(tmpdir(),'bmz-static-ui-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const src=join(dir,'src');mkdirSync(src);for(const [n]of PUBLIC_UI_FILES){mkdirSync(dirname(join(src,n)),{recursive:true});writeFileSync(join(src,n),'public '+n);}return{dir,src,out:join(dir,'out')};}
function files(root){return readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(root,e.name)).map(n=>`${e.name}/${n}`):[e.name]);}
test('only explicit public UI files and reports are copied, never keys or run state',t=>{
  const{src,out}=setup(t);mkdirSync(join(src,'app/.keys'));writeFileSync(join(src,'app/.keys/state.json'),'PRIVATE_CANARY');writeFileSync(join(src,'.env'),'PRIVATE_CANARY');
  prepareStaticVercel('https://example-demo.trycloudflare.com',out,src);
  assert.deepEqual(files(out).sort(),[...PUBLIC_UI_FILES.map(x=>x[1]),'vercel.json'].sort());
  for(const n of files(out))assert.ok(!readFileSync(join(out,n),'utf8').includes('PRIVATE_CANARY'));
  assert.throws(()=>prepareStaticVercel('https://example-demo.trycloudflare.com',out,src));
});
test('only API paths use the tunnel; the page, scripts and recorded proof remain static',()=>{
  const c=staticVercelConfig('https://example-demo.trycloudflare.com');
  assert.equal(c.routes[1].src,'/api/(.*)');assert.equal(c.routes[1].dest,'https://example-demo.trycloudflare.com/api/$1');
  assert.deepEqual(c.routes.at(-1),{handle:'filesystem'});assert.equal(c.routes[0].continue,true);
  for(const bad of ['http://example-demo.trycloudflare.com','https://example.com','https://example-demo.trycloudflare.com:443'])assert.throws(()=>staticVercelConfig(bad));
});
test('missing or symlinked public inputs fail before any output is created',t=>{
  const{src,out}=setup(t);const path=join(src,PUBLIC_UI_FILES[0][0]);unlinkSync(path);symlinkSync(join(src,PUBLIC_UI_FILES[1][0]),path);
  assert.throws(()=>prepareStaticVercel('https://example-demo.trycloudflare.com',out,src));assert.equal(existsSync(out),false);
});
