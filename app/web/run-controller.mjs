// The only POST paths are an explicit start or an explicit retry of a prepared
// reference. A URL, a reload, polling and reconnecting never authorize a POST.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TEMPLATES = new Set(['master', 'publishing']);
const STATUSES = new Set(['running', 'needs-review', 'verified']);
const isId = value => typeof value === 'string' && UUID_V4.test(value);
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));

export function createRunController({
  fetchFn = (...args) => fetch(...args), references, renderRun,
  onBusy = () => {}, onState = () => {}, uuid = () => crypto.randomUUID(), requiresReview = () => false,
  delay = wait, maxPolls = 120, pollMs = 2000,
}) {
  if (!Number.isInteger(maxPolls) || maxPolls < 1 || !Number.isFinite(pollMs) || pollMs < 0) {
    throw new TypeError('Invalid run polling settings.');
  }
  let active = null, currentId = null, lastRun, state = null, prepared = null;
  const emit = (kind,run) => {
    state = {kind,requestId:currentId,...(run ? {run} : {})};
    onState(state);
    return state;
  };
  function readReference() {
    const ref = references.read();
    if (ref === null || ref === undefined) return null;
    if (!ref || typeof ref !== 'object' || !isId(ref.requestId)) throw new Error('Invalid run reference.');
    return TEMPLATES.has(ref.template) && STATUSES.has(ref.status)
      ? {requestId:ref.requestId,template:ref.template,status:ref.status} : {requestId:ref.requestId};
  }
  function saveObserved(run,status) {
    // Displaying an observed payment must not depend on browser persistence.
    try { references.save({requestId:run.requestId,template:run.template,status}); } catch {}
  }
  function exclusive(work) {
    if (active) return active;
    currentId = null; lastRun = undefined;
    let busyError = false;
    active = Promise.resolve().then(() => {
      if (busyError) throw new Error('Could not update the run controls.');
      return work();
    }).catch(() => {
      // Network, persistence-read and renderer errors are unconfirmed states.
      // Raw server messages, exception text and stack traces never reach the UI.
      try { return emit('pending',lastRun); } catch { return {kind:'pending',requestId:currentId}; }
    }).finally(() => {
      active = null;
      try { onBusy(false); } catch {}
    });
    try { onBusy(true); } catch { busyError = true; }
    return active;
  }
  function validRun(run,id) {
    return run !== null && typeof run === 'object' && !Array.isArray(run)
      && run.requestId === id && TEMPLATES.has(run.template) && STATUSES.has(run.status);
  }
  async function poll(id,known) {
    currentId = id;
    prepared = known?.requestId === id && TEMPLATES.has(known.template) ? {...known} : null;
    emit('checking');
    for (let attempt=0; attempt<maxPolls; attempt++) {
      const response = await fetchFn('/api/demo-runs/' + encodeURIComponent(id),{signal:AbortSignal.timeout(10000)});
      if (response.status === 404) return emit('not-found');
      if (!response.ok) throw new Error('Run read failed.');
      const received = await response.json();
      if (!validRun(received,id)) return emit('review');
      // The server can retain a running JSON record after its process died.
      // The caller supplies current runtime/lock health from public config.
      const run = received.status === 'running' && requiresReview(received) ? {...received,status:'needs-review'} : received;
      lastRun = run;
      prepared = {requestId:id,template:run.template,status:run.status};
      // renderRun validates this run's transfer proof as well as drawing it.
      // Do not promote a server flag into a saved verified reference first.
      const proofValid = renderRun(run) === true;
      if (run.status === 'verified') {
        saveObserved(run,proofValid ? 'verified' : 'needs-review');
        return emit(proofValid ? 'complete' : 'review',run);
      }
      saveObserved(run,run.status);
      if (run.status === 'needs-review') return emit('review',run);
      emit('checking',run);
      if (attempt + 1 < maxPolls) await delay(pollMs);
    }
    return emit('pending',lastRun);
  }
  async function submit(ref) {
    currentId = ref.requestId; prepared = {...ref};
    let durable = false;
    try { durable = references.save(ref)?.durable === true; } catch {}
    if (!durable) return emit('storage-error');
    emit('starting');
    const response = await fetchFn('/api/demo-runs',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({requestId:ref.requestId,template:ref.template}),signal:AbortSignal.timeout(10000),
    });
    if (response.status !== 202) throw new Error('Run start was not confirmed.');
    return poll(ref.requestId,ref);
  }
  function start(template) {
    return exclusive(() => {
      const ref = readReference();
      if (ref && ref.status !== 'verified') return poll(ref.requestId,ref);
      if (!TEMPLATES.has(template)) return emit('review');
      const id = uuid();
      if (!isId(id)) return emit('review');
      return submit({requestId:id,template,status:'running'});
    });
  }
  function resume(id) {
    return exclusive(() => {
      if (!isId(id)) return emit('review');
      const ref = readReference();
      return poll(id,ref?.requestId === id ? ref : null);
    });
  }
  function retryPrepared() {
    if (active) return active;
    if (state?.kind !== 'not-found' || !prepared || prepared.requestId !== state.requestId || !TEMPLATES.has(prepared.template)) {
      return Promise.resolve(state);
    }
    const retry = {...prepared,status:'running'};
    return exclusive(() => submit(retry));
  }
  return {start,resume,retryPrepared,get busy() { return active !== null; }};
}
