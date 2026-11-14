// Reescreve a seção "Live on testnet" do README a partir de evidence/claims.json e provas.json.
// Uso: npm run readme  (depois de npm run verify)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, EXPLORER } from './lib.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Refuse to present historical transactions as proof of another build.
execFileSync(process.execPath, [fileURLToPath(new URL('./verify-build.mjs', import.meta.url))], { stdio: 'inherit' });

const C = JSON.parse(readFileSync(join(ROOT, 'evidence', 'claims.json'), 'utf8'));
const P = JSON.parse(readFileSync(join(ROOT, 'evidence', 'provas.json'), 'utf8'));
if(P.source==='live-demo')throw new Error('The live-run report has fresh batch IDs. Review README against evidence/live-runs instead of using the legacy m1/e1 updater.');
if (P.failed) throw new Error('verify não está verde: corrija antes de atualizar o README');
const by = Object.fromEntries(C.claims.map((c) => [c.id, c]));
const tx = (id) => (by[id] ? `[${by[id].tx.slice(0, 6)}…](${EXPLORER}/txns/${by[id].tx})` : '—');
const rows = [
  ['Contract-model published (test)', 'terms'],
  ['Composition registered (ISWC → 2 tokens)', 'register_work'],
  ['Recording registered; contract computed master 40 / 42 / 18', 'register'],
  ['Artist confirms the composition, gas paid by the label', 'confirm_mc_iswc'],
  ['Producer confirms the recording, gas paid by the label', 'confirm_beat_isrc'],
  ['Master invoice, 2 test USDC', 'pay_m1'],
  ['Performance invoice, 1 test USDC', 'pay_e1'],
  ['Gate approves only the m1 hash', 'gate_m1'],
  ['Master paid, receipt BMZ1:m1', 'pay_out_m1'],
  ['Performance paid, receipt BMZ1:e1', 'pay_out_e1'],
];
const section = `## Live on testnet

Contract v2: [\`${C.contract}\`](${EXPLORER}/address/${C.contract}). Test contract-model \`teste-2026-10-14\`: master D 40%, publishing D 25%. **These are test parameters, not the label's terms.**

| Step | Transaction |
|---|---|
${rows.map(([t, id]) => `| ${t} | ${tx(id)} |`).join('\n')}

Result (test USDC): master 2.00 → label 0.80, performer 0.84, producer 0.36; performance 1.00 → label 0.25, lyrics 0.45, melody 0.30.
Verified ${P.checked_at.slice(0, 10)}: **${P.passed}/${P.passed + P.failed} checks** ([evidence/PROVAS.md](evidence/PROVAS.md)).

`;
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const start = readme.indexOf('## Live on testnet');
const end = readme.indexOf('## Evidence');
if (start < 0 || end < 0) throw new Error('seções do README não encontradas');
writeFileSync(join(ROOT, 'README.md'), readme.slice(0, start) + section + readme.slice(end));
console.log('README atualizado com', rows.length, 'transações de', C.contract);
