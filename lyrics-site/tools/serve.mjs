import { createServer, request as upstreamRequest } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.LYRICS_PORT || 8094);
const apiPort = Number(process.env.LYRICS_API_PORT || 0);
const types = { html: 'text/html; charset=utf-8', js: 'application/javascript', mjs: 'application/javascript', css: 'text/css', json: 'application/json', webmanifest: 'application/manifest+json', svg: 'image/svg+xml', wasm: 'application/wasm' };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const apiPrefix = ['/lyrics/api/', '/api/'].find(prefix => url.pathname.startsWith(prefix));
  if (apiPort && apiPrefix) {
    const upstream = upstreamRequest({ hostname: '127.0.0.1', port: apiPort, path: '/' + url.pathname.slice(apiPrefix.length) + url.search, method: request.method, headers: request.headers }, reply => {
      response.writeHead(reply.statusCode, reply.headers); reply.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('API unavailable'); });
    request.pipe(upstream); return;
  }
  if (url.pathname === '/lyrics') { response.writeHead(301, { Location: '/lyrics/' }); response.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { response.writeHead(400); response.end(); return; }
  const relative = pathname.startsWith('/lyrics/') ? pathname.slice('/lyrics/'.length) : pathname.slice(1);
  const candidate = resolve(root, relative || 'index.html');
  if (candidate !== root && !candidate.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
  try {
    if (!(await stat(candidate)).isFile()) throw new Error('Not a file');
    const data = await readFile(candidate);
    response.writeHead(200, { 'Content-Type': types[candidate.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Lyrics preview: http://127.0.0.1:${port}/lyrics/ (same artifact also at /)`));
