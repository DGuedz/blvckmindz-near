import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunController } from '../web/run-controller.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const ref = {requestId:id,template:'master',status:'running'};
const completed = {...ref,status:'verified',proof:{matched:true}};
const reply = (run,status=200) => ({ok:status>=200 && status<300,status,json:async()=>run});
function fixture({saved=null,fetch,render=run=>run.proof?.matched === true,durable=true,saveThrows=false,...options}={}) {
  const requests=[],states=[],busy=[],saves=[],renders=[];
  let reference=saved;
  const references={read:()=>reference,save(value) { saves.push({...value});if(saveThrows)throw new Error('QuotaExceededError: internal details');reference={...value};return{durable};}};
  const controller=createRunController({references,fetchFn:async(url,init={})=>{
    requests.push({url,...init});return fetch ? fetch(url,init) : init.method==='POST'?reply(null,202):reply(completed);
  },renderRun:run=>{renders.push(run);return render(run);},onBusy:value=>busy.push(value),onState:value=>states.push(value),uuid:()=>id,delay:async()=>{},maxPolls:3,...options});
  return {controller,requests,states,busy,saves,renders,references};
}

test('double clicks share one promise and one POST while a live request is busy', async()=>{
  let release;
  const accepted=new Promise(resolve=>{release=resolve;});
  const f=fixture({fetch:(_url,init)=>init.method==='POST'?accepted:reply(completed)});
  const first=f.controller.start('master'),second=f.controller.start('master');
  assert.equal(first,second);assert.equal(f.controller.busy,true);
  await Promise.resolve();assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
  release(reply(null,202));const result=await first;
  assert.equal(result.kind,'complete');assert.equal(f.controller.busy,false);assert.deepEqual(f.busy,[true,false]);
  assert.equal(f.saves[0].status,'running');assert.equal(f.saves.at(-1).status,'verified');
});

test('reloading a pending reference and opening an unknown URL run only issue GET requests', async()=>{
  for(const saved of [ref,{requestId:id}]) {
    const f=fixture({saved});
    assert.equal((await f.controller.start('publishing')).kind,'complete');
    assert.ok(f.requests.length>0);assert.ok(f.requests.every(r=>!r.method));
    assert.ok(f.requests.every(r=>r.url.endsWith(id)));
  }
});

test('a timeout after POST stays pending and a later start resumes the same ID with GET only', async()=>{
  let reads=0;
  const f=fixture({fetch:(_url,init)=>{
    if(init.method==='POST')return reply(null,202);
    if(++reads===1)throw new Error('Timeout: secret server diagnostic');
    return reply(completed);
  }});
  assert.equal((await f.controller.start('master')).kind,'pending');
  assert.equal(f.controller.busy,false);
  assert.equal((await f.controller.start('publishing')).kind,'complete');
  assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
  assert.ok(f.requests.filter(r=>!r.method).every(r=>r.url.endsWith(id)));
  assert.equal(JSON.stringify(f.states).includes('secret server diagnostic'),false);
});

test('a timed-out POST is never repeated automatically; explicit resume uses GET for its prepared ID', async()=>{
  const f=fixture({fetch:(_url,init)=>{if(init.method==='POST')throw new Error('Network timeout');return reply(completed);}});
  assert.equal((await f.controller.start('master')).kind,'pending');
  assert.equal((await f.controller.resume(id)).kind,'complete');
  assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
});

test('404 never sends a payment; only an explicit prepared retry posts the same known ID', async()=>{
  let started=false;
  const f=fixture({saved:ref,fetch:(_url,init)=>{
    if(init.method==='POST'){started=true;return reply(null,202);}
    return started?reply(completed):reply(null,404);
  }});
  assert.equal((await f.controller.resume(id)).kind,'not-found');
  assert.equal(f.requests.some(r=>r.method==='POST'),false);
  assert.equal((await f.controller.retryPrepared()).kind,'complete');
  const posts=f.requests.filter(r=>r.method==='POST');assert.equal(posts.length,1);
  assert.deepEqual(JSON.parse(posts[0].body),{requestId:id,template:'master'});
  const unknown=fixture({saved:{requestId:id},fetch:()=>reply(null,404)});
  await unknown.controller.resume(id);await unknown.controller.retryPrepared();
  assert.equal(unknown.requests.some(r=>r.method==='POST'),false);
});

test('no POST happens when a new reference cannot be kept durably', async()=>{
  for(const options of [{durable:false},{saveThrows:true}]) {
    const f=fixture(options);
    assert.equal((await f.controller.start('master')).kind,'storage-error');
    assert.equal(f.requests.length,0);assert.equal(f.controller.busy,false);assert.deepEqual(f.busy,[true,false]);
  }
});

test('failed metadata persistence after a verified GET does not hide the payment', async()=>{
  for (const failure of [{saveThrows:true},{durable:false}]) {
    const f=fixture({saved:ref,...failure});
    assert.equal((await f.controller.resume(id)).kind,'complete');
    assert.equal(f.renders.length,1);assert.ok(f.states.some(s=>s.kind==='complete'));
  }
});

test('a raw verified flag without a valid rendered proof never completes or saves verified', async()=>{
  const f=fixture({saved:ref,render:()=>false});
  assert.equal((await f.controller.resume(id)).kind,'review');
  assert.equal(f.states.some(s=>s.kind==='complete'),false);
  assert.equal(f.saves.some(s=>s.status==='verified'),false);
  assert.equal(f.saves.at(-1).status,'needs-review');
});

test('unknown schemas and mismatched request IDs are rejected before rendering or saving', async()=>{
  for(const run of [null,[],{...completed,requestId:other},{...completed,status:'Paid'},{...completed,template:'other'}]) {
    const f=fixture({saved:ref,fetch:()=>reply(run)});
    assert.equal((await f.controller.resume(id)).kind,'review');
    assert.equal(f.renders.length,0);assert.equal(f.saves.length,0);
  }
});

test('renderer failures and exhausted polling remain pending without false success or another POST', async()=>{
  const broken=fixture({saved:ref,render:()=>{throw new Error('DOM error: private details');}});
  assert.equal((await broken.controller.resume(id)).kind,'pending');
  assert.equal(broken.saves.some(s=>s.status==='verified'),false);
  assert.equal(JSON.stringify(broken.states).includes('private details'),false);
  const running=fixture({saved:ref,fetch:()=>reply(ref)});
  assert.equal((await running.controller.resume(id)).kind,'pending');
  assert.equal(running.requests.length,3);assert.equal(running.requests.some(r=>r.method==='POST'),false);
  assert.equal(running.controller.busy,false);
});

test('operator-review status remains review and only an earlier verified reference permits a new explicit start', async()=>{
  const review=fixture({saved:ref,fetch:()=>reply({...ref,status:'needs-review'})});
  assert.equal((await review.controller.start('master')).kind,'review');
  assert.equal(review.requests.some(r=>r.method==='POST'),false);
  const fresh=fixture({saved:{...ref,requestId:other,status:'verified'}});
  assert.equal((await fresh.controller.start('master')).kind,'complete');
  assert.equal(JSON.parse(fresh.requests.find(r=>r.method==='POST').body).requestId,id);
});

test('an interrupted runtime overrides a stale running record and stops polling for operator review', async()=>{
  const received={...ref};
  const f=fixture({saved:ref,fetch:()=>reply(received),requiresReview:run=>run.status==='running'});
  const result=await f.controller.resume(id);
  assert.equal(result.kind,'review');assert.equal(result.run.status,'needs-review');
  assert.equal(f.renders[0].status,'needs-review');assert.equal(f.saves.at(-1).status,'needs-review');
  assert.equal(received.status,'running');assert.equal(f.requests.length,1);
  assert.equal(f.requests.some(r=>r.method==='POST'),false);
  const historical=fixture({saved:ref,requiresReview:()=>true});
  assert.equal((await historical.controller.resume(id)).kind,'complete');
  // A different orphaned run's lock cannot erase an already verified receipt.
  assert.equal(historical.renders[0].status,'verified');
});

test('a later prepared retry keeps the template learned from GET instead of stale local metadata', async()=>{
  let reads=0;
  const f=fixture({saved:ref,fetch:(_url,init)=>init.method==='POST'?reply(null,202):++reads===1?reply({...ref,template:'publishing'}):reply(null,404)});
  assert.equal((await f.controller.resume(id)).kind,'not-found');
  await f.controller.retryPrepared();
  assert.deepEqual(JSON.parse(f.requests.find(r=>r.method==='POST').body),{requestId:id,template:'publishing'});
});
