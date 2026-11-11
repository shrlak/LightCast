import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
// @ts-expect-error plain ESM server modules
import { aiMiddleware } from './server/ai.mjs';
// @ts-expect-error plain ESM server modules
import { attachRelay } from './server/relay.mjs';
// @ts-expect-error plain ESM server modules
import { controlMiddleware } from './server/control.mjs';
// @ts-expect-error plain ESM server modules
import { dmxMiddleware } from './server/dmx.mjs';
// @ts-expect-error plain ESM server modules
import { x32Middleware } from './server/x32.mjs';
// @ts-expect-error plain ESM server modules
import { cloudMiddleware } from './server/cloud.mjs';
// @ts-expect-error plain ESM server modules
import { recognitionMiddleware } from './server/recognition.mjs';
// @ts-expect-error plain ESM server modules
import { songPptMiddleware } from './server/songPpt.mjs';
// @ts-expect-error plain ESM server modules
import { songLyricsMiddleware } from './server/songLyrics.mjs';

/** Dev server gets the same AI endpoints and remote relay as `npm start`. */
function freecastServer(): Plugin {
  return {
    name: 'freecast-server',
    configureServer(server) {
      server.middlewares.use(aiMiddleware);
      server.middlewares.use(recognitionMiddleware);
      server.middlewares.use(songPptMiddleware);
      server.middlewares.use(songLyricsMiddleware);
      server.middlewares.use(dmxMiddleware);
      server.middlewares.use(x32Middleware);
      server.middlewares.use(cloudMiddleware);
      if (server.httpServer) {
        const wss = attachRelay(server.httpServer);
        server.middlewares.use(controlMiddleware(wss));
      }
    },
  };
}

/**
 * pdf.js's character maps and standard fonts, which reading the text of a Korean 콘티 needs
 * (CID-keyed fonts such as Adobe-Korea1): served from node_modules in dev, copied into the build.
 */
function pdfAssets(): Plugin {
  const root = resolve('node_modules/pdfjs-dist');
  const dirs = ['cmaps', 'standard_fonts'];
  let outDir = 'dist';
  return {
    name: 'freecast-pdf-assets',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]);
        const dir = dirs.find((d) => path.startsWith(`/${d}/`));
        if (!dir) return next();
        const file = normalize(join(root, path));
        if (!file.startsWith(join(root, dir)) || !existsSync(file) || !statSync(file).isFile()) return next();
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      for (const d of dirs) cpSync(join(root, d), join(outDir, d), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), freecastServer(), pdfAssets()],
  server: { host: true },
  test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/setupEngine.ts'] },
});
