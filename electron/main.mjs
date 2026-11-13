import crypto from 'node:crypto';
// LightCast desktop app: runs the LightCast server inside the app and shows the console,
// audience outputs and stage displays as native windows placed on your displays.
import { app, BrowserWindow, clipboard, ipcMain, Menu, powerMonitor, safeStorage, screen, session, shell, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanAddresses, startServer } from '../server/app.mjs';
import { checkForUpdates, holdingQuit, installUpdate, startUpdater, updateState } from './updater.mjs';
import { PUBLISH } from './publish.mjs';
import { setAiConfigProvider } from '../server/ai.mjs';
import { startTunnel } from '../server/tunnel.mjs';
import { aiConfig, DEFAULT_PROXY } from '../server/aiProviders.mjs';
import { linkAddress, remoteWebAppAddress, remotePairingAddress, teamWebAppAddress, teamPairingAddress, newLinkCredentials, registerLink, removeLink } from '../server/remoteLink.mjs';
import { pptxToPdf, pptToPptx } from './pptxToPdf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
// Fixed port: the console's saved library lives in browser storage tied to this address.
const PORT = 47317;
const SMOKE = process.env.FREECAST_SMOKE;

// The app was called FreeCast before LightCast. Its data (the saved library in browser storage,
// settings, remote-link keys) lives in a folder named after the app, so keep using that folder:
// renaming it would leave every installed copy with an empty library. Must run before anything
// reads the path (the single-instance lock included).
app.setPath('userData', path.join(app.getPath('appData'), 'FreeCast'));

/**
 * macOS: an install that updated itself from FreeCast still sits in /Applications/FreeCast.app
 * (the updater replaces the bundle in place), so Finder, Launchpad and Spotlight keep showing the
 * old name. Rename the bundle to LightCast.app once and start again from there. Nothing happens when
 * the folder is not writable, LightCast.app already exists, or the app runs unpackaged.
 */
function renameOldMacBundle() {
  if (process.platform !== 'darwin' || !app.isPackaged) return false;
  const bundle = path.resolve(process.execPath, '..', '..', '..');
  if (path.basename(bundle) !== 'FreeCast.app') return false;
  const target = path.join(path.dirname(bundle), 'LightCast.app');
  if (fs.existsSync(target)) return false;
  try {
    fs.renameSync(bundle, target);
  } catch {
    return false;
  }
  // The running process still points into the old path: start again from the renamed bundle.
  app.relaunch({ execPath: path.join(target, path.relative(bundle, process.execPath)), args: process.argv.slice(1) });
  app.exit(0);
  return true;
}
const relaunching = renameOldMacBundle();

if (!relaunching && !app.requestSingleInstanceLock()) app.quit();

// ---------- settings ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { networkRemote: false, internetRemote: false, remoteLinkId: '', remoteLinkSecret: '', teamLinkId: '', teamLinkSecret: '', ai: {}, outputDisplays: {}, presenterDisplay: null };

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    let ai = {};
    try {
      if (raw.aiEnc && safeStorage.isEncryptionAvailable()) ai = JSON.parse(safeStorage.decryptString(Buffer.from(raw.aiEnc, 'base64')));
      else if (raw.aiPlain) ai = raw.aiPlain;
    } catch { /* An unavailable AI keychain must not discard either permanent link. */ }
    settings = { networkRemote: !!raw.networkRemote, internetRemote: !!raw.internetRemote, remoteLinkId: typeof raw.remoteLinkId === 'string' ? raw.remoteLinkId : '', remoteLinkSecret: typeof raw.remoteLinkSecret === 'string' ? raw.remoteLinkSecret : '', teamLinkId: typeof raw.teamLinkId === 'string' ? raw.teamLinkId : '', teamLinkSecret: typeof raw.teamLinkSecret === 'string' ? raw.teamLinkSecret : '', ai, outputDisplays: raw.outputDisplays ?? {}, presenterDisplay: typeof raw.presenterDisplay === 'number' ? raw.presenterDisplay : null };
  } catch {
    // first run
  }
}

function saveSettings() {
  const out = { networkRemote: settings.networkRemote, internetRemote: settings.internetRemote, remoteLinkId: settings.remoteLinkId, remoteLinkSecret: settings.remoteLinkSecret, teamLinkId: settings.teamLinkId, teamLinkSecret: settings.teamLinkSecret, outputDisplays: settings.outputDisplays, presenterDisplay: settings.presenterDisplay };
  // AI proxy address and optional own Gemini / OpenRouter keys, encrypted with the OS keychain.
  if (Object.keys(settings.ai ?? {}).length) {
    if (safeStorage.isEncryptionAvailable()) out.aiEnc = safeStorage.encryptString(JSON.stringify(settings.ai)).toString('base64');
    else out.aiPlain = settings.ai;
  }
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(out, null, 2));
}

// ---------- server ----------
let running = null;
async function restartServer() {
  await running?.close();
  running = await startServer({ root: path.join(appRoot, 'dist'), port: PORT, host: settings.networkRemote ? '0.0.0.0' : '127.0.0.1', publicOpen: () => settings.internetRemote, teamKey: () => settings.teamLinkSecret ? crypto.createHash('sha256').update(settings.teamLinkSecret).digest('hex') : '' });
}

// ---------- internet remote (phones on any network) ----------
let tunnel = null;
let tunnelState = { status: 'off', url: null, error: null };
// The permanent link (church Worker → the tunnel's current address): 'off' | 'pending' | 'ok' | 'unavailable' | 'error'.
let linkState = { status: 'off', error: null };
let teamLinkState = { status: 'off', error: null };
let linkTimer = null;
let publishedFor = null;

// Remote registration is independent of the editable AI proxy setting.
const REMOTE_PROXY = DEFAULT_PROXY;
const linkOpts = () => ({ proxy: REMOTE_PROXY, origin: aiConfig().proxyOrigin, id: settings.remoteLinkId, secret: settings.remoteLinkSecret });

/** Tell the Worker where the tunnel is now (retries until it hears us). */
async function publishLink() {
  clearTimeout(linkTimer);
  const url = tunnelState.url, remoteId = settings.remoteLinkId, teamId = settings.teamLinkId;
  if (!settings.internetRemote || tunnelState.status !== 'on' || !url) return;
  linkState = { status: 'pending', error: null };
  teamLinkState = { status: 'pending', error: null };
  const [r, team] = await Promise.all([registerLink({ ...linkOpts(), url }), registerLink({ proxy: REMOTE_PROXY, origin: aiConfig().proxyOrigin, id: settings.teamLinkId, secret: settings.teamLinkSecret, kind: 'team', url })]);
  if (!settings.internetRemote || tunnelState.url !== url || settings.remoteLinkId !== remoteId || settings.teamLinkId !== teamId) return;
  teamLinkState = { status: team.ok ? 'ok' : team.missing ? 'unavailable' : 'error', error: team.error ?? null };
  if (r.ok && team.ok) {
    publishedFor = url;
    linkState = { status: 'ok', error: null };
    return;
  }
  linkState = { status: r.ok ? 'ok' : r.missing ? 'unavailable' : 'error', error: r.error ?? null };
  linkTimer = setTimeout(publishLink, 30_000);
}

function syncTunnel() {
  tunnel?.stop();
  tunnel = null;
  clearTimeout(linkTimer);
  publishedFor = null;
  tunnelState = { status: 'off', url: null, error: null };
  linkState = { status: 'off', error: null };
  teamLinkState = { status: 'off', error: null };
  if (!settings.internetRemote) return;
  // The permanent link is made once and then kept, until "New Link" is pressed.
  if (!settings.remoteLinkId || !settings.remoteLinkSecret) {
    const c = newLinkCredentials();
    settings.remoteLinkId = c.id;
    settings.remoteLinkSecret = c.secret;
    saveSettings();
  }
  if (!settings.teamLinkId || !settings.teamLinkSecret) {
    const c = newLinkCredentials(); settings.teamLinkId = c.id; settings.teamLinkSecret = c.secret; saveSettings();
  }
  tunnelState = { status: 'connecting', url: null, error: null };
  tunnel = startTunnel(PORT, (st) => {
    tunnelState = st;
    if (st.status === 'on' && st.url && st.url !== publishedFor) publishLink();
  }, { dir: path.join(app.getPath('userData'), 'cloudflared') });
}
const origin = () => `http://127.0.0.1:${PORT}`;

// ---------- windows ----------
let mainWindow = null;
let splashWindow = null;
/** The start-screen animation ends (or is clicked away) — splash.js sets its title to "fc-done". */
let splashDone = false;
let mainReady = false;
/** KCCP emblem — window/taskbar icon on Windows & Linux, Dock icon when run unpackaged. */
const APP_ICON = path.join(here, 'icon.png');

/** Big animated KCCP start screen, shown while the built-in server starts. */
function showSplash() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.round(Math.min(1440, sw * 0.78));
  const height = Math.round(Math.min(sh * 0.82, width * 0.6));
  splashWindow = new BrowserWindow({
    width, height, frame: false, resizable: false, center: true, show: false,
    backgroundColor: '#030806', alwaysOnTop: true, skipTaskbar: true, roundedCorners: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashWindow.loadFile(path.join(here, 'splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow?.show());
  splashWindow.on('page-title-updated', (_e, title) => {
    if (title !== 'fc-done') return;
    splashDone = true;
    revealMain();
  });
  // Never keep the app waiting on a splash that stopped animating.
  setTimeout(() => {
    splashDone = true;
    revealMain();
  }, 12000);
}

/** Show the main window once it has loaded and the start screen has finished. */
function revealMain() {
  if (!mainReady || !splashDone || !mainWindow || mainWindow.isVisible()) return;
  mainWindow.show();
  setTimeout(() => {
    splashWindow?.destroy();
    splashWindow = null;
  }, 150);
}

const viewWindows = new Map();

const webPreferences = {
  preload: path.join(here, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

function displayList() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: `${d.label || `Display ${i + 1}`} (${d.size.width}×${d.size.height})${d.id === primary ? ' · main' : ''}`,
    primary: d.id === primary,
  }));
}

const isMac = process.platform === 'darwin';
/**
 * Cover a display with no animation. On macOS this is the pre-Lion "simple" fullscreen (no new Space,
 * no slide-in), the way PowerPoint and ProPresenter take over a projector.
 */
function setCover(win, on) {
  if (isMac) win.setSimpleFullScreen(on);
  else win.setFullScreen(on);
}
const isCovering = (win) => (isMac ? win.isSimpleFullScreen() : win.isFullScreen());

/**
 * Open (or move) an output/stage window. With a display it goes fullscreen there.
 * `present`: a slide show is starting, so cover a display right away like PowerPoint — the saved one,
 * else the connected projector/TV, else this screen — without ever showing a window first.
 */
function openView(url, displayId, present = false) {
  const u = new URL(url, origin());
  if (u.origin !== origin()) return;
  if (u.searchParams.get('view') === 'mixer') return openMixer();
  const key = `${u.searchParams.get('view')}:${u.searchParams.get('screen') ?? ''}:${u.searchParams.get('layout') ?? ''}`;
  const screenId = u.searchParams.get('screen') ?? u.searchParams.get('view');
  if (displayId === undefined) displayId = settings.outputDisplays[screenId];
  else {
    settings.outputDisplays[screenId] = displayId;
    saveSettings();
  }
  const displays = screen.getAllDisplays();
  let display = displays.find((d) => d.id === displayId);
  if (!display && present) {
    const consoleDisplay = mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()) : screen.getPrimaryDisplay();
    display = displays.find((d) => d.id !== consoleDisplay.id) ?? consoleDisplay;
  }
  // The console keeps the keyboard when the show is on another screen (presenter view).
  const sameScreen = !!display && !!mainWindow && screen.getDisplayMatching(mainWindow.getBounds()).id === display.id;
  const keepFocus = present && !sameScreen;
  let win = viewWindows.get(key);
  if (!win || win.isDestroyed()) {
    // Born on its display already covering it: no window appears first and then grows.
    win = new BrowserWindow({
      width: 960, height: 540, title: 'LightCast', backgroundColor: '#000000', autoHideMenuBar: true, icon: APP_ICON,
      ...(display ? { ...display.bounds, fullscreen: !isMac } : {}),
      show: false, webPreferences,
    });
    if (display && isMac) setCover(win, true);
    win.on('closed', () => viewWindows.delete(key));
    viewWindows.set(key, win);
    win.loadURL(u.toString());
    win.once('ready-to-show', () => {
      if (keepFocus) win.showInactive();
      else win.show();
    });
    return win;
  }
  const alreadyThere = display && isCovering(win) && screen.getDisplayMatching(win.getBounds()).id === display.id;
  if (display && !alreadyThere) {
    setCover(win, false);
    win.setBounds(display.bounds);
    setCover(win, true);
  } else if (displayId === null && isCovering(win)) {
    setCover(win, false);
    win.setSize(960, 540);
    win.center();
  }
  if (keepFocus) win.showInactive();
  else win.focus();
  return win;
}

/**
 * The X32 mixer in its own window, floating above the console, the slide show and other apps so the
 * sound can be worked at any moment (📌 in the window lets it go behind again).
 */
let mixerWindow = null;
function openMixer() {
  if (mixerWindow && !mixerWindow.isDestroyed()) {
    mixerWindow.show();
    mixerWindow.focus();
    return mixerWindow;
  }
  const win = new BrowserWindow({
    width: 1280, height: 660, minWidth: 480, minHeight: 360, title: 'LightCast — X32 믹서', backgroundColor: '#1c1e23',
    autoHideMenuBar: true, icon: APP_ICON, alwaysOnTop: true, show: false, webPreferences,
  });
  win.setAlwaysOnTop(true, 'floating');
  win.on('closed', () => { if (mixerWindow === win) mixerWindow = null; });
  win.loadURL(`${origin()}/?view=mixer`);
  win.once('ready-to-show', () => win.show());
  mixerWindow = win;
  return win;
}

/** The window a slide show opened itself (closed again when the show ends, like PowerPoint). */
let showKey = null;
function closeShow() {
  const win = showKey && viewWindows.get(showKey);
  if (win && !win.isDestroyed()) win.close();
  showKey = null;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => checkForUpdates() },
        { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Audience Output', accelerator: 'CmdOrCtrl+1', click: () => openView(`${origin()}/?view=output`) },
        { label: 'Open X32 Mixer', accelerator: 'CmdOrCtrl+3', click: () => openMixer() },
        { label: 'Close All Outputs', accelerator: 'CmdOrCtrl+Shift+W', click: () => viewWindows.forEach((w) => w.close()) },
        { type: 'separator' },
        { label: 'Open Data Folder', click: () => shell.openPath(app.getPath('userData')) },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload', accelerator: 'CmdOrCtrl+Shift+R' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640, title: 'LightCast', icon: APP_ICON,
    backgroundColor: '#0b0d12', show: false, webPreferences,
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return { action: 'deny' };
    }
    if (u.origin === origin() && ['output', 'stage', 'remote', 'mixer'].includes(u.searchParams.get('view') ?? '')) openView(url);
    else if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin())) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.once('ready-to-show', () => {
    if (SMOKE) return;
    mainReady = true;
    if (!splashWindow) splashDone = true;
    revealMain();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    viewWindows.forEach((w) => w.destroy());
  });
  mainWindow.loadURL(`${origin()}/`);
}

// ---------- IPC (exposed to the console through preload.cjs) ----------
const fromMain = (e) => e.senderFrame?.url?.startsWith(origin());
ipcMain.handle('desktop:info', (e) => {
  if (!fromMain(e)) return null;
  return {
    version: app.getVersion(),
    platform: process.platform,
    computerName: os.hostname(),
    displays: displayList(),
    outputDisplays: settings.outputDisplays,
    presenterDisplay: settings.presenterDisplay,
    ai: { proxyUrl: settings.ai.proxyUrl ?? '', hasGeminiKey: !!settings.ai.geminiKey, hasOpenrouterKey: !!settings.ai.openrouterKey },
    networkRemote: settings.networkRemote,
    lanUrls: settings.networkRemote ? lanAddresses().map((ip) => `http://${ip}:${PORT}`) : [],
    internet: { on: settings.internetRemote, status: tunnelState.status, url: tunnelState.url, error: tunnelState.error, note: tunnelState.note ?? null,
      webAppUrl: remoteWebAppAddress(REMOTE_PROXY), pairingUrl: settings.remoteLinkId ? remotePairingAddress(REMOTE_PROXY, settings.remoteLinkId) : null,
      connectionCode: settings.remoteLinkId ?? null,
      team: { webAppUrl: teamWebAppAddress(REMOTE_PROXY), pairingUrl: settings.teamLinkId ? teamPairingAddress(REMOTE_PROXY, settings.teamLinkId) : null, connectionCode: settings.teamLinkId || null, status: teamLinkState.status, error: teamLinkState.error },
      link: settings.internetRemote && settings.remoteLinkId ? linkAddress(REMOTE_PROXY, settings.remoteLinkId) : null, linkStatus: linkState.status, linkError: linkState.error },
  };
});
ipcMain.handle('desktop:copyRemoteCode', (e) => {
  if (!fromMain(e) || !settings.remoteLinkId) return false;
  clipboard.writeText(settings.remoteLinkId);
  return true;
});
ipcMain.handle('desktop:copyTeamLink', (e) => {
  if (!fromMain(e) || !settings.teamLinkId) return false;
  clipboard.writeText(teamPairingAddress(REMOTE_PROXY, settings.teamLinkId)); return true;
});
ipcMain.handle('desktop:pptxToPdf', (e, bytes) => (fromMain(e) && bytes instanceof Uint8Array ? pptxToPdf(bytes) : null));
// File › Export › PDF: the print pages the console has laid out (body.printing + #print-root), written as a
// real PDF — selectable text, A4 or landscape as the page's own @page rule says.
ipcMain.handle('desktop:printToPdf', async (e) => {
  if (!fromMain(e)) return null;
  try {
    return new Uint8Array(await e.sender.printToPDF({ preferCSSPageSize: true, printBackground: true }));
  } catch {
    return null;
  }
});
ipcMain.handle('desktop:pptToPptx', (e, bytes) => (fromMain(e) && bytes instanceof Uint8Array ? pptToPptx(bytes) : null));
// Paste from PowerPoint: Office puts the copied shapes on the clipboard as a small Office package
// (DrawingML), under this name on Windows and as a pasteboard type on macOS.
const OFFICE_SHAPES = ['Art::GVML ClipFormat', 'com.microsoft.Art--GVML-ClipFormat', 'Art--GVML-ClipFormat'];
ipcMain.handle('desktop:readOfficeClipboard', (e) => {
  if (!fromMain(e)) return null;
  const formats = clipboard.availableFormats();
  const names = [...OFFICE_SHAPES, ...formats.filter((f) => /GVML/i.test(f))];
  for (const name of names) {
    try {
      const buf = clipboard.readBuffer(name);
      // A zip package starts with "PK".
      if (buf?.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) return new Uint8Array(buf);
    } catch { /* not on the clipboard */ }
  }
  return null;
});
ipcMain.handle('desktop:openView', (e, url, displayId) => {
  if (!fromMain(e) || typeof url !== 'string') return;
  openView(url, typeof displayId === 'number' ? displayId : displayId === null ? null : undefined);
});
// The mixer window's 📌: keep it above everything, or let it go behind like a normal window.
ipcMain.handle('desktop:setOnTop', (e, on) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!fromMain(e) || !win || win !== mixerWindow) return false;
  if (typeof on === 'boolean') win.setAlwaysOnTop(on, 'floating');
  return win.isAlwaysOnTop();
});
ipcMain.handle('desktop:present', (e, url) => {
  if (!fromMain(e) || typeof url !== 'string') return;
  const before = new Set(viewWindows.values());
  const win = openView(url, undefined, true);
  if (win && !before.has(win)) showKey = [...viewWindows].find(([, w]) => w === win)?.[0] ?? null;
  moveConsoleToPresenterDisplay();
});
/** 슬라이드 쇼 › 모니터: which display shows the audience (null: automatic) and which the presenter view (null: where the console is). */
ipcMain.handle('desktop:setShowDisplays', (e, audienceId, presenterId) => {
  if (!fromMain(e)) return;
  const ids = new Set(screen.getAllDisplays().map((d) => d.id));
  if (typeof audienceId === 'number' && ids.has(audienceId)) settings.outputDisplays.output = audienceId;
  else delete settings.outputDisplays.output;
  settings.presenterDisplay = typeof presenterId === 'number' && ids.has(presenterId) ? presenterId : null;
  saveSettings();
});
/** The console (presenter view) goes to its chosen display when a show starts, if that display is still connected. */
function moveConsoleToPresenterDisplay() {
  const display = screen.getAllDisplays().find((d) => d.id === settings.presenterDisplay);
  if (!display || !mainWindow || mainWindow.isDestroyed()) return;
  if (screen.getDisplayMatching(mainWindow.getBounds()).id === display.id) return;
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  mainWindow.setBounds(display.workArea);
  mainWindow.maximize();
}
ipcMain.handle('desktop:endShow', (e) => {
  if (fromMain(e)) closeShow();
});
ipcMain.handle('desktop:setAiConfig', (e, patch) => {
  if (!fromMain(e) || !patch || typeof patch !== 'object') return;
  const next = { ...settings.ai };
  for (const k of ['proxyUrl', 'geminiKey', 'openrouterKey']) {
    if (!(k in patch)) continue;
    const v = typeof patch[k] === 'string' ? patch[k].trim() : '';
    if (v) next[k] = v;
    else delete next[k];
  }
  settings.ai = next;
  saveSettings();
});
ipcMain.handle('desktop:setNetworkRemote', async (e, on) => {
  if (!fromMain(e)) return;
  settings.networkRemote = !!on;
  saveSettings();
  await restartServer();
});
ipcMain.handle('desktop:setInternetRemote', (e, on) => {
  if (!fromMain(e)) return;
  settings.internetRemote = !!on;
  saveSettings();
  syncTunnel();
});
ipcMain.handle('desktop:newRemoteLink', async (e) => {
  if (!fromMain(e)) return;
  // The old link stops working; phones with it must scan or open the new one.
  if (settings.remoteLinkId) await removeLink({ ...linkOpts(), url: '' });
  const c = newLinkCredentials();
  settings.remoteLinkId = c.id;
  settings.remoteLinkSecret = c.secret;
  saveSettings();
  publishedFor = null;
  linkState = { status: 'pending', error: null };
  publishLink();
});
ipcMain.handle('desktop:updateState', (e) => (fromMain(e) ? updateState() : null));
ipcMain.handle('desktop:checkUpdates', (e) => (fromMain(e) ? checkForUpdates() : null));
ipcMain.handle('desktop:installUpdate', (e) => {
  if (fromMain(e)) installUpdate();
});
ipcMain.handle('desktop:closeOutputs', (e) => {
  if (fromMain(e)) viewWindows.forEach((w) => w.close());
});

// ---------- lifecycle ----------
async function smokeTest() {
  const result = { ok: false };
  try {
    const wc = mainWindow.webContents;
    if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r));
    result.console = await wc.executeJavaScript(`new Promise((r) => setTimeout(() => r({ topbar: !!document.querySelector('.topbar, .rb-tabs'), title: document.title, desktop: typeof window.freecastDesktop, online: document.querySelector('.online-status')?.textContent ?? null }), 6000))`);
    result.ai = await wc.executeJavaScript(`fetch('/api/ai/status').then((r) => r.json())`);
    result.info = await wc.executeJavaScript('window.freecastDesktop.info()');
    const out = openView(`${origin()}/?view=output`);
    await new Promise((r) => out.webContents.once('did-finish-load', r));
    result.output = await out.webContents.executeJavaScript(`new Promise((r) => setTimeout(() => r({ title: document.title, canvas: !!document.querySelector('.canvas') || document.body.innerText.slice(0, 60) }), 1500))`);
    result.ok = result.console.topbar && result.console.desktop === 'object' && !!result.output.title;
  } catch (err) {
    result.error = String(err);
  }
  fs.writeFileSync(SMOKE, JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  if (relaunching) return;
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(APP_ICON);
  if (!SMOKE) showSplash();
  loadSettings();
  setAiConfigProvider(() => settings.ai);
  // Spelling in Korean and English where this system's checker has them (macOS uses its own languages).
  try {
    const have = session.defaultSession.availableSpellCheckerLanguages ?? [];
    const want = ['ko', 'ko-KR', 'en-US'].filter((l) => have.includes(l));
    if (want.length) session.defaultSession.setSpellCheckerLanguages(want);
  } catch { /* not supported here */ }
  try {
    await restartServer();
    syncTunnel();
  } catch (err) {
    splashWindow?.destroy();
    dialog.showErrorBox('LightCast could not start', err.code === 'EADDRINUSE'
      ? `Port ${PORT} is already in use. Close the other program using it (or another LightCast) and try again.`
      : String(err.message ?? err));
    app.exit(1);
    return;
  }
  // Waking from sleep can leave cloudflared alive with a disconnected quick tunnel.
  powerMonitor.on('resume', () => { if (settings.internetRemote) tunnel?.restart(); });
  buildMenu();
  createMainWindow();
  if (!SMOKE) {
    startUpdater({
      publishConfig: PUBLISH,
      sendToRenderer: (st) => mainWindow?.webContents.send('desktop:update', st),
    });
  }
  const notify = () => mainWindow?.webContents.send('desktop:displays', displayList());
  screen.on('display-added', notify);
  screen.on('display-removed', (_e, removed) => {
    // A saved choice for a display that is gone stops applying; the renderer says so and falls back.
    if (settings.presenterDisplay === removed.id) { settings.presenterDisplay = null; saveSettings(); }
    for (const [k, v] of Object.entries(settings.outputDisplays)) if (v === removed.id) delete settings.outputDisplays[k];
    saveSettings();
    notify();
  });
  if (SMOKE) smokeTest();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  // Closing LightCast first looks for an update (updater.mjs); the server is stopped when it really quits.
  if (holdingQuit()) return;
  tunnel?.stop();
  running?.close();
});
