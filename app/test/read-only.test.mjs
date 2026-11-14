import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

test('read-only demo serves public config and refuses relaying', { timeout: 10_000 }, async (t) => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const script = fileURLToPath(new URL('../serve.mjs', import.meta.url));
  const server = spawn(process.execPath, [script, '--readonly'], {
    env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => server.kill());
  const base = `http://127.0.0.1:${port}`;
  let config;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      config = await fetch(`${base}/api/config`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.ok(config, 'read-only server did not start');
  assert.equal(config.status, 200);
  const data = await config.json();
  const evidence = JSON.parse(readFileSync(new URL('../../evidence/claims.json', import.meta.url), 'utf8'));
  assert.equal(data.registry, evidence.contract);
  const relay = await fetch(`${base}/api/relay`, { method: 'POST', body: '{}' });
  assert.equal(relay.status, 403);
  assert.match((await relay.json()).error, /HTTP relayer disabled/);
  const csv = await fetch(`${base}/csv.mjs`);
  assert.equal(csv.status, 200);
  for (const path of ['/demo.mjs', '/demo.css', '/assets/logo.svg', '/assets/anton.woff2', '/split-engine.mjs', '/templates.mjs', '/engine-motion.mjs', '/engine-motion.css', '/run-reference.mjs', '/run-controller.mjs', '/assets/usdc-coin.webp']) {
    assert.equal((await fetch(`${base}${path}`)).status, 200, `${path} should be served`);
  }
  assert.equal((await fetch(`${base}/api/payment-proof?batch=not-recorded`)).status, 400);
  assert.equal((await fetch(`${base}/api/demo-runs`, {method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status, 403);
  assert.equal((await fetch(`${base}/assets/../../.keys/state.json`)).status, 404);
});
