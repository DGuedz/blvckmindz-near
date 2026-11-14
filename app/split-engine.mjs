// Browser explanation of the catalog/NEAR formula. Checked against shared vectors.
// Share apportionment and monetary rounding are separate operations.
export const FULL = 10000;
export function percentToBps(value) {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(String(value))) throw new Error('Use a percentage with at most two decimal places.');
  const [whole, fraction = ''] = String(value).split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (bps > FULL) throw new Error('Percentage must be between 0 and 100.');
  return bps;
}
export function parseTestUsdc(value) {
  if (String(value).length > 32) throw new Error('Amount exceeds the contract limit.');
  if (!/^\d+(\.\d{1,6})?$/.test(String(value))) throw new Error('Use a non-negative amount with at most six decimals.');
  const [whole, fraction = ''] = String(value).split('.');
  const amount = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (amount > (1n << 64n) - 1n) throw new Error('Amount exceeds the contract limit.');
  return amount;
}
export function composeRight(label, deal, side) {
  if (!Number.isInteger(deal) || deal < 0 || deal > FULL) throw new Error('Invalid label allocation.');
  if (!Array.isArray(side) || !side.length || side.length > 7 || side.some((s) => !s.key || !Number.isInteger(s.bps) || s.bps <= 0 || s.bps > FULL)) throw new Error('Use one to seven contributors with positive shares.');
  if (side.reduce((sum, s) => sum + s.bps, 0) !== FULL) throw new Error('Contributors’ side must total 100%.');
  const pool = FULL - deal;
  const raw = side.map((s, i) => ({ key: s.key, i, floor: Math.floor(pool * s.bps / FULL), rest: pool * s.bps % FULL }));
  let left = pool - raw.reduce((sum, s) => sum + s.floor, 0);
  for (const row of [...raw].sort((a, b) => b.rest - a.rest || a.i - b.i)) {
    if (!left) break;
    row.floor++; left--;
  }
  if (pool && raw.some((s) => !s.floor)) throw new Error('A contributor’s allocation is below one basis point.');
  const merged = new Map(deal ? [[label, deal]] : []);
  if (pool) for (const s of raw) merged.set(s.key, (merged.get(s.key) ?? 0) + s.floor);
  return [...merged].map(([key, bps]) => ({ key, bps }));
}
export function allocateMoney(amount, rows, label) {
  if (typeof amount !== 'bigint' || amount < 0n || amount > (1n << 64n) - 1n) throw new Error('Invalid micro-unit amount.');
  if (!rows.length || rows.length > 8 || rows.some((r) => !Number.isInteger(r.bps) || r.bps <= 0) || rows.reduce((s, r) => s + r.bps, 0) !== FULL) throw new Error('Invalid final shares.');
  const parts = rows.map((r) => amount * BigInt(r.bps) / 10000n);
  const remainder = amount - parts.reduce((a, b) => a + b, 0n);
  const index = Math.max(0, rows.findIndex((r) => r.key === label));
  parts[index] += remainder;
  return { parts, remainder, remainderKey: rows[index].key };
}
