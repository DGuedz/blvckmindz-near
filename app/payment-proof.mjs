import { allocateMoney } from './split-engine.mjs';

// Public reads only. Accept only the payout claims maintained in the evidence file.
export async function verifyPayment({ evidence, batchId, rpcUrl, transactionRpcUrl = 'https://archival-rpc.testnet.near.org', fetchFn = fetch }) {
  const claim = evidence.claims.find((c) => c.id === `pay_out_${batchId}` && c.expect?.batch === batchId);
  if (!claim) throw new Error('No recorded payout for this batch.');
  async function rpc(method, params, endpoint = rpcUrl) {
    const response = await fetchFn(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(method === 'query' ? 15000 : 25000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 'payment-proof', method, params }),
    });
    if (!response.ok) throw new Error('Public RPC unavailable.');
    const body = await response.json();
    if (body.error || !body.result) throw new Error('Public RPC did not return the requested evidence.');
    return body.result;
  }
  async function view(method_name, args) {
    const result = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: evidence.contract, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
    if (result.error || !Array.isArray(result.result)) throw new Error('Contract view unavailable.');
    return { value: JSON.parse(Buffer.from(result.result).toString()), block: result.block_height };
  }
  const [{ value: batch, block }, { value: config }, tx] = await Promise.all([
    view('get_batch', { batch_id: batchId }), view('get_config', {}),
    rpc('EXPERIMENTAL_tx_status', { tx_hash: claim.tx, sender_account_id: claim.signer, wait_until: 'FINAL' }, transactionRpcUrl),
  ]);
  if (!batch || !config.token_id) throw new Error('Batch or token configuration unavailable.');
  const { value: right } = await view('get_right', { token_id: batch.token_id });
  if (!right?.holders?.length) throw new Error('No registered shares found.');
  const { parts } = allocateMoney(BigInt(batch.amount), right.holders.map((h) => ({ key: h.account_id, bps: h.bps })), config.owner_id);
  const emitted = (tx.receipts_outcome ?? []).flatMap((o) => {
    if (!o.outcome?.status || !Object.hasOwn(o.outcome.status, 'SuccessValue')) return [];
    return (o.outcome.logs ?? []).filter((s) => s.startsWith('EVENT_JSON:')).flatMap((s) => {
      try {
        const event = JSON.parse(s.slice(11));
        if (!event || typeof event !== 'object' || Array.isArray(event)) return [];
        // The emitting account comes from the RPC outcome, never the log payload.
        return [{ ...event, executor: o.outcome.executor_id }];
      } catch { return []; }
    });
  });
  const transfers = emitted.filter((e) => e.executor === config.token_id && e.standard === 'nep141' && e.event === 'ft_transfer')
    .flatMap((e) => e.data ?? []).filter((d) => d.old_owner_id === evidence.contract);
  const rows = right.holders.map((h, i) => {
    const found = transfers.filter((d) => d.new_owner_id === h.account_id);
    const actual = found.reduce((sum, d) => sum + BigInt(d.amount), 0n);
    return { account: h.account_id, role: h.role, bps: h.bps, expected: String(parts[i]), actual: String(actual), matched: actual === parts[i] && found.length === (parts[i] === 0n ? 0 : 1) };
  });
  const receipt = `BMZ1:${batchId}:${batch.ledger_hash}`;
  const checks = {
    transaction: tx.transaction?.hash === claim.tx && Object.hasOwn(tx.status ?? {}, 'SuccessValue'),
    receipt: emitted.some((e) => e.executor === evidence.contract && e.standard === 'bmz' && e.event === 'receipt' && e.data?.some((d) => d.receipt === receipt && d.token_id === batch.token_id)),
    amounts: rows.every((r) => r.matched),
    total: transfers.reduce((sum, d) => sum + BigInt(d.amount), 0n) === BigInt(batch.amount),
    recipients: transfers.every((d) => rows.some((r) => r.account === d.new_owner_id)),
  };
  return { checkedAt: new Date().toISOString(), contract: evidence.contract, assetContract: config.token_id, batchId, tokenId: batch.token_id, block, tx: claim.tx, amount: batch.amount, rows, checks, matched: Object.values(checks).every(Boolean) };
}
