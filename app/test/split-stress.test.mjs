import test from 'node:test';
import assert from 'node:assert/strict';
import { composeRight, allocateMoney, parseTestUsdc, percentToBps } from '../split-engine.mjs';
import { formatTestUsdc } from '../statement.mjs';

// Fixed seed reproduces every generated sheet; properties are conservation and
// round trips, not a second implementation of the apportionment algorithm.
function generator(seed) {
  let state=seed>>>0;
  return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
}

test('one thousand deterministic sheets conserve all basis points and every micro-unit',()=>{
  const next=generator(0xb17cc001),maximum=(1n<<64n)-1n;
  const boundaries=[0n,1n,2n,999999n,1000000n,1000001n,maximum];
  for(let example=0;example<1000;example++) {
    const count=1+next()%7;
    const remaining=10000-count*200;
    const cuts=[0,...Array.from({length:count-1},()=>next()%(remaining+1)),remaining].sort((a,b)=>a-b);
    const side=Array.from({length:count},(_,i)=>({key:i===0&&example%3===0?'label':`participant-${i}`,bps:200+cuts[i+1]-cuts[i]}));
    const deal=example%11===0?10000:next()%9001;
    const rows=composeRight('label',deal,side);
    assert.equal(rows.reduce((sum,row)=>sum+row.bps,0),10000,`sheet ${example}: basis-point conservation`);
    assert.equal(new Set(rows.map(row=>row.key)).size,rows.length,`sheet ${example}: one allocation per recipient`);
    assert.ok(rows.every(row=>Number.isInteger(row.bps)&&row.bps>0&&row.bps<=10000));
    for(const row of rows) {
      const percent=`${Math.floor(row.bps/100)}.${String(row.bps%100).padStart(2,'0')}`;
      assert.equal(percentToBps(percent),row.bps,`sheet ${example}: percentage round trip`);
    }
    const amount=boundaries[example]??((BigInt(next())<<32n)|BigInt(next()));
    const {parts,remainder,remainderKey}=allocateMoney(amount,rows,'label');
    assert.equal(parts.length,rows.length);
    assert.equal(parts.reduce((sum,part)=>sum+part,0n),amount,`sheet ${example}: no missing/created money`);
    assert.ok(parts.every(part=>part>=0n&&part<=amount));
    assert.ok(remainder>=0n&&remainder<BigInt(rows.length));
    assert.ok(rows.some(row=>row.key===remainderKey));
    assert.equal(parseTestUsdc(formatTestUsdc(amount)),amount,`sheet ${example}: exact amount round trip`);
    for(const part of parts)assert.equal(parseTestUsdc(formatTestUsdc(part)),part,`sheet ${example}: exact recipient round trip`);
  }
});
