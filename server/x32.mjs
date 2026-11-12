// Behringer X32 / M32 over the network (OSC on UDP 10023): LightCast operates the mixer over Wi-Fi like
// the console itself — faders, mutes, pan, gain, low cut, gate, compressor, EQ, monitor sends and scene
// recall — by hand from the Mixer, or from macros and slide actions.
// On connecting it reads names, mutes, faders and scene names, and /xremote keeps them in step with
// whatever the sound team changes on the console.
import dgram from 'node:dgram';
import os from 'node:os';

const PORT = 10023;
const RENEW_MS = 8000; // /xremote lasts 10 s
const LOST_MS = 20000;

const pad4 = (b) => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]);
const oscString = (s) => pad4(Buffer.from(s, 'utf8'));

/**
 * One OSC message. args: strings are sent as s, numbers as int32 when whole and float32 otherwise;
 * { f: n } forces a float (an X32 fader at exactly 0 or 1 is still a float).
 */
export function oscMessage(address, args = []) {
  const isFloat = (a) => typeof a === 'object' || !Number.isInteger(a);
  const tags = ',' + args.map((a) => (typeof a === 'string' ? 's' : isFloat(a) ? 'f' : 'i')).join('');
  const data = args.map((a) => {
    if (typeof a === 'string') return oscString(a);
    const b = Buffer.alloc(4);
    if (isFloat(a)) b.writeFloatBE(typeof a === 'object' ? a.f : a); else b.writeInt32BE(a);
    return b;
  });
  return Buffer.concat([oscString(address), oscString(tags), ...data]);
}

function readString(buf, at) {
  const end = buf.indexOf(0, at);
  if (end < 0) return null;
  return { value: buf.toString('utf8', at, end), next: at + Math.ceil((end - at + 1) / 4) * 4 };
}

/** { address, args: [{ type, value }] }, or null for anything that is not a plain OSC message. */
export function parseOsc(buf) {
  try {
    const addr = readString(buf, 0);
    if (!addr || !addr.value.startsWith('/')) return null;
    const tags = readString(buf, addr.next);
    if (!tags || !tags.value.startsWith(',')) return { address: addr.value, args: [] };
    let at = tags.next;
    const args = [];
    for (const t of tags.value.slice(1)) {
      if (t === 'i') { args.push({ type: 'i', value: buf.readInt32BE(at) }); at += 4; }
      else if (t === 'f') { args.push({ type: 'f', value: buf.readFloatBE(at) }); at += 4; }
      else if (t === 's') { const s = readString(buf, at); if (!s) return null; args.push({ type: 's', value: s.value }); at = s.next; }
      else if (t === 'b') { const n = buf.readInt32BE(at); at += 4 + Math.ceil(n / 4) * 4; args.push({ type: 'b', value: null }); }
      else return null;
    }
    return { address: addr.value, args };
  } catch {
    return null;
  }
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export const isIpv4 = (ip) => typeof ip === 'string' && IPV4.test(ip) && ip.split('.').every((n) => Number(n) <= 255);

/** Subnet broadcast addresses of this computer's networks (plus the global one). */
function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const i of Object.values(os.networkInterfaces()).flat()) {
    if (!i || i.family !== 'IPv4' || i.internal || !i.netmask) continue;
    const ip = i.address.split('.').map(Number);
    const mask = i.netmask.split('.').map(Number);
    out.add(ip.map((n, k) => (n & mask[k]) | (~mask[k] & 255)).join('.'));
  }
  return [...out];
}

const two = (n) => String(n).padStart(2, '0');
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const STRIPS = [
  ...range(1, 32).map((n) => `ch/${two(n)}`), ...range(1, 8).map((n) => `auxin/${two(n)}`), ...range(1, 8).map((n) => `fxrtn/${two(n)}`),
  ...range(1, 16).map((n) => `bus/${two(n)}`), ...range(1, 6).map((n) => `mtx/${two(n)}`), 'main/st', 'main/m',
];
/**
 * What LightCast reads on connecting: every strip's name, mute, fader and pan, DCAs, scene names and the
 * current scene. A strip's processing (gain, low cut, gate, compressor, EQ, sends) is read when its
 * editor opens (see read), and /xremote keeps everything current afterwards.
 */
export const SNAPSHOT = [
  ...STRIPS.flatMap((s) => [...(s.startsWith('main/') ? [] : [`/${s}/config/name`, `/${s}/config/color`]), `/${s}/mix/on`, `/${s}/mix/fader`, ...(s === 'main/m' ? [] : [`/${s}/mix/pan`])]),
  ...range(1, 8).flatMap((n) => [`/dca/${n}/config/name`, `/dca/${n}/config/color`, `/dca/${n}/on`, `/dca/${n}/fader`]),
  ...range(0, 99).map((n) => `/-show/showfile/scene/${String(n).padStart(3, '0')}/name`),
  '/-show/prepos/current',
];

const STRIP = '(?:ch\\/(?:0[1-9]|[12]\\d|3[0-2])|auxin\\/0[1-8]|fxrtn\\/0[1-8]|bus\\/(?:0[1-9]|1[0-6])|mtx\\/0[1-6]|main\\/(?:st|m))';
const SEND = '(?:0[1-9]|1[0-6])';
/**
 * Everything LightCast may change, as [pattern, kind]: 'f' = float 0–1 (faders, knobs; the X32 maps it to
 * dB, Hz, ms…), a number = whole value 0…n (switches and choices). Phantom power, routing, inputs and
 * setup are deliberately not here.
 */
const SETTABLE = [
  [`${STRIP}\\/mix\\/(?:fader|pan)`, 'f'], [`${STRIP}\\/mix\\/on`, 1],
  [`${STRIP}\\/mix\\/${SEND}\\/level`, 'f'], [`${STRIP}\\/mix\\/${SEND}\\/on`, 1],
  [`${STRIP}\\/preamp\\/(?:trim|hpf)`, 'f'], [`${STRIP}\\/preamp\\/(?:invert|hpon)`, 1], [`${STRIP}\\/preamp\\/hpslope`, 2],
  [`${STRIP}\\/gate\\/on`, 1], [`${STRIP}\\/gate\\/mode`, 4], [`${STRIP}\\/gate\\/(?:thr|range|attack|hold|release)`, 'f'],
  [`${STRIP}\\/dyn\\/(?:on|mode|det|env|pos|auto)`, 1], [`${STRIP}\\/dyn\\/ratio`, 11],
  [`${STRIP}\\/dyn\\/(?:thr|knee|mgain|attack|hold|release|mix)`, 'f'],
  [`${STRIP}\\/eq\\/on`, 1], [`${STRIP}\\/eq\\/[1-6]\\/type`, 5], [`${STRIP}\\/eq\\/[1-6]\\/(?:f|g|q)`, 'f'],
  ['dca\\/[1-8]\\/fader', 'f'], ['dca\\/[1-8]\\/on', 1],
  ['-action\\/goscene', 99],
].map(([re, kind]) => [new RegExp(`^\\/${re}$`), kind]);
const READABLE = [
  new RegExp(`^\\/(?:${STRIP}|dca\\/[1-8])\\/config\\/(?:name|color)$`),
  /^\/-show\/showfile\/scene\/\d{3}\/name$/, /^\/-show\/prepos\/current$/,
];

/**
 * The OSC argument for a change LightCast may make (mute 1 = on / 0 = muted, faders and knobs 0–1,
 * choices 0…n, scene recall 0–99), or null when it is refused.
 */
export function checkSet(address, value) {
  if (typeof address !== 'string' || typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rule = SETTABLE.find(([re]) => re.test(address));
  if (!rule) return null;
  if (rule[1] === 'f') return value >= 0 && value <= 1 ? { f: value } : null;
  return Number.isInteger(value) && value >= 0 && value <= rule[1] ? value : null;
}

/** Whether LightCast may ask the mixer for this value. */
export const checkRead = (address) => typeof address === 'string' && (SETTABLE.some(([re]) => re.test(address)) || READABLE.some((re) => re.test(address)));

/** The X32 link: one at a time, renewed every few seconds, reported to every open console. */
export function createX32Link({ createSocket = () => dgram.createSocket('udp4'), now = () => Date.now() } = {}) {
  let socket = null;
  let timer = null;
  let state = { status: 'off', ip: null, name: null, model: null, version: null };
  let lastReply = 0;
  let values = {};
  const listeners = new Set();
  const emit = (event) => listeners.forEach((fn) => fn(event));
  const set = (patch) => { state = { ...state, ...patch }; emit({ type: 'status', ...state }); };
  const send = (address, args) => socket?.send(oscMessage(address, args), PORT, state.ip);
  const remember = (address, value) => {
    if (values[address] === value) return;
    values = { ...values, [address]: value };
    emit({ type: 'value', address, value });
  };
  /** Ask the mixer for values, a few messages at a time so no reply is dropped. */
  const ask = (addresses) => {
    const list = [...addresses];
    const batch = () => {
      if (!socket) return;
      list.splice(0, 16).forEach((a) => send(a));
      if (list.length) setTimeout(batch, 20);
    };
    batch();
  };
  /** Everything the Mixer tab shows, plus the strips whose editors have been opened. */
  const opened = new Set();
  const readAll = () => ask([...SNAPSHOT, ...opened]);

  const tick = () => {
    send('/xremote');
    send('/info');
    if ((state.status === 'connected' || state.status === 'connecting') && now() - lastReply > LOST_MS) set({ status: 'lost' });
  };

  function disconnect() {
    clearInterval(timer);
    timer = null;
    socket?.close();
    socket = null;
    values = {};
    opened.clear();
    set({ status: 'off', ip: null, name: null, model: null, version: null });
  }

  function connect(ip) {
    if (!isIpv4(ip)) throw new Error('X32 IP 주소가 올바르지 않습니다.');
    if (socket && state.ip === ip) return state;
    disconnect();
    socket = createSocket();
    socket.on('error', () => undefined);
    socket.on('message', (msg, rinfo) => {
      if (rinfo.address !== state.ip) return;
      const m = parseOsc(msg);
      if (!m) return;
      lastReply = now();
      // First answer, or back after the mixer was gone: read everything again.
      const arrived = state.status !== 'connected';
      if (m.address === '/info' || m.address === '/xinfo') {
        const s = m.args.map((a) => a.value);
        set(m.address === '/info' ? { status: 'connected', model: s[2] ?? null, version: s[3] ?? null } : { status: 'connected', name: s[1] ?? null, model: s[2] ?? null, version: s[3] ?? null });
      } else {
        if (arrived) set({ status: 'connected' });
        if (m.args.length === 1 && m.args[0].type !== 'b') remember(m.address, m.args[0].value);
      }
      if (arrived) readAll();
    });
    lastReply = now();
    set({ status: 'connecting', ip, name: null, model: null, version: null });
    socket.bind(() => { send('/xinfo'); tick(); });
    timer = setInterval(tick, RENEW_MS);
    return state;
  }

  /** Ask every X32 on this computer's networks to answer (/xinfo), for about a second. */
  function scan(waitMs = 1200) {
    return new Promise((resolve) => {
      const found = new Map();
      const s = createSocket();
      s.on('error', () => undefined);
      s.on('message', (msg, rinfo) => {
        const m = parseOsc(msg);
        if (m?.address !== '/xinfo') return;
        const [ip, name, model, version] = m.args.map((a) => a.value);
        found.set(rinfo.address, { ip: isIpv4(ip) ? ip : rinfo.address, name: name ?? null, model: model ?? null, version: version ?? null });
      });
      s.bind(() => {
        s.setBroadcast(true);
        for (const addr of broadcastAddresses()) s.send(oscMessage('/xinfo'), PORT, addr);
      });
      setTimeout(() => { s.close(); resolve([...found.values()]); }, waitMs);
    });
  }

  /** Change one thing on the mixer (see checkSet). The X32 does not echo a client's own change, so it is remembered here. */
  function setValue(address, value) {
    const arg = checkSet(address, value);
    if (arg == null) throw new Error('이 믹서 값은 바꿀 수 없습니다.');
    if (!socket || state.status !== 'connected') throw new Error('X32가 연결되어 있지 않습니다.');
    send(address, [arg]);
    if (address === '/-action/goscene') {
      remember('/-show/prepos/current', value);
      // A recalled scene changes mutes and faders everywhere: read them again once it has loaded.
      setTimeout(readAll, 300);
    } else remember(address, value);
    return { ok: true };
  }

  /** Read values (e.g. one strip's gain, low cut, gate, compressor and EQ when its editor opens). */
  function read(addresses) {
    if (!Array.isArray(addresses) || addresses.length > 400 || !addresses.every(checkRead)) throw new Error('읽을 수 없는 믹서 값입니다.');
    if (!socket || state.status !== 'connected') throw new Error('X32가 연결되어 있지 않습니다.');
    addresses.forEach((a) => opened.add(a));
    ask(addresses);
    return { ok: true };
  }

  return {
    connect, disconnect, scan, setValue, read,
    get state() { return state; },
    get values() { return values; },
    subscribe(fn) {
      listeners.add(fn);
      fn({ type: 'status', ...state });
      fn({ type: 'snapshot', values });
      return () => listeners.delete(fn);
    },
  };
}

const link = createX32Link();
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * /api/x32/* for the console on this computer only (phones on the network and the internet
 * address never reach it): GET events (server-sent events), POST connect {ip}, disconnect, scan,
 * set {address, value}, read {addresses}.
 */
export async function x32Middleware(req, res, next) {
  if (!req.url?.startsWith('/api/x32/')) return next();
  const reply = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return reply(403, { error: 'X32는 LightCast를 실행한 컴퓨터에서만 연결할 수 있습니다.' });
  if (req.headers['sec-fetch-site'] === 'cross-site') return reply(403, { error: 'Cross-site requests are not allowed' });
  const route = req.url.split('?')[0].slice('/api/x32/'.length);
  if (route === 'events' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const off = link.subscribe((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { off(); clearInterval(keepAlive); });
    return;
  }
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20000) return reply(413, { error: 'Too large' });
  }
  try {
    if (route === 'connect') return reply(200, link.connect(JSON.parse(raw || '{}').ip));
    if (route === 'disconnect') { link.disconnect(); return reply(200, link.state); }
    if (route === 'scan') return reply(200, { found: await link.scan() });
    if (route === 'set') { const { address, value } = JSON.parse(raw || '{}'); return reply(200, link.setValue(address, value)); }
    if (route === 'read') return reply(200, link.read(JSON.parse(raw || '{}').addresses));
    reply(404, { error: 'Not found' });
  } catch (e) {
    reply(400, { error: e.message });
  }
}
