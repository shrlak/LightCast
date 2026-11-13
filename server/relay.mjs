// WebSocket relay so phones, tablets and other computers on the network can act as
// remote controls, stage displays or outputs for the operator console.
import { WebSocketServer } from 'ws';
import { timingSafeEqual } from 'node:crypto';
import { teamRequests } from './teamRequests.mjs';
import { remoteControl } from './remoteControl.mjs';
import { isPublicHost } from './tunnel.mjs';

const PIN = process.env.FREECAST_REMOTE_PIN || '';
const COMMANDS = new Set([
  'live/next', 'live/prev', 'live/clearAll', 'live/clearText', 'live/clearBackground', 'live/toggleBlack',
  'live/go', 'playlist/select', 'macro/run', 'timer/op', 'prop/toggle', 'live/message',
  'live/logo', 'live/stageMessage', 'prop/clearAll', 'announce/stop', 'show/start', 'show/end',
  'live/chords', 'bible/show',
]);

/** Only well-formed commands from the whitelist reach the operator. */
function validCommand(c) {
  if (!c || typeof c !== 'object' || !COMMANDS.has(c.type)) return false;
  for (const [k, v] of Object.entries(c)) {
    if (k === 'type') continue;
    if (!['string', 'number', 'boolean'].includes(typeof v) && v !== null) return false;
    if (typeof v === 'string' && v.length > 500) return false;
  }
  return true;
}

/**
 * Returns the WebSocket server plus helpers for the HTTP control API.
 * Visitors arriving over the public internet address may only be remotes, and only while
 * `publicOpen()` says the internet remote is switched on. The address itself is the key:
 * it is long and random, and a new one can be made at any time.
 */
export function attachRelay(httpServer, { publicOpen = () => false, teamKey = () => '' } = {}) {
  // Compress bulky slide catalogs over slow WAN links, keeping tiny control messages uncompressed.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024, perMessageDeflate: {
    threshold: 1024, serverNoContextTakeover: true, clientNoContextTakeover: true,
    zlibDeflateOptions: { level: 1 }, concurrencyLimit: 4,
  } });
  const control = remoteControl(wss);
  const team = teamRequests(wss);
  let rehearsal = null;
  let lastState = null;
  let lastInfo = [];
  let lastPosition = null;
  let pendingInfo = null;

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url ?? '/', 'http://local').pathname; } catch { return socket.destroy(); }
    if (!['/freecast-ws', '/freecast-team-ws'].includes(pathname)) return;
    const pub = isPublicHost(req.headers.host);
    if (pub && !publicOpen()) return socket.destroy();
    const received = req.headers['x-freecast-team-key'];
    const expected = teamKey();
    const authorizedTeam = typeof received === 'string' && typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected) && /^[a-f0-9]{64}$/.test(received) && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
    const teamOnly = pathname === '/freecast-team-ws' || authorizedTeam;
    if (pub && teamOnly && !authorizedTeam) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.pub = pub; ws.teamOnly = teamOnly;
      wss.emit('connection', ws);
    });
  });

  // The console only needs to ship slide media while a remote is connected.
  const tellHosts = () => {
    const count = [...wss.clients].filter((c) => c.readyState === 1 && ['remote', 'team'].includes(c.role)).length;
    broadcast(JSON.stringify({ type: 'remotes', count, teamCount: [...wss.clients].filter((c) => c.readyState === 1 && c.role === 'team').length }), (c) => c.role === 'host');
  };

  const broadcast = (data, filter) => {
    for (const c of wss.clients) if (c.readyState === 1 && filter(c)) c.send(data);
  };

  const tellRemotes = () => broadcast(JSON.stringify({ type: 'host-status', connected: [...wss.clients].some((c) => c.readyState === 1 && c.role === 'host') }), (c) => c.role === 'remote' || c.role === 'team');

  wss.on('connection', (ws) => {
    ws.role = null;
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg?.type === 'ping') { ws.send(JSON.stringify({ type: 'pong', ...(typeof msg.id === 'number' && Number.isFinite(msg.id) || typeof msg.id === 'string' && msg.id.length <= 80 ? { id: msg.id } : {}) })); return; }
      if (msg?.type === 'hello') {
        if (ws.role) return;
        const role = ws.teamOnly ? 'team' : ['host', 'viewer', 'remote', 'team'].includes(msg.role) ? msg.role : 'viewer';
        const pin = ws.pub ? '' : PIN;
        if (ws.pub && role !== 'remote' && !(role === 'team' && ws.teamOnly)) {
          ws.send(JSON.stringify({ type: 'error', error: 'Not allowed' }));
          return ws.close();
        }
        if (['remote', 'team'].includes(role) && pin && msg.pin !== pin) {
          ws.send(JSON.stringify({ type: 'error', error: 'Wrong PIN' }));
          return ws.close();
        }
        ws.role = role;
        ws.send(JSON.stringify({ type: 'welcome', pinRequired: Boolean(pin) }));
        if (['remote', 'team'].includes(role)) control.register(ws, msg);
        else if (role === 'host') control.publish();
        if (['remote', 'team', 'host'].includes(role)) { tellHosts(); tellRemotes(); team.publish(); }
        if (role !== 'host') {
          if (lastState) ws.send(lastState);
          if (role === 'remote') {
            if (rehearsal) ws.send(rehearsal);
            for (const packet of lastInfo) ws.send(packet);
            for (const packet of pendingInfo?.packets ?? []) ws.send(packet);
            if (lastPosition) ws.send(lastPosition);
          }
        }
        return;
      }
      if (msg?.type === 'team-request') { team.receive(ws, msg); return; }
      if (msg?.type === 'connection-quality') { control.quality(ws, msg.quality); return; }
      if (msg?.type === 'remote-control') { control.receive(ws, msg); return; }
      if (ws.role === 'host' && msg?.type === 'rehearsal') {
        rehearsal = JSON.stringify({ type: 'rehearsal', active: msg.active === true, state: msg.state, cursor: msg.cursor });
        broadcast(rehearsal, (c) => c.role === 'remote');
        return;
      }
      if (ws.role === 'host' && msg?.type === 'laser') {
        // The presenter's laser dot (0-1 across the slide), or off: passed on to audience viewers, never kept.
        const ok01 = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
        if (msg.off === true) broadcast(JSON.stringify({ type: 'laser', off: true }), (c) => c.role === 'viewer');
        else if (ok01(msg.x) && ok01(msg.y)) broadcast(JSON.stringify({ type: 'laser', x: msg.x, y: msg.y }), (c) => c.role === 'viewer');
        return;
      }
      if (ws.role === 'host' && msg?.type === 'caption') {
        // Live caption text for audience viewers: length-limited, passed on, never kept.
        if (msg.off === true) broadcast(JSON.stringify({ type: 'caption', off: true }), (c) => c.role === 'viewer');
        else if (typeof msg.text === 'string') {
          broadcast(JSON.stringify({ type: 'caption', text: msg.text.slice(0, 400), final: msg.final === true, size: ['sm', 'md', 'lg'].includes(msg.size) ? msg.size : 'md', lines: msg.lines === 1 ? 1 : 2 }), (c) => c.role === 'viewer');
        }
        return;
      }
      if (ws.role === 'host' && msg?.type === 'state') {
        lastState = String(raw);
        broadcast(lastState, (c) => c.role === 'viewer' || c.role === 'remote' || c.role === 'team');
      } else if (ws.role === 'host' && msg?.type === 'info') {
        pendingInfo = null;
        lastPosition = null;
        lastInfo = [String(raw)];
        broadcast(lastInfo[0], (c) => c.role === 'remote');
      } else if (ws.role === 'host' && msg?.type === 'info-chunk') {
        if (typeof msg.id !== 'string' || msg.id.length > 100 || typeof msg.data !== 'string' || !Number.isInteger(msg.total) || msg.total < 1 || !Number.isInteger(msg.index) || msg.index < 0 || msg.index >= msg.total) return;
        if (msg.index === 0) { lastPosition = null; pendingInfo = { owner: ws, id: msg.id, total: msg.total, packets: [] }; }
        if (!pendingInfo || pendingInfo.owner !== ws || pendingInfo.id !== msg.id || pendingInfo.total !== msg.total || pendingInfo.packets.length !== msg.index) return;
        const packet = String(raw);
        pendingInfo.packets.push(packet);
        broadcast(packet, (c) => c.role === 'remote');
        if (pendingInfo.packets.length === pendingInfo.total) { lastInfo = pendingInfo.packets; pendingInfo = null; }
      } else if (ws.role === 'host' && msg?.type === 'info-position') {
        if (!Array.isArray(msg.upcoming) || msg.upcoming.length > 100 ||
            !msg.upcoming.every((item) => item && typeof item.key === 'string' && item.key.length <= 256 &&
              typeof item.heading === 'boolean' && (item.section === undefined || typeof item.section === 'string' && item.section.length <= 256)) ||
            (msg.current !== null && (!msg.current || typeof msg.current.presentationId !== 'string' || !Number.isInteger(msg.current.seq)))) return;
        lastPosition = JSON.stringify({ type: 'info-position', current: msg.current, upcoming: msg.upcoming });
        broadcast(lastPosition, (c) => c.role === 'remote');
      } else if (ws.role === 'remote' && control.owns(ws) && msg?.type === 'command' && validCommand(msg.command)) {
        broadcast(JSON.stringify({ type: 'command', command: msg.command }), (c) => c.role === 'host');
      }
    });
  });
  wss.on('connection', (ws) => ws.on('close', () => { if (['remote', 'team'].includes(ws.role)) { control.close(ws); tellHosts(); } if (ws.role === 'host') { rehearsal = null; broadcast(JSON.stringify({ type: 'rehearsal', active: false }), (c) => c.role === 'remote'); if (pendingInfo?.owner === ws) pendingInfo = null; tellRemotes(); } }));
  wss.toHost = (command) => {
    if (!validCommand(command)) return false;
    let sent = false;
    for (const c of wss.clients) {
      if (c.readyState === 1 && c.role === 'host') {
        c.send(JSON.stringify({ type: 'command', command }));
        sent = true;
      }
    }
    return sent;
  };
  wss.lastState = () => (lastState ? JSON.parse(lastState).state : null);
  return wss;
}
