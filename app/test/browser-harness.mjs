// Test-only UI fault server. It never imports signing/RPC code or reads .keys.
// Start explicitly: node test/browser-harness.mjs (PORT optionally overrides 8792).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS = ['post-refused','lost-response','read-offline','bad-proof','busy-peer','no-config','storage-blocked','slow-lookup','missing-run'];
const PEER_ID = '11111111-1111-4111-8111-111111111111';
const MISSING_ID = '33333333-3333-4333-8333-333333333333';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FIXTURE_ROOT = 'ui-fixture.testnet';
const CONTRACT = `rights.${FIXTURE_ROOT}`;
const FILES = new Map([
  ['/demo.css',['web/demo.css','text/css; charset=utf-8']],
  ['/engine-motion.css',['web/engine-motion.css','text/css; charset=utf-8']],
  ['/demo.mjs',['web/demo.mjs','text/javascript; charset=utf-8']],
  ['/engine-motion.mjs',['web/engine-motion.mjs','text/javascript; charset=utf-8']],
  ['/run-reference.mjs',['web/run-reference.mjs','text/javascript; charset=utf-8']],
  ['/run-controller.mjs',['web/run-controller.mjs','text/javascript; charset=utf-8']],
  ['/csv.mjs',['csv.mjs','text/javascript; charset=utf-8']],
  ['/statement.mjs',['statement.mjs','text/javascript; charset=utf-8']],
  ['/split-engine.mjs',['split-engine.mjs','text/javascript; charset=utf-8']],
  ['/templates.mjs',['templates.mjs','text/javascript; charset=utf-8']],
  ['/assets/usdc-coin.webp',['web/assets/usdc-coin.webp','image/webp']],
  ['/assets/logo.svg',['web/assets/logo.svg','image/svg+xml']],
  ['/assets/anton.woff2',['web/assets/anton.woff2','font/woff2']],
  ['/assets/inter-tight.woff2',['web/assets/inter-tight.woff2','font/woff2']],
]);

function fixtureRun(input, status='running') {
  const publishing=input.template==='publishing';
  return {...input,network:'testnet',status,step:'distributing',batchId:`demo-${input.requestId.replaceAll('-','')}`,
    amount:publishing?'1000000':'2000000',ledgerHash:'0'.repeat(64),txs:[],
    uiFaultFixture:true,networkTransactions:false,
    message:'UI fault fixture only. No transaction was signed or sent to any network.'};
}
function failedProof(run) {
  const publishing=run.template==='publishing';
  const amounts=publishing?['250000','450000','300000']:['800000','840000','360000'];
  const accounts=[FIXTURE_ROOT,`mc.${FIXTURE_ROOT}`,`beat.${FIXTURE_ROOT}`];
  const roles=publishing?['Publisher','Writer 1','Writer 2']:['Label','Artist','Beatmaker'];
  const tx='UI_FIXTURE_NOT_A_NETWORK_TRANSACTION';
  return {...run,status:'verified',step:'verifying',txs:[{step:'distributing',hash:tx,signer:FIXTURE_ROOT}],
    proof:{matched:false,contract:CONTRACT,assetContract:`usdc.${FIXTURE_ROOT}`,batchId:run.batchId,
      tokenId:publishing?'T0000000001:publishing_performance':'PYXXX2600001:master',tx,
      amount:String(BigInt(run.amount)-1n),block:0,checkedAt:'2026-11-14T00:00:00.000Z',
      rows:accounts.map((account,i)=>({account,role:roles[i],bps:(publishing?[2500,4500,3000]:[4000,4200,1800])[i],
        expected:amounts[i],actual:i===0?String(BigInt(amounts[i])-1n):amounts[i],matched:i!==0})),
      checks:{transaction:true,receipt:true,amounts:false,total:false,recipients:true}},
    message:'Intentionally inconsistent UI fixture: the UI must reject this proof.'};
}

export function createBrowserHarness({port=8792}={}) {
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Choose a local test port.');
  let scenario='post-refused', generation=0, runs=new Map(), requestLog=new Map(), calls, review=false;
  function reset(next) {
    scenario=next;generation++;runs=new Map();requestLog=new Map();review=false;
    calls={config:0,post:0,runGet:0,rpcBlocked:0,proofBlocked:0};
    if(scenario==='busy-peer') {
      runs.set(PEER_ID,fixtureRun({requestId:PEER_ID,template:'master'}));
      requestLog.set(PEER_ID,{requestId:PEER_ID,posts:0,reads:0,accepted:true,preExisting:true});
    }
  }
  reset(scenario);
  const entry=id=>{
    if(!requestLog.has(id))requestLog.set(id,{requestId:id,posts:0,reads:0,accepted:false});
    return requestLog.get(id);
  };
  const stats=()=>({uiFaultTest:true,networkTransactions:0,scenario,generation,calls:{...calls},
    requests:[...requestLog.values()].map(x=>({...x})),storedRunIds:[...runs.keys()],needsReview:review});
  const json=(res,code,value)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
  function html() {
    const controls=SCENARIOS.map(name=>`<a href="/?scenario=${name}&amp;reset=1${name==='missing-run'?'&amp;run='+MISSING_ID:''}"${name===scenario?' aria-current="page"':''}>${name}</a>`).join(' ');
    const styles=`<style>.ui-fault-banner{position:sticky;top:0;z-index:9999;padding:14px 20px;background:#ffe9a8;color:#241900;border-bottom:3px solid #d47a00;font:14px/1.4 Arial,sans-serif}.ui-fault-banner strong{display:block;font-size:18px}.ui-fault-banner p{margin:5px 0}.ui-fault-banner nav{display:flex;flex-wrap:wrap;gap:8px 15px;border:0;padding:5px 0;margin:0;font:12px Arial,sans-serif}.ui-fault-banner a{color:#241900}.ui-fault-banner [aria-current=page]{font-weight:bold;text-decoration:underline}.ui-fault-log{max-width:1160px;margin:20px auto;padding:16px;border:2px solid #d47a00;color:#ffe9a8;font:13px/1.5 monospace}.ui-fault-log pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto}.ui-fault-log button{font:12px Arial,sans-serif;min-height:32px;padding:5px 10px}</style>`;
    const banner=`<aside class="ui-fault-banner" role="note" aria-label="UI fault test"><strong>UI fault test — no network transactions</strong><p>Scenario: <b>${scenario}</b>. Every API result below is a local fixture. No wallet keys, signing or public RPC.</p><nav aria-label="UI fault scenarios">${controls}</nav></aside>`;
    const log=`<details class="ui-fault-log"><summary>Test request log</summary><p>Local HTTP counts only. A network transaction count above zero is never possible in this harness.</p><button id="uiFaultRefresh" type="button">Refresh test log</button><pre id="uiFaultStats">Loading local request counts…</pre></details>`;
    const script=`<script>
      (()=>{
        const url=new URL(location.href);
        if(url.searchParams.has('reset')) {
          try { sessionStorage.removeItem('bmzTestnetRun'); } catch {}
          url.searchParams.delete('reset');
          if(${JSON.stringify(scenario)}!=='missing-run')url.searchParams.delete('run');
          history.replaceState(history.state??null,'',url.href);
        }
        if(${JSON.stringify(scenario)}==='storage-blocked')Object.defineProperty(window,'sessionStorage',{
          configurable:true,get(){throw new DOMException('UI fault fixture: browser storage blocked.','SecurityError');}
        });
        addEventListener('DOMContentLoaded',()=>{
          const output=document.getElementById('uiFaultStats');
          const refresh=async()=>{try{const response=await fetch('/test-stats',{cache:'no-store'});output.textContent=JSON.stringify(await response.json(),null,2);}catch{output.textContent='Local test log unavailable.';}};
          document.getElementById('uiFaultRefresh').onclick=refresh;
          refresh();setInterval(refresh,750);
        },{once:true});
      })();
    </script>`;
    return readFileSync(join(APP,'web/index.html'),'utf8').replace('</head>',styles+script+'</head>')
      .replace('<body>','<body>'+banner).replace('</body>',log+'</body>');
  }
  return createServer(async(req,res)=>{
    res.setHeader('content-security-policy',"default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; frame-src 'none'");
    const host=req.headers.host;
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return json(res,403,{error:'Use this loopback test server.'});
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      if(req.method==='GET'&&url.pathname==='/') {
        const selected=url.searchParams.get('scenario')??scenario;
        if(!SCENARIOS.includes(selected))return json(res,400,{error:'Unknown UI fault scenario.',scenarios:SCENARIOS});
        if(selected!==scenario||url.searchParams.has('reset'))reset(selected);
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(html());
      }
      if(req.method==='GET'&&FILES.has(url.pathname)) {
        const [file,type]=FILES.get(url.pathname);res.writeHead(200,{'content-type':type,'cache-control':'no-store'});return res.end(readFileSync(join(APP,file)));
      }
      if(req.method==='GET'&&url.pathname==='/test-stats')return json(res,200,stats());
      if(req.method==='GET'&&url.pathname==='/api/config') {
        calls.config++;
        if(scenario==='no-config')return json(res,503,{error:'UI fixture: configuration unavailable.'});
        const active=scenario==='missing-run'?null:[...runs.values()].find(run=>run.status==='running');
        return json(res,200,{registry:CONTRACT,token:`usdc.${FIXTURE_ROOT}`,label:FIXTURE_ROOT,gate:`gate.${FIXTURE_ROOT}`,
          rpc:`http://${host}/test-rpc`,explorer:'https://testnet.nearblocks.io',proofs:[],
          uiFaultFixture:true,liveDemo:{enabled:true,remaining:Math.max(0,10-runs.size),needsReview:review,
            activeRun:active?{requestId:active.requestId,template:active.template,status:active.status,step:active.step}:null}});
      }
      if(req.method==='POST'&&url.pathname==='/api/demo-runs') {
        calls.post++;
        if(req.headers.origin!==`http://${host}`)return json(res,403,{error:'Use the local UI fault page.'});
        let size=0;const chunks=[];
        for await(const chunk of req){size+=chunk.length;if(size>1024)return json(res,413,{error:'Fixture request too large.'});chunks.push(chunk);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'Malformed fixture request.'});}
        if(!UUID.test(input?.requestId)||!['master','publishing'].includes(input?.template))return json(res,400,{error:'Use a fixed fixture template and UUID.'});
        const record=entry(input.requestId);record.posts++;
        if(scenario==='post-refused')return json(res,409,{error:'UI fixture: payment request was refused before execution.'});
        if(scenario==='no-config'||scenario==='busy-peer')return json(res,409,{error:'UI fixture: this session cannot start another request.'});
        if(!runs.has(input.requestId)){runs.set(input.requestId,fixtureRun(input));record.accepted=true;}
        else if(runs.get(input.requestId).template!==input.template)return json(res,409,{error:'Fixture ID belongs to another template.'});
        if(scenario==='lost-response')return json(res,502,{error:'UI fixture: request accepted, response deliberately unavailable.'});
        return json(res,202,runs.get(input.requestId));
      }
      if(req.method==='GET'&&url.pathname.startsWith('/api/demo-runs/')) {
        calls.runGet++;
        const id=url.pathname.slice('/api/demo-runs/'.length),record=entry(id);record.reads++;
        if(!UUID.test(id))return json(res,400,{error:'Invalid fixture request ID.'});
        if(scenario==='missing-run')return json(res,404,{error:'UI fixture: this public run reference does not exist. No metadata or network lookup is available.'});
        if(scenario==='read-offline')return json(res,503,{error:'UI fixture: saved run reads unavailable.'});
        const run=runs.get(id);if(!run)return json(res,404,{error:'Fixture run not found. No network lookup was performed.'});
        if(scenario==='bad-proof'){const bad=failedProof(run);runs.set(id,bad);review=true;return json(res,200,bad);}
        if(scenario==='busy-peer'||record.reads>1){run.status='needs-review';run.message='UI fixture: execution deliberately interrupted; no network transaction exists.';review=true;}
        return json(res,200,run);
      }
      if(url.pathname==='/test-rpc'){
        calls.rpcBlocked++;
        if(scenario==='slow-lookup')await new Promise(resolve=>setTimeout(resolve,5000));
        return json(res,503,{error:'Public RPC disabled in UI fault harness.'});
      }
      if(url.pathname==='/api/payment-proof'){calls.proofBlocked++;return json(res,503,{error:'No on-chain verification occurs in UI fault harness.'});}
      if(req.method==='GET'&&url.pathname==='/provas'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end('<h1>UI fault test — no network transactions</h1><p>This harness has no real transaction evidence.</p><a href="/">Return to the local fixture</a>');}
      return json(res,404,{error:'Not a public UI test asset.'});
    }catch{return json(res,500,{error:'Local UI fault harness failed. No network transaction was possible.'});}
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT??8792);
  createBrowserHarness({port}).listen(port,'127.0.0.1',()=>{
    console.log(`UI fault test — no network transactions: http://127.0.0.1:${port}/?scenario=post-refused&reset=1`);
  });
}
