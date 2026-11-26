// /api/cloud/* → the church Worker's /freecast/* routes (accounts + shared slide library).
// /api/songs   → the Worker's /libraries/lyrics: the 찬양 라이브러리 the ppt site reads and registers
//                songs into (registration needs no password; DELETE requires the administrator token).
// Going through this local server means the Worker sees its allowed origin and the browser
// never deals with CORS. FREECAST_CLOUD_URL overrides the Worker address (e.g. wrangler dev).
import { aiConfig } from './aiProviders.mjs';

const cloudBase = () => (process.env.FREECAST_CLOUD_URL || aiConfig().proxyUrl).replace(/\/+$/, '');

export async function cloudMiddleware(req, res, next) {
  const songs = req.url === '/api/songs' || req.url?.startsWith('/api/songs?');
  if (!req.url?.startsWith('/api/cloud/') && !songs) return next();
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    res.writeHead(403, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Cross-site requests are not allowed' }));
  }
  const target = songs
    ? `${aiConfig().proxyUrl.replace(/\/+$/, '')}/libraries/lyrics`
    : `${cloudBase()}/freecast/${req.url.slice('/api/cloud/'.length)}`;
  const headers = { Origin: aiConfig().proxyOrigin };
  for (const h of ['authorization', 'content-type', 'x-admin-password', 'x-freecast-reset-id']) if (req.headers[h]) headers[h] = req.headers[h];
  try {
    const hasBody = !['GET', 'HEAD'].includes(req.method ?? 'GET');
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req : undefined,
      duplex: hasBody ? 'half' : undefined,
      signal: AbortSignal.timeout(120_000),
    });
    const out = { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'no-store' };
    // The church server's own clock (its Date header): every computer stamps edits in server time (src/domain/serverClock.ts).
    const date = upstream.headers.get('date');
    if (date) out['x-lightcast-server-date'] = date;
    res.writeHead(upstream.status, out);
    if (upstream.status === 204 || !upstream.body) return res.end();
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `클라우드 서버에 연결할 수 없습니다 (${e.message})` }));
  }
}
