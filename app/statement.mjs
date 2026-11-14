// A derived reference is not proof that an event or a transfer succeeded.
export function expectedReceiptReference(batch) {
  return batch.status === 'Paid' ? `BMZ1:${batch.batch_id}:${batch.ledger_hash}` : '';
}

// Test token has six decimal places. Never round financial values through Number.
export function formatTestUsdc(micro) {
  const amount = BigInt(micro);
  if (amount < 0n) throw new RangeError('negative amount');
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${whole}.${fraction}`;
}
