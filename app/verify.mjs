// Verificador independente: não usa nenhuma chave e não confia na saída da demo.
// Busca cada transação de evidence/claims.json na rede, lê os eventos e confere:
//   1. cada afirmação (sucesso ou recusa esperada, evento emitido, quem pagou o gas);
//   2. o hash de cada lote, recalculado aqui a partir do ledger de amostra;
//   3. os pontos-base de cada direito, recalculados aqui pela fórmula do selo;
//   4. o valor que cada titular recebeu, lido dos eventos ft_transfer do token.
// Gera evidence/PROVAS.md e evidence/provas.json. Sai com código 1 se qualquer conferência falhar.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, RPC_URL, EXPLORER, batchSummary, readLedger, receipt, splitAmount, view } from './lib.mjs';

const C = JSON.parse(readFileSync(join(ROOT, 'evidence', 'claims.json'), 'utf8'));
// Ataques gravados por `npm run attacks`: cada um vira uma conferência de recusa (ou de devolução).
const ATTACKS = existsSync(join(ROOT, 'evidence', 'attacks.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'evidence', 'attacks.json'), 'utf8')).attacks.filter((a) => a.tx)
  : [];
const REG = C.contract;
const LEDGER = join(ROOT, 'fixtures', 'demo-ledger-v2.csv');
const results = [];
let failed = 0;

function record(group, name, ok, detail, link) {
  results.push({ group, name, ok, detail, link });
  if (!ok) failed++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} [${group}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function rpc(method, params) {
  const endpoint = method === 'EXPERIMENTAL_tx_status' ? (process.env.NEAR_ARCHIVAL_RPC_URL ?? 'https://archival-rpc.testnet.near.org') : RPC_URL;
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'v', method, params }),
  }).then((x) => x.json());
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.result;
}

const txCache = new Map();
async function tx(hash, signer) {
  if (!txCache.has(hash)) {
    txCache.set(hash, await rpc('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: signer, wait_until: 'FINAL' }));
  }
  return txCache.get(hash);
}

const events = (t) =>
  t.receipts_outcome.flatMap((o) =>
    o.outcome.logs
      .filter((l) => l.startsWith('EVENT_JSON:'))
      .map((l) => ({ executor: o.outcome.executor_id, ...JSON.parse(l.slice(11)) })),
  );

// ---- 1. afirmações ligadas a transações ----
for (const c of C.claims) {
  const link = `${EXPLORER}/txns/${c.tx}`;
  try {
    const t = await tx(c.tx, c.signer);
    const success = 'SuccessValue' in t.status;
    const ev = events(t);
    const problems = [];
    if (success !== c.expect.success) problems.push(`esperava ${c.expect.success ? 'sucesso' : 'recusa'}`);
    if (c.expect.event && !ev.some((e) => e.event === c.expect.event)) problems.push(`sem evento ${c.expect.event}`);
    if (c.expect.panic && !JSON.stringify(t.receipts_outcome).includes(c.expect.panic)) problems.push(`sem a recusa "${c.expect.panic}"`);
    if (c.expect.gasless_for) {
      const r = t.receipts.find((x) => x.receiver_id === REG);
      if (t.transaction.signer_id === c.expect.gasless_for) problems.push('o titular assinou e pagou o gas');
      if (r?.predecessor_id !== c.expect.gasless_for) problems.push(`o contrato não viu ${c.expect.gasless_for} como autor`);
    }
    if (c.expect.batch) {
      const b = await view(REG, 'get_batch', { batch_id: c.expect.batch });
      const want = receipt(c.expect.batch, b.ledger_hash);
      if (!ev.some((e) => e.event === 'receipt' && e.data[0].receipt === want)) problems.push(`recibo ${want} não encontrado`);
    }
    const detail = c.expect.gasless_for
      ? `gas pago por ${t.transaction.signer_id}, ação feita como ${c.expect.gasless_for}`
      : c.expect.panic ? `recusado: "${c.expect.panic}"` : (c.expect.event ?? '');
    record('transações', c.claim, problems.length === 0, problems.join('; ') || detail, link);
  } catch (e) {
    record('transações', c.claim, false, String(e.message ?? e).slice(0, 160), link);
  }
}

// ---- 1b. ataques: a rede precisa ter recusado (ou devolvido o dinheiro) ----
for (const a of ATTACKS) {
  const link = `${EXPLORER}/txns/${a.tx}`;
  try {
    const t = await tx(a.tx, a.signer);
    const all = JSON.stringify(t.receipts_outcome);
    let ok;
    let detail;
    if (a.expect.refund) {
      const refunded = events(t).some((e) => e.event === 'ft_transfer' && e.data.some((d) => d.old_owner_id === REG && d.new_owner_id === a.signer));
      ok = all.includes(a.expect.panic) && refunded;
      detail = `contrato recusou "${a.expect.panic}"; o token devolveu ao pagador`;
    } else {
      // Recusa = o recibo executado NO CONTRATO falhou com a mensagem esperada. Numa meta-transação a
      // transação de fora aparece como sucesso; o que conta é o recibo de dentro.
      ok = t.receipts_outcome.some((o) => o.outcome.executor_id === REG && o.outcome.status.Failure && JSON.stringify(o.outcome.status).includes(a.expect.panic));
      detail = `recusado: "${a.expect.panic}"`;
    }
    record('ataques', a.claim, ok, detail, link);
  } catch (e) {
    record('ataques', a.claim, false, String(e.message ?? e).slice(0, 160), link);
  }
}

// ---- 2. hashes dos lotes recalculados do ledger ----
const rows = readLedger(LEDGER);
const BATCHES = [
  { id: 'm1', code: 'PYXXX2600001', right: 'master', payout: 'pay_out_m1' },
  { id: 'e1', code: 'T0000000001', right: 'publishing_performance', payout: 'pay_out_e1' },
];
for (const b of BATCHES) {
  const { amount, ledgerHash } = batchSummary(rows, b.id, b.code, b.right);
  const onchain = await view(REG, 'get_batch', { batch_id: b.id });
  record('lotes', `${b.id}: hash recalculado do ledger = hash na rede`, onchain.ledger_hash === ledgerHash, ledgerHash);
  record('lotes', `${b.id}: valor do ledger = valor pago`, BigInt(onchain.amount) === amount, `${amount} micro-USDC`);
  record('lotes', `${b.id}: status final`, onchain.status === 'Paid', onchain.status);
}

// ---- 3. pontos-base recalculados pela fórmula de duas camadas ----
function composeRight(eas, deal, side) {
  const pool = 10000 - deal;
  const raw = side.map(([k, w], i) => ({ i, k, floor: Math.floor((pool * w) / 10000), rest: (pool * w) % 10000 }));
  let left = pool - raw.reduce((a, r) => a + r.floor, 0);
  for (const r of [...raw].sort((a, b) => b.rest - a.rest || a.i - b.i)) {
    if (!left) break;
    r.floor++;
    left--;
  }
  return [...(deal ? [[eas, deal]] : []), ...raw.map((r) => [r.k, r.floor])];
}
const terms = await view(REG, 'get_terms', { version: 'teste-2026-10-14' });
record('fórmula', 'contrato-modelo marcado como teste', terms?.test_only === true, `master ${terms.master_bps} · autoral ${terms.performance_bps} bps`);
const mc = `mc.${C.label}`;
const beat = `beat.${C.label}`;
const FORMS = {
  'PYXXX2600001:master': [terms.master_bps, [[mc, 7000], [beat, 3000]]],
  'T0000000001:publishing_performance': [terms.performance_bps, [[mc, 6000], [beat, 4000]]],
  'T0000000001:publishing_mechanical': [terms.mechanical_bps, [[mc, 6000], [beat, 4000]]],
};
for (const [id, [deal, form]] of Object.entries(FORMS)) {
  const want = composeRight(C.label, deal, form);
  const got = (await view(REG, 'get_right', { token_id: id })).holders.map((h) => [h.account_id, h.bps]);
  record('fórmula', `${id}: pontos-base da rede = fórmula recalculada aqui`, JSON.stringify(got) === JSON.stringify(want), got.map(([, b]) => b / 100 + '%').join(' · '));
}
const producer = (await view(REG, 'get_right', { token_id: 'PYXXX2600001:neighboring_producer' })).holders;
record('fórmula', 'conexo de produtor: 100% para o selo', producer.length === 1 && producer[0].bps === 10000 && producer[0].account_id === C.label);

// ---- 4. valores recebidos, lidos dos eventos ft_transfer do token ----
for (const b of BATCHES) {
  const claim = C.claims.find((c) => c.id === b.payout);
  const t = await tx(claim.tx, claim.signer);
  const transfers = events(t).filter((e) => e.event === 'ft_transfer').flatMap((e) => e.data);
  const right = await view(REG, 'get_right', { token_id: `${b.code}:${b.right}` });
  const onchain = await view(REG, 'get_batch', { batch_id: b.id });
  const ri = Math.max(0, right.holders.findIndex((h) => h.account_id === C.label));
  const want = splitAmount(BigInt(onchain.amount), right.holders.map((h) => h.bps), ri);
  right.holders.forEach((h, i) => {
    const got = transfers.filter((x) => x.new_owner_id === h.account_id && x.old_owner_id === REG).reduce((s, x) => s + BigInt(x.amount), 0n);
    record('pagamentos', `${b.id}: ${h.role} (${h.account_id}) recebeu a parte certa`, got === want[i], `${Number(got) / 1e6} USDC de teste`, `${EXPLORER}/txns/${claim.tx}`);
  });
  const total = transfers.filter((x) => x.old_owner_id === REG).reduce((s, x) => s + BigInt(x.amount), 0n);
  record('pagamentos', `${b.id}: soma paga = valor da fatura (nada sobra, nada falta)`, total === BigInt(onchain.amount), `${Number(total) / 1e6} USDC de teste`);
}
for (const who of [mc, beat]) {
  const owed = await view(REG, 'get_owed', { account_id: who });
  record('pagamentos', `${who}: nenhuma parte retida`, owed === '0');
}

// ---- saída ----
const when = new Date().toISOString();
const block = (await rpc('block', { finality: 'final' })).header.height;
writeFileSync(join(ROOT, 'evidence', 'provas.json'), JSON.stringify({ checked_at: when, final_block: block, rpc: RPC_URL, contract: REG, passed: results.length - failed, failed, results }, null, 2) + '\n');
const md = [
  '# Provas na testnet',
  '',
  `Conferido em ${when} (bloco final ${block}) por \`npm run verify\`, sem chaves, direto do RPC \`${RPC_URL}\`.`,
  `Contrato: [${REG}](${EXPLORER}/address/${REG}). Dados de amostra e USDC de teste, sem valor.`,
  '',
  `**${results.length - failed} de ${results.length} conferências passaram.**`,
  '',
  ...['transações', 'ataques', 'lotes', 'fórmula', 'pagamentos'].filter((g) => results.some((r) => r.group === g)).flatMap((g) => [
    `## ${{ transações: 'Cada afirmação tem uma transação', ataques: 'Tentativas indevidas que a rede recusou', lotes: 'Hash de cada lote recalculado do ledger', fórmula: 'Divisão recalculada pela fórmula do selo', pagamentos: 'O que cada titular recebeu (eventos do token)' }[g]}`,
    '',
    '| | Conferência | Detalhe |',
    '|---|---|---|',
    ...results.filter((r) => r.group === g).map((r) => `| ${r.ok ? 'OK' : 'FALHA'} | ${r.link ? `[${r.name}](${r.link})` : r.name} | ${String(r.detail ?? '').replace(/\|/g, '/')} |`),
    '',
  ]),
].join('\n');
writeFileSync(join(ROOT, 'evidence', 'PROVAS.md'), md);

// Página para imprimir ou filmar: mesmo visual de recibo do site, uma linha por conferência, com o link de cada prova.
const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const TITLES = { transações: 'Cada afirmação tem uma transação', ataques: 'Tentativas indevidas que a rede recusou', lotes: 'Hash de cada lote recalculado do ledger', fórmula: 'Divisão recalculada pela fórmula do selo', pagamentos: 'O que cada titular recebeu' };
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Provas na testnet · BLVCK MINDZ × NEAR</title>
<style>
:root{--paper:#f3f1ea;--ink:#111;--muted:#666;--ok:#0a7a5a;--bad:#960018}
body{margin:0;background:#0b0b0c;font:14px/1.45 ui-monospace,"SF Mono",Menlo,monospace;color:var(--ink)}
main{max-width:860px;margin:24px auto;background:var(--paper);padding:28px 24px 40px;border-radius:6px}
h1{font:700 22px/1.2 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;margin:0 0 6px}
h2{font:600 13px/1.3 system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;margin:26px 0 8px;border-top:1px dashed #999;padding-top:14px}
.meta{color:var(--muted);font-size:12px}.score{font:700 28px system-ui,sans-serif;margin:14px 0 0}
table{width:100%;border-collapse:collapse}td{padding:5px 4px;vertical-align:top;border-bottom:1px dotted #bbb}
td.s{width:54px;font-weight:700}.ok{color:var(--ok)}.bad{color:var(--bad)}td.d{color:var(--muted);word-break:break-all;width:38%}
a{color:inherit}@media print{body{background:#fff}main{margin:0;border-radius:0}}
</style></head><body><main>
<h1>Provas na testnet</h1>
<div class="meta">BLVCK MINDZ × NEAR · contrato ${esc(REG)} · conferido em ${esc(when)} · bloco final ${block}<br>Verificador sem chaves, direto do RPC. Dados de amostra e USDC de teste, sem valor.</div>
<div class="score">${results.length - failed} / ${results.length} conferências OK</div>
${['transações', 'ataques', 'lotes', 'fórmula', 'pagamentos'].filter((g) => results.some((r) => r.group === g)).map((g) => `<h2>${TITLES[g]}</h2><table>${results.filter((r) => r.group === g).map((r) => `<tr><td class="s ${r.ok ? 'ok' : 'bad'}">${r.ok ? 'OK' : 'FALHA'}</td><td>${r.link ? `<a href="${esc(r.link)}">${esc(r.name)}</a>` : esc(r.name)}</td><td class="d">${esc(r.detail)}</td></tr>`).join('')}</table>`).join('')}
</main></body></html>`;
writeFileSync(join(ROOT, 'evidence', 'provas.html'), html);
console.log(`\n${results.length - failed}/${results.length} conferências passaram. Relatório: evidence/PROVAS.md`);
process.exit(failed ? 1 : 0);
