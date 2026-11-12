// Runs the 주일예배 cleanup on the church server without any LightCast window open (the GitHub Actions
// workflow .github/workflows/service-cleanup.yml calls this on a schedule). It signs in to the church
// account, reads the shared library, removes every service that has ended (5 pm Sunday, Korean time) with
// everything in its folder — sermon, 광고, 기도 … — but never the library songs, writes the library back
// and deletes the media files only those decks used.
//
//   LIGHTCAST_CLOUD_USER / LIGHTCAST_CLOUD_PASSWORD   the church account (required)
//   FREECAST_CLOUD_URL                                  Worker address (default: the church Worker)
//   FREECAST_CLOUD_ORIGIN                               origin the Worker allows (default: the church site)
import { rolldown } from 'rolldown';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const user = process.env.LIGHTCAST_CLOUD_USER;
const password = process.env.LIGHTCAST_CLOUD_PASSWORD;
if (!user || !password) {
  console.log('LIGHTCAST_CLOUD_USER / LIGHTCAST_CLOUD_PASSWORD are not set: nothing to do.');
  process.exit(0);
}
const base = (process.env.FREECAST_CLOUD_URL || 'https://lyrics-ai-proxy.spencerkim1235.workers.dev').replace(/\/+$/, '');
const origin = process.env.FREECAST_CLOUD_ORIGIN || 'https://shrlak.github.io';

// The app's own TypeScript (the cleanup rules and the library reader) is bundled so the server job
// removes exactly what the app would.
const dir = mkdtempSync(path.join(tmpdir(), 'lightcast-cleanup-'));
const out = path.join(dir, 'core.mjs');
try {
  const entry = path.join(dir, 'entry.ts');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(entry, `export { cleanupFinishedServices } from ${JSON.stringify(path.join(root, 'src/domain/sunday/serverCleanup.ts'))};\nexport { normalizeLibrary } from ${JSON.stringify(path.join(root, 'src/domain/persistence.ts'))};\n`);
  const bundle = await rolldown({ input: entry, platform: 'node', logLevel: 'silent' });
  await bundle.write({ file: out, format: 'esm' });
  await bundle.close();
  const { cleanupFinishedServices, normalizeLibrary } = await import(pathToFileURL(out).href);

  const call = async (p, init = {}, token) => {
    const headers = { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}) };
    const res = await fetch(`${base}/freecast/${p}`, { ...init, headers, signal: AbortSignal.timeout(120_000) });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, data };
  };

  const login = await call('login', { method: 'POST', body: JSON.stringify({ username: user, password }) });
  if (login.status !== 200 || !login.data?.token) throw new Error(`login failed (${login.status})`);
  const token = login.data.token;
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const got = await call('library', {}, token);
      if (got.status !== 200) throw new Error(`could not read the library (${got.status})`);
      const lib = normalizeLibrary(got.data.data);
      if (!lib) throw new Error('the server library is not readable');
      const result = cleanupFinishedServices(lib, new Date());
      if (!result) { console.log('No finished service to remove.'); break; }
      const put = await call('library', { method: 'PUT', body: JSON.stringify({ baseVersion: got.data.version, data: result.library }) }, token);
      if (put.status === 409) { console.log(`Library changed meanwhile, trying again (${attempt}/3).`); continue; }
      if (put.status !== 200) throw new Error(`could not save the library (${put.status})`);
      for (const id of result.removedMediaIds) {
        const del = await call(`media/${encodeURIComponent(id)}`, { method: 'DELETE' }, token);
        if (del.status >= 400 && del.status !== 404) console.log(`media ${id}: delete answered ${del.status}`);
      }
      console.log(`Removed ${result.removedPlaylists} service(s), ${result.removedPresentations} deck(s), ${result.removedMediaIds.length} file(s).`);
      break;
    }
  } finally {
    await call('logout', { method: 'POST' }, token).catch(() => undefined);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
