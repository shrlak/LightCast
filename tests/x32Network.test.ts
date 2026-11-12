import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import http from 'node:http';
// @ts-expect-error plain ESM server module
import { checkRead, checkSet, createX32Link, oscMessage, parseOsc, SNAPSHOT, x32Middleware } from '../server/x32.mjs';
import {
  dbToFader, describeX32Step, faderToDb, formatDb, formatParam, normalizeX32Settings, paramValue, sceneName, stripAddress, stripAddresses,
  stripName, stripSections, x32Message, X32_STRIPS,
} from '../src/domain/x32';
import { createInitialState, reducer } from '../src/domain/reducer';
import { createSeedLibrary } from '../src/domain/defaults';

type Arg = { type: string; value: unknown };
/** A UDP socket stand-in: records what is sent, and lets the test play the X32's replies. */
class FakeSocket extends EventEmitter {
  sent: { address: string; args: Arg[]; port: number; host: string }[] = [];
  closed = false;
  bind(cb: () => void) { cb(); }
  setBroadcast() {}
  send(buf: Buffer, port: number, host: string) { const m = parseOsc(buf)!; this.sent.push({ address: m.address, args: m.args, port, host }); }
  close() { this.closed = true; }
  reply(from: string, address: string, args: (number | string | { f: number })[] = []) { this.emit('message', oscMessage(address, args), { address: from }); }
}

describe('OSC for the X32', () => {
  it('encodes and decodes messages with 4-byte padding', () => {
    const buf = oscMessage('/ch/32/mix/on', [1]);
    expect(buf.length % 4).toBe(0);
    expect(buf.subarray(0, 16).toString('latin1')).toBe('/ch/32/mix/on\0\0\0');
    expect(parseOsc(buf)).toEqual({ address: '/ch/32/mix/on', args: [{ type: 'i', value: 1 }] });
    expect(parseOsc(oscMessage('/info', ['V2.07', 'osc-server', 'X32', '4.06'])).args.map((a: Arg) => a.value)).toEqual(['V2.07', 'osc-server', 'X32', '4.06']);
    const fader = parseOsc(oscMessage('/ch/01/mix/fader', [0.75]));
    expect(fader.args[0].type).toBe('f');
    expect(fader.args[0].value).toBeCloseTo(0.75);
    // A fader at the very top or bottom is still sent as a float.
    expect(parseOsc(oscMessage('/ch/01/mix/fader', [{ f: 1 }])).args[0]).toEqual({ type: 'f', value: 1 });
    expect(parseOsc(Buffer.from('#bundle\0garbage'))).toBeNull();
    expect(parseOsc(Buffer.from([1, 2, 3]))).toBeNull();
  });

  it('only lets LightCast change mutes, faders and scenes', () => {
    expect(checkSet('/ch/05/mix/on', 0)).toBe(0);
    expect(checkSet('/ch/32/mix/fader', 1)).toEqual({ f: 1 });
    expect(checkSet('/dca/8/on', 1)).toBe(1);
    expect(checkSet('/main/st/mix/fader', 0.5)).toEqual({ f: 0.5 });
    expect(checkSet('/-action/goscene', 12)).toBe(12);
    expect(checkSet('/ch/33/mix/on', 1)).toBeNull();
    expect(checkSet('/ch/05/mix/on', 0.5)).toBeNull();
    expect(checkSet('/ch/05/mix/fader', 1.2)).toBeNull();
    expect(checkSet('/-action/goscene', 100)).toBeNull();
    expect(checkSet('/-action/initall', 1)).toBeNull();
    expect(checkSet('/config/mute/1', 1)).toBeNull();
    expect(checkSet('/ch/05/mix/on', Number.NaN)).toBeNull();
  });

  it('lets LightCast work a strip like the console: gain, low cut, gate, compressor, EQ, pan, sends', () => {
    expect(checkSet('/ch/05/preamp/trim', 0.5)).toEqual({ f: 0.5 });
    expect(checkSet('/ch/05/preamp/hpon', 1)).toBe(1);
    expect(checkSet('/ch/05/preamp/hpf', 0.3)).toEqual({ f: 0.3 });
    expect(checkSet('/ch/05/preamp/hpslope', 2)).toBe(2);
    expect(checkSet('/ch/05/gate/mode', 3)).toBe(3);
    expect(checkSet('/ch/05/dyn/on', 1)).toBe(1);
    expect(checkSet('/ch/05/dyn/ratio', 11)).toBe(11);
    expect(checkSet('/ch/05/dyn/ratio', 12)).toBeNull();
    expect(checkSet('/ch/05/dyn/thr', 0.4)).toEqual({ f: 0.4 });
    expect(checkSet('/ch/05/eq/3/type', 2)).toBe(2);
    expect(checkSet('/ch/05/eq/3/g', 0.5)).toEqual({ f: 0.5 });
    expect(checkSet('/bus/16/eq/6/f', 0.5)).toEqual({ f: 0.5 });
    expect(checkSet('/main/st/dyn/mgain', 0.1)).toEqual({ f: 0.1 });
    expect(checkSet('/auxin/08/mix/pan', 0.5)).toEqual({ f: 0.5 });
    expect(checkSet('/ch/05/mix/16/level', 0.75)).toEqual({ f: 0.75 });
    expect(checkSet('/ch/05/mix/03/on', 1)).toBe(1);
    // Not offered: phantom power, routing, setup, channels that do not exist.
    expect(checkSet('/headamp/000/phantom', 1)).toBeNull();
    expect(checkSet('/ch/05/config/source', 3)).toBeNull();
    expect(checkSet('/ch/05/mix/17/level', 0.5)).toBeNull();
    expect(checkSet('/auxin/09/mix/on', 1)).toBeNull();
    expect(checkSet('/-prefs/lamp', 0.5)).toBeNull();
    expect(checkRead('/ch/05/dyn/ratio')).toBe(true);
    expect(checkRead('/bus/03/config/name')).toBe(true);
    expect(checkRead('/-show/showfile/scene/012/name')).toBe(true);
    expect(checkRead('/-prefs/lamp')).toBe(false);
  });
});

describe('X32 network link', () => {
  const setup = () => {
    const sockets: FakeSocket[] = [];
    let t = 0;
    const link = createX32Link({ createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s; }, now: () => t });
    const events: Record<string, unknown>[] = [];
    link.subscribe((e: Record<string, unknown>) => events.push(e));
    return { link, sockets, events, advance: (ms: number) => { t += ms; } };
  };

  it('subscribes, reads the mixer once it answers, and keeps up with changes made on the console', () => {
    vi.useFakeTimers();
    try {
      const { link, sockets, events } = setup();
      link.connect('192.168.0.64');
      const s = sockets[0];
      expect(s.sent.map((m) => m.address)).toEqual(['/xinfo', '/xremote', '/info']);
      expect(s.sent.every((m) => m.port === 10023 && m.host === '192.168.0.64')).toBe(true);
      s.reply('192.168.0.64', '/xinfo', ['192.168.0.64', 'Church X32', 'X32', '4.06']);
      expect(link.state).toMatchObject({ status: 'connected', name: 'Church X32', model: 'X32' });
      vi.advanceTimersByTime(1000);
      const asked = s.sent.slice(3).map((m) => m.address);
      expect(asked).toEqual(SNAPSHOT);
      expect(s.sent.slice(3).every((m) => m.args.length === 0)).toBe(true);
      s.reply('192.168.0.64', '/ch/05/config/name', ['Pastor']);
      s.reply('192.168.0.64', '/ch/05/mix/fader', [{ f: 0.75 }]);
      s.reply('10.0.0.9', '/ch/06/mix/on', [0]); // someone else's packet
      expect(link.values).toEqual({ '/ch/05/config/name': 'Pastor', '/ch/05/mix/fader': 0.75 });
      expect(events.filter((e) => e.type === 'value').map((e) => e.address)).toEqual(['/ch/05/config/name', '/ch/05/mix/fader']);
      // A new console gets everything known so far.
      const late: Record<string, unknown>[] = [];
      link.subscribe((e: Record<string, unknown>) => late.push(e));
      expect(late[1]).toEqual({ type: 'snapshot', values: link.values });
      link.disconnect();
      expect(s.closed).toBe(true);
      expect(link.state.status).toBe('off');
      expect(link.values).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends mutes, faders (as floats) and scene recalls, and remembers them', () => {
    vi.useFakeTimers();
    try {
      const { link, sockets } = setup();
      expect(() => link.setValue('/ch/05/mix/on', 1)).toThrow(); // not connected yet
      link.connect('192.168.0.64');
      const s = sockets[0];
      s.reply('192.168.0.64', '/info', ['V2.07', 'osc-server', 'X32', '4.06']);
      vi.advanceTimersByTime(1000);
      s.sent.length = 0;
      link.setValue('/ch/05/mix/on', 1);
      link.setValue('/main/st/mix/fader', 1);
      link.setValue('/-action/goscene', 3);
      expect(s.sent.slice(0, 3)).toEqual([
        { address: '/ch/05/mix/on', args: [{ type: 'i', value: 1 }], port: 10023, host: '192.168.0.64' },
        { address: '/main/st/mix/fader', args: [{ type: 'f', value: 1 }], port: 10023, host: '192.168.0.64' },
        { address: '/-action/goscene', args: [{ type: 'i', value: 3 }], port: 10023, host: '192.168.0.64' },
      ]);
      expect(link.values).toMatchObject({ '/ch/05/mix/on': 1, '/main/st/mix/fader': 1, '/-show/prepos/current': 3 });
      // After a scene recall the mixer is read again.
      vi.advanceTimersByTime(1000);
      expect(s.sent.filter((m) => m.address === '/ch/01/mix/fader')).toHaveLength(1);
      expect(() => link.setValue('/-action/initall', 1)).toThrow();
      // Opening a strip's editor reads its processing, and it is read again after a later recall.
      s.sent.length = 0;
      link.read(['/ch/05/dyn/thr', '/ch/05/eq/1/f']);
      expect(s.sent.map((m) => m.address)).toEqual(['/ch/05/dyn/thr', '/ch/05/eq/1/f']);
      s.reply('192.168.0.64', '/ch/05/dyn/ratio', [6]);
      expect(link.values['/ch/05/dyn/ratio']).toBe(6);
      link.setValue('/-action/goscene', 4);
      vi.advanceTimersByTime(1000);
      expect(s.sent.filter((m) => m.address === '/ch/05/dyn/thr')).toHaveLength(2);
      expect(() => link.read(['/-prefs/lamp'])).toThrow();
      link.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a mixer that stops answering, and refuses a bad address', () => {
    vi.useFakeTimers();
    try {
      const { link, sockets, advance } = setup();
      link.connect('192.168.0.64');
      sockets[0].reply('192.168.0.64', '/info', ['V2.07', 'osc-server', 'X32', '4.06']);
      expect(link.state.status).toBe('connected');
      advance(25000);
      vi.advanceTimersByTime(8000);
      expect(link.state.status).toBe('lost');
      link.connect('192.168.0.64'); // same IP: keeps the link
      expect(sockets).toHaveLength(1);
      expect(() => link.connect('mixer.local')).toThrow();
      expect(() => link.connect('300.1.1.1')).toThrow();
      link.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it('finds X32s that answer /xinfo', async () => {
    const { link, sockets } = setup();
    const pending = link.scan(20);
    const s = sockets[0];
    expect(s.sent.every((m) => m.address === '/xinfo' && m.port === 10023)).toBe(true);
    s.reply('192.168.0.64', '/xinfo', ['192.168.0.64', 'Church X32', 'X32', '4.06']);
    expect(await pending).toEqual([{ ip: '192.168.0.64', name: 'Church X32', model: 'X32', version: '4.06' }]);
  });

  it('only serves the console on this computer', async () => {
    const server = http.createServer((req, res) => x32Middleware(req, res, () => res.writeHead(404).end()));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as { port: number };
    try {
      const bad = await fetch(`http://127.0.0.1:${port}/api/x32/connect`, { method: 'POST', body: JSON.stringify({ ip: 'nope' }) });
      expect(bad.status).toBe(400);
      const notConnected = await fetch(`http://127.0.0.1:${port}/api/x32/set`, { method: 'POST', body: JSON.stringify({ address: '/ch/01/mix/on', value: 0 }) });
      expect(notConnected.status).toBe(400);
      const get = await fetch(`http://127.0.0.1:${port}/api/x32/connect`);
      expect(get.status).toBe(405);
      const off = await fetch(`http://127.0.0.1:${port}/api/x32/disconnect`, { method: 'POST' });
      expect((await off.json()).status).toBe('off');
      const other = await fetch(`http://127.0.0.1:${port}/api/other`);
      expect(other.status).toBe(404);
    } finally {
      server.close();
    }
    let status = 0;
    const res = { writeHead: (s: number) => { status = s; }, end: () => undefined } as unknown as http.ServerResponse;
    await x32Middleware({ url: '/api/x32/set', method: 'POST', headers: {}, socket: { remoteAddress: '192.168.0.20' } }, res, () => undefined);
    expect(status).toBe(403);
  });
});

describe('X32 mixer vocabulary', () => {
  it('converts fader positions to dB like the console', () => {
    expect(faderToDb(0.75)).toBeCloseTo(0);
    expect(faderToDb(1)).toBeCloseTo(10);
    expect(faderToDb(0.5)).toBeCloseTo(-10);
    expect(faderToDb(0.25)).toBeCloseTo(-30);
    expect(faderToDb(0)).toBe(-Infinity);
    for (const db of [10, 0, -5, -10, -20, -30, -45, -60, -75]) expect(faderToDb(dbToFader(db))).toBeCloseTo(db, 0);
    expect(dbToFader(-120)).toBe(0);
    expect(formatDb(0.75)).toBe('0.0 dB');
    expect(formatDb(1)).toBe('+10.0 dB');
    expect(formatDb(0)).toBe('−∞ dB');
  });
  it('names strips and scenes from what the mixer reported', () => {
    const values = { '/ch/05/config/name': 'Pastor', '/dca/2/config/name': ' ', '/-show/showfile/scene/003/name': 'Sunday 1' };
    expect(stripName('ch/05', values)).toBe('Ch 05 · Pastor');
    expect(stripName('dca/2', values)).toBe('DCA 2');
    expect(stripName('main/st', values)).toBe('Main LR');
    expect(sceneName(3, values)).toBe('03 · Sunday 1');
    expect(sceneName(4, values)).toBe('04');
    expect(stripAddress('dca/2', 'on')).toBe('/dca/2/on');
    expect(stripAddress('ch/05', 'fader')).toBe('/ch/05/mix/fader');
  });
  it('turns macro steps into mixer changes', () => {
    expect(x32Message({ type: 'x32', action: 'unmute', strip: 'ch/05' })).toEqual({ address: '/ch/05/mix/on', value: 1 });
    expect(x32Message({ type: 'x32', action: 'mute', strip: 'dca/3' })).toEqual({ address: '/dca/3/on', value: 0 });
    expect(x32Message({ type: 'x32', action: 'fader', strip: 'main/st', value: 0.75 })).toEqual({ address: '/main/st/mix/fader', value: 0.75 });
    expect(x32Message({ type: 'x32', action: 'scene', scene: 7 })).toEqual({ address: '/-action/goscene', value: 7 });
    expect(x32Message({ type: 'x32', action: 'mute', strip: 'ch/40' })).toBeNull();
    expect(x32Message({ type: 'x32', action: 'fader', strip: 'ch/01' })).toBeNull();
    expect(describeX32Step({ type: 'x32', action: 'unmute', strip: 'ch/05' }, { '/ch/05/config/name': 'Pastor' })).toBe('X32 Ch 05 · Pastor 뮤트 해제');
    expect(describeX32Step({ type: 'x32', action: 'fader', strip: 'main/st', value: 0.75 })).toBe('X32 Main LR 페이더 0.0 dB');
    expect(describeX32Step({ type: 'x32', action: 'scene', scene: 2 })).toBe('X32 장면 불러오기 02');
  });
  it('leaves the slide show alone when a macro has mixer steps', () => {
    const state = createInitialState({ ...createSeedLibrary(), macros: [{ id: 'sermon', name: 'Sermon', color: '#000', steps: [{ type: 'x32', action: 'unmute', strip: 'ch/05' }, { type: 'black', on: true }] }] });
    expect(reducer(state, { type: 'macro/run', id: 'sermon', now: 1 }).live.black).toBe(true);
  });
  it('shows processing in the console\'s units', () => {
    const sec = (kind: Parameters<typeof stripSections>[0], id: string) => stripSections(kind).find((s) => s.id === id)!;
    const param = (kind: Parameters<typeof stripSections>[0], id: string, key: string) =>
      [...sec(kind, id).params, ...(sec(kind, id).bands ?? []).flatMap((b) => b.params)].find((p) => p.key === key)!.kind;
    expect(formatParam(param('ch', 'preamp', 'preamp/trim'), 0.5)).toBe('0.0 dB');
    expect(formatParam(param('ch', 'preamp', 'preamp/trim'), 1)).toBe('+18.0 dB');
    expect(formatParam(param('ch', 'preamp', 'preamp/hpf'), 0)).toBe('20 Hz');
    expect(formatParam(param('ch', 'preamp', 'preamp/hpf'), 1)).toBe('400 Hz');
    expect(paramValue(param('ch', 'preamp', 'preamp/hpf'), 0.5)).toBeCloseTo(89.4, 1);
    expect(formatParam(param('ch', 'dyn', 'dyn/thr'), 0.5)).toBe('-30.0 dB');
    expect(formatParam(param('ch', 'dyn', 'dyn/ratio'), 6)).toBe('4.0:1');
    expect(formatParam(param('ch', 'dyn', 'dyn/release'), 1)).toBe('4000 ms');
    expect(formatParam(param('ch', 'dyn', 'dyn/mgain'), 0.5)).toBe('+12.0 dB');
    expect(formatParam(param('ch', 'eq', 'eq/1/f'), 1)).toBe('20.0 kHz');
    expect(formatParam(param('ch', 'eq', 'eq/1/q'), 0)).toBe('10.0');
    expect(formatParam(param('ch', 'eq', 'eq/1/q'), 1)).toBe('0.30');
    expect(formatParam(param('ch', 'eq', 'eq/2/type'), 0)).toBe('로우 컷');
    expect(formatParam({ type: 'pan' }, 0.25)).toBe('L50');
    expect(formatParam({ type: 'pan' }, 0.5)).toBe('C');
    expect(formatParam({ type: 'bool' }, 1)).toBe('켜짐');
    expect(formatParam({ type: 'bool' }, undefined)).toBe('…');
    // Channels have the full strip; buses and main have compressor and 6-band EQ; DCAs only fader and mute.
    expect(stripSections('ch').map((s) => s.id)).toEqual(['preamp', 'gate', 'dyn', 'eq', 'sends']);
    expect(stripSections('bus').map((s) => s.id)).toEqual(['dyn', 'eq']);
    expect(sec('main', 'eq').bands).toHaveLength(6);
    expect(stripSections('dca')).toEqual([]);
  });

  it('reads only what an editor shows, and all of it is allowed', () => {
    for (const s of X32_STRIPS) expect(stripAddresses(s.id).every((a) => checkRead(a))).toBe(true);
    const ch = stripAddresses('ch/05');
    expect(ch).toContain('/ch/05/dyn/thr');
    expect(ch).toContain('/ch/05/preamp/hpf');
    expect(ch).toContain('/ch/05/eq/4/q');
    expect(ch).toContain('/ch/05/mix/16/level');
    expect(ch).toContain('/bus/16/config/name');
    expect(ch.length).toBeLessThanOrEqual(400);
    expect(stripAddresses('dca/1')).toEqual([]);
    // Every editable parameter is also allowed to be changed.
    expect(ch.filter((a) => !a.endsWith('/config/name')).every((a) => checkSet(a, 0) != null)).toBe(true);
  });

  it('reads saved settings defensively', () => {
    expect(normalizeX32Settings({ on: true, ip: ' 192.168.0.64 ' })).toEqual({ on: true, ip: '192.168.0.64' });
    expect(normalizeX32Settings(null)).toEqual({ on: false, ip: '' });
    expect(normalizeX32Settings({ on: 'yes', ip: 5 })).toEqual({ on: false, ip: '' });
  });
});
