// Peças comuns: rede (testnet), contas locais de demo, leitura de contratos, ledger e recibo.
// Chaves ficam em app/.keys/ (fora do git) e nunca são impressas.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Account, KeyPair, JsonRpcProvider } from 'near-api-js';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const KEYS = join(HERE, '.keys');
export const STATE = join(KEYS, 'state.json');
export const RPC_URL = process.env.NEAR_RPC_URL ?? 'https://test.rpc.fastnear.com';
export const EXPLORER = 'https://testnet.nearblocks.io';
export const provider = new JsonRpcProvider({ url: RPC_URL });

export const TGAS = 1_000_000_000_000n;
export const YOCTO_PER_NEAR = 10n ** 24n;
export const near = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;

export function loadState() {
  if (!existsSync(STATE)) throw new Error('rode antes: npm run setup');
  return JSON.parse(readFileSync(STATE, 'utf8'));
}

export function saveState(s) {
  mkdirSync(KEYS, { recursive: true, mode: 0o700 });
  writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

/** Conta assinante a partir da chave guardada em state.keys[accountId]. */
export function account(state, accountId) {
  const sk = state.keys[accountId];
  if (!sk) throw new Error(`sem chave local para ${accountId}`);
  return new Account(accountId, provider, sk);
}

export function newKey() {
  const kp = KeyPair.fromRandom('ed25519');
  return { secret: kp.toString(), publicKey: kp.getPublicKey().toString() };
}

/** Leitura (view) por JSON-RPC puro: o mesmo formato que a página usa no navegador. */
export async function view(contractId, method, args = {}, { fetchFn = fetch } = {}) {
  const res = await fetchFn(RPC_URL, {
    signal: AbortSignal.timeout(15000),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'v',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'optimistic',
        account_id: contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      },
    }),
  }).then((r) => r.json());
  if (res.error || res.result?.error) throw new Error(JSON.stringify(res.error ?? res.result.error));
  return JSON.parse(Buffer.from(res.result.result).toString() || 'null');
}

export const txLink = (r) => `${EXPLORER}/txns/${r?.transaction?.hash ?? r?.transaction_outcome?.id}`;
export const accLink = (id) => `${EXPLORER}/address/${id}`;

// ---- ledger (mesmo formato canônico do baseline Solana) ----

export function readLedger(path = join(ROOT, 'fixtures', 'demo-ledger.csv')) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('batch_id'))
    .map((l) => {
      const c = l.split(',');
      if (c.length !== 7) throw new Error(`linha inválida: ${l}`);
      return { batchId: c[0], period: c[1], isrc: c[2], right: c[3], store: c[4], territory: c[5], amount: BigInt(c[6]) };
    });
}

/** Total do lote + SHA-256 das linhas canônicas ordenadas. É o hash que o portão aprova e o recibo publica. */
export function batchSummary(rows, batchId, isrc, right = 'master') {
  const mine = rows.filter((r) => r.batchId === String(batchId) && r.isrc === isrc && r.right === right);
  if (!mine.length) throw new Error(`lote ${batchId} sem linhas para ${isrc}`);
  const canonical = mine
    .map((r) => [r.batchId, r.period, r.isrc, r.right, r.store, r.territory, r.amount].join(','))
    .sort()
    .join('\n');
  return {
    count: mine.length,
    amount: mine.reduce((s, r) => s + r.amount, 0n),
    ledgerHash: createHash('sha256').update(canonical).digest('hex'),
  };
}

export const receipt = (batchId, hash) => `BMZ1:${batchId}:${hash}`;

/** Mesma regra do contrato (math.rs): piso por bps, sobra para remainder_index. */
export function splitAmount(amount, bps, remainderIndex) {
  const shares = bps.map((b) => (amount * BigInt(b)) / 10000n);
  shares[remainderIndex] += amount - shares.reduce((a, b) => a + b, 0n);
  return shares;
}

export const usdc = (micro) => (Number(micro) / 1e6).toFixed(6);
