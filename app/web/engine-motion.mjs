// The site's HowPlayer uses a scene clock and smoothstep windows. Here the same
// motion language follows calculation snapshots or observed testnet events.
import { formatTestUsdc } from '../statement.mjs';

export const SIMULATION_DURATION = 6800;
const clamp = (n) => Math.max(0, Math.min(1, n));
const ease = (n) => { const p = clamp(n); return p * p * (3 - 2 * p); };
export function simulationFrame(elapsed) {
  const p = clamp(elapsed / SIMULATION_DURATION);
  return {
    stage: p < .19 ? 0 : p < .43 ? 1 : p < .88 ? 2 : 3,
    inlet: ease((p - .19) / .2),
    branches: [0, 1, 2].map(i => ease((p - .43 - i * .075) / .22)),
    complete: p >= 1,
  };
}

// A Paid batch or a submitted hash is insufficient to mark recipients as paid.
export function visualAmount(value) {
  const exact = formatTestUsdc(value);
  const amount = BigInt(value);
  for (const [unit,suffix] of [[1000000000000000000n,'T'],[1000000000000000n,'B'],[1000000000000n,'M']]) {
    if (amount >= unit) {
      const hundredths = amount * 100n / unit;
      return {text:`${hundredths / 100n}.${String(hundredths % 100n).padStart(2,'0')}${suffix}`,exact,abbreviated:true};
    }
  }
  return {text:exact,exact,abbreviated:false};
}
export function liveFrame(run, expectedParts, context) {
  const txs = Array.isArray(run.txs) ? run.txs : [];
  const sent = step => txs.some(tx => tx?.step === step && typeof tx.hash === 'string' && tx.hash.length > 0);
  const proof = run.proof;
  const validRows = Array.isArray(proof?.rows) && proof.rows.length === 3 && proof.rows.every(r =>
    r && r.matched && typeof r.actual === 'string' && /^\d+$/.test(r.actual) && r.actual === r.expected);
  const boundContext = !context || (run.network === 'testnet' && proof?.contract === context.contract
    && proof.assetContract === context.assetContract && proof.tokenId === context.tokenId && run.amount === context.amount
    && validRows && proof.rows.every((r,i) => r.account === context.accounts[i])
    && (!context.batchIds || context.batchIds.includes(run.batchId)));
  const verified = run.status === 'verified' && proof?.matched === true
    && ['transaction','receipt','amounts','total','recipients'].every(key => proof.checks?.[key] === true)
    && typeof run.amount === 'string' && /^[1-9]\d*$/.test(run.amount) && proof.amount === run.amount
    && proof.batchId === run.batchId && proof.tx === txs.find(tx => tx.step === 'distributing')?.hash
    && validRows && proof.rows.reduce((sum,r) => sum + BigInt(r.actual),0n) === BigInt(run.amount)
    && (!expectedParts || proof.rows.every((r,i) => r.actual === String(expectedParts[i]))) && boundContext;
  const funded = sent('funding-invoice');
  const approved = sent('approving-sample');
  const distributed = sent('distributing');
  const stage = verified ? 4 : ({checking:0,reserving:1,'funding-test-payer':1,'funding-invoice':1,'approving-sample':2,distributing:3,verifying:4}[run.step] ?? 0);
  return {stage,verified,interrupted:run.status === 'needs-review',funded,approved,distributed,
    completed:[run.step !== 'checking',funded,approved,distributed,verified],
    hash: txs.at(-1)?.hash ?? null};
}

const simulationTitles = ['Start with the people on the track.','Apply their agreed shares.','Split the payment.','The split is ready.'];
const liveTitles = ['Checking the agreed shares.','Preparing this payment on NEAR.','Approving this payment.','Sending the three shares.','Verifying what arrived.'];
const displayRole = name => name === 'Beatmaker' ? 'Producer' : name;

export function createEngineMotion(root, {onSimulationEnd = () => {}, expectedContext = () => null} = {}) {
  const el = name => root.querySelector(`[data-motion="${name}"]`);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let snapshot, mode = 'ready', elapsed = 0, started = 0, raf = 0, paused = false;
  let lastStage = -1, simulationEnded = false;
  const recipients = [...root.querySelectorAll('[data-recipient]')];
  const labels = () => mode === 'live' ? ['Check','Fund','Approve','Send','Verify'] : ['Track','Agreement','Split','Result'];
  const stopClock = () => { cancelAnimationFrame(raf); raf = 0; };
  function money(node, amount) {
    const value = visualAmount(amount);
    node.textContent = value.text;
    node.title = `${value.exact} test USDC`;
    node.setAttribute('aria-label',`${value.exact} test USDC`);
    node.style.setProperty('--digits',value.text.length);
  }

  function steps() {
    el('steps').replaceChildren(...labels().map((label, i) => {
      const li = document.createElement('li');
      const button = document.createElement('button'); button.type = 'button';
      const number = document.createElement('span'); number.textContent = String(i + 1).padStart(2,'0');
      button.append(number, document.createTextNode(label));
      button.disabled = mode !== 'simulation';
      button.onclick = () => {
        stopClock(); paused = true;
        elapsed = [0, .22, .55, 1][i] * SIMULATION_DURATION;
        renderSimulation(); syncControls();
      };
      li.append(button); return li;
    }));
  }
  function stage(index, complete = []) {
    [...el('steps').children].forEach((li, i) => {
      li.dataset.done = String(Boolean(complete[i]));
      li.querySelector('button').toggleAttribute('aria-current', i === index);
      if (i === index) li.querySelector('button').setAttribute('aria-current','step');
    });
    el('position').textContent = `${String(index + 1).padStart(2,'0')} / ${String(labels().length).padStart(2,'0')}`;
    if (index !== lastStage) { root.dataset.stage = String(index); lastStage = index; }
  }
  function draw(inlet, branches, received = false) {
    root.style.setProperty('--inlet', inlet);
    recipients.forEach((item, i) => {
      const hasAmount = snapshot && snapshot.parts[i] > 0n;
      root.style.setProperty(`--branch-${i}`, hasAmount ? branches[i] : 0);
      item.dataset.arrived = String(Boolean(received && hasAmount && branches[i] >= .995));
      item.dataset.calculated = String(Boolean(mode === 'simulation' && hasAmount && branches[i] >= .995));
      if (!snapshot || (mode === 'simulation' && branches[i] < .995)) { const cash=item.querySelector('[data-cash]');cash.textContent='—';cash.removeAttribute('title');cash.removeAttribute('aria-label');cash.style.removeProperty('--digits'); }
      else money(item.querySelector('[data-cash]'),snapshot.parts[i]);
      item.querySelector('[data-cash-label]').textContent = received ? 'Received' : mode === 'simulation' ? 'Calculated' : 'Expected';
    });
    // Use the existing 24-frame USDC render; no 3D runtime in the page.
    const frame = Math.min(23, Math.floor(inlet * 23));
    el('coin').style.backgroundPosition = `${(frame % 6) * 20}% ${Math.floor(frame / 6) * (100 / 3)}%`;
  }
  function fill(data) {
    snapshot = data;
    el('code').textContent = `${data.identifier} · ${data.code}`;
    money(el('amount'),data.amount);
    el('agreement').textContent = data.rows.map(row=>`${row.bps / 100}% ${displayRole(row.key)}`).join(' · ');
    el('formula').textContent = 'Applied automatically to this payment.';
    recipients.forEach((item, i) => {
      item.querySelector('[data-role]').textContent = displayRole(data.rows[i].key);
      item.querySelector('[data-share]').textContent = `${data.rows[i].bps / 100}%`;
    });
  }
  function syncControls() {
    el('pause').hidden = mode !== 'simulation' || elapsed >= SIMULATION_DURATION || reduce.matches;
    el('pause').textContent = paused ? 'Play' : 'Pause';
    el('pause').setAttribute('aria-pressed', String(paused));
    el('replay').hidden = mode !== 'simulation';
  }
  function renderSimulation() {
    const frame = simulationFrame(elapsed);
    stage(frame.stage, labels().map((_, i) => i < frame.stage || frame.complete));
    el('title').textContent = simulationTitles[frame.stage];
    el('description').textContent = [
      `This sample payment belongs to the ${snapshot.rows.map(r => displayRole(r.key).toLowerCase()).join(', ')}.`,
      `The agreement sets each share. The ${snapshot.identifier === 'ISRC' ? 'recording' : 'composition'} code identifies the ${snapshot.identifier === 'ISRC' ? 'track' : 'work'}.`,
      'Each recipient gets the agreed amount. Rounding leaves nothing unassigned.',
      'Nothing has moved yet. Send the sample on NEAR testnet to get a verifiable receipt.',
    ][frame.stage];
    el('motor-label').textContent = frame.stage < 2 ? 'Agreed allocation' : 'Split calculated';
    draw(frame.inlet, frame.branches);
    root.dataset.complete = String(frame.stage === 3);
    el('receipt').hidden = frame.stage !== 3;
    el('receipt-status').textContent = 'SIMULATION · NO TRANSFER';
    el('receipt-value').textContent = `${visualAmount(snapshot.amount).text} allocated · ${snapshot.parts.filter(p=>p>0n).length} shares`;
    el('note').textContent = visualAmount(snapshot.amount).abbreviated ? 'Display abbreviated · exact amounts in allocation details. No transfer.' : 'Local calculation · no wallet, no transfer.';
    el('tx').hidden = true;
    syncControls();
    if (frame.complete && !simulationEnded) { simulationEnded = true; onSimulationEnd(); }
  }
  function tick(now) {
    raf = 0;
    if (paused || mode !== 'simulation') return;
    elapsed = Math.min(SIMULATION_DURATION, now - started);
    renderSimulation();
    if (elapsed < SIMULATION_DURATION) raf = requestAnimationFrame(tick);
  }
  function simulate(data) {
    stopClock(); mode = 'simulation'; simulationEnded = false; lastStage = -1; paused = false; elapsed = reduce.matches ? SIMULATION_DURATION : 0;
    root.dataset.mode = mode; fill(data); steps();
    el('mode').textContent = 'Simulation';
    el('note').textContent = 'Local calculation · no wallet, no transfer.';
    renderSimulation(); started = performance.now();
    if (!reduce.matches) raf = requestAnimationFrame(tick);
  }
  function live(data, run) {
    stopClock();
    if (mode !== 'live') { mode = 'live'; root.dataset.mode = mode; lastStage = -1; steps(); }
    fill(data);
    const frame = liveFrame(run, data.parts, expectedContext(run.template,run));
    stage(frame.stage, frame.completed); syncControls();
    el('mode').textContent = frame.interrupted ? 'Needs review' : frame.verified ? 'Verified on NEAR' : 'NEAR testnet · live';
    el('title').textContent = frame.interrupted ? 'Payment needs review.' : frame.verified ? 'All three shares arrived.' : liveTitles[frame.stage];
    const descriptions = {
      checking:'Checking the deployed contract and the three confirmed participants.',
      reserving:'Binding one invoice to its payer, amount and participant agreement.',
      'funding-test-payer':'Preparing valueless test tokens for the sample payer.',
      'funding-invoice':'Moving the test payment into its reserved invoice.',
      'approving-sample':'The operator approves this fixed test invoice.',
      distributing:'The contract schedules the three transfers. Receipt verification follows.',
      verifying:'Reading the token-transfer events and comparing every recipient’s amount.',
    };
    el('description').textContent = frame.interrupted ? 'No automatic retry. Inspect the saved transactions before paying again.' : frame.verified ? 'Each transfer matches this payment. Open the receipt to check it on NEAR.' : (descriptions[run.step] ?? 'Waiting for the saved execution status.');
    el('motor-label').textContent = frame.verified ? 'Transfers verified' : frame.approved ? 'Payment approved' : 'Agreed allocation';
    draw(frame.funded ? 1 : 0, [0,1,2].map(() => frame.verified ? 1 : 0), frame.verified);
    root.dataset.sending = String(!frame.interrupted && !frame.verified && (run.step === 'distributing' || run.step === 'verifying'));
    root.dataset.complete = String(frame.verified);
    el('receipt').hidden = !frame.verified;
    el('receipt-status').textContent = 'TRANSFER EVENTS VERIFIED';
    el('receipt-value').textContent = `${formatTestUsdc(data.amount)} received · 3 recipients`;
    const hash = frame.verified ? run.proof.tx : frame.hash;
    el('tx').hidden = !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash??'');
    if (hash && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash)) {
      el('tx-link').href = `https://testnet.nearblocks.io/txns/${encodeURIComponent(hash)}`;
      el('tx-link').textContent = frame.verified ? 'Open this payment on NEAR ↗' : 'Inspect the latest confirmed transaction ↗';
      el('hash').textContent = hash;
    }
    el('note').textContent = 'Live status from this run · test tokens have no monetary value.';
  }
  function reset(template) {
    stopClock(); mode = 'ready'; snapshot = undefined; lastStage = -1; paused = false;
    root.dataset.mode = mode; root.dataset.complete = 'false'; root.dataset.sending = 'false';
    el('mode').textContent = 'Ready to run'; el('title').textContent = 'Follow the payment.';
    el('description').textContent = 'Start with a simulation. Then run a real testnet distribution.';
    el('code').textContent = `${template.identifier} · ${template.code}`; el('amount').textContent = template.amount; el('amount').removeAttribute('title'); el('amount').removeAttribute('aria-label'); el('amount').style.removeProperty('--digits');
    el('agreement').textContent = [template.id === 'master'?'Label':'Publisher',...template.roles].map(displayRole).join(' · '); el('formula').textContent = 'One agreement, applied to every payment.';
    el('motor-label').textContent = 'Agreed shares';
    recipients.forEach((item,i) => { item.querySelector('[data-role]').textContent = displayRole([template.id === 'master'?'Label':'Publisher',...template.roles][i]); item.querySelector('[data-share]').textContent = '—'; });
    steps(); stage(0); draw(0,[0,0,0]); syncControls();
    el('receipt').hidden = true; el('tx').hidden = true;
    el('note').textContent = 'Simulation explains the split. Testnet provides the proof.';
  }
  el('pause').onclick = () => {
    if (mode !== 'simulation') return;
    paused = !paused;
    if (paused) stopClock(); else { started = performance.now() - elapsed; raf = requestAnimationFrame(tick); }
    syncControls();
  };
  el('replay').onclick = () => { if (snapshot && mode === 'simulation') simulate(snapshot); };
  reduce.addEventListener('change', () => { if (mode === 'simulation' && reduce.matches) { stopClock(); elapsed = SIMULATION_DURATION; renderSimulation(); } });
  return {simulate,live,reset,cancel:stopClock, interrupt(message) {
    stopClock(); root.dataset.sending = 'false'; root.dataset.complete = 'false'; el('motor-label').textContent='Outcome unconfirmed'; recipients.forEach((item,i)=>{root.style.setProperty(`--branch-${i}`,0);item.dataset.arrived='false';}); el('mode').textContent = 'Awaiting confirmation'; el('title').textContent = 'Keep this payment open.';
    el('description').textContent = message; el('receipt').hidden = true; recipients.forEach(item => item.querySelector('[data-cash-label]').textContent = 'Expected');
  }};
}
