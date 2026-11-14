// Same-origin policy for the loopback demo and an explicitly enabled temporary tunnel.
// This module does not add CORS headers or trust forwarded-host headers.
const PUBLIC_HOST=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/;
const FRONTEND_ORIGIN=/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/;
const CONTROL=/[\x00-\x1f\x7f]/;
const JSON_TYPE=/^application\/json(?: *; *charset *= *(?:utf-8|"utf-8"))?$/i;
const header=value=>typeof value==='string'&&value.length>0&&!CONTROL.test(value);

// Optional startup configuration should call this only when a pin was supplied.
export function allowedPublicHost(value) {
  return header(value)&&PUBLIC_HOST.test(value);
}

export function allowedFrontendOrigin(value) {
  return header(value)&&FRONTEND_ORIGIN.test(value);
}

export function acceptsDemoPost(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))return false;
  const {host,origin,contentType,port,publicMode=false,publicHost,frontendOrigin}=input;
  if(!header(host)||!header(origin)||!header(contentType)||!JSON_TYPE.test(contentType)
      ||!Number.isInteger(port)||port<1||port>65535||typeof publicMode!=='boolean')return false;
  if(publicHost!==undefined&&!allowedPublicHost(publicHost))return false;

  const loopback=host===`127.0.0.1:${port}`||host===`localhost:${port}`;
  if(loopback)return origin===`http://${host}`;
  if(!publicMode||!allowedPublicHost(host))return false;
  if(frontendOrigin!==undefined&&!allowedFrontendOrigin(frontendOrigin))return false;
  if(publicHost!==undefined&&host!==publicHost)return false;
  return origin===`https://${host}`||(frontendOrigin!==undefined&&origin===frontendOrigin);
}
