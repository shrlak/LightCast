// Stress: the relay that carries the live show to phones, tablets and stage displays (server/relay.mjs), with
// in-memory sockets so thousands of sessions run quickly: phones joining and leaving, slow phones, phones that vanish
// without closing, the controls handed around, and the console reconnecting.
// Deep run: SYNC_STRESS_RUNS=5000 npx vitest run tests/stress
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { check, scenario, timeoutFor, type Rng } from './helpers/stress';
// @ts-expect-error plain ESM server module
import { attachRelay, HEARTBEAT_MS, SLOW_BYTES } from '../server/relay.mjs';

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); });

interface Wss { clients: Set<Sock>; emit(e: string, ws: Sock): void; close(cb?: () => void): void; toHost(c: unknown): boolean }

class Sock extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  answers = true;
  constructor(private wss: Wss, public pub = false, public teamOnly = false) { super(); }
  send(data: string) { if (this.readyState === 1) this.sent.push(JSON.parse(String(data))); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.wss.clients.delete(this); this.emit('close'); }
  terminate() { this.close(); }
  ping() { if (this.answers) queueMicrotask(() => this.emit('pong')); }
  say(m: unknown) { if (this.readyState === 1) this.emit('message', Buffer.from(JSON.stringify(m))); }
  last(type: string) { for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].type === type) return this.sent[i]; return undefined; }
}

function relay() {
  const wss = attachRelay(new EventEmitter()) as unknown as Wss;
  const connect = (role: string, extra: Record<string, unknown> = {}) => {
    const ws = new Sock(wss);
    wss.clients.add(ws);
    wss.emit('connection', ws);
    ws.say({ type: 'hello', role, ...extra });
    return ws;
  };
  // As startServer's close: connections first (the relay's own close, which stops its heartbeat, waits for them).
  return { wss, connect, done: () => { for (const c of [...wss.clients]) c.terminate(); wss.close(); } };
}

const stateMsg = (n: number) => ({ type: 'state', state: { slide: { id: `s${n}`, text: `슬라이드 ${n}` }, n }, seq: n, epoch: 'run' });
const stateOf = (ws: Sock) => (ws.last('state') as { state?: { n?: number } } | undefined)?.state?.n;

describe('sync stress: phones and stage displays', () => {
  it('phones and screens joining and leaving at random always show what is live now', () =>
    scenario('phones come and go', async (r) => {
      const { connect, done } = relay();
      try {
        const host = connect('host');
        const screens: Sock[] = [];
        let live = 0;
        for (let i = 0; i < r.int(20, 120); i++) {
          const roll = r.next();
          if (roll < 0.3) screens.push(connect(r.pick(['remote', 'viewer', 'viewer', 'team']), r.chance(0.3) ? { stage: true } : {}));
          else if (roll < 0.45 && screens.length) r.pick(screens).close();
          else { host.say(stateMsg(++live)); }
          await vi.advanceTimersByTimeAsync(r.int(0, 60));
        }
        for (const s of screens.filter((x) => x.readyState === 1)) check(live === 0 || stateOf(s) === live, `a screen shows slide ${stateOf(s)}, slide ${live} is live`);
        const late = connect('viewer');
        check(live === 0 || stateOf(late) === live, `a screen that joined late shows ${stateOf(late)}, slide ${live} is live`);
      } finally { done(); }
    }), timeoutFor(10));

  it('a slow phone gets only the newest slide (no backlog), in order, and catches up once its line is free', () =>
    scenario('slow phones', async (r) => {
      const { connect, done } = relay();
      try {
        const host = connect('host');
        const phones = Array.from({ length: r.int(2, 12) }, () => connect('remote'));
        let live = 0;
        for (let i = 0; i < r.int(10, 80); i++) {
          for (const p of phones) if (r.chance(0.2)) p.bufferedAmount = r.chance(0.5) ? SLOW_BYTES * 2 : 0;
          host.say(stateMsg(++live));
          await vi.advanceTimersByTimeAsync(r.int(0, 30));
        }
        for (const p of phones) {
          const seqs = p.sent.filter((m) => m.type === 'state').map((m) => (m as { seq: number }).seq);
          check(seqs.every((s, i) => i === 0 || s > seqs[i - 1]), `a phone saw slides out of order: ${seqs.join(',')}`);
        }
        // The lines clear: every phone ends on what is live.
        for (const p of phones) p.bufferedAmount = 0;
        await vi.advanceTimersByTimeAsync(200);
        for (const p of phones) check(stateOf(p) === live, `a phone shows ${stateOf(p)} after its line cleared, ${live} is live`);
        const backlog = Math.max(...phones.map((p) => p.sent.filter((m) => m.type === 'state').length));
        check(backlog <= live, 'a phone got more slide changes than there were');
        // A phone slow through a whole burst of changes gets one: the newest.
        const slow = r.pick(phones);
        const had = slow.sent.filter((m) => m.type === 'state').length;
        slow.bufferedAmount = SLOW_BYTES * 3;
        const burst = r.int(2, 30);
        for (let i = 0; i < burst; i++) { host.say(stateMsg(++live)); await vi.advanceTimersByTimeAsync(r.int(0, 20)); }
        slow.bufferedAmount = 0;
        await vi.advanceTimersByTimeAsync(100);
        const got = slow.sent.filter((m) => m.type === 'state').length - had;
        check(got === 1 && stateOf(slow) === live, `a phone slow through ${burst} changes got ${got} of them (it should get only the newest)`);
      } finally { done(); }
    }), timeoutFor(10));

  it('a phone that vanishes without closing is dropped within two heartbeats and stops holding the controls', () =>
    scenario('vanished phones', async (r) => {
      const { wss, connect, done } = relay();
      try {
        const host = connect('host');
        const phones = Array.from({ length: r.int(1, 8) }, (_, i) => connect('remote', { clientToken: `token-${i}-abcdefghijklmnop` }));
        const gone = phones.filter(() => r.chance(0.5));
        for (const p of gone) p.answers = false;
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2 + 100);
        for (const p of gone) check(p.readyState === 3 && !wss.clients.has(p), 'a vanished phone was not dropped');
        for (const p of phones.filter((x) => !gone.includes(x))) check(p.readyState === 1, 'a phone that answers was dropped');
        const count = (host.last('remotes') as { count?: number } | undefined)?.count;
        check(count === phones.length - gone.length, `the console counts ${count} phones, ${phones.length - gone.length} are there`);
        // The phone that had the controls comes back with its token and has them again.
        if (gone.includes(phones[0])) {
          const back = connect('remote', { clientToken: 'token-0-abcdefghijklmnop' });
          check((back.last('remote-control') as { canControl?: boolean } | undefined)?.canControl === true, 'the returning phone lost the controls');
        }
      } finally { done(); }
    }), timeoutFor(10));

  it('the controls handed around at random: only the phone holding them drives the show or the laser', () =>
    scenario('remote controls', async (r) => {
      const { connect, done } = relay();
      try {
        const host = connect('host');
        const phones = Array.from({ length: r.int(2, 8) }, (_, i) => connect('remote', { clientToken: `phone-${i}-abcdefghijklmnop` }));
        for (let i = 0; i < r.int(10, 60); i++) {
          const p = r.pick(phones);
          const ctl = (host.last('remote-control') as { controllerId?: string | null; clients?: { id: string }[] } | undefined);
          const roll = r.next();
          if (roll < 0.15) p.say({ type: 'remote-control', action: 'request' });
          else if (roll < 0.3 && ctl?.clients?.length) host.say({ type: 'remote-control', action: 'grant', id: r.pick(ctl.clients).id });
          else if (roll < 0.35) host.say({ type: 'remote-control', action: 'revoke' });
          else {
            const holder = ctl?.controllerId;
            const owns = (p.last('remote-control') as { canControl?: boolean } | undefined)?.canControl === true;
            const commands = host.sent.filter((m) => m.type === 'command').length;
            const lasers = host.sent.filter((m) => m.type === 'laser').length;
            if (r.chance(0.5)) p.say({ type: 'command', command: { type: 'live/next' } });
            else p.say({ type: 'laser', x: r.next(), y: r.next() });
            await vi.advanceTimersByTimeAsync(30);
            const reached = host.sent.filter((m) => m.type === 'command').length > commands || host.sent.filter((m) => m.type === 'laser').length > lasers;
            check(reached === owns, `${owns ? 'the holder' : 'a phone without the controls'} ${reached ? 'reached' : 'did not reach'} the console (holder ${holder ?? 'none'})`);
          }
          await vi.advanceTimersByTimeAsync(r.int(0, 40));
          const holders = phones.filter((x) => x.readyState === 1 && (x.last('remote-control') as { canControl?: boolean } | undefined)?.canControl);
          check(holders.length <= 1, `${holders.length} phones hold the controls`);
        }
      } finally { done(); }
    }), timeoutFor(10));

  it('the console reconnecting (app restarted, network back): phones are told, and show what is live once it is back', () =>
    scenario('console reconnects', async (r) => {
      const { connect, done } = relay();
      try {
        let host = connect('host');
        const phones = Array.from({ length: r.int(1, 10) }, () => connect(r.pick(['remote', 'viewer'])));
        let live = 0;
        for (let i = 0; i < r.int(5, 40); i++) {
          if (r.chance(0.2)) {
            host.close();
            await vi.advanceTimersByTimeAsync(r.int(0, 100));
            for (const p of phones.filter((x) => x.readyState === 1 && x.sent.some((m) => m.type === 'welcome'))) {
              const s = p.last('host-status') as { connected?: boolean } | undefined;
              if (s) check(s.connected === false || p.sent.lastIndexOf(s) < 0, 'a phone was not told the console left');
            }
            host = connect('host');
            // useLiveBroadcast: a relay that (re)connects gets what is live at once.
            if (live) host.say(stateMsg(live));
          } else host.say(stateMsg(++live));
          await vi.advanceTimersByTimeAsync(r.int(0, 50));
        }
        for (const p of phones) check(live === 0 || stateOf(p) === live, `a phone shows ${stateOf(p)} after the console came back, ${live} is live`);
      } finally { done(); }
    }), timeoutFor(10));
});

export type { Rng };
