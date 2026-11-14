
import { csvLine } from '/csv.mjs';
import { expectedReceiptReference, formatTestUsdc } from '/statement.mjs';
import { composeRight, allocateMoney, percentToBps, parseTestUsdc } from '/split-engine.mjs';
import { SAMPLE_TEMPLATES, matchesRecordedTemplate } from '/templates.mjs';
import { createEngineMotion, liveFrame } from '/engine-motion.mjs';
import { createRunReferenceStore } from '/run-reference.mjs';
import { createRunController } from '/run-controller.mjs';
const $ = (id) => document.getElementById(id);
const motion = createEngineMotion($('engineMotion'), {expectedContext:runContext,onSimulationEnd: () => { simulationReady=true; $('engineRunStatus').textContent = 'Simulation complete. No tokens moved.'; updateLiveAvailability(); $('journeyNext').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}); }});
function motionSnapshot(result) { return {...result, ...SAMPLE_TEMPLATES[$('engineTerms').value], amount:result.amount, weights:result.weights}; }
let cfg;
let configUnavailable=false;
let liveBusy = false;
let launching = false;
let simulationReady = false;
let completedVisible = false;
let controller;
let recoveryState;
let lookupAbort;
let readRequest = 0;
const references = createRunReferenceStore({storage:{getItem:key=>window.sessionStorage.getItem(key),setItem:(key,value)=>window.sessionStorage.setItem(key,value),removeItem:key=>window.sessionStorage.removeItem(key)},location:window.location,history:window.history});
let displayedVerifiedRun;
let revision = 0;
let proofRequest = 0;
let proofAbort;
let queryGeneration = 0;
const usdc = formatTestUsdc;
function resetMotionToInputs() {
  let amount='—'; try { amount=usdc(parseTestUsdc($('engineAmount').value)); } catch {}
  motion.reset({...SAMPLE_TEMPLATES[$('engineTerms').value],amount});
}
function calculateExample() {
  const publishing = $('engineTerms').value === 'publishing';
  const template = SAMPLE_TEMPLATES[$('engineTerms').value];
  const d = template.deal;
  const label = publishing ? 'Publisher' : 'Label';
  const names = template.roles;
  $('firstRole').textContent = names[0]; $('secondRole').textContent = names[1];
  for (const id of ['engineA','engineB','engineAmount']) {$(id).removeAttribute('aria-invalid');$(id).removeAttribute('aria-describedby');}
  const parseField = (id, parser) => {try{return parser($(id).value);}catch(error){$(id).setAttribute('aria-invalid','true');throw error;}};
  try {
    const amount = parseField('engineAmount',parseTestUsdc);
    if (amount === 0n) { $('engineAmount').setAttribute('aria-invalid','true'); throw new Error('Enter a positive sample payment.'); }
    const side = ['engineA','engineB'].map((id, i) => ({key:names[i],bps:parseField(id,percentToBps)}));
    if (side.reduce((sum,row)=>sum+row.bps,0) !== 10000) {
      for (const id of ['engineA','engineB']) $(id).setAttribute('aria-invalid','true');
      throw new Error('The two contributor shares must total 100% of their pool.');
    }
    const rows = composeRight(label, d, side);
    const {parts, remainder, remainderKey} = allocateMoney(amount, rows, label);
    $('engineResult').innerHTML = `<span class="output-label">Allocation / sample terms</span><div class="invoice-total">${usdc(amount)} <span>TEST USDC</span></div><div class="allocation-track" role="img" aria-label="${rows.map(r=>`${r.key}: ${r.bps/100}%`).join(', ')}">${rows.map(r=>`<span style="width:${r.bps/100}%"></span>`).join('')}</div>${rows.map((r,i)=>`<div class="result-row"><div>${r.key}<small>${i===0 ? 'From the sample agreement' : 'Calculated share'}</small></div><span class="share">${r.bps/100}%</span><span class="cash">${usdc(parts[i])}</span></div>`).join('')}<p class="conserved">Full payment allocated · Total ${usdc(parts.reduce((a,b)=>a+b,0n))} test USDC</p><details><summary>How the split was calculated</summary><p>${label}: ${d/100}%. Remaining contributors’ pool: ${(10000-d)/100}%.</p><p>${(10000-d)/100}% × ${side[0].bps/100}% → ${rows.find(r=>r.key===names[0]).bps/100}% of the invoice for ${names[0]}, after basis-point rounding.</p><p>Share rounding uses the largest-remainder method. Monetary rounding assigned ${remainder} micro-unit(s) to ${remainderKey}. All money is computed in integer micro-units.</p></details>`;
    for (const id of ['engineA','engineB','engineAmount']) {$(id).removeAttribute('aria-invalid');$(id).removeAttribute('aria-describedby');}
    $('calculationDetails').hidden = false; $('calculationDetails').open = false;
    return { valid:true, amount, weights:side.map(s=>s.bps), rows, parts };
  } catch (e) {
    resetMotionToInputs();
    $('calculationDetails').hidden = false; $('calculationDetails').open = true;
    $('engineResult').replaceChildren();
    const box = document.createElement('div'); box.className = 'engine-error';
    const title = document.createElement('h3'); title.textContent = 'This sheet needs a correction.';
    const reason = document.createElement('p'); reason.id='engineError'; reason.textContent = e.message;
    box.append(title,reason); $('engineResult').append(box);
    const invalid=document.querySelector('#engineForm [aria-invalid=true]');
    for(const field of document.querySelectorAll('#engineForm [aria-invalid=true]'))field.setAttribute('aria-describedby','engineError');
    if(invalid?.id==='engineA'||invalid?.id==='engineB')$('engineInspector').open=true;
    invalid?.focus();
    return {valid:false};
  }
}
function clearRun({detach=true}={}) {
  simulationReady=false; completedVisible=false; $('resetSample').textContent='Reset';
  for(const id of ['engineAmount','engineA','engineB']){$(id).removeAttribute('aria-invalid');$(id).removeAttribute('aria-describedby');}
  if (detach) references.detach();
  revision++; queryGeneration++; proofRequest++; proofAbort?.abort(); lookupAbort?.abort();
  $('nearNetworkStatus').textContent='Run a test payment to attach its verified receipt here.'; $('nearNetworkLink').hidden=true;
  $('feedback').textContent=''; $('track').textContent='Use View track to inspect the registered rights.'; $('batches').textContent='—';
  $('runSample').disabled = false;
  $('runSample').textContent = 'Simulate split';
  $('verifyTransfers').disabled = false;
  $('proofBatch').disabled = false;
  $('proofResult').replaceChildren();
  $('proofStatus').textContent = 'Run the pre-filled sample to check its historical transfers.';
  $('proofStatus').className = '';
  $('engineResult').replaceChildren();
  $('calculationDetails').hidden = true;
  resetMotionToInputs();
  $('liveReceiptCard').hidden = true; $('liveReceiptCard').open=false; $('liveRunResult').replaceChildren();
  $('engineRunStatus').textContent = 'Local calculation. No tokens moved.';
  updateLiveAvailability();
  $('personalCard').hidden = true; $('traceCard').hidden = true; $('receiptCard').hidden = true;
}
function setExample(publishing,{internal=false}={}) {
  clearRun({detach:!internal});
  const t = SAMPLE_TEMPLATES[publishing ? 'publishing' : 'master'];
  $('engineTerms').value = t.id;
  $('engineAmount').value = t.amount;
  $('engineA').value = String(t.weights[0]/100); $('engineB').value = String(t.weights[1]/100);
  $('firstRole').textContent = t.roles[0]; $('secondRole').textContent = t.roles[1];
  $('templateCode').value = t.code; $('codeLabel').textContent = publishing ? 'Composition ID (ISWC)' : 'Recording ID (ISRC)';
  $('templateHint').textContent = publishing ? 'Identifies the composition. The agreement sets the shares.' : 'Identifies the recording. The agreement sets the shares.';
  $('sheetDescription').textContent = publishing ? 'Publisher · writer 1 · writer 2' : 'Label · artist · beatmaker';
  $('masterPreset').setAttribute('aria-pressed',String(!publishing)); $('authorPreset').setAttribute('aria-pressed',String(publishing));
  $('proofBatch').value = t.batchId; $('isrc').value = t.code; $('rightScope').value = t.right;
  motion.reset(t);
  $('caseIntro').textContent = publishing ? 'One song’s writing income, shared by the publisher and two writers.' : 'One song’s payment, shared by the label, artist and producer.';
  updateLiveAvailability();
}
async function runSample() {
  if (liveBusy || launching) return;
  references.detach(); simulationReady=false; completedVisible=false; $('resetSample').textContent='Reset';
  $('liveReceiptCard').hidden=true; $('liveRunResult').replaceChildren();
  const result = calculateExample();
  $('engineRunStatus').textContent = result.valid ? 'Local simulation. No tokens moved.' : ($('engineError')?.textContent??'Correct the highlighted sample inputs and run again.');
  if (result.valid) { $('engineMotion').scrollIntoView({block:'center',behavior:'auto'}); motion.simulate(motionSnapshot(result)); }
}
$('engineForm').onsubmit = (event) => {event.preventDefault();runSample();};
$('masterPreset').onclick = () => {if(!liveBusy&&!launching)setExample(false);};
$('authorPreset').onclick = () => {if(!liveBusy&&!launching)setExample(true);};
$('resetSample').onclick = () => {if(!liveBusy&&!launching)setExample($('engineTerms').value === 'publishing');};
for (const id of ['engineAmount','engineA','engineB']) $(id).oninput = () => {if(!liveBusy&&!launching)clearRun();};

function split(amount, bps, ri) {
  const a = BigInt(amount); const s = bps.map((b) => (a * BigInt(b)) / 10000n);
  s[ri] += a - s.reduce((x, y) => x + y, 0n); return s;
}
async function view(method, args) {
  const r = await fetch(cfg.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    jsonrpc: '2.0', id: 'v', method: 'query', params: { request_type: 'call_function', finality: 'optimistic',
      account_id: cfg.registry, method_name: method, args_base64: btoa(JSON.stringify(args)) } }), signal: lookupAbort ? AbortSignal.any([lookupAbort.signal,AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }).then((x) => x.json());
  if (r.error || r.result?.error) throw new Error(JSON.stringify(r.error ?? r.result.error));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result.result)) || 'null');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ROLE = { 'selo (EAS)': 'Label', 'intérprete': 'Artist', 'produtor musical': 'Producer', 'produtora fonográfica (EAS)': 'recording producer (label)', 'letra': 'Lyrics writer', 'melodia': 'Melody writer' };
const role = (value) => ROLE[value] ?? value;
const RIGHT = { master: 'Master (recording)', neighboring_producer: 'Producer neighboring right', publishing_performance: 'Publishing: performance', publishing_mechanical: 'Publishing: mechanical' };
async function load() {
  const generation = queryGeneration;
  const code = $('isrc').value.trim();
  const scope = $('rightScope').value;
  const allRights = await view('get_rights', { code });
  if (generation !== queryGeneration) return;
  const rights = allRights.filter((r) => scope === 'all' || r.right === scope);
  if (!rights.length) { $('track').textContent = 'Code not registered.'; $('batches').textContent = '—'; $('receiptCard').hidden = true; $('personalCard').hidden = true; return; }
  const test = rights.some((r) => r.test_terms);
  const participants = [...new Set(rights.flatMap((r) => r.holders.map((h) => h.account_id)))];
  $('participant').innerHTML = participants.map((id) => {
    const first = rights.flatMap((r) => r.holders).find((h) => h.account_id === id);
    return `<option value="${esc(id)}">${esc(role(first.role))} · ${esc(id)}</option>`;
  }).join('');
  const showParticipant = () => {
    const selected = $('participant').value;
    const shares = rights.flatMap((r) => r.holders.filter((h) => h.account_id === selected).map((h) => ({ right: r.right, holder: h })));
    $('personal').innerHTML = shares.map(({right, holder}) => `<p><b>${esc(RIGHT[right] ?? right)}</b> · ${holder.bps / 100}% · ${holder.confirmed ? 'confirmed' : 'awaiting confirmation'}</p>`).join('');
  };
  $('participant').onchange = showParticipant;
  const performer = rights.flatMap((r) => r.holders).find((h) => h.role === 'intérprete')
    ?? rights.flatMap((r) => r.holders).find((h) => h.account_id !== cfg.label);
  if (performer) $('participant').value = performer.account_id;
  $('personalCard').hidden = false;
  showParticipant();
  $('track').innerHTML = `<p><b>${esc(rights[0].title)}</b> · test terms <span class="mono">${esc(rights[0].terms_version)}</span>${test ? ' <span class="tag">test parameters</span>' : ''}</p>` +
    rights.map((r) => `<p style="margin:14px 0 4px"><b>${RIGHT[r.right] ?? esc(r.right)}</b> · <span class="mono">${esc(r.token_id)}</span></p><table><tr><th>Holder</th><th>Role</th><th>Share</th><th>Confirmed</th></tr>` +
      r.holders.map((h) => `<tr><td class="mono"><a href="${cfg.explorer}/address/${esc(h.account_id)}" target="_blank" rel="noopener">${esc(h.account_id)}</a></td><td>${esc(role(h.role))}</td><td>${h.bps / 100}%</td><td class="${h.confirmed ? 'ok' : 'wait'}">${h.confirmed ? 'yes' : 'pending'}</td></tr>`).join('') + '</table>').join('');
  const ids = new Set(rights.map((r) => r.token_id));
  const bs = (await view('list_batches', { from_index: 0, limit: 100 })).filter((b) => ids.has(b.token_id));
  if (generation !== queryGeneration) return;
  if (!bs.length) { $('batches').textContent = 'No invoices found in the first 100 batches.'; $('receiptCard').hidden = true; return; }
  const rows = [];
  $('batches').innerHTML = '<table><tr><th>Batch</th><th>Right</th><th>Amount</th><th>Status</th></tr>' + bs.map((b) =>
    `<tr><td>${esc(b.batch_id)}</td><td>${RIGHT[b.token_id.split(':')[1]] ?? esc(b.token_id)}</td><td>${usdc(b.amount)} test USDC</td><td class="${b.status === 'Paid' ? 'ok' : 'wait'}">${{ Reserved: 'reserved', Funded: 'funded, awaiting approval', Approved: 'approved', Paid: 'distribution initiated', RefundPendingFunded: 'refund pending', RefundPendingApproved: 'refund pending', Refunded: 'refunded' }[b.status] ?? 'unknown'}</td></tr>`).join('') +
    '</table><p>Showing matches from the first 100 batches. CSV shares are calculated expectations; verify each transfer in the token events.</p><p><button id="csv">Download CSV</button></p>';
  const mainInvoice = bs.find((b) => b.batch_id === 'm1' && b.token_id === 'PYXXX2600001:master');
  $('traceCard').hidden = !mainInvoice;
  if (mainInvoice) {
    const right = rights.find((r) => r.token_id === mainInvoice.token_id);
    const labelIndex = Math.max(0, right.holders.findIndex((h) => h.account_id === cfg.label));
    const amounts = split(mainInvoice.amount, right.holders.map((h) => h.bps), labelIndex);
    const summary = document.createElement('p');
    summary.textContent = `Sample invoice m1: ${usdc(mainInvoice.amount)} test USDC. Expected split: ` + right.holders.map((h, i) => `${role(h.role)} ${usdc(amounts[i])}`).join(' / ') + '. Verify completed transfers in the explorer.';
    $('batches').prepend(summary);
    const proof = (id, label) => {
      const found = cfg.proofs?.find((item) => item.id === id);
      return found ? `<a href="${cfg.explorer}/txns/${encodeURIComponent(found.tx)}" target="_blank" rel="noopener">${esc(label)}</a>` : '<span>Transaction link unavailable for this deployment.</span>';
    };
    $('trace').innerHTML = `<ol>
      <li><h3>Register the right and split</h3><p>The label registers this recording under terms <code>${esc(right.terms_version)}</code>. The contract calculates shares of ${right.holders.map((h) => `${h.bps / 100}%`).join(' / ')}. The label owns the token record; this does not establish legal ownership.</p>${proof('register', 'Inspect registration')}</li>
      <li><h3>Confirm the participants</h3><p>${right.holders.filter((h) => h.confirmed).length} of ${right.holders.length} recorded shares are confirmed. In this test case, holders signed meta-transactions; the label paid gas. Confirmation records the account’s action, not a legal identity check.</p>${proof('confirm_mc_isrc', 'Inspect performer confirmation')}</li>
      <li><h3>Match the incoming invoice</h3><p>Batch <code>${esc(mainInvoice.batch_id)}</code> pays <code>${esc(mainInvoice.token_id)}</code>. Its recorded amount is ${usdc(mainInvoice.amount)} test USDC. The ledger hash binds the batch to a statement; it does not prove the statement is commercially accurate.</p><p>Ledger SHA-256: <code>${esc(mainInvoice.ledger_hash)}</code></p>${proof('pay_m1', 'Inspect invoice funding')}</li>
      <li><h3>Authorize the batch</h3><p>The gate or label can approve the funded batch with its matching hash. Statement checks run off-chain. Approval is an operator decision; distribution also requires every recorded holder’s confirmation.</p>${proof('gate_m1', 'Inspect approval')}</li>
      <li><h3>Check each transfer</h3><p>The contract schedules transfers using the recorded shares and prevents distributing the same batch twice. Inspect the token transfer events for ${amounts.map(usdc).join(' / ')} test USDC. A receipt or a <code>Paid</code> status alone is insufficient; failed transfers can remain owed.</p>${proof('pay_out_m1', 'Inspect payout and transfer events')}</li>
    </ol><p class="foot">These links refer to the historical deployment named above. This deployment reserves each invoice against its payer, right, amount and hash, and includes a refund path before distribution. Callback failure recovery remains unfinished.</p>`;
  }
  for (const b of bs) {
    const r = rights.find((x) => x.token_id === b.token_id);
    const ri = Math.max(0, r.holders.findIndex((h) => h.account_id === cfg.label));
    const s = split(b.amount, r.holders.map((h) => h.bps), ri);
    r.holders.forEach((h, i) => rows.push([b.batch_id, b.token_id, b.status, h.account_id, h.role, h.bps, usdc(s[i]), expectedReceiptReference(b)]));
  }
  $('csv').onclick = () => {
    const csv = 'batch,right,contract_status,holder,role,bps,expected_test_usdc,derived_reference_not_verified\n' + rows.map(csvLine).join('\n') + '\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `statement-${code}.csv`; a.click();
  };
  const paid = bs.filter((b) => b.status === 'Paid');
  $('receiptCard').hidden = !paid.length;
  $('receipt').innerHTML = paid.map((p) => {
    const r = rights.find((x) => x.token_id === p.token_id);
    const hash = p.ledger_hash.match(/.{2}/g).join(' ').toUpperCase();
    return `<div class="receipt" style="margin-bottom:12px">${RIGHT[r.right]}<br>${r.holders.map((h) => `${esc(role(h.role))} ·········· ${h.bps / 100}%`).join('<br>')}<br>-------------------------<br>NEAR testnet<br><br>BATCH HASH<br><span class="hash">${hash}</span><br><br>BMZ1:${esc(p.batch_id)}:${p.ledger_hash.slice(0, 12)}…</div>`;
  }).join('') + `<p><a href="${cfg.explorer}/address/${cfg.registry}" target="_blank" rel="noopener">Check receipt events in the explorer</a></p>`;
}
async function refresh() {
  if(liveBusy||launching)return;
  lookupAbort?.abort(); lookupAbort=new AbortController();
  const request=++readRequest;
  const generation = ++queryGeneration;
  $('load').disabled = true;
  $('sampleRecording').disabled = true;
  $('sampleWork').disabled = true;
  $('isrc').disabled = true;
  $('rightScope').disabled = true;
  $('personalCard').hidden = true;
  $('receiptCard').hidden = true;
  $('traceCard').hidden = true;
  $('track').textContent = 'Loading rights…';
  $('batches').textContent = 'Loading invoices…';
  $('feedback').textContent = 'Reading NEAR testnet…';
  try {
    cfg ??= await fetch('/api/config', { signal: AbortSignal.timeout(10000) }).then((r) => {
      if (!r.ok) throw new Error('configuration unavailable');
      return r.json();
    });
    $('acc').textContent = `contract: ${cfg.registry}`;
    await load();
    if (generation === queryGeneration) $('feedback').textContent = 'Testnet sample loaded.';
  } catch {
    if (generation !== queryGeneration) return;
    $('personalCard').hidden = true;
    $('receiptCard').hidden = true;
    $('traceCard').hidden = true;
    $('track').textContent = 'Data unavailable.';
    $('batches').textContent = 'Data unavailable.';
    $('feedback').textContent = 'Could not read the testnet. Check your connection and try View track again.';
  } finally {
    if (request !== readRequest) return;
    const locked=liveBusy||launching;
    $('load').disabled = locked;
    $('sampleRecording').disabled = locked;
    $('sampleWork').disabled = locked;
    $('isrc').disabled = locked;
    $('rightScope').disabled = locked;
  }
}
$('search').onsubmit = (event) => { event.preventDefault(); if (!liveBusy&&!launching&&!$('load').disabled) refresh(); };
$('sampleRecording').onclick = () => {if(liveBusy||launching)return;setExample(false);runSample();};
$('sampleWork').onclick = () => {if(liveBusy||launching)return;setExample(true);runSample();};

async function verifyRecordedPayment(expectedRevision = revision) {
  if(liveBusy||launching)return;
  const request = ++proofRequest;
  const batchId = $('proofBatch').value;
  proofAbort?.abort(); proofAbort = new AbortController();
  const button = $('verifyTransfers'); button.disabled = true;
  $('proofBatch').disabled = true;
  $('proofStatus').className = '';
  $('proofStatus').textContent = 'Checking the recorded transfers…';
  $('proofResult').replaceChildren();
  try {
    const response = await fetch('/api/payment-proof?batch=' + encodeURIComponent(batchId), {signal:AbortSignal.any([proofAbort.signal,AbortSignal.timeout(45000)])});
    const report = await response.json();
    if (request !== proofRequest || expectedRevision !== revision) return null;
    if (!response.ok) throw new Error(report.error ?? 'Verification unavailable.');
    $('proofStatus').className = report.matched ? 'proof-pass' : 'proof-fail';
    $('proofStatus').textContent = report.matched ? 'Verified: all recorded amounts match the split.' : 'Mismatch found. Review the transaction.';
    $('proofResult').innerHTML = `<table class="proof-table"><caption>Recorded testnet transfers · ${esc(report.batchId)}</caption><thead><tr><th>Participant</th><th>Expected</th><th>Recorded</th><th>Match</th></tr></thead><tbody>${report.rows.map(r=>`<tr><td>${esc(role(r.role))}<br><span class="mono">${esc(r.account)}</span></td><td>${usdc(r.expected)}</td><td>${usdc(r.actual)}</td><td class="${r.matched?'proof-pass':'proof-fail'}">${r.matched?'Matched':'Check'}</td></tr>`).join('')}</tbody></table><p><a href="https://testnet.nearblocks.io/txns/${encodeURIComponent(report.tx)}" target="_blank" rel="noopener">Open the original payout transaction ↗</a></p><details><summary>Verification scope</summary><p>Receipt emitted by the rights contract: ${report.checks.receipt?'matched':'not matched'}. Token-transfer amounts: ${report.checks.amounts?'matched':'not matched'}. Total: ${report.checks.total?'matched':'not matched'}. Recipients: ${report.checks.recipients?'matched':'not matched'}. Outer transaction: ${report.checks.transaction?'succeeded':'not matched'}.</p><p>Checked ${esc(report.checkedAt)}. Contract state read at block ${esc(report.block)}. This verifies the historical test-token events, not legal ownership or commercial collection.</p></details>`;
    return report;
  } catch (error) { if (request !== proofRequest || expectedRevision !== revision) return null; $('proofStatus').textContent = 'Verification unavailable. Try again or use the full evidence report and explorer links.'; }
  finally { if (request === proofRequest) {button.disabled = liveBusy||launching; $('proofBatch').disabled = liveBusy||launching;} }
}
$('verifyTransfers').onclick = () => verifyRecordedPayment();

function runContext(templateId,run) {
  const template=SAMPLE_TEMPLATES[templateId];
  if(!cfg?.registry||!cfg.token||!template)return null;
  return {contract:cfg.registry,assetContract:cfg.token,tokenId:`${template.code}:${template.right}`,
    amount:String(parseTestUsdc(template.amount)),accounts:[cfg.label,cfg.participants?.first??`mc.${cfg.label}`,cfg.participants?.second??`beat.${cfg.label}`],
    ...(run?.requestId ? {batchIds:[`demo-${run.requestId.replaceAll('-','')}`,`demo-${run.requestId.replaceAll('-','').slice(0,24)}`]} : {})};
}
function fixedInputs() {
  const t=SAMPLE_TEMPLATES[$('engineTerms').value];
  try {return matchesRecordedTemplate(t,{code:$('templateCode').value,amount:parseTestUsdc($('engineAmount').value),weights:[$('engineA').value,$('engineB').value].map(percentToBps)});}catch{return false;}
}
function pendingReference() {
  const ref=references.read();
  return ref&&ref.status!=='verified'?ref:null;
}
function restoreRunTemplate(templateId) {
  const template=SAMPLE_TEMPLATES[templateId];
  if(template&&($('engineTerms').value!==templateId||!fixedInputs()))setExample(templateId==='publishing',{internal:true});
}
function showLiveRun(run) {
  if(run.network!=='testnet'||!SAMPLE_TEMPLATES[run.template])throw new Error('Unexpected run context.');
  restoreRunTemplate(run.template);
  lockLiveControls(liveBusy||launching);
  const result=calculateExample(),context=runContext(run.template,run);
  if(!result.valid||!context)throw new Error('Expected testnet context unavailable.');
  motion.live(motionSnapshot(result),run);
  const verified=liveFrame(run,result.parts,context).verified;
  $('liveReceiptCard').hidden=false;
  $('liveReceiptTitle').textContent=run.template==='master'?'Recording payment · testnet':'Songwriting payment · testnet';
  $('liveRunStatus').textContent=verified?'Verified: every recipient received the expected test amount.':run.status==='needs-review'?'Execution needs review. No automatic payment retry.':'Reading this testnet execution…';
  const txs=Array.isArray(run.txs)?run.txs.filter(tx=>/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(tx?.hash??'')):[];
  const payout=txs.find(tx=>tx.step==='distributing');
  $('liveRunResult').innerHTML=(payout?`<p><a href="https://testnet.nearblocks.io/txns/${encodeURIComponent(payout.hash)}" target="_blank" rel="noopener">Inspect this payout on NEAR ↗</a><br><code>${esc(payout.hash)}</code></p>`:'')+
    (txs.length?`<details><summary>Execution transactions</summary>${txs.map(t=>`<p><a href="https://testnet.nearblocks.io/txns/${encodeURIComponent(t.hash)}" target="_blank" rel="noopener">${esc(t.step)} ↗</a></p>`).join('')}</details>`:'');
  if(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(run.unconfirmedTransaction?.hash??'')){
    const tx=run.unconfirmedTransaction;
    $('liveRunResult').insertAdjacentHTML('beforeend',`<p class="proof-fail">Submitted; outcome not confirmed.<br><a href="https://testnet.nearblocks.io/txns/${encodeURIComponent(tx.hash)}" target="_blank" rel="noopener">Inspect the submitted transaction ↗</a></p>`);
  }
  if(verified){
    completedVisible=true; $('resetSample').textContent='New test';
    $('nearNetworkStatus').textContent=`Verified ${usdc(run.amount)} → ${run.proof.rows.map(row=>usdc(row.actual)).join(' / ')} test USDC.`;
    $('nearNetworkLink').href=`https://testnet.nearblocks.io/txns/${encodeURIComponent(run.proof.tx)}`; $('nearNetworkLink').hidden=false;
    $('liveRunResult').insertAdjacentHTML('afterbegin',`<table class="received-table"><caption>This payment · project test tokens</caption><thead><tr><th>Recipient</th><th>Agreed</th><th>On NEAR</th></tr></thead><tbody>${run.proof.rows.map(r=>`<tr><td>${esc(role(r.role))}<br><code>${esc(r.account)}</code></td><td>${usdc(r.expected)}</td><td class="proof-pass">${usdc(r.actual)}</td></tr>`).join('')}</tbody></table>`);
    $('liveRunResult').insertAdjacentHTML('beforeend',`<details class="proof-metadata"><summary>What was verified</summary><p>The transaction, receipt event, three recipients and exact transfer amounts all match this batch.</p><dl><div><dt>Network</dt><dd>NEAR testnet</dd></div><div><dt>Checked</dt><dd><time datetime="${esc(run.proof.checkedAt)}">${esc(String(run.proof.checkedAt ?? 'Not recorded').replace('T',' ').replace('Z',' UTC'))}</time></dd></div><div><dt>Payment contract</dt><dd><a href="https://testnet.nearblocks.io/address/${encodeURIComponent(run.proof.contract)}" target="_blank" rel="noopener">${esc(run.proof.contract)} ↗</a></dd></div><div><dt>Test token</dt><dd><a href="https://testnet.nearblocks.io/address/${encodeURIComponent(run.proof.assetContract)}" target="_blank" rel="noopener">${esc(run.proof.assetContract)} ↗</a></dd></div><div><dt>State read at block</dt><dd>${esc(run.proof.block)}</dd></div><div><dt>Batch</dt><dd><code>${esc(run.batchId)}</code></dd></div><div><dt>Statement fingerprint</dt><dd><code>${esc(run.ledgerHash)}</code></dd></div></dl><p class="foot">This receipt records the check made after execution. Opening it again reads the saved result. The explorer provides an independent view.</p></details>`);
    if(displayedVerifiedRun!==run.requestId){displayedVerifiedRun=run.requestId;$('engineMotion').scrollIntoView({block:'center',behavior:'auto'});}
  }else if(run.status==='verified'){
    motion.interrupt('The returned proof does not match this payment. Inspect the transaction; no new payment is started.');
    $('liveRunStatus').textContent='Proof mismatch. Received amounts have not been confirmed.';
  }
  return verified;
}
function lockLiveControls(locked) {
  for(const id of ['liveRun','runSample','masterPreset','authorPreset','resetSample','engineAmount','engineA','engineB','lastRunButton','sampleRecording','sampleWork','proofBatch','verifyTransfers','load','isrc','rightScope','participant','csv','continueToTestnet','resumeRun','retryRun','leaveMissingRun']){
    if($(id))$(id).disabled=locked;
  }
}
function showJourneyState(state) {
  recoveryState=state;
  const id=state.requestId;
  const messages={
    starting:'Starting this testnet payment…',checking:'Following this execution. No new payment is sent while checking.',
    complete:'Transfers verified. Open this run’s transaction on NEAR.',review:'This execution needs review. No automatic payment retry.',
    pending:'Execution not confirmed. Check this request before starting another.',
    'not-found':'This request was not found on this server. No payment is confirmed.',
    'storage-error':'The request reference could not be saved safely. No payment was sent.',
  };
  $('engineRunStatus').textContent=messages[state.kind]??'Checking this payment…';
  const recovery=['review','pending','not-found','storage-error'].includes(state.kind);
  $('runRecovery').hidden=!recovery;
  $('recoveryMessage').textContent=messages[state.kind]??'';
  $('recoveryId').textContent=id??'';
  $('resumeRun').hidden=!id||state.kind==='not-found';
  $('resumeRun').textContent=state.kind==='review'?'Inspect this execution':'Check this payment';
  $('retryRun').hidden=state.kind!=='not-found'||!references.read()?.template;
  $('leaveMissingRun').hidden=!['not-found','storage-error'].includes(state.kind);
  if(state.kind==='starting'||(state.kind==='checking'&&!state.run)){
    const result=calculateExample();
    if(result.valid)motion.live(motionSnapshot(result),{network:'testnet',status:'running',step:'checking',txs:[]});
    $('engineMotion').scrollIntoView({block:'center',behavior:'auto'});
  }
  if(recovery){
    motion.interrupt(messages[state.kind]);
    $('liveRunStatus').textContent=messages[state.kind];
  }
  simulationReady=false;
  updateLiveAvailability();
}
function updateLiveAvailability() {
  const info=cfg?.liveDemo,busy=liveBusy||launching;
  const ref=references.read(),pending=pendingReference();
  const resumeId=pending?.requestId??info?.activeRun?.requestId??(completedVisible&&ref?.status==='verified'?ref.requestId:null);
  const validFixed=fixedInputs();
  const canStart=Boolean(!configUnavailable&&info?.enabled&&!info.needsReview&&!info.activeRun&&info.remaining>0&&!pending&&validFixed&&!busy);
  $('liveRun').textContent=resumeId?(completedVisible?'View verified receipt':info?.needsReview?'Inspect interrupted run':'Resume testnet run'):'Distribute on testnet';
  $('liveRun').disabled=busy||(!resumeId&&!canStart)||!info?.enabled;
  $('lastRunButton').hidden=!(info?.enabled&&ref?.status==='verified')||completedVisible;
  $('lastRunButton').disabled=busy;
  $('historicalProofCard').hidden=Boolean(info?.enabled);
  if(info?.enabled)$('recordedCase').textContent='Inspect the execution.';
  $('liveMode').textContent=busy?'Following this execution…':info?.needsReview?'An interrupted execution needs review. Check its transactions; no new payment is started.':resumeId?'An existing request is ready to check. Resuming does not send another payment.':canStart?`New testnet transaction · project test token · ${info.remaining} runs remaining.`:info?.enabled&&!validFixed?'Edited values are simulation only. Restore the sample to run on testnet.':info?.enabled?'The local test budget is used up. Existing receipts remain available.':'Read-only mode. Simulate, then check a recorded testnet payment.';
  const recovering=['pending','review','not-found','storage-error'].includes(recoveryState?.kind);
  $('journeyNext').hidden=(!simulationReady&&!recovering)||busy;
  $('continueToTestnet').disabled=busy;
  $('continueToTestnet').textContent=!validFixed?'Restore sample →':resumeId?'Check existing test →':info?.enabled?'Distribute on testnet →':'Verify recorded payment →';
  $('journeyHint').textContent=!validFixed?'Your edited calculation is preserved above. Testnet uses the fixed sample.':info?.enabled?'The next step creates a test transaction with an explorer link.':'Read the actual transfer events from an earlier sample.';
  if(info?.enabled&&validFixed&&!resumeId&&!canStart){$('continueToTestnet').disabled=true;$('journeyHint').textContent=$('liveMode').textContent;}
  if(configUnavailable&&!recovering){$('continueToTestnet').textContent='Reconnect to testnet →';$('continueToTestnet').disabled=busy;$('journeyHint').textContent='Simulation is local. Reconnect before checking network evidence.';}
  if(configUnavailable)$('liveMode').textContent='Testnet configuration unavailable. Local simulation still works.';
  else if(!cfg)$('liveMode').textContent='Connecting to the demo…';
  if(recovering&&!simulationReady){
    $('continueToTestnet').disabled=busy;
    $('continueToTestnet').textContent=recoveryState.kind==='review'?'Inspect execution →':recoveryState.kind==='not-found'?(ref?.template?'Start saved request →':'Return to template →'):recoveryState.kind==='storage-error'?'Return to template →':'Check this request →';
    $('journeyHint').textContent=$('recoveryMessage').textContent;
  }
}
async function refreshLiveMode() {
  try{
    const response=await fetch('/api/config',{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Configuration unavailable.');
    const data=await response.json();
    if(!data?.registry||typeof data.liveDemo?.enabled!=='boolean')throw new Error('Invalid configuration.');
    cfg=data;configUnavailable=false;updateLiveAvailability();
  }catch{configUnavailable=true;throw new Error('Configuration unavailable.');}
}
controller=createRunController({references,renderRun:showLiveRun,
  requiresReview:()=>Boolean(cfg?.liveDemo?.needsReview&&!cfg.liveDemo.activeRun),
  onBusy:busy=>{liveBusy=busy;lockLiveControls(liveBusy||launching);updateLiveAvailability();},onState:showJourneyState,
});
async function launchRun(action='start',explicitId) {
  if(liveBusy||launching)return;
  launching=true;simulationReady=false;lockLiveControls(true);
  try{
    await refreshLiveMode();
    if(!cfg.liveDemo?.enabled)throw new Error('Read-only mode.');
    const ref=references.read(),pending=pendingReference(),existing=explicitId??pending?.requestId??cfg.liveDemo.activeRun?.requestId??(completedVisible&&ref?.status==='verified'?ref.requestId:null);
    if(action==='retry')await controller.retryPrepared();
    else if(action==='resume'||existing){
      const id=existing??ref?.requestId;
      if(!id)throw new Error('No saved execution.');
      restoreRunTemplate(ref?.requestId===id?ref.template:cfg.liveDemo.activeRun?.template);
      await controller.resume(id);
    }else{
      if(cfg.liveDemo.needsReview||cfg.liveDemo.remaining<1||!fixedInputs())throw new Error('Fixed sample unavailable.');
      await controller.start($('engineTerms').value);
    }
  }catch{
    showJourneyState({kind:'pending',requestId:references.read()?.requestId});
  }finally{
    let unavailable=false;
    try{await refreshLiveMode();}catch{cfg=null;unavailable=true;}
    launching=false;lockLiveControls(liveBusy);updateLiveAvailability();
    if(unavailable)$('liveMode').textContent='Configuration unavailable. Local simulation still works; check the saved request when the server returns.';
  }
}
$('liveRun').onclick=()=>launchRun();
$('resumeRun').onclick=()=>launchRun('resume',recoveryState?.requestId);
$('retryRun').onclick=()=>launchRun('retry');
$('lastRunButton').onclick=()=>launchRun('resume',references.read()?.requestId);
$('leaveMissingRun').onclick=()=>{
  if(liveBusy||launching||!['not-found','storage-error'].includes(recoveryState?.kind))return;
  if(references.forget(recoveryState.requestId).durable){recoveryState=null;$('runRecovery').hidden=true;setExample($('engineTerms').value==='publishing');}
  else $('recoveryMessage').textContent='The old bookmark could not be removed. Open the demo in a fresh tab before starting another request.';
};
$('continueToTestnet').onclick=()=>{
  if(liveBusy||launching)return;
  if(!simulationReady&&recoveryState?.kind==='review'){$('liveReceiptCard').open=true;$('liveReceiptCard').scrollIntoView({block:'start',behavior:'auto'});return;}
  if(!simulationReady&&recoveryState?.kind==='pending'){launchRun('resume',recoveryState.requestId);return;}
  if(!simulationReady&&recoveryState?.kind==='not-found'){if(references.read()?.template)launchRun('retry');else $('leaveMissingRun').click();return;}
  if(!simulationReady&&recoveryState?.kind==='storage-error'){$('leaveMissingRun').click();return;}
  if(configUnavailable){refreshLiveMode().catch(()=>updateLiveAvailability());return;}
  if(!fixedInputs()){setExample($('engineTerms').value==='publishing');runSample();}
  else if(cfg?.liveDemo?.enabled)launchRun();
  else{$('historicalProofCard').scrollIntoView({block:'center',behavior:'auto'});verifyRecordedPayment();}
};
$('proofBatch').onchange=()=>{if(!liveBusy&&!launching)setExample($('proofBatch').value==='e1');};
setExample(false,{internal:true});
(async()=>{
  try{
    await refreshLiveMode();
    const ref=references.read(),id=references.urlId()??(ref?.status!=='verified'?ref?.requestId:null)??cfg.liveDemo?.activeRun?.requestId;
    if(id&&cfg.liveDemo?.enabled)await launchRun('resume',id);
  }catch{
    cfg=null;updateLiveAvailability();$('liveMode').textContent='Testnet configuration unavailable. Local simulation still works.';
  }
})();


$('networkJump').onclick=()=>{$('networkPortal').open=true;};
$('networkPortal').addEventListener('toggle',async()=>{
  if(!$('networkPortal').open||$('solanaNetworkLink').getAttribute('href'))return;
  try{
    const response=await fetch('/evidence/solana-reference.json',{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Reference unavailable.');
    const reference=await response.json();
    if(reference.chain!=='solana'||reference.network!=='devnet'||!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(reference.signature))throw new Error('Unexpected reference.');
    const checked=reference.liveCheck?.available&&reference.liveCheck.matched;
    $('solanaNetworkStatus').textContent=checked?`Rechecked ${reference.liveCheck.checkedAt.slice(0,10)} · 2.00 → 1.00 / 0.70 / 0.30 test tokens.`:'Historical reference; current network recheck unavailable.';
    $('solanaNetworkLink').href=`https://explorer.solana.com/tx/${encodeURIComponent(reference.signature)}?cluster=devnet`;
    $('solanaNetworkLink').hidden=false;
  }catch{$('solanaNetworkStatus').textContent='Reference unavailable. The current NEAR payment remains independent.';}
});
