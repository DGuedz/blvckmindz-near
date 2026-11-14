import { parseTestUsdc } from './split-engine.mjs';

export const SAMPLE_TEMPLATES = Object.freeze({
  master: Object.freeze({ id:'master', code:'PYXXX2600001', identifier:'ISRC', right:'master', batchId:'m1', amount:'2.00', deal:4000, weights:Object.freeze([7000,3000]), roles:Object.freeze(['Artist','Beatmaker']) }),
  publishing: Object.freeze({ id:'publishing', code:'T0000000001', identifier:'ISWC', right:'publishing_performance', batchId:'e1', amount:'1.00', deal:2500, weights:Object.freeze([6000,4000]), roles:Object.freeze(['Writer 1','Writer 2']) }),
});

// Edited calculations must never be presented as the recorded payment.
export function matchesRecordedTemplate(template, { code, amount, weights }) {
  return code === template.code && amount === parseTestUsdc(template.amount)
    && weights.length === template.weights.length && weights.every((w,i) => w === template.weights[i]);
}
