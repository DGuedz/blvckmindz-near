// A successful outer token transaction may have refunded the payer. Check the actual batch state.
export function validateBatch(batch, { id, payer, tokenId, hash, amount }) {
  if (!batch || batch.payer_id !== payer || batch.token_id !== tokenId || batch.ledger_hash !== hash || BigInt(batch.amount) !== BigInt(amount)) {
    throw new Error(`lote ${id} diverge da fatura esperada`);
  }
  return batch.status;
}

export function gateAction(status) {
  if (status === 'Funded') return 'check';
  if (status === 'Approved' || status === 'Paid') return 'already-processed';
  throw new Error(`lote não está financiado: ${status}`);
}
