// A public run reference is a bookmark, never permission to send a payment.
// Callers must fetch it with GET and validate the returned proof before saving
// a server-reported run as verified. This module never performs network I/O.
const KEY = 'bmzTestnetRun';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TEMPLATES = new Set(['master', 'publishing']);
const STATUSES = new Set(['running', 'needs-review', 'verified']);

function validId(value) {
  return typeof value === 'string' && UUID_V4.test(value);
}
function reference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'requestId,status,template'
    || !validId(value.requestId) || !TEMPLATES.has(value.template) || !STATUSES.has(value.status)) {
    throw new TypeError('Invalid public run reference.');
  }
  return Object.freeze({requestId:value.requestId, template:value.template, status:value.status});
}

export function createRunReferenceStore({storage, location, history} = {}) {
  let memory = null;
  function currentUrl() {
    try { return new URL(location.href); } catch { return null; }
  }
  function urlId() {
    const ids = currentUrl()?.searchParams.getAll('run') ?? [];
    return ids.length === 1 && validId(ids[0]) ? ids[0] : null;
  }
  function stored() {
    try { return reference(JSON.parse(storage.getItem(KEY))); } catch { return null; }
  }
  function read() {
    const id = urlId(), saved = stored();
    if (id) {
      // URL parameters other than run never supply template/status metadata.
      const same = memory?.requestId === id && memory.template ? memory
        : saved?.requestId === id ? saved : null;
      return same ? {...same} : {requestId:id};
    }
    const last = memory ?? saved;
    return last ? {...last} : null;
  }
  function writeUrl(url) {
    try {
      if (typeof history?.replaceState !== 'function') return false;
      history.replaceState(history.state ?? null, '', url.href);
      return true;
    } catch { return false; }
  }
  function save(value) {
    // Validation finishes before memory, history or storage can be changed.
    const next = reference(value);
    memory = next;
    let urlSaved = urlId() === next.requestId, storageSaved = false;
    const url = currentUrl();
    if (url && !urlSaved) { url.searchParams.set('run', next.requestId); urlSaved = writeUrl(url); }
    try {
      if (typeof storage?.setItem === 'function') { storage.setItem(KEY, JSON.stringify(next)); storageSaved = true; }
    } catch { /* In-memory display remains available even when storage is full. */ }
    // An old URL would override the new stored ID on reload. Do not tell the
    // caller it can safely POST unless that conflict was actually removed.
    const activeId = urlId();
    const conflictingUrl = activeId !== null && activeId !== next.requestId;
    return {durable:urlSaved || (storageSaved && !conflictingUrl)};
  }
  function detach() {
    // Removing the active URL does not erase the last receipt bookmark.
    const last = read();
    if (last) memory = Object.freeze({...last});
    const url = currentUrl();
    if (!url) return false;
    if (!url.searchParams.has('run')) return true;
    url.searchParams.delete('run');
    return writeUrl(url);
  }
  function forget(requestId) {
    if (!validId(requestId)) throw new TypeError('Invalid public run reference.');
    let record = null;
    try {
      const raw = typeof storage?.getItem === 'function' ? storage.getItem(KEY) : null;
      try { record = JSON.parse(raw); } catch { /* Invalid JSON is never used by read(). */ }
    } catch {
      // An unreadable store could hold a different receipt. Do not erase it.
      return {durable:false};
    }
    const url = currentUrl();
    if (location && !url) return {durable:false};
    if (url?.searchParams.getAll('run').includes(requestId)) {
      const otherIds = url.searchParams.getAll('run').filter(id => id !== requestId);
      url.searchParams.delete('run');
      for (const id of otherIds) url.searchParams.append('run',id);
      if (!writeUrl(url)) return {durable:false};
    }
    if (record && typeof record === 'object' && record.requestId === requestId) {
      try {
        if (typeof storage?.removeItem !== 'function') return {durable:false};
        storage.removeItem(KEY);
      } catch { return {durable:false}; }
    }
    if (memory?.requestId === requestId) memory = null;
    return {durable:true};
  }
  return {read,save,detach,forget,urlId};
}
