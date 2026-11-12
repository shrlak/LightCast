// Internet access for the phone/tablet remote: a public https address that reaches this computer's
// LightCast server from any network. It runs Cloudflare's free "quick tunnel" (cloudflared: no
// account, no time limit), downloaded once into the app's data folder. Everything arriving through
// the tunnel is treated as "public" (see isPublicHost) and limited to the remote.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RELEASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
// Where each computer type gets its cloudflared from (the Mac ones are .tgz archives).
const ASSETS = {
  'darwin-arm64': 'cloudflared-darwin-arm64.tgz',
  'darwin-x64': 'cloudflared-darwin-amd64.tgz',
  'win32-x64': 'cloudflared-windows-amd64.exe',
  'win32-arm64': 'cloudflared-windows-amd64.exe',
  'linux-x64': 'cloudflared-linux-amd64',
  'linux-arm64': 'cloudflared-linux-arm64',
};
const URL_RE = /https:\/\/(?!api\.)[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;

/** Which cloudflared download this computer needs, or null when there is none. */
export function cloudflaredAsset(platform = process.platform, arch = process.arch) {
  return ASSETS[`${platform}-${arch}`] ?? null;
}

/** Terminal colour codes and other control characters removed (cloudflared logs are plain, but be safe). */
export function cleanOutput(text) {
  return String(text)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

/** Pull the public address out of cloudflared's log. */
export function parseTunnelUrl(text) {
  return URL_RE.exec(cleanOutput(text))?.[0].toLowerCase() ?? null;
}

/** cloudflared's own status server on this computer ("Starting metrics server on 127.0.0.1:53421/metrics"). */
export function parseMetricsAddress(text) {
  return /Starting metrics server on (127\.0\.0\.1|localhost|\[::1\]):(\d+)/i.exec(cleanOutput(text))?.slice(1, 3).join(':') ?? null;
}

async function run(cmd, args) {
  await new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
    c.on('error', reject);
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 종료 코드 ${code}`))));
  });
}

/** Path of cloudflared in `dir`, downloading it first when it is not there yet. */
export async function ensureCloudflared(dir, onNote) {
  const asset = cloudflaredAsset();
  if (!asset) throw new Error(`이 컴퓨터(${process.platform}/${process.arch})용 cloudflared가 없습니다.`);
  const bin = path.join(dir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (fs.existsSync(bin)) return bin;
  fs.mkdirSync(dir, { recursive: true });
  onNote?.('인터넷 연결 프로그램(cloudflared)을 내려받는 중…');
  const res = await fetch(`${RELEASE}/${asset}`, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`cloudflared 다운로드 실패 (${res.status})`);
  const tmp = path.join(dir, `download-${asset}`);
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  try {
    if (asset.endsWith('.tgz')) {
      await run('tar', ['-xzf', tmp, '-C', dir, 'cloudflared']);
      fs.rmSync(tmp, { force: true });
    } else {
      fs.renameSync(tmp, bin);
    }
    fs.chmodSync(bin, 0o755);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(bin, { force: true });
    throw e;
  }
  return bin;
}

/**
 * True when the request came in over a public address. Local and home-network visitors use
 * localhost, a private IPv4 address, a .local name or a bare computer name; the tunnel forwards the public host name.
 */
export function isPublicHost(host) {
  const h = String(host ?? '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.localhost') || !h.includes('.')) return false;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return true;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return !(a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254));
}

/**
 * Open the tunnel to `port` and keep it open (reconnects after a drop). `dir` is where cloudflared is kept.
 * `onChange({ status: 'connecting' | 'on' | 'error', url, error, note })` reports progress.
 */
export function startTunnel(port, onChange, { dir, ensureBinary = ensureCloudflared, spawnFn = spawn, fetchFn = fetch }) {
  let child = null;
  let stopped = false;
  let generation = 0;
  let retry, quiet, healthTimer, healthAbort;
  let state = { status: 'connecting', url: null, error: null, note: null };
  const set = (next) => {
    state = { ...state, ...next };
    onChange?.(state);
  };
  const clearAttempt = () => {
    clearTimeout(retry); clearTimeout(quiet); clearTimeout(healthTimer);
    healthAbort?.abort(); healthAbort = null;
    const previous = child; child = null;
    previous?.kill();
  };

  const connect = async () => {
    const attempt = ++generation;
    clearAttempt();
    set({ status: 'connecting', url: null, error: null, note: null });
    let bin;
    try {
      bin = await ensureBinary(dir, (note) => { if (!stopped && attempt === generation) set({ note }); });
    } catch (e) {
      if (stopped || attempt !== generation) return;
      set({ status: 'error', error: `준비 실패: ${e.message}`, note: null });
      retry = setTimeout(connect, 30_000);
      return;
    }
    if (stopped || attempt !== generation) return;
    set({ note: null });
    let out = '';
    let gotUrl = false;
    let pending = null;
    let metrics = null;
    let failures = 0;
    // http2 (plain TCP) goes through firewalls that block the faster QUIC/UDP. The status server
    // stays on this computer only, on any free port (it is read back from the log).
    const process = spawnFn(bin, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--metrics', '127.0.0.1:0', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child = process;
    const active = () => !stopped && attempt === generation && child === process;
    /** cloudflared's own word on its connections to Cloudflare (no DNS, no trip over the internet). */
    const connected = async (signal) => {
      if (!metrics) return false;
      try {
        const response = await fetchFn(`http://${metrics}/ready`, { cache: 'no-store', signal });
        const body = await response.json().catch(() => ({}));
        return response.ok && Number(body.readyConnections ?? 1) > 0;
      } catch { return false; }
    };
    const health = async () => {
      if (!active()) return;
      const controller = new AbortController(); healthAbort = controller;
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let healthy = false;
      try {
        const response = await fetchFn(pending + '/?view=remote', { cache: 'no-store', redirect: 'manual', signal: controller.signal });
        const body = await response.text();
        // An answer from Cloudflare that is not LightCast (e.g. 530: the tunnel is gone) is a real failure.
        healthy = response.ok && /id=["']root["']/.test(body);
      } catch {
        // This computer could not reach its own public address at all. That is often this computer's
        // network, not the tunnel: its DNS has not learned the brand-new address yet (Windows and macOS
        // remember a failed lookup for minutes) or a filter blocks trycloudflare.com, while phones get
        // through fine. Then cloudflared itself decides: still connected to Cloudflare means healthy.
        healthy = await connected(controller.signal);
      }
      finally { clearTimeout(timeout); if (healthAbort === controller) healthAbort = null; }
      if (!active()) return;
      failures = healthy ? 0 : failures + 1;
      // Allow DNS propagation and brief network drops before replacing the quick tunnel.
      if (failures >= 2) { connect(); return; }
      healthTimer = setTimeout(health, 15_000);
    };
    const read = (chunk) => {
      if (!active()) return;
      out = (out + chunk).slice(-4000);
      pending = parseTunnelUrl(out) ?? pending;
      metrics = parseMetricsAddress(out) ?? metrics;
      // The address is printed before the tunnel is reachable: show it once the connection is registered.
      if (!gotUrl && pending && /Registered tunnel connection/.test(out)) {
        gotUrl = true;
        clearTimeout(quiet);
        set({ status: 'on', url: pending, error: null });
        healthTimer = setTimeout(health, 15_000);
      }
    };
    // No working connection after a while: try another tunnel.
    quiet = setTimeout(() => { if (active() && !gotUrl) process.kill(); }, 45_000);
    process.stdout.on('data', read);
    process.stderr.on('data', read);
    process.on('error', (e) => {
      if (!active()) return;
      child = null;
      clearTimeout(quiet); clearTimeout(healthTimer); healthAbort?.abort();
      set({ status: 'error', url: null, error: `실행 실패: ${e.message}` });
      // A broken download is removed so the next try fetches it again.
      fs.rmSync(bin, { force: true });
      retry = setTimeout(connect, 15_000);
    });
    process.on('close', () => {
      if (!active()) return;
      child = null;
      clearTimeout(quiet); clearTimeout(healthTimer); healthAbort?.abort();
      if (gotUrl) set({ status: 'connecting', url: null });
      else {
        const said = cleanOutput(out).trim().split('\n').filter(Boolean).filter((l) => /ERR|WRN|failed|error/i.test(l)).slice(-2).join(' ').replace(/\d{4}-\d\d-\d\dT[\d:]+Z /g, '');
        set({ status: 'error', url: null, error: `연결 실패${said ? `: ${said.slice(0, 240)}` : ''}` });
      }
      retry = setTimeout(connect, gotUrl ? 3000 : 15_000);
    });
  };

  connect();
  return {
    state: () => state,
    restart() { if (!stopped) connect(); },
    stop() {
      stopped = true; generation++;
      clearAttempt();
    },
  };
}
