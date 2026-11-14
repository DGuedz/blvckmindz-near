import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsDemoPost, allowedPublicHost, allowedFrontendOrigin } from '../demo-http-policy.mjs';

const local={host:'127.0.0.1:8787',origin:'http://127.0.0.1:8787',contentType:'application/json',port:8787};
const publicHost='music-payments-test.trycloudflare.com';
const tunnel={host:publicHost,origin:`https://${publicHost}`,contentType:'application/json',port:8787,publicMode:true};

test('loopback POSTs require the exact port and matching HTTP origin',()=>{
  assert.equal(acceptsDemoPost(local),true);
  assert.equal(acceptsDemoPost({...local,host:'localhost:8787',origin:'http://localhost:8787'}),true);
  assert.equal(acceptsDemoPost({...local,publicMode:true,publicHost}),true);
  for(const change of [
    {port:8788},{host:'localhost:8787'},{origin:'http://localhost:8787'},
    {host:'127.0.0.1:08787',origin:'http://127.0.0.1:08787'},
    {host:'0.0.0.0:8787',origin:'http://0.0.0.0:8787'},
    {host:'[::1]:8787',origin:'http://[::1]:8787'},
    {origin:'https://127.0.0.1:8787'},
  ])assert.equal(acceptsDemoPost({...local,...change}),false);
});

test('the public tunnel is opt-in and an optional pin matches exactly',()=>{
  assert.equal(acceptsDemoPost({...tunnel,publicMode:false}),false);
  assert.equal(acceptsDemoPost({...tunnel,publicMode:undefined}),false);
  assert.equal(acceptsDemoPost(tunnel),true);
  assert.equal(acceptsDemoPost({...tunnel,publicHost}),true);
  assert.equal(acceptsDemoPost({...tunnel,publicHost:'different.trycloudflare.com'}),false);
  assert.equal(acceptsDemoPost({...tunnel,publicHost:'https://'+publicHost}),false);
  assert.equal(acceptsDemoPost({...tunnel,publicHost:''}),false);
});

test('cross-site, opaque, HTTP, port-bearing and path-bearing public origins are refused',()=>{
  for(const origin of [
    undefined,null,'null','https://evil.example','https://'+publicHost+'.evil',
    'http://'+publicHost,'https://'+publicHost+':443','https://'+publicHost+'/',
    'https://'+publicHost+'/demo','https://user@'+publicHost,
    'https://'+publicHost+'?query=1','https://'+publicHost+'#fragment',
    'https://'+publicHost+', https://evil.example','https://'+publicHost+'\n',
  ])assert.equal(acceptsDemoPost({...tunnel,origin}),false,String(origin));
});

test('public host validation rejects suffix confusion, injection, arbitrary domains and private IPs',()=>{
  const hosts=[
    'evil.example','127.0.0.1','169.254.169.254','10.0.0.1','192.168.1.1','localhost',
    publicHost+'.evil','sub.'+publicHost,publicHost+'.',publicHost+':443',publicHost+':8787',
    'https://'+publicHost,publicHost+'/path',publicHost+'@evil.example','user@'+publicHost,
    publicHost+', evil.example',publicHost+'\r\nX-Test: injected',publicHost+'\0',
    'UPPER.trycloudflare.com','-music.trycloudflare.com','music-.trycloudflare.com',
    'a'.repeat(64)+'.trycloudflare.com','trycloudflare.com',
  ];
  for(const host of hosts) {
    assert.equal(allowedPublicHost(host),false,host);
    assert.equal(acceptsDemoPost({...tunnel,host,origin:`https://${host}`}),false,host);
  }
  assert.equal(allowedPublicHost('a.trycloudflare.com'),true);
  assert.equal(allowedPublicHost('a'.repeat(63)+'.trycloudflare.com'),true);
  assert.equal(allowedPublicHost(undefined),false);
});

test('JSON media types allow UTF-8 charset while rejecting suffix tricks and extra headers',()=>{
  for(const contentType of ['application/json','application/json; charset=utf-8','application/json;charset="utf-8"','Application/JSON; Charset=UTF-8']) {
    assert.equal(acceptsDemoPost({...tunnel,contentType}),true,contentType);
    assert.equal(acceptsDemoPost({...local,contentType}),true,contentType);
  }
  for(const contentType of ['text/plain','application/x-www-form-urlencoded','application/json-evil','application/jsonevil',
    'application/json, text/plain','application/json;evil=true','application/json; charset=utf-8 evil',
    'application/json; charset=utf-8; charset=utf-8','application/json; charset=utf-16',
    'application/json\r\nX-Test: injected','application/json\n','application/json\0',
  ])assert.equal(acceptsDemoPost({...tunnel,contentType}),false,contentType);
});

test('multi-value headers and malformed options never coerce into an allowed request',()=>{
  for(const field of ['host','origin','contentType'])for(const value of [[tunnel[field]],[tunnel[field],'evil'],{toString:()=>tunnel[field]},null,undefined]) {
    assert.equal(acceptsDemoPost({...tunnel,[field]:value}),false,field);
  }
  for(const port of [0,-1,65536,8787.5,'8787',undefined,NaN,Infinity])assert.equal(acceptsDemoPost({...tunnel,port}),false);
  for(const publicMode of ['true','false',1,null,[]])assert.equal(acceptsDemoPost({...tunnel,publicMode}),false);
  assert.equal(acceptsDemoPost({...tunnel,publicHost:[publicHost]}),false);
  assert.equal(acceptsDemoPost(undefined),false);assert.equal(acceptsDemoPost(null),false);assert.equal(acceptsDemoPost([]),false);
});


test('a configured Vercel frontend grants only its exact HTTPS origin on the pinned tunnel',()=>{
  const frontendOrigin='blvckmindz-review.vercel.app';
  const selected=`https://${frontendOrigin}`;
  assert.equal(allowedFrontendOrigin(selected),true);
  assert.equal(acceptsDemoPost({...tunnel,origin:selected}),false);
  assert.equal(acceptsDemoPost({...tunnel,frontendOrigin:selected,origin:selected,publicHost}),true);
  assert.equal(acceptsDemoPost({...tunnel,frontendOrigin:selected,publicHost}),true); // Direct Cloudflare review still works.
  assert.equal(acceptsDemoPost({...tunnel,frontendOrigin:selected,origin:'https://other-review.vercel.app'}),false);
  assert.equal(acceptsDemoPost({...tunnel,frontendOrigin:selected,origin:selected,publicMode:false}),false);
  assert.equal(acceptsDemoPost({...tunnel,frontendOrigin:selected,origin:selected,publicHost:'different.trycloudflare.com'}),false);
  assert.equal(acceptsDemoPost({...tunnel,frontendOrigin:selected,origin:selected,host:frontendOrigin}),false);
});

test('Vercel startup origins reject URL tricks, wildcard permissions and malformed configuration',()=>{
  const valid='https://blvckmindz-review.vercel.app';
  for(const frontendOrigin of [
    undefined,null,'','https://*.vercel.app','https://vercel.app','http://blvckmindz-review.vercel.app',
    valid+'/',valid+'/demo',valid+'?query=1',valid+'#fragment',valid+':443',
    valid+'.evil','https://evil.example','https://user@blvckmindz-review.vercel.app',
    'https://sub.blvckmindz-review.vercel.app','https://UPPER.vercel.app','https://-bad.vercel.app',
    valid+'\n',[valid],{toString:()=>valid},
  ]) {
    assert.equal(allowedFrontendOrigin(frontendOrigin),false,String(frontendOrigin));
    if(frontendOrigin!==undefined)assert.equal(acceptsDemoPost({...tunnel,frontendOrigin}),false,String(frontendOrigin));
  }
  for(const origin of [valid+'.evil',valid+'/',valid+':443','http://blvckmindz-review.vercel.app','https://other.vercel.app',[valid]]) {
    assert.equal(acceptsDemoPost({...tunnel,frontendOrigin:valid,origin}),false,String(origin));
  }
});

test('a frontend origin never changes the loopback same-origin rule',()=>{
  const frontendOrigin='https://blvckmindz-review.vercel.app';
  assert.equal(acceptsDemoPost({...local,frontendOrigin}),true);
  assert.equal(acceptsDemoPost({...local,frontendOrigin,publicMode:true,publicHost}),true);
  assert.equal(acceptsDemoPost({...local,frontendOrigin,origin:frontendOrigin,publicMode:true}),false);
  assert.equal(acceptsDemoPost({...local,frontendOrigin,origin:'http://localhost:8787'}),false);
  assert.equal(acceptsDemoPost({...local,frontendOrigin:'invalid-configuration'}),true);
});
