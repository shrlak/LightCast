// The LightCast server: built app + AI endpoints + remote-control relay.
// Used by `npm start` (server/serve.mjs) and by the desktop app (electron/main.mjs).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { aiMiddleware } from './ai.mjs';
import { attachRelay } from './relay.mjs';
import { isPublicHost } from './tunnel.mjs';
import { remoteMediaGet, remoteMediaMiddleware } from './remoteMedia.mjs';
import { controlMiddleware } from './control.mjs';
import { dmxMiddleware } from './dmx.mjs';
import { x32Middleware } from './x32.mjs';
import { cloudMiddleware } from './cloud.mjs';
import { recognitionMiddleware } from './recognition.mjs';
import { songPptMiddleware } from './songPpt.mjs';
import { songLyricsMiddleware } from './songLyrics.mjs';
import { fontFinderMiddleware } from './fontFinder.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
};
/** Files worth compressing (text and WebAssembly); pictures, fonts and media are compressed already. */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.wasm', '.txt', '.dic', '.aff', '.map']);
const COMPRESS_MIN = 1024;
const COMPRESS_MAX = 40 * 1024 * 1024;
/** Vite's built files carry a content hash in their name: they never change, so browsers keep them. */
const HASHED = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

/** A request from this computer (the app's own windows): compressing costs time and saves nothing there. */
const loopback = (req) => { const a = req.socket?.remoteAddress ?? ''; return a === '127.0.0.1' || a === '::1' || a.startsWith('::ffff:127.'); };

export function staticHandler(root) {
  /** Compressed copies, made once per file version (the first phone waits for it, every later one gets it at once). */
  const packed = new Map();
  const compressed = (file, stat, encoding) => {
    const key = `${file}|${stat.mtimeMs}|${stat.size}|${encoding}`;
    let job = packed.get(key);
    if (!job) {
      job = fs.promises.readFile(file).then((buf) => new Promise((resolve, reject) => {
        const done = (err, out) => (err ? reject(err) : resolve(out));
        if (encoding === 'br') zlib.brotliCompress(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }, done);
        else zlib.gzip(buf, { level: 6 }, done);
      }));
      job.catch(() => packed.delete(key));
      for (const k of packed.keys()) if (k.startsWith(`${file}|`) && !k.endsWith(`|${stat.size}|${encoding}`)) packed.delete(k);
      packed.set(key, job);
    }
    return job;
  };
  const stats = async (file) => { try { const st = await fs.promises.stat(file); return st.isFile() ? st : null; } catch { return null; } };
  return async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    // Resolve inside `root` only; anything that escapes it falls back to the app shell.
    const file = path.resolve(root, '.' + path.posix.normalize(pathname));
    const inside = file === root || file.startsWith(root + path.sep);
    let target = inside ? file : path.join(root, 'index.html');
    let stat = inside ? await stats(file) : null;
    if (!stat) { target = path.join(root, 'index.html'); stat = await stats(target); }
    if (!stat) { res.writeHead(404).end(); return; }
    const ext = path.extname(target).toLowerCase();
    const etag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
    const headers = {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      etag,
      // Hashed files are kept for a year; everything else is checked each time (a 304 answer when unchanged).
      'cache-control': HASHED.test(target.split(path.sep).join('/')) ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    if (COMPRESSIBLE.has(ext)) headers.vary = 'Accept-Encoding';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return; }
    const accept = String(req.headers['accept-encoding'] ?? '');
    const encoding = !COMPRESSIBLE.has(ext) || stat.size < COMPRESS_MIN || stat.size > COMPRESS_MAX || (loopback(req) && !isPublicHost(req.headers.host)) ? null
      : /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
    if (encoding) {
      try {
        const body = await compressed(target, stat, encoding);
        res.writeHead(200, { ...headers, 'content-encoding': encoding, 'content-length': body.length });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      } catch { /* sent as it is */ }
    }
    res.writeHead(200, { ...headers, 'content-length': stat.size });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(target).on('error', () => res.destroy()).pipe(res);
  };
}

export function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

/**
 * Start the server. `host` 127.0.0.1 keeps it private to this computer;
 * 0.0.0.0 lets phones and other computers on the network connect.
 */
export function startServer({ root, port, host = '127.0.0.1', publicOpen = () => false, teamKey = () => '' }) {
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error(`App files not found in ${root} — run \`npm run build\` first.`);
  const serveFile = staticHandler(path.resolve(root));
  const serveStatic = (req, res) => serveFile(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  let control = (_req, _res, next) => next();
  // Visitors on the public internet address get the app files and the remote relay only:
  // no AI, cloud, DMX, X32, song search, font search or control endpoints.
  const everything = (req, res) => remoteMediaMiddleware(req, res, () => aiMiddleware(req, res, () => recognitionMiddleware(req, res, () => songPptMiddleware(req, res, () => songLyricsMiddleware(req, res, () => fontFinderMiddleware(req, res, () => cloudMiddleware(req, res, () => dmxMiddleware(req, res, () => x32Middleware(req, res, () => control(req, res, () => serveStatic(req, res)))))))))));
  // The console (and its login) is never offered on the internet address: any page there is the remote.
  const publicPage = (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (req.method === 'GET' && url.pathname.startsWith('/remote-media/')) return remoteMediaGet(req, res);
    if (!/\.\w+$/.test(url.pathname) && !['remote', 'team'].includes(url.searchParams.get('view'))) {
      res.writeHead(302, { location: '/?view=remote' });
      return res.end();
    }
    serveStatic(req, res);
  };
  const server = http.createServer((req, res) => (isPublicHost(req.headers.host) ? publicPage(req, res) : req.method === 'GET' && req.url?.startsWith('/remote-media/') ? remoteMediaGet(req, res) : everything(req, res)));
  const wss = attachRelay(server, { publicOpen, teamKey });
  control = controlMiddleware(wss);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve({
        server,
        port: server.address().port,
        close: () => new Promise((done) => {
          for (const c of wss.clients) c.terminate();
          wss.close();
          server.closeAllConnections?.();
          server.close(() => done());
        }),
      });
    });
  });
}
