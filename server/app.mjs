// The FreeCast server: built app + AI endpoints + remote-control relay.
// Used by `npm start` (server/serve.mjs) and by the desktop app (electron/main.mjs).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
};

function staticHandler(root) {
  return (req, res) => {
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
    const target = inside && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream' });
    fs.createReadStream(target).pipe(res);
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
  const serveStatic = staticHandler(path.resolve(root));
  let control = (_req, _res, next) => next();
  // Visitors on the public internet address get the app files and the remote relay only:
  // no AI, cloud, DMX, X32, song search or control endpoints.
  const everything = (req, res) => remoteMediaMiddleware(req, res, () => aiMiddleware(req, res, () => recognitionMiddleware(req, res, () => songPptMiddleware(req, res, () => songLyricsMiddleware(req, res, () => cloudMiddleware(req, res, () => dmxMiddleware(req, res, () => x32Middleware(req, res, () => control(req, res, () => serveStatic(req, res))))))))));
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
