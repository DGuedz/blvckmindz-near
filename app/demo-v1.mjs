// Roteiro da demo na TESTNET, um passo por comando (ou `all`):
//   register → confirm → pay → gate → distribute → csv
// Dados: fixtures/demo-ledger.csv (AMOSTRA, valores fictícios).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, TGAS, account, accLink, batchSummary, loadState, readLedger, receipt, saveState,
  splitAmount, txLink, usdc, view,
} from './lib.mjs';
import { relay, signConfirm } from './relay.mjs';
import { actions } from 'near-api-js';
import { csvLine } from './csv.mjs';

/** Envia uma chamada e devolve a resposta da rede (com o hash da transação para o explorer). */
const call = (who, contractId, methodName, args, gas, deposit = 0n) =>
  account(state, who).signAndSendTransaction({
    receiverId: contractId,
    actions: [actions.functionCall(methodName, args, gas, deposit)],
  });

const ISRC = 'PYXXX2600001';
const BATCH = '1';
const step = process.argv[2] ?? 'all';
const state = loadState();
const A = state.accounts;
const REG = A.registry_v1 ?? A.registry; // v1: um ISRC, um direito
const log = (...x) => console.log(...x);

async function register() {
  const r = await call(A.root, REG, 'register_track', {
      isrc: ISRC,
      title: 'Faixa de amostra',
      holders: [
        { account_id: A.mc, role: 'artista', bps: 3500 },
        { account_id: A.beat, role: 'produtor', bps: 1500 },
        { account_id: A.root, role: 'selo', bps: 5000 },
      ],
      remainder_index: 2,
  }, 50n * TGAS);
  log('1. faixa registrada como ativo (nft_mint):', ISRC);
  log('   ', accLink(REG));
  return r;
}

async function confirm() {
  for (const who of [A.mc, A.beat]) {
    const b64 = await signConfirm(state, who, { isrc: ISRC }, REG);
    const { res } = await relay(state, b64);
    log(`2. ${who} confirmou a parte SEM gas (o selo pagou):`, txLink(res));
  }
  await call(A.root, REG, 'confirm_share', { isrc: ISRC }, 30n * TGAS);
  log('2. selo confirmou a própria parte');
}

async function pay() {
  const { amount, ledgerHash } = batchSummary(readLedger(), BATCH, ISRC);
  if (A.token === A.usdc) {
    await call(A.distribuidora, A.token, 'faucet', { amount: amount.toString() }, 30n * TGAS);
  }
  const r = await call(A.distribuidora, A.token, 'ft_transfer_call', {
    receiver_id: REG,
    amount: amount.toString(),
    msg: JSON.stringify({ isrc: ISRC, batch_id: BATCH, ledger_hash: ledgerHash }),
  }, 100n * TGAS, 1n);
  log(`3. distribuidora pagou a fatura: ${usdc(amount)} USDC, lote ${BATCH}`);
  log('   hash do ledger:', ledgerHash);
  return r;
}

/**
 * Portão antes do repasse. Aqui ficam as regras fixas que qualquer um confere.
 * A revisão de risco (Jev) roda no ambiente privado do selo e chega como decisão sobre o MESMO hash;
 * sem decisão, uma pessoa precisa aprovar com --approve.
 */
async function gate() {
  const rows = readLedger();
  const { amount, ledgerHash } = batchSummary(rows, BATCH, ISRC);
  const b = await view(REG, 'get_batch', { batch_id: BATCH });
  const t = await view(REG, 'get_track', { isrc: ISRC });
  const checks = [
    ['lote recebido e aguardando', b?.status === 'Funded'],
    ['hash recalculado do ledger = hash pago', b?.ledger_hash === ledgerHash],
    ['valor pago = total do ledger', BigInt(b?.amount ?? -1) === amount],
    ['todos os titulares confirmaram', t?.holders.every((h) => h.confirmed)],
    ['divisão soma 10.000 bps', t?.holders.reduce((s, h) => s + h.bps, 0) === 10000],
  ];
  for (const [name, ok] of checks) log(`4. [${ok ? 'ok' : 'FALHOU'}] ${name}`);
  if (!checks.every(([, ok]) => ok)) throw new Error('portão reteve o lote');
  if (!process.argv.includes('--approve')) {
    log('4. regras ok. Falta a aprovação humana: rode `npm run demo -- gate --approve`');
    return;
  }
  const r = await call(A.gate, REG, 'approve_batch', { batch_id: BATCH, ledger_hash: ledgerHash }, 30n * TGAS);
  log('4. portão aprovou SÓ este hash:', ledgerHash.slice(0, 16) + '…');
  return r;
}

async function distribute() {
  const r = await call(A.root, REG, 'distribute', { batch_id: BATCH }, 200n * TGAS);
  const b = await view(REG, 'get_batch', { batch_id: BATCH });
  log('5. repasse feito. Recibo público:', receipt(BATCH, b.ledger_hash));
  return r;
}

async function csv() {
  const t = await view(REG, 'get_track', { isrc: ISRC });
  const batches = await view(REG, 'list_batches', { isrc: ISRC });
  const lines = ['lote,isrc,status,titular,papel,bps,valor_usdc,recibo'];
  for (const b of batches) {
    const shares = splitAmount(BigInt(b.amount), t.holders.map((h) => h.bps), t.remainder_index);
    t.holders.forEach((h, i) =>
      lines.push(csvLine([b.batch_id, b.isrc, b.status, h.account_id, h.role, h.bps, usdc(shares[i]), receipt(b.batch_id, b.ledger_hash)])),
    );
  }
  const out = join(ROOT, 'app', 'extrato.csv');
  writeFileSync(out, lines.join('\n') + '\n');
  log('6. extrato para o contador:', out);
  for (const who of [A.mc, A.beat, A.root]) {
    const bal = await view(A.token, 'ft_balance_of', { account_id: who });
    log(`   saldo ${who}: ${usdc(bal)} USDC`);
  }
}

const steps = { register, confirm, pay, gate, distribute, csv };
const run = async (name) => {
  const r = await steps[name]();
  if (r?.transaction || r?.transaction_outcome) log('   tx:', txLink(r));
};
if (step === 'all') {
  for (const s of ['register', 'confirm', 'pay', 'gate']) await run(s);
  if (process.argv.includes('--approve')) {
    await run('distribute');
    await run('csv');
  } else {
    log('Demonstração pausada antes da aprovação e distribuição.');
  }
} else if (steps[step]) {
  await run(step);
} else {
  console.error(`passo desconhecido: ${step}. Use: ${Object.keys(steps).join(' | ')} | all`);
  process.exit(1);
}
saveState(state);
