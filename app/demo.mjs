// Demo v2 na TESTNET: um token por direito, fórmula de duas camadas, mesma ficha do catálogo da BLVCK MINDZ.
//   terms → register → confirm → pay → gate → distribute → csv     (ou `all`)
// Dados: fixtures/demo-ledger-v2.csv (AMOSTRA, valores fictícios). Contrato-modelo: PARÂMETROS DE TESTE.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { actions } from 'near-api-js';
import {
  ROOT, TGAS, account, accLink, batchSummary, loadState, near, readLedger, receipt, saveState, splitAmount, txLink, usdc, view,
} from './lib.mjs';
import { relay, signConfirm } from './relay.mjs';
import { csvLine } from './csv.mjs';
import { expectedReceiptReference } from './statement.mjs';
import { validateBatch, gateAction } from './batch-policy.mjs';

const ISRC = 'PYXXX2600001';
const ISWC = 'T0000000001';
const TERMS = { version: 'teste-2026-10-14', master_bps: 4000, performance_bps: 2500, mechanical_bps: 2500, test_only: true };
const LEDGER = join(ROOT, 'fixtures', 'demo-ledger-v2.csv');
const BATCHES = [
  { id: 'm1', code: ISRC, right: 'master' },
  { id: 'e1', code: ISWC, right: 'publishing_performance' },
];

const state = loadState();
const A = state.accounts;
if (!A.registry_v1) throw new Error('rode antes: npm run setup:v2');
const REG = A.registry;
const step = process.argv[2] ?? 'all';
const log = (...x) => console.log(...x);
const call = (who, contractId, methodName, args, gas, deposit = 0n) =>
  account(state, who).signAndSendTransaction({ receiverId: contractId, actions: [actions.functionCall(methodName, args, gas, deposit)] });
const pct = (bps) => `${bps / 100}%`;

// Cada transação da demo vira uma afirmação em evidence/claims.json, que o `npm run verify` confere sozinho.
const CLAIMS = join(ROOT, 'evidence', 'claims.json');
const evidence = existsSync(CLAIMS) ? JSON.parse(readFileSync(CLAIMS, 'utf8')) : null;
const claims = evidence?.contract === REG ? evidence : { _about: 'Gerado pela demo: cada afirmação ligada à transação que a prova. Conferido por app/verify.mjs. Testnet, dados de amostra.', network: 'testnet', contract: REG, label: A.root, claims: [] };
function claim(id, text, r, signer, expect) {
  const tx = r?.transaction?.hash ?? r?.transaction_outcome?.id;
  if (!tx) return;
  claims.claims = claims.claims.filter((c) => c.id !== id).concat({ id, claim: text, tx, signer, expect });
  writeFileSync(CLAIMS, JSON.stringify(claims, null, 2) + '\n');
}

async function terms() {
  const existing = await view(REG, 'get_terms', { version: TERMS.version });
  if (existing) {
    const same = ['master_bps', 'performance_bps', 'mechanical_bps', 'test_only'].every((k) => existing[k] === TERMS[k]);
    if (!same) throw new Error(`o contrato-modelo ${TERMS.version} já existe com outros valores: use um contrato novo (npm run setup -- --force)`);
  }
  const r = await call(A.root, REG, 'set_terms', { terms: TERMS }, 30n * TGAS);
  claim('terms', 'O selo publicou o contrato-modelo de TESTE (master D=40%, autoral D=25%)', r, A.root, { success: true, event: 'terms_published' });
  log(`1. contrato-modelo publicado [PARÂMETROS DE TESTE]: master D=${pct(TERMS.master_bps)}, autoral D=${pct(TERMS.performance_bps)}`);
  return r;
}

async function register() {
  const w = await call(A.root, REG, 'register_work', {
    iswc: ISWC,
    title: 'Faixa de amostra',
    writers: [
      { account_id: A.mc, role: 'letra', weight: 6000 },
      { account_id: A.beat, role: 'melodia', weight: 4000 },
    ],
    terms_version: TERMS.version,
  }, 80n * TGAS);
  const r = await call(A.root, REG, 'register_recording', {
    isrc: ISRC,
    title: 'Faixa de amostra',
    artists: [
      { account_id: A.mc, role: 'intérprete', weight: 7000 },
      { account_id: A.beat, role: 'produtor musical', weight: 3000 },
    ],
    terms_version: TERMS.version,
    iswc: ISWC,
  }, 80n * TGAS);
  claim('register_work', 'A composição (ISWC) foi registrada e virou dois tokens autorais', w, A.root, { success: true, event: 'nft_mint' });
  claim('register', 'A gravação (ISRC) foi registrada e virou dois tokens (master e conexo de produtor)', r, A.root, { success: true, event: 'nft_mint' });
  log('2. formulário enviado; o CONTRATO calculou os pontos-base de cada direito:');
  for (const right of await view(REG, 'get_rights', { code: ISRC })) {
    log(`   ${right.token_id.padEnd(36)} ${right.holders.map((h) => `${h.role} ${pct(h.bps)}`).join(' · ')}`);
  }
  return r;
}

async function confirm() {
  for (const who of [A.mc, A.beat]) {
    for (const code of [ISWC, ISRC]) {
      const { res } = await relay(state, await signConfirm(state, who, { code }));
      log(`3. ${who} confirmou em ${code} SEM gas (o selo pagou):`, txLink(res));
      const name = who === A.mc ? 'mc' : 'beat';
      claim(`confirm_${name}_${code === ISRC ? 'isrc' : 'iswc'}`, `${name === 'mc' ? 'O MC' : 'O beatmaker'} confirmou ${code === ISRC ? 'a gravação' : 'a composição'} e o gas foi pago pelo selo`, res, A.root, { success: true, event: 'share_confirmed', gasless_for: who });
    }
  }
}

async function pay() {
  const rows = readLedger(LEDGER);
  let last;
  for (const b of BATCHES) {
    const { amount, ledgerHash } = batchSummary(rows, b.id, b.code, b.right);
    if (!(await view(REG, 'get_batch', { batch_id: b.id }))) {
      await call(A.root, REG, 'reserve_batch', { batch_id: b.id, token_id: `${b.code}:${b.right}`, payer_id: A.distribuidora, amount: amount.toString(), ledger_hash: ledgerHash }, 50n * TGAS, near(0.05));
    }
    const reservation = await view(REG, 'get_batch', { batch_id: b.id });
    const status = validateBatch(reservation, { id: b.id, payer: A.distribuidora, tokenId: `${b.code}:${b.right}`, hash: ledgerHash, amount });
    if (['Funded', 'Approved', 'Paid'].includes(status)) { log(`4. ${b.id}: fatura já processada (${status}).`); continue; }
    if (status !== 'Reserved') throw new Error(`reserva ${b.id} não pode ser paga (${status})`);
    if (A.token === A.usdc) await call(A.distribuidora, A.token, 'faucet', { amount: amount.toString() }, 30n * TGAS);
    last = await call(A.distribuidora, A.token, 'ft_transfer_call', {
      receiver_id: REG,
      amount: amount.toString(),
      msg: JSON.stringify({ token_id: `${b.code}:${b.right}`, batch_id: b.id, ledger_hash: ledgerHash }),
    }, 100n * TGAS, 1n);
    const funded = await view(REG, 'get_batch', { batch_id: b.id });
    if (validateBatch(funded, { id: b.id, payer: A.distribuidora, tokenId: `${b.code}:${b.right}`, hash: ledgerHash, amount }) !== 'Funded') throw new Error(`fatura ${b.id} não foi financiada; confira a devolução do token`);
    log(`4. fatura ${b.id} paga: ${usdc(amount)} USDC para ${b.code}:${b.right}`, txLink(last));
    claim(`pay_${b.id}`, `A distribuidora pagou ${usdc(amount)} USDC de teste na fatura ${b.code}:${b.right}`, last, A.distribuidora, { success: true, event: 'batch_funded' });
  }
  return undefined;
}

/** Regras fixas que qualquer um confere; a aprovação vale só para o hash recalculado. Sem --approve, nada é aprovado. */
async function gate() {
  const rows = readLedger(LEDGER);
  for (const b of BATCHES) {
    const { amount, ledgerHash } = batchSummary(rows, b.id, b.code, b.right);
    const batch = await view(REG, 'get_batch', { batch_id: b.id });
    const right = await view(REG, 'get_right', { token_id: `${b.code}:${b.right}` });
    const status = validateBatch(batch, { id: b.id, payer: A.distribuidora, tokenId: `${b.code}:${b.right}`, hash: ledgerHash, amount });
    if (gateAction(status) === 'already-processed') {
      log(`5. ${b.id}: já passou pelo portão (status ${batch.status}).`);
      continue;
    }
    const checks = [
      ['lote recebido e aguardando', batch?.status === 'Funded'],
      ['hash recalculado do ledger = hash pago', batch?.ledger_hash === ledgerHash],
      ['valor pago = total do ledger', BigInt(batch?.amount ?? -1) === amount],
      ['direito do lote = direito do ledger', batch?.token_id === `${b.code}:${b.right}`],
      ['todos os titulares confirmaram', right?.holders.every((h) => h.confirmed)],
      ['divisão soma 10.000 bps', right?.holders.reduce((s, h) => s + h.bps, 0) === 10000],
    ];
    for (const [name, ok] of checks) log(`5. ${b.id} [${ok ? 'ok' : 'FALHOU'}] ${name}`);
    if (!checks.every(([, ok]) => ok)) throw new Error(`portão reteve o lote ${b.id}`);
    if (!process.argv.includes('--approve')) {
      log(`5. ${b.id}: regras ok. Falta a aprovação humana: npm run demo -- gate --approve`);
      continue;
    }
    const r = await call(A.gate, REG, 'approve_batch', { batch_id: b.id, ledger_hash: ledgerHash }, 30n * TGAS);
    log(`5. ${b.id}: portão aprovou SÓ o hash ${ledgerHash.slice(0, 16)}…`, txLink(r));
    claim(`gate_${b.id}`, `O portão aprovou só o hash do lote ${b.id}`, r, A.gate, { success: true, event: 'batch_approved' });
  }
}

async function distribute() {
  for (const b of BATCHES) {
    const r = await call(A.root, REG, 'distribute', { batch_id: b.id }, 200n * TGAS);
    const batch = await view(REG, 'get_batch', { batch_id: b.id });
    log(`6. ${b.id} repassado. Recibo: ${receipt(b.id, batch.ledger_hash)}`, txLink(r));
    claim(`pay_out_${b.id}`, `O lote ${b.id} foi dividido e ficou o recibo BMZ1:${b.id}`, r, A.root, { success: true, event: 'receipt', batch: b.id });
  }
}

async function csv() {
  const rights = await view(REG, 'get_rights', { code: ISRC });
  const batches = (await Promise.all(BATCHES.map((b) => view(REG, 'get_batch', { batch_id: b.id })))).filter(Boolean);
  const lines = ['lote,direito,status,titular,papel,bps,valor_previsto_usdc,contrato_modelo,referencia_calculada_nao_verificada'];
  for (const b of batches) {
    const r = rights.find((x) => x.token_id === b.token_id);
    if (!r) continue;
    const ri = Math.max(0, r.holders.findIndex((h) => h.account_id === A.root));
    const shares = splitAmount(BigInt(b.amount), r.holders.map((h) => h.bps), ri);
    r.holders.forEach((h, i) =>
      lines.push(csvLine([b.batch_id, b.token_id, b.status, h.account_id, h.role, h.bps, usdc(shares[i]),
        `${r.terms_version}${r.test_terms ? ' (teste)' : ''}`, expectedReceiptReference(b)])),
    );
  }
  const out = join(ROOT, 'app', 'extrato.csv');
  writeFileSync(out, lines.join('\n') + '\n');
  log('7. extrato para o contador:', out);
  for (const who of [A.mc, A.beat, A.root]) {
    log(`   saldo ${who}: ${usdc(await view(A.token, 'ft_balance_of', { account_id: who }))} USDC`);
  }
  log('   contrato:', accLink(REG));
}

const steps = { terms, register, confirm, pay, gate, distribute, csv };
// Proteções do contrato que significam "este passo já foi feito": a demo segue em vez de parar.
const DONE = /versão já publicada|direito já registrado|nada a confirmar|lote já recebido|não está aguardando|já pago/;
const run = async (name) => {
  let r;
  try {
    r = await steps[name]();
  } catch (e) {
    const msg = e?.panicMessage ?? e?.message ?? String(e);
    if (!DONE.test(msg)) throw e;
    log(`   (${name}: já feito antes — o contrato recusou repetir: "${msg}")`);
    return;
  }
  if (r?.transaction || r?.transaction_outcome) log('   tx:', txLink(r));
};
if (step === 'all') {
  for (const s of ['terms', 'register', 'confirm', 'pay', 'gate']) await run(s);
  if (process.argv.includes('--approve')) {
    await run('distribute');
    await run('csv');
  } else {
    log('Demonstração pausada antes da aprovação e distribuição. Revise o lote e use gate --approve.');
  }
} else if (steps[step]) {
  await run(step);
} else {
  console.error(`passo desconhecido: ${step}. Use: ${Object.keys(steps).join(' | ')} | all`);
  process.exit(1);
}
saveState(state);
