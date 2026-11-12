// Self-updating for the LightCast desktop app.
// - Windows: electron-updater (NSIS) downloads in the background and installs when the app quits.
// - macOS: Apple's updater only works for apps signed with a paid Developer ID, so unsigned builds
//   download the new release .zip and swap the app bundle with a small script — when the app quits,
//   or right away (with a relaunch) if the operator clicks the notice.
// Nothing restarts on its own: an update never interrupts a running service.
// LightCast looks for a new release on its own shortly after launch, every 30 minutes while it is
// open and when the computer wakes from sleep, so a new version on GitHub reaches every installed copy.
// "Check for Updates…" in the menu still checks by hand at any time. When LightCast is closed it looks
// once more and, if there is a new version, downloads it before it quits, so it is installed then.
import { app, BrowserWindow, Notification, powerMonitor, shell } from 'electron';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import updaterPkg from 'electron-updater';
import { newer } from './version.mjs';

const { autoUpdater } = updaterPkg;

let send = () => undefined;
const watchers = new Set();
let state = { status: 'idle', version: null, progress: 0, error: null, checkedAt: null };
let macUpdate = null; // { version, zipUrl, appPath (downloaded .app) }
let checking = false;
let publish = null;

function set(patch) {
  state = { ...state, ...patch };
  send(state);
  watchers.forEach((w) => w(state));
}

/** Resolves once `done(state)` holds, or after `ms`. */
function waitFor(done, ms) {
  return new Promise((resolve) => {
    if (done(state)) return resolve();
    const finish = () => { clearTimeout(t); watchers.delete(watch); resolve(); };
    const watch = (st) => { if (done(st)) finish(); };
    const t = setTimeout(finish, ms);
    watchers.add(watch);
  });
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  if (onClick) n.on('click', onClick);
  n.show();
}

// Test hook: FREECAST_UPDATE_API points the macOS updater at another release feed (e.g. a local server).
const client = (url) => (url.startsWith('http:') && process.env.FREECAST_UPDATE_API ? http : https);

function getJson(url) {
  return new Promise((resolve, reject) => {
    client(url).get(url, { headers: { 'user-agent': 'LightCast-Updater', accept: 'application/vnd.github+json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(getJson(res.headers.location));
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(body)) : reject(new Error(`GitHub ${res.statusCode}`))));
    }).on('error', reject);
  });
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    client(url).get(url, { headers: { 'user-agent': 'LightCast-Updater', accept: 'application/octet-stream' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(download(res.headers.location, dest, onProgress));
      if (res.statusCode !== 200) return reject(new Error(`Download failed (${res.statusCode})`));
      const total = Number(res.headers['content-length']) || 0;
      let got = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => {
        got += c.length;
        if (total) onProgress(got / total);
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
    }).on('error', reject);
  });
}

/** The running .app bundle (…/LightCast.app). */
const currentBundle = () => path.resolve(process.execPath, '..', '..', '..');

async function checkMac() {
  const rel = await getJson(process.env.FREECAST_UPDATE_API || `https://api.github.com/repos/${publish.owner}/${publish.repo}/releases/latest`);
  const version = String(rel.tag_name ?? '').replace(/^v/, '');
  if (!version || !newer(version, app.getVersion())) return set({ status: 'none', version: app.getVersion() });
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const zips = (rel.assets ?? []).filter((a) => a.name.endsWith('-mac.zip'));
  const asset = zips.find((a) => a.name.includes(arch)) ?? zips.find((a) => !/arm64/.test(a.name) && arch === 'x64');
  if (!asset) return set({ status: 'error', error: `No macOS (${arch}) download in release ${version}` });
  if (macUpdate?.version === version) return set({ status: 'ready', version });
  set({ status: 'downloading', version, progress: 0 });
  notify('LightCast 업데이트', `새 버전 ${version}을(를) 내려받는 중입니다…`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecast-update-'));
  const zip = await download(asset.browser_download_url, path.join(dir, asset.name), (p) => set({ progress: Math.round(p * 100) }));
  await new Promise((resolve, reject) => execFile('/usr/bin/ditto', ['-x', '-k', zip, dir], (e) => (e ? reject(e) : resolve())));
  const appDir = fs.readdirSync(dir).find((n) => n.endsWith('.app'));
  if (!appDir) throw new Error('The update archive has no LightCast.app');
  macUpdate = { version, appPath: path.join(dir, appDir) };
  set({ status: 'ready', version, progress: 100 });
  notify('LightCast 업데이트 준비됨', `버전 ${version} — 앱을 종료하면 자동으로 설치됩니다. 지금 설치하려면 클릭하세요.`, () => installUpdate());
  if (process.env.FREECAST_UPDATE_AUTOINSTALL === '1') installUpdate();
}

let macInstalling = false;

/** Swap in the downloaded app once this process has exited; `relaunch` opens it again afterwards. */
function installMac(relaunch = true) {
  if (!macUpdate || macInstalling) return;
  const target = currentBundle();
  let writable = true;
  try {
    fs.accessSync(path.dirname(target), fs.constants.W_OK);
  } catch {
    writable = false;
  }
  if (!writable || !target.endsWith('.app')) {
    // Can't replace in place (e.g. not in a user-writable folder): show the new app to drag in.
    if (relaunch) shell.showItemInFolder(macUpdate.appPath);
    return;
  }
  macInstalling = true;
  // A copy still called FreeCast.app (from before the rename) is installed as LightCast.app.
  const dest = path.basename(target) === 'FreeCast.app' && !fs.existsSync(path.join(path.dirname(target), 'LightCast.app'))
    ? path.join(path.dirname(target), 'LightCast.app') : target;
  const script = path.join(os.tmpdir(), `freecast-update-${Date.now()}.sh`);
  fs.writeFileSync(script, `#!/bin/sh
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done
rm -rf "${target}.old"
mv "${target}" "${target}.old" && /usr/bin/ditto "${macUpdate.appPath}" "${dest}" && rm -rf "${target}.old" || mv "${target}.old" "${target}"
/usr/bin/xattr -dr com.apple.quarantine "${dest}" 2>/dev/null
${relaunch ? `open "${dest}"` : ''}
rm -f "$0"
`, { mode: 0o755 });
  spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
  if (relaunch) app.quit();
}

function setupWindows() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking' }));
  autoUpdater.on('update-not-available', () => set({ status: 'none', version: app.getVersion() }));
  autoUpdater.on('update-available', (info) => {
    set({ status: 'downloading', version: info.version, progress: 0 });
    notify('LightCast 업데이트', `새 버전 ${info.version}을(를) 내려받는 중입니다…`);
  });
  autoUpdater.on('download-progress', (p) => set({ progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    set({ status: 'ready', version: info.version, progress: 100 });
    notify('LightCast 업데이트 준비됨', `버전 ${info.version} — 앱을 종료하면 자동으로 설치됩니다. 지금 설치하려면 클릭하세요.`, () => installUpdate());
  });
  autoUpdater.on('error', (e) => set({ status: 'error', error: e?.message ?? String(e) }));
}

export async function checkForUpdates() {
  if (!app.isPackaged || !publish || checking) return state;
  checking = true;
  try {
    set({ status: 'checking', error: null });
    if (process.platform === 'darwin') await checkMac();
    else await autoUpdater.checkForUpdates();
  } catch (e) {
    set({ status: 'error', error: e?.message ?? String(e) });
  } finally {
    checking = false;
    set({ checkedAt: Date.now() });
  }
  return state;
}

export function installUpdate() {
  if (state.status !== 'ready') return;
  if (process.platform === 'darwin') installMac();
  else autoUpdater.quitAndInstall(false, true);
}

export const updateState = () => state;

/** How often an open LightCast looks for a new release. */
export const CHECK_EVERY_MS = 30 * 60 * 1000;

/** How long closing LightCast may wait for the last check (and its download) before it quits anyway. */
const QUIT_CHECK_MS = 20_000;
const QUIT_DOWNLOAD_MS = 3 * 60 * 1000;
let quitCheck = 'idle'; // 'idle' | 'running' | 'done'

/** True while LightCast is looking for an update on its way out (the app is still needed then). */
export const holdingQuit = () => quitCheck === 'running';

/** The small window that says what closing LightCast is waiting for. */
function quitWindow() {
  const win = new BrowserWindow({ width: 440, height: 150, frame: false, resizable: false, alwaysOnTop: true, show: false, backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, sandbox: true } });
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:15px -apple-system,'Segoe UI','Malgun Gothic',sans-serif;display:grid;place-items:center;height:100vh;background:#fff;color:#252423">
<div style="text-align:center;padding:0 24px"><b style="font-size:16px">LightCast를 닫는 중</b><p id="m" style="margin:10px 0 0">새 버전이 있는지 확인하는 중…</p></div></body>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.once('ready-to-show', () => win.show());
  return win;
}

/**
 * Closing LightCast: look for a new release one last time, and download it if there is one, so it is
 * installed as LightCast quits (Windows: electron-updater on quit; macOS: the will-quit swap).
 * Offline, or when it takes too long, LightCast simply quits; the next launch checks again.
 */
async function checkOnQuit() {
  quitCheck = 'running';
  BrowserWindow.getAllWindows().forEach((w) => w.hide());
  const win = quitWindow();
  const say = (text) => { if (!win.isDestroyed()) win.webContents.executeJavaScript(`document.getElementById('m').textContent=${JSON.stringify(text)}`).catch(() => undefined); };
  const progress = (st) => { if (st.status === 'downloading') say(`새 버전 ${st.version}을(를) 내려받는 중… ${st.progress}%`); };
  watchers.add(progress);
  try {
    if (state.status !== 'downloading') {
      // A check already under way (the 30-minute one) is waited for instead of started again.
      if (checking) await waitFor((st) => st.status !== 'checking', QUIT_CHECK_MS);
      else await Promise.race([checkForUpdates(), new Promise((r) => setTimeout(r, QUIT_CHECK_MS))]);
    }
    if (state.status === 'downloading' || state.status === 'checking') await waitFor((st) => st.status !== 'downloading' && st.status !== 'checking', QUIT_DOWNLOAD_MS);
    if (state.status === 'ready') say(`새 버전 ${state.version}을(를) 설치합니다…`);
  } catch { /* quit anyway */ }
  finally {
    watchers.delete(progress);
    quitCheck = 'done';
    if (!win.isDestroyed()) win.destroy();
    app.quit();
  }
}

/** Start the updater. `publishConfig` is the GitHub repo that hosts releases. */
export function startUpdater({ publishConfig, sendToRenderer }) {
  publish = publishConfig;
  send = sendToRenderer;
  if (!app.isPackaged || !publish) return;
  if (process.platform !== 'darwin') setupWindows();
  // macOS: a downloaded update installs itself when LightCast quits (Windows does this in electron-updater).
  else app.on('will-quit', () => state.status === 'ready' && installMac(false));

  // Closing LightCast checks once more first (an update already downloaded just installs).
  app.prependListener('before-quit', (e) => {
    if (quitCheck !== 'idle' || state.status === 'ready') return;
    e.preventDefault();
    void checkOnQuit();
  });

  // Once an update is downloaded there is nothing more to fetch until it is installed.
  const auto = () => state.status !== 'ready' && state.status !== 'downloading' && checkForUpdates();
  setTimeout(auto, 10_000);
  setInterval(auto, CHECK_EVERY_MS).unref?.();
  powerMonitor.on('resume', () => setTimeout(auto, 15_000));
}
