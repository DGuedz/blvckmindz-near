// Página da fatura + relayer, só em 127.0.0.1. Nada de chave sai daqui: /api/config mostra só nomes de conta.
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, ROOT, RPC_URL, EXPLORER, loadState } from './lib.mjs';
import { verifyPayment } from './payment-proof.mjs';
import { createLiveDemo } from './live-demo.mjs';
import { acceptsDemoPost, allowedPublicHost, allowedFrontendOrigin } from './demo-http-policy.mjs';

const PORT = Number(process.env.PORT ?? 8787);
// Explicit read-only mode uses public evidence, never local signing keys.
const readOnly = process.argv.includes('--readonly');
const testnetDemo = process.argv.includes('--testnet-demo');
const publicDemo = process.argv.includes('--public-demo');
const publicHost = process.env.NEAR_DEMO_PUBLIC_HOST;
const frontendOrigin = process.env.NEAR_DEMO_FRONTEND_ORIGIN;
if (readOnly && testnetDemo) throw new Error('Choose read-only or the opt-in testnet transaction demo.');
if (publicDemo && !testnetDemo) throw new Error('Public transaction mode requires the isolated testnet demo.');
if (publicHost !== undefined && (!publicDemo || !allowedPublicHost(publicHost))) throw new Error('Pin only the exact temporary demo hostname in explicit public mode.');
if (frontendOrigin !== undefined && (!publicDemo || !allowedFrontendOrigin(frontendOrigin))) throw new Error('Pin only the exact HTTPS Vercel origin in explicit public mode.');
const evidence = readOnly ? JSON.parse(readFileSync(join(ROOT, 'evidence', 'claims.json'), 'utf8')) : null;
const state = readOnly
  ? { accounts: { registry: evidence.contract, root: evidence.label, gate: `gate.${evidence.label}`, token: null } }
  : loadState();
const page = () => readFileSync(join(HERE, 'web', 'index.html'));
const liveDemo = testnetDemo ? await createLiveDemo(state) : null;
const proofReads = new Map();
function publishedRun(template) {
  const folder=join(ROOT,'evidence','live-runs');
  if(!existsSync(folder))return null;
  return readdirSync(folder).filter(name=>/^[0-9a-f-]{36}\.json$/.test(name)).map(name=>JSON.parse(readFileSync(join(folder,name),'utf8')))
    .filter(run=>run.template===template&&run.status==='verified'&&run.proof?.contract===state.accounts.registry)
    .sort((a,b)=>String(b.finishedAt).localeCompare(String(a.finishedAt)))[0]??null;
}
const publicFiles = new Map([
  ...['index.html','quickstart.html','rights.html','execution.html','verification.html','architecture.html','limits.html','docs.css'].map(n=>[`/docs/${n}`,[`web/docs/${n}`,n.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8']]),
  ...['','quickstart','rights','execution','verification','architecture','limits'].flatMap(n=>[n?`/docs/${n}`:'/docs',n?`/docs/${n}/`:'/docs/'].map(url=>[url,[`web/docs/${n||'index'}.html`,'text/html; charset=utf-8']])),
  ['/demo.css', ['web/demo.css', 'text/css; charset=utf-8']],
  ['/engine-motion.css', ['web/engine-motion.css', 'text/css; charset=utf-8']],
  ['/demo.mjs', ['web/demo.mjs', 'text/javascript; charset=utf-8']],
  ['/engine-motion.mjs', ['web/engine-motion.mjs', 'text/javascript; charset=utf-8']],
  ['/run-reference.mjs', ['web/run-reference.mjs', 'text/javascript; charset=utf-8']],
  ['/run-controller.mjs', ['web/run-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/usdc-coin.webp', ['web/assets/usdc-coin.webp', 'image/webp']],
  ['/assets/logo.svg', ['web/assets/logo.svg', 'image/svg+xml']],
  ['/evidence/solana-reference.json', ['../evidence/solana-reference.json', 'application/json; charset=utf-8']],
  ['/assets/anton.woff2', ['web/assets/anton.woff2', 'font/woff2']],
  ['/assets/inter-tight.woff2', ['web/assets/inter-tight.woff2', 'font/woff2']],
]);

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server=createServer(async (req, res) => {
  res.setHeader('cache-control','no-store');
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://test.rpc.fastnear.com https://archival-rpc.testnet.near.org https://testnet-rpc.intea.rs; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const host=req.headers.host;
    const localHost=['127.0.0.1:'+PORT,'localhost:'+PORT].includes(host);
    if(!localHost&&(!publicDemo||!allowedPublicHost(host)||(publicHost&&host!==publicHost)))return json(res,403,{error:'Use the configured demo address.'});
    if (req.method === 'POST' && req.url === '/api/demo-runs') {
      if (!liveDemo) return json(res,403,{error:'New transactions are disabled in this read-only preview.'});
      if (!acceptsDemoPost({host,origin:req.headers.origin,contentType:req.headers['content-type'],port:PORT,publicMode:publicDemo,publicHost,frontendOrigin})) return json(res,403,{error:'Use the configured demo page.'});
      const chunks=[]; let size=0;
      for await (const chunk of req) {size+=chunk.length;if(size>1024)return json(res,413,{error:'Request too large.'});chunks.push(chunk);}
      try {return json(res,202,liveDemo.start(JSON.parse(Buffer.concat(chunks).toString())));}
      catch {return json(res,409,{error:'Run refused. Use a fixed template, check the test budget, and review any interrupted run.'});}
    }
    if (req.method === 'GET' && req.url.startsWith('/api/demo-runs/')) {
      if (!liveDemo) return json(res,403,{error:'New transactions are disabled.'});
      const id=req.url.slice('/api/demo-runs/'.length);
      if(!/^[0-9a-f-]{36}$/.test(id))return json(res,400,{error:'Invalid request ID.'});
      const run=liveDemo.get(id);return json(res,run?200:404,run??{error:'Run not found.'});
    }
    if (req.method === 'GET' && publicFiles.has(req.url)) {
      const [file, type] = publicFiles.get(req.url);
      res.writeHead(200, { 'content-type': type });
      return res.end(readFileSync(join(HERE, file)));
    }
    if (req.method === 'GET' && req.url.startsWith('/api/payment-proof?')) {
      const query = new URL(req.url, 'http://127.0.0.1');
      const batchId = query.searchParams.get('batch');
      if (!readOnly || !['m1', 'e1'].includes(batchId)) return json(res, 400, { error: 'Choose a recorded sample batch.' });
      let entry = proofReads.get(batchId);
      if (!entry || Date.now() - entry.time > 30000) {
        const run=publishedRun(batchId==='m1'?'master':'publishing');
        const payout=run?.txs.find(tx=>tx.step==='distributing');
        const proofBatch=run?.batchId??batchId;
        const proofEvidence=run ? {contract:run.proof.contract,claims:[{id:`pay_out_${proofBatch}`,tx:payout.hash,signer:payout.signer,expect:{batch:proofBatch}}]} : evidence;
        entry = { time: Date.now(), promise: verifyPayment({ evidence:proofEvidence, batchId:proofBatch, rpcUrl: RPC_URL, transactionRpcUrl: process.env.NEAR_ARCHIVAL_RPC_URL ?? 'https://archival-rpc.testnet.near.org' }) };
        proofReads.set(batchId, entry);
        entry.promise.catch(() => { if (proofReads.get(batchId) === entry) proofReads.delete(batchId); });
      }
      try { return json(res, 200, await entry.promise); }
      catch { return json(res, 502, { error: 'Could not verify the public testnet evidence. Try again or open the transaction in the explorer.' }); }
    }
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page());
    }
    if (req.method === 'GET' && req.url === '/provas') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(join(HERE, '..', 'evidence', 'provas.html')));
    }
    if (req.method === 'GET' && req.url === '/csv.mjs') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(readFileSync(join(HERE, 'csv.mjs')));
    }
    if (req.method === 'GET' && req.url === '/statement.mjs') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(readFileSync(join(HERE, 'statement.mjs')));
    }
    if (req.method === 'GET' && req.url === '/split-engine.mjs') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(readFileSync(join(HERE, 'split-engine.mjs')));
    }
    if (req.method === 'GET' && req.url === '/templates.mjs') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(readFileSync(join(HERE, 'templates.mjs')));
    }
    if (req.method === 'GET' && req.url === '/api/config') {
      const { registry, token, root, gate } = state.accounts;
      const proofs = evidence?.contract === registry ? evidence.claims.map(({ id, tx }) => ({ id, tx })) : [];
      return json(res, 200, { registry, token, label: root, participants:{first:state.accounts.mc??`mc.${root}`,second:state.accounts.beat??`beat.${root}`}, gate, rpc: RPC_URL, explorer: EXPLORER, proofs, liveDemo:liveDemo?.info()??{enabled:false} });
    }
    if (req.method === 'POST' && req.url === '/api/relay') {
      return json(res, 403, { error: 'HTTP relayer disabled' });
    }
    json(res, 404, { error: 'não encontrado' });
  } catch {
    if(res.headersSent){res.destroy();return;}
    json(res, 503, { error: 'Demo data unavailable. Check this request again; no payment is retried automatically.' });
  }
});
server.requestTimeout=15000;
server.headersTimeout=10000;
server.keepAliveTimeout=5000;
server.maxHeadersCount=40;
server.listen(PORT,'127.0.0.1',()=>console.log(`página da fatura${readOnly?' (read-only)':''}: http://127.0.0.1:${PORT}${publicDemo?' (temporary public testnet mode)':''}`));
