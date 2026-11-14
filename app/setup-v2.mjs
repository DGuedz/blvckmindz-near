// Publica a v2 (um token por direito) numa conta NOVA, ao lado da v1, que fica como prova. Só testnet.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, account, accLink, loadState, newKey, near, saveState, TGAS, view, provider } from './lib.mjs';
import { actions } from 'near-api-js';

const state = loadState();
const A = state.accounts;
if (A.registry_v1) {
  console.log('A v2 já foi publicada:', accLink(A.registry));
  process.exit(0);
}
const root = account(state, A.root);
const id = `rights.${A.root}`;

// O contrato v2 ocupa ~250 KB (~2,5 NEAR de armazenamento). Junta na conta raiz o NEAR de teste que sobra
// nas contas da v1 e do token (a parte presa ao armazenamento delas fica onde está).
// Só move o que está livre: saldo − armazenamento ocupado − 0,05 NEAR de folga para gas.
const BYTE = 10n ** 19n;
for (const from of [A.usdc, A.registry]) {
  const v = await provider.viewAccount({ accountId: from });
  const free = BigInt(v.amount) - BigInt(v.storage_usage ?? v.storageUsage) * BYTE - near(0.05);
  if (free <= near(0.1)) continue;
  await account(state, from).transfer({ receiverId: A.root, amount: free });
  console.log(`${Number(free / 10n ** 21n) / 1000} NEAR de teste movido para a raiz a partir de`, from);
}
const k = newKey();
await root.createSubAccount({ accountOrPrefix: id, publicKey: k.publicKey, nearToTransfer: near(2.8) });
state.keys[id] = k.secret;
A.registry_v1 = A.registry;
A.registry = id;
saveState(state);

const reg = account(state, id);
await reg.signAndSendTransaction({ receiverId: id, actions: [
  actions.deployContract(readFileSync(join(ROOT, 'target', 'near', 'track_account', 'track_account.wasm'))),
  actions.functionCall('new', { owner_id: A.root, token_id: A.token, gate_id: A.gate }, 30n * TGAS, 0n),
] });
const config = await view(id, 'get_config');
if (config.owner_id !== A.root || config.token_id !== A.token || config.gate_id !== A.gate) throw new Error('configuração do contrato não corresponde ao esperado');
const bounds = await view(A.token, 'storage_balance_bounds');
await root.callFunction({
  contractId: A.token, methodName: 'storage_deposit', args: { account_id: id, registration_only: true }, deposit: BigInt(bounds.min), gas: 30n * TGAS,
});
console.log('v2 publicada:', accLink(id));
console.log('v1 continua em:', accLink(A.registry_v1));
console.log('Próximo passo: npm run demo');
