// Ataques que PRECISAM falhar, na testnet. Cada tentativa vira uma transação recusada com link no explorer,
// gravada em evidence/attacks.json para o verificador conferir. Custa só gas de teste (e 0,1 USDC de teste no lote a1).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { actions } from 'near-api-js';
import { ROOT, TGAS, account, loadState, near, txLink, view } from './lib.mjs';
import { relay, signConfirm, checkDelegate } from './relay.mjs';

const state = loadState();
const A = state.accounts;
const REG = A.registry;
const OUT = join(ROOT, 'evidence', 'attacks.json');

// Ordem obrigatória: os ataques testam proteções de um contrato que já tem contrato-modelo, faixa e lote pago.
// Rodar antes da demo faria o "ataque" de reescrever o contrato-modelo publicá-lo de verdade.
if (!A.registry_v1) throw new Error('rode antes: npm run setup:v2 e npm run demo');
const m1 = await view(REG, 'get_batch', { batch_id: 'm1' });
if (m1?.status !== 'Paid') throw new Error('rode antes: npm run demo (o lote m1 precisa estar pago)');
const done = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { attacks: [] };
const log = (...x) => console.log(...x);
const call = (who, contractId, methodName, args, gas = 50n * TGAS, deposit = 0n) =>
  account(state, who).signAndSendTransaction({ receiverId: contractId, actions: [actions.functionCall(methodName, args, gas, deposit)] });

const balance = async (who) => BigInt(await view(A.token, 'ft_balance_of', { account_id: who }));

async function attempt(id, claim, signer, expectPanic, fn) {
  if (done.attacks.some((a) => a.id === id)) return log(`(já registrado) ${claim}`);
  try {
    const r = await fn();
    // Sucesso aqui = a proteção falhou. Também conta como falha se o resultado não foi recusado.
    done.attacks.push({ id, claim, tx: r?.transaction?.hash, signer, expect: { success: false, panic: expectPanic }, result: 'NÃO RECUSADO' });
    log(`FALHA: "${claim}" não foi recusado`, txLink(r));
  } catch (e) {
    const hash = e?.transactionResult?.transaction?.hash;
    const msg = e?.panicMessage ?? e?.message ?? String(e);
    const ok = msg.includes(expectPanic);
    done.attacks.push({ id, claim, tx: hash ?? null, signer, expect: { success: false, panic: expectPanic }, result: ok ? 'recusado' : `erro inesperado: ${msg.slice(0, 120)}` });
    log(`${ok ? 'RECUSADO' : 'INESPERADO'}: ${claim} — "${msg.slice(0, 80)}"`, hash ? `${txLink({ transaction: { hash } })}` : '(recusado antes de ir à rede)');
  }
  writeFileSync(OUT, JSON.stringify(done, null, 2) + '\n');
}

// 1. Quem não está na ficha tenta confirmar, pelo relayer (o relayer aceita o método; o contrato recusa a pessoa).
await attempt('stranger_confirm', 'Uma conta fora da ficha tenta confirmar uma parte', A.root, 'nada a confirmar', async () => {
  const { res } = await relay(state, await signConfirm(state, A.gate, { code: 'PYXXX2600001' }));
  return res;
});

// 2. Alguém de fora tenta registrar uma faixa (só o selo registra).
await attempt('not_label_register', 'A distribuidora tenta registrar uma gravação', A.distribuidora, 'só o selo', () =>
  call(A.distribuidora, REG, 'register_recording', {
    isrc: 'PYXXX2600099', title: 'x', artists: [{ account_id: A.distribuidora, role: 'x', weight: 10000 }], terms_version: 'teste-2026-10-14', iswc: null,
  }));

// 3. Mudar o contrato-modelo depois de publicado.
await attempt('terms_rewrite', 'O selo tenta reescrever o contrato-modelo publicado', A.root, 'versão já publicada', () =>
  call(A.root, REG, 'set_terms', { terms: { version: 'teste-2026-10-14', master_bps: 9000, performance_bps: 9000, mechanical_bps: 9000, test_only: true } }));

// 4. Pagar um lote já pago.
await attempt('double_payout', 'Alguém tenta pagar de novo o lote m1, já repassado', A.distribuidora, 'lote não aprovado ou já pago', () =>
  call(A.distribuidora, REG, 'distribute', { batch_id: 'm1' }, 200n * TGAS));

// 5. Fingir ser o token: chamar ft_on_transfer direto, sem mandar USDC.
await attempt('fake_token', 'Uma conta finge ser o USDC para criar uma fatura sem dinheiro', A.distribuidora, 'token não aceito', () =>
  call(A.distribuidora, REG, 'ft_on_transfer', { sender_id: A.distribuidora, amount: '1000000', msg: '{}' }));

// 6. Lote novo a1 (0,1 USDC de teste no master): portão errado, pagamento antes do portão, hash errado.
const ledger = 'a1,2026-11,PYXXX2600001,master,ataque,BR,100000';
const hashA1 = createHash('sha256').update(ledger).digest('hex');
if (!(await view(REG, 'get_batch', { batch_id: 'a1' }))) {
  await call(A.root, REG, 'reserve_batch', { batch_id: 'a1', token_id: 'PYXXX2600001:master', payer_id: A.distribuidora, amount: '100000', ledger_hash: hashA1 }, 50n * TGAS, near(0.05));
  if (A.token === A.usdc) await call(A.distribuidora, A.token, 'faucet', { amount: '100000' }, 30n * TGAS);
  await call(A.distribuidora, A.token, 'ft_transfer_call', {
    receiver_id: REG, amount: '100000', msg: JSON.stringify({ token_id: 'PYXXX2600001:master', batch_id: 'a1', ledger_hash: hashA1 }),
  }, 100n * TGAS, 1n);
  log('lote a1 recebido (0,1 USDC de teste) para os testes de portão');
}
await attempt('payout_before_gate', 'Alguém tenta pagar o lote a1 antes do portão', A.distribuidora, 'lote não aprovado ou já pago', () =>
  call(A.distribuidora, REG, 'distribute', { batch_id: 'a1' }, 200n * TGAS));
await attempt('non_gate_approves', 'Uma conta que não é o portão tenta aprovar o lote a1', A.distribuidora, 'só o portão ou o selo', () =>
  call(A.distribuidora, REG, 'approve_batch', { batch_id: 'a1', ledger_hash: hashA1 }));
await attempt('wrong_hash', 'O portão tenta aprovar o lote a1 com outro hash', A.gate, 'hash diferente do lote recebido', () =>
  call(A.gate, REG, 'approve_batch', { batch_id: 'a1', ledger_hash: '0'.repeat(64) }));

// 7. Fatura para um direito que não existe: o padrão do token devolve o dinheiro ao pagador.
if (!done.attacks.some((a) => a.id === 'refund_unknown_right')) {
  if (A.token === A.usdc) await call(A.distribuidora, A.token, 'faucet', { amount: '50000' }, 30n * TGAS);
  const before = await balance(A.distribuidora);
  const r = await call(A.distribuidora, A.token, 'ft_transfer_call', {
    receiver_id: REG, amount: '50000', msg: JSON.stringify({ token_id: 'PYXXX2600099:master', batch_id: 'x1', ledger_hash: hashA1 }),
  }, 100n * TGAS, 1n);
  const after = await balance(A.distribuidora);
  const ok = after === before;
  done.attacks.push({
    id: 'refund_unknown_right', claim: 'Fatura para um direito inexistente: o pagador recebe tudo de volta', tx: r.transaction.hash, signer: A.distribuidora,
    expect: { refund: true, panic: 'direito não existe' }, result: ok ? 'devolvido' : `saldo mudou: ${before} → ${after}`,
  });
  writeFileSync(OUT, JSON.stringify(done, null, 2) + '\n');
  log(`${ok ? 'DEVOLVIDO' : 'FALHA'}: fatura para direito inexistente — saldo antes ${before}, depois ${after}`, txLink(r));
}

// 8. O relayer recusa pagar gas de qualquer coisa que não seja confirmar (checagem local, nada vai à rede).
try {
  checkDelegate(state, { delegateAction: { senderId: A.mc, receiverId: REG, actions: [{ functionCall: { methodName: 'distribute', deposit: 0n } }] } });
  log('FALHA: o relayer aceitou distribute');
} catch (e) {
  log(`RECUSADO (relayer, local): pagar gas de "distribute" — "${e.message}"`);
}

const bad = done.attacks.filter((a) => !['recusado', 'devolvido'].includes(a.result));
log(`\n${done.attacks.length - bad.length}/${done.attacks.length} ataques barrados. Registro: evidence/attacks.json`);
log('Agora rode: npm run verify');
process.exit(bad.length ? 1 : 0);
