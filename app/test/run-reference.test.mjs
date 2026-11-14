import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunReferenceStore } from '../web/run-reference.mjs';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const running = {requestId:first,template:'master',status:'running'};
function fixture({url='http://127.0.0.1:8787/?lang=en#engineTitle',saved,storageFails=false,historyFails=false}={}) {
  let data = saved === undefined ? null : JSON.stringify(saved);
  const calls = {storage:0,history:0};
  const location = {href:url};
  const storage = {
    getItem:() => { if (storageFails) throw new Error('SecurityError'); return data; },
    setItem:(_key,value) => { calls.storage++; if (storageFails) throw new Error('QuotaExceededError'); data=value; },
    removeItem:() => { if (storageFails) throw new Error('SecurityError'); data=null; },
  };
  const history = {state:{kept:true},replaceState(state,_title,next) {
    calls.history++;
    if (historyFails) throw new Error('SecurityError');
    assert.deepEqual(state,{kept:true}); location.href=next;
  }};
  return {store:createRunReferenceStore({storage,location,history}),calls,location,storage,history};
}

test('a run remains recoverable through its public URL when storage fails before or after a payment', () => {
  const f = fixture({storageFails:true});
  assert.deepEqual(f.store.save(running),{durable:true});
  assert.equal(f.store.urlId(),first); assert.deepEqual(f.store.read(),running);
  const completed={...running,status:'verified'};
  assert.deepEqual(f.store.save(completed),{durable:true}); assert.deepEqual(f.store.read(),completed);
  const reloaded=createRunReferenceStore({storage:f.storage,location:f.location,history:f.history});
  assert.deepEqual(reloaded.read(),{requestId:first});
});

test('a URL run takes precedence and cannot borrow another run’s stored metadata', () => {
  const f = fixture({url:`http://127.0.0.1:8787/?run=${second}&template=master&status=verified`,saved:running});
  assert.deepEqual(f.store.read(),{requestId:second});
  const same=fixture({url:`http://127.0.0.1:8787/?run=${first}`,saved:running});
  assert.deepEqual(same.store.read(),running);
});

test('tampered URL references never become a usable request ID', () => {
  for (const id of ['not-a-run','11111111-1111-1111-8111-111111111111','11111111-1111-4111-7111-111111111111','__proto__','https://example.test/']) {
    const f=fixture({url:`http://127.0.0.1:8787/?run=${encodeURIComponent(id)}`});
    assert.equal(f.store.urlId(),null); assert.equal(f.store.read(),null);
  }
  assert.equal(fixture({url:`http://127.0.0.1:8787/?run=${first}&run=${second}`}).store.urlId(),null);
});

test('stale, incomplete and non-object stored data is ignored', () => {
  for (const saved of [null,[],false,'text',42,{requestId:first},{...running,template:'__proto__'},{...running,status:'complete'},{...running,amount:'2000000'}]) {
    assert.equal(fixture({saved}).store.read(),null);
  }
  const f=fixture();f.storage.getItem=()=>'{broken';assert.equal(f.store.read(),null);
});

test('history failure falls back to storage, while failure of both is reported without losing in-memory display', () => {
  const f=fixture({historyFails:true});
  assert.deepEqual(f.store.save(running),{durable:true});
  assert.deepEqual(createRunReferenceStore({storage:f.storage}).read(),running);
  const unavailable=fixture({storageFails:true,historyFails:true});
  assert.deepEqual(unavailable.store.save(running),{durable:false});
  assert.deepEqual(unavailable.store.read(),running);
  assert.deepEqual(createRunReferenceStore().save(running),{durable:false});
});

test('storage cannot make a new reference durable while a different URL run still takes precedence', () => {
  const f=fixture({url:`http://127.0.0.1:8787/?run=${first}`,saved:running,historyFails:true});
  const next={requestId:second,template:'publishing',status:'running'};
  assert.deepEqual(f.store.save(next),{durable:false});
  assert.equal(f.store.urlId(),first);assert.deepEqual(f.store.read(),{requestId:first});
  // A correct existing URL is already sufficient to recover with GET, even
  // when metadata persistence and later History calls are unavailable.
  const same=fixture({url:`http://127.0.0.1:8787/?run=${first}`,storageFails:true,historyFails:true});
  assert.deepEqual(same.store.save(running),{durable:true});
});

test('save rejects invalid data before mutating memory, storage or the URL', () => {
  const f=fixture();f.store.save(running);
  const before={...f.calls},url=f.location.href;
  for (const value of [null,[],{...running,status:'paid'},{...running,template:'other'},{...running,requestId:second.replace('4222','1222')},{...running,amount:'2000000'}]) {
    assert.throws(()=>f.store.save(value),TypeError);
    assert.deepEqual(f.store.read(),running);assert.deepEqual(f.calls,before);assert.equal(f.location.href,url);
  }
});

test('detach preserves the last receipt and unrelated URL state; callers cannot mutate the saved reference', () => {
  const f=fixture();f.store.save(running);
  const read=f.store.read();read.requestId=second;
  assert.equal(f.store.urlId(),first);assert.equal(f.store.read().requestId,first);
  assert.equal(f.store.detach(),true);assert.equal(f.store.urlId(),null);assert.deepEqual(f.store.read(),running);
  assert.equal(new URL(f.location.href).searchParams.get('lang'),'en');assert.equal(new URL(f.location.href).hash,'#engineTitle');
  const onlyUrl=fixture({url:`http://127.0.0.1:8787/?run=${first}`});
  assert.equal(onlyUrl.store.detach(),true);assert.deepEqual(onlyUrl.store.read(),{requestId:first});
});

test('detach signals a history failure instead of pretending the old URL was removed', () => {
  const f=fixture({url:`http://127.0.0.1:8787/?run=${first}`,historyFails:true});
  assert.equal(f.store.detach(),false);assert.equal(f.store.urlId(),first);
});

test('forgetting an unknown URL run preserves a different saved verified receipt', () => {
  const previous={...running,requestId:second,status:'verified'};
  const f=fixture({url:`http://127.0.0.1:8787/?run=${first}&lang=en#engineTitle`,saved:previous});
  assert.deepEqual(f.store.read(),{requestId:first});
  assert.deepEqual(f.store.forget(first),{durable:true});
  assert.equal(f.store.urlId(),null);assert.deepEqual(f.store.read(),previous);
  assert.deepEqual(createRunReferenceStore({storage:f.storage}).read(),previous);
  assert.equal(new URL(f.location.href).searchParams.get('lang'),'en');
  assert.equal(new URL(f.location.href).hash,'#engineTitle');
});

test('forget removes only the matching URL, memory and storage reference', () => {
  const f=fixture();f.store.save(running);
  assert.deepEqual(f.store.forget(first),{durable:true});
  assert.equal(f.store.read(),null);assert.equal(f.store.urlId(),null);
  assert.equal(createRunReferenceStore({storage:f.storage}).read(),null);
  const unknown=fixture({url:`http://127.0.0.1:8787/?run=${first}`});
  unknown.store.detach(); // detach deliberately retains an ID-only memory bookmark.
  assert.deepEqual(unknown.store.forget(first),{durable:true});assert.equal(unknown.store.read(),null);
  const anotherUrl=fixture({url:`http://127.0.0.1:8787/?run=${second}`,saved:running});
  assert.deepEqual(anotherUrl.store.forget(first),{durable:true});
  assert.equal(anotherUrl.store.urlId(),second);assert.deepEqual(anotherUrl.store.read(),{requestId:second});
});

test('forget reports persistence failures without claiming a stale run was cleared', () => {
  const historyBlocked=fixture({url:`http://127.0.0.1:8787/?run=${first}`,saved:running,historyFails:true});
  assert.deepEqual(historyBlocked.store.forget(first),{durable:false});
  assert.equal(historyBlocked.store.urlId(),first);assert.deepEqual(historyBlocked.store.read(),running);
  const removalBlocked=fixture({saved:running});
  removalBlocked.storage.removeItem=()=>{throw new Error('SecurityError');};
  assert.deepEqual(removalBlocked.store.forget(first),{durable:false});
  assert.deepEqual(removalBlocked.store.read(),running);
  assert.deepEqual(fixture({storageFails:true}).store.forget(first),{durable:false});
});

test('forget rejects invalid IDs and never deletes another URL parameter or reference', () => {
  const f=fixture();f.store.save(running);const before=f.location.href;
  assert.throws(()=>f.store.forget('not-a-run'),TypeError);
  assert.equal(f.location.href,before);assert.deepEqual(f.store.read(),running);
  const duplicate=fixture({url:`http://127.0.0.1:8787/?run=${first}&run=${second}`});
  assert.deepEqual(duplicate.store.forget(first),{durable:true});
  assert.equal(duplicate.store.urlId(),second);
});
