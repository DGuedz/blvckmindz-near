// Relayer: o titular assina a confirmação (meta-transação, NEP-366) e o selo paga o gas.
// Só passa o que está na lista: chamada a `confirm_share` no contrato da faixa, sem depósito.
import { decodeSignedDelegate, encodeSignedDelegate } from 'near-api-js';
import { account } from './lib.mjs';

const ALLOWED = new Set(['confirm_share']);

export function checkDelegate(state, signedDelegate) {
  const d = signedDelegate.delegateAction;
  const allowed = [state.accounts.registry, state.accounts.registry_v1].filter(Boolean);
  if (!allowed.includes(d.receiverId)) throw new Error('destino não permitido');
  if (!d.actions.length) throw new Error('sem ações');
  for (const a of d.actions) {
    const fc = a.functionCall;
    if (!fc) throw new Error('só chamadas de função');
    if (!ALLOWED.has(fc.methodName)) throw new Error(`método não permitido: ${fc.methodName}`);
    if (BigInt(fc.deposit ?? 0) !== 0n) throw new Error('depósito não permitido');
  }
  return d.senderId;
}

/** Recebe a meta-transação em base64, confere e envia pagando o gas com a conta do selo. */
export async function relay(state, signedDelegateB64) {
  const sd = decodeSignedDelegate(Buffer.from(signedDelegateB64, 'base64'));
  const sender = checkDelegate(state, sd);
  const relayer = account(state, state.accounts.root);
  const res = await relayer.relayMetaTransaction(sd);
  // Numa meta-transação a NEAR marca a transação de fora como sucesso mesmo se a ação de dentro falhar.
  // Por isso o relayer olha o recibo executado no contrato e repassa a recusa a quem pediu.
  const inner = res.receipts_outcome.find((o) => o.outcome.executor_id === sd.delegateAction.receiverId);
  const failure = inner?.outcome.status?.Failure;
  if (failure) {
    const err = new Error(JSON.stringify(failure).match(/panicked: ([^"]+)/)?.[1] ?? 'ação recusada pelo contrato');
    err.panicMessage = err.message;
    err.transactionResult = res;
    throw err;
  }
  return { sender, res };
}

/** Lado do titular: assina a confirmação sem gastar NEAR. */
/** `args`: { code } na v2 ({ isrc } na v1); `receiverId`: o contrato onde confirmar. */
export async function signConfirm(state, holderId, args, receiverId = state.accounts.registry) {
  const { actions } = await import('near-api-js');
  const { TGAS } = await import('./lib.mjs');
  const holder = account(state, holderId);
  const { signedDelegate } = await holder.createSignedMetaTransaction({
    receiverId,
    actions: [actions.functionCall('confirm_share', args, 30n * TGAS, 0n)],
  });
  return Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64');
}
