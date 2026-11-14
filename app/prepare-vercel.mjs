// Build a two-file public entry directory. No application code, keys, run
// state, dependencies or environment files are copied into the deployment.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allowedPublicHost } from './demo-http-policy.mjs';

export function buildVercelConfig(origin) {
  // Check the original spelling too: URL() normalizes explicit :443, dot
  // segments, whitespace and some backslashes that this boundary refuses.
  if (typeof origin !== 'string' || /\s|[\x00-\x1f\x7f]/u.test(origin)) {
    throw new TypeError('Use an HTTPS trycloudflare origin without a path, port or credentials.');
  }
  const match = /^https:\/\/([^/?#:]+)\/?$/.exec(origin);
  if (!match || !allowedPublicHost(match[1])) {
    throw new TypeError('Use an HTTPS trycloudflare origin without a path, port or credentials.');
  }
  const target = `https://${match[1]}`;
  return {
    version:2,
    framework:null,
    installCommand:null,
    buildCommand:null,
    // Resolve the origin before static files: index.html is only a package
    // placeholder, never the live demo or an automatic upstream fallback.
    routes:[{src:'/(.*)',dest:`${target}/$1`,headers:{
      'Cache-Control':'no-store','x-vercel-enable-rewrite-caching':'0',
    }}],
  };
}

const maintenance = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>BLVCK MINDZ · Demo</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#050505;color:#edebe6;font:16px/1.5 Arial,Helvetica,sans-serif}main{min-height:100svh;max-width:720px;margin:auto;padding:48px 28px;display:flex;flex-direction:column;justify-content:center}.brand{font-size:13px;font-weight:700;letter-spacing:.12em;color:#66ffdd;border-bottom:1px solid #363632;padding-bottom:18px}h1{font-size:clamp(30px,7vw,48px);font-weight:600;letter-spacing:-.03em;line-height:1.1;margin:32px 0 12px}p{color:#bdb8ae;margin:0}
</style>
</head>
<body><main><p class="brand">BLVCK MINDZ</p><h1>We’ll be right back.</h1><p>The demo is temporarily unavailable.</p></main></body>
</html>
`;

export function prepareVercel(origin, outputFolder) {
  const config = buildVercelConfig(origin);
  if (typeof outputFolder !== 'string' || outputFolder.trim().length === 0) {
    throw new TypeError('Choose a new output folder.');
  }
  const target = resolve(outputFolder);
  // mkdir without recursive is exclusive: an existing directory, file or
  // symlink is refused before writing any deployment file.
  mkdirSync(target);
  writeFileSync(join(target,'vercel.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
  writeFileSync(join(target,'index.html'),maintenance,{flag:'wx'});
  return target;
}

export function main(args = process.argv.slice(2)) {
  if (args.length !== 2) throw new TypeError('Usage: node prepare-vercel.mjs <origin> <new-output-folder>');
  return prepareVercel(args[0],args[1]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(`Prepared public entry: ${main()}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode=1; }
}
