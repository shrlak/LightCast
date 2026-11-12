// Pictures and videos the remote needs to draw slides like the computer does. They live in the
// console's browser storage, so the console hands the ones in use to this server (PUT) and
// remotes fetch them (GET). Kept in memory only, capped, and gone when LightCast quits.
const MAX_FILE = 60 * 1024 * 1024;
const MAX_TOTAL = 300 * 1024 * 1024;
const files = new Map(); // id -> { type, buf }  (insertion order = age)
let total = 0;

const ID = /^[\w.-]{1,100}$/;

function remember(id, type, buf) {
  const old = files.get(id);
  if (old) {
    total -= old.buf.length;
    files.delete(id);
  }
  files.set(id, { type, buf });
  total += buf.length;
  for (const [k, v] of files) {
    if (total <= MAX_TOTAL) break;
    if (k === id) continue;
    files.delete(k);
    total -= v.buf.length;
  }
}

/** GET /remote-media/:id — answered on every address (it is only what slides show). */
export function remoteMediaGet(req, res) {
  const id = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname.slice('/remote-media/'.length));
  const f = ID.test(id) ? files.get(id) : null;
  if (!f) {
    res.writeHead(404, { 'cache-control': 'no-store' }).end();
    return;
  }
  res.writeHead(200, { 'content-type': f.type, 'content-length': f.buf.length, 'cache-control': 'private, max-age=3600' });
  res.end(f.buf);
}

/** PUT /api/remote-media/:id and HEAD for "do you have it?" — console side only. */
export async function remoteMediaMiddleware(req, res, next) {
  if (!req.url?.startsWith('/api/remote-media/')) return next();
  const id = decodeURIComponent(new URL(req.url, 'http://local').pathname.slice('/api/remote-media/'.length));
  const reply = (status) => res.writeHead(status).end();
  if (!ID.test(id)) return reply(400);
  if (req.method === 'HEAD') return reply(files.has(id) ? 200 : 404);
  if (req.method !== 'PUT') return reply(405);
  if (req.headers['sec-fetch-site'] === 'cross-site') return reply(403);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_FILE) return reply(413);
    chunks.push(c);
  }
  remember(id, String(req.headers['content-type'] || 'application/octet-stream'), Buffer.concat(chunks));
  reply(204);
}
