// Prepara a demo na TESTNET (uma vez). Nada aqui toca a mainnet.
//
// 1. Conta raiz: usa NEAR_ROOT_ACCOUNT + NEAR_ROOT_KEY (uma conta testnet sua com ~10 NEAR de teste),
//    ou pede uma conta nova ao faucet da testnet (gera a chave aqui, guarda em app/.keys/).
// 2. Cria as subcontas: registry (contrato da faixa), usdc (token de teste), gate (portão),
//    mc e beat (titulares, sem saldo: o relayer paga o gas deles) e distribuidora (pagador).
// 3. Publica e inicializa os dois contratos e registra todo mundo no token.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT, account, newKey, saveState, near, TGAS, accLink, view } from './lib.mjs';
import { existsSync } from 'node:fs';
import { STATE, KEYS } from './lib.mjs';
import { actions } from 'near-api-js';

const FAUCET = process.env.NEAR_FAUCET_URL ?? 'https://helper.testnet.near.org/account';
const WASM = (name) => readFileSync(join(ROOT, 'target', 'near', name, `${name}.wasm`));

if (existsSync(STATE) && !process.argv.includes('--force')) {
  console.log('Já existe uma demo em app/.keys/state.json. Use --force para criar outra.');
  process.exit(0);
}

// Rodada nova: a anterior fica guardada (chaves e provas), nunca é apagada.
if (existsSync(STATE)) {
  const { renameSync, mkdirSync } = await import('node:fs');
  const old = JSON.parse(readFileSync(STATE, 'utf8'));
  const tag = old.accounts?.root ?? `antiga-${Date.now()}`;
  renameSync(STATE, join(KEYS, `state.${tag}.json`));
  const ev = join(ROOT, 'evidence');
  const arch = join(ev, 'archive', tag);
  mkdirSync(arch, { recursive: true });
  for (const f of ['claims.json', 'attacks.json', 'provas.json', 'PROVAS.md', 'provas.html']) {
    if (existsSync(join(ev, f))) renameSync(join(ev, f), join(arch, f));
  }
  console.log(`rodada anterior guardada: app/.keys/state.${tag}.json e evidence/archive/${tag}/`);
}
const state = { network: 'testnet', keys: {}, accounts: {} };

let root = process.env.NEAR_ROOT_ACCOUNT;
if (root) {
  if (!process.env.NEAR_ROOT_KEY) throw new Error('NEAR_ROOT_KEY ausente (ed25519:...)');
  state.keys[root] = process.env.NEAR_ROOT_KEY;
} else {
  root = `bmz-${randomBytes(4).toString('hex')}.testnet`;
  const k = newKey();
  const r = await fetch(FAUCET, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newAccountId: root, newAccountPublicKey: k.publicKey }),
  });
  if (!r.ok) {
    throw new Error(
      `faucet recusou (${r.status}). Crie uma conta testnet numa carteira e rode com NEAR_ROOT_ACCOUNT e NEAR_ROOT_KEY.`,
    );
  }
  state.keys[root] = k.secret;
  console.log('conta raiz criada pelo faucet:', root);
}
state.accounts.root = root;
saveState(state);

const rootAcc = account(state, root);
const subs = { registry: 3, usdc: 3, gate: 0.5, mc: 0, beat: 0, distribuidora: 1 };
for (const [name, bal] of Object.entries(subs)) {
  const id = `${name}.${root}`;
  const k = newKey();
  await rootAcc.createSubAccount({ accountOrPrefix: id, publicKey: k.publicKey, nearToTransfer: near(bal) });
  state.keys[id] = k.secret;
  state.accounts[name] = id;
  saveState(state);
  console.log('subconta', id);
}

const tokenId = process.env.USDC_TOKEN_ID ?? state.accounts.usdc;
state.accounts.token = tokenId;

if (tokenId === state.accounts.usdc) {
  const u = account(state, state.accounts.usdc);
  await u.signAndSendTransaction({ receiverId: tokenId, actions: [
    actions.deployContract(WASM('test_usdc')),
    actions.functionCall('new', {}, 30n * TGAS, 0n),
  ] });
  console.log('token de teste publicado:', tokenId);
}

const reg = account(state, state.accounts.registry);
await reg.signAndSendTransaction({ receiverId: state.accounts.registry, actions: [
  actions.deployContract(WASM('track_account')),
  actions.functionCall('new', { owner_id: root, token_id: tokenId, gate_id: state.accounts.gate }, 30n * TGAS, 0n),
] });
const config = await view(state.accounts.registry, 'get_config');
if (config.owner_id !== root || config.token_id !== tokenId || config.gate_id !== state.accounts.gate) throw new Error('configuração do contrato não corresponde ao esperado');
console.log('contrato da faixa publicado:', state.accounts.registry);

const bounds = await view(tokenId, 'storage_balance_bounds');
for (const who of ['registry', 'mc', 'beat', 'distribuidora', 'root']) {
  await rootAcc.callFunction({
    contractId: tokenId,
    methodName: 'storage_deposit',
    args: { account_id: state.accounts[who], registration_only: true },
    deposit: BigInt(bounds.min),
    gas: 30n * TGAS,
  });
}
saveState(state);
console.log('\nPronto. Contrato:', accLink(state.accounts.registry));
console.log('Próximo passo: npm run setup:v2');
