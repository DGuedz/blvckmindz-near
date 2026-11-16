// Publish the UI and selected public proof files. Signing and execution remain
// on the operator's bounded testnet engine, behind the explicit API proxy.
import { mkdirSync, writeFileSync, copyFileSync, lstatSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildVercelConfig } from './prepare-vercel.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const PUBLIC_UI_FILES=Object.freeze([
  ...['index.html','demo.css','demo.mjs','engine-motion.css','engine-motion.mjs','run-controller.mjs','run-reference.mjs'].map(n=>[`app/web/${n}`,n]),
  ...['csv.mjs','statement.mjs','split-engine.mjs','templates.mjs'].map(n=>[`app/${n}`,n]),
  ...['logo.svg','usdc-coin.webp','anton.woff2','inter-tight.woff2','Anton-OFL.txt','Inter-Tight-OFL.txt','NOTICES.md'].map(n=>[`app/web/assets/${n}`,`assets/${n}`]),
  ['evidence/provas.html','provas.html'],
  ...['index.html','quickstart.html','rights.html','execution.html','verification.html','architecture.html','limits.html','docs.css'].map(n=>[`app/web/docs/${n}`,`docs/${n}`]),
  ['evidence/solana-reference.json','evidence/solana-reference.json'],
  ['evidence/live-runs/76cd07e4-95f0-4477-8a79-becaacf31538.json','evidence/live-runs/76cd07e4-95f0-4477-8a79-becaacf31538.json'],
  ['evidence/protection/76cd07e4-95f0-4477-8a79-becaacf31538.json','evidence/protection/76cd07e4-95f0-4477-8a79-becaacf31538.json'],
]);
export function staticVercelConfig(origin) {
  const upstream=buildVercelConfig(origin).routes[0].dest;
  return {version:2,framework:null,installCommand:null,buildCommand:null,routes:[
    {src:'/(.*)',headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://test.rpc.fastnear.com https://archival-rpc.testnet.near.org https://testnet-rpc.intea.rs; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'"},continue:true},
    {src:'/api/(.*)',dest:upstream.replace('/$1','/api/$1'),headers:{'x-vercel-enable-rewrite-caching':'0'}},
    {src:'/provas',dest:'/provas.html'},
    {src:'/docs/?',dest:'/docs/index.html'},
    ...['quickstart','rights','execution','verification','architecture','limits'].map(n=>({src:`/docs/${n}/?`,dest:`/docs/${n}.html`})),
    {handle:'filesystem'},
  ]};
}
export function prepareStaticVercel(origin,outputFolder,sourceRoot=ROOT) {
  const config=staticVercelConfig(origin);
  if(typeof outputFolder!=='string'||!outputFolder.trim())throw new TypeError('Choose a fresh output folder.');
  // Validate the whole explicit input set before creating the output.
  for(const [source] of PUBLIC_UI_FILES)if(!lstatSync(join(sourceRoot,source)).isFile())throw new TypeError('Public input must be a regular file.');
  const target=resolve(outputFolder);mkdirSync(target);
  for(const [source,destination] of PUBLIC_UI_FILES){
    const out=join(target,destination);mkdirSync(dirname(out),{recursive:true});copyFileSync(join(sourceRoot,source),out);
  }
  writeFileSync(join(target,'vercel.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
  return target;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==4)throw new TypeError('Usage: node prepare-static-vercel.mjs <origin> <fresh-output-folder>');
    console.log(`Prepared static UI: ${prepareStaticVercel(process.argv[2],process.argv[3])}`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
