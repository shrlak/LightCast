import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
// @ts-expect-error plain ESM server module
import { attachRelay } from '../server/relay.mjs';
import {
  defaultPacing, elapsedMs, flashMark, formatSpan, idleClock, paceOf, paceText, parsePacing, parseTimerMessage, pauseClock, plannedAt,
  startClock, timerDue, timerMessage, viewOfTimerMessage, pacingView, zoneOf, TIMER_HEARTBEAT_MS,
} from '../src/domain/pacing';

const MIN = 60_000;

describe('settings', () => {
  it('defaults and validates', () => {
    expect(parsePacing(null)).toEqual({ targetMin: 30, checkpoints: [], flash: true });
    expect(parsePacing({ targetMin: 'x' }, 25).targetMin).toBe(25);
    expect(parsePacing({ targetMin: 99999 }).targetMin).toBe(600);
    expect(defaultPacing(40).targetMin).toBe(40);
  });
  it('sorts checkpoints, keeps times rising and inside the target, one per slide', () => {
    const s = parsePacing({ targetMin: 30, checkpoints: [{ slide: 20, min: 25 }, { slide: 5, min: 8 }, { slide: 10, min: 5 }, { slide: 1, min: 0 }, { slide: 5, min: 9 }, { slide: 30, min: 99 }, { slide: 'a', min: 1 }], flash: false });
    expect(s.checkpoints).toEqual([{ slide: 5, min: 9 }, { slide: 10, min: 9 }, { slide: 20, min: 25 }, { slide: 30, min: 30 }]);
    expect(s.flash).toBe(false);
  });
});

describe('clock', () => {
  it('runs, pauses and counts', () => {
    let c = startClock(idleClock(), 1000);
    expect(elapsedMs(c, 4000)).toBe(3000);
    c = pauseClock(c, 4000);
    expect(elapsedMs(c, 99999)).toBe(3000);
    c = startClock(c, 10000);
    expect(elapsedMs(c, 12000)).toBe(5000);
  });
});

describe('plan and pace', () => {
  const target = 30 * MIN;
  it('is linear over the slides without checkpoints', () => {
    expect(plannedAt(0, 10, target, [])).toBe(0);
    expect(plannedAt(5, 10, target, [])).toBe(15 * MIN);
    expect(plannedAt(10, 10, target, [])).toBe(target);
  });
  it('bends through checkpoints', () => {
    const cps = [{ slide: 3, min: 10 }];
    expect(plannedAt(2, 10, target, cps)).toBe(10 * MIN);
    expect(plannedAt(1, 10, target, cps)).toBe(5 * MIN);
    expect(plannedAt(6, 10, target, cps)).toBeCloseTo(10 * MIN + (4 / 8) * 20 * MIN);
  });
  it('judges ahead / on track / behind with a tolerance', () => {
    // slide index 4 of 10: window 12..15 min
    expect(paceOf(13 * MIN, 4, 10, target, []).kind).toBe('on');
    expect(paceOf(5 * MIN, 4, 10, target, []).kind).toBe('ahead');
    expect(paceOf(20 * MIN, 4, 10, target, [])).toMatchObject({ kind: 'behind', deltaMs: 5 * MIN });
    expect(paceOf(15 * MIN + 20_000, 4, 10, target, []).kind).toBe('on'); // inside tolerance
    expect(paceOf(0, 0, 10, target, []).kind).toBe('on');
  });
  it('uses checkpoints for the pace', () => {
    const cps = [{ slide: 2, min: 20 }];
    expect(paceOf(10 * MIN, 0, 10, target, cps).kind).toBe('on'); // window 0..20
    expect(paceOf(10 * MIN, 1, 10, target, cps).kind).toBe('ahead'); // should arrive at slide 2 at minute 20
  });
  it('words the pace in Korean', () => {
    expect(paceText({ kind: 'on', deltaMs: 0 })).toBe('순조');
    expect(paceText({ kind: 'ahead', deltaMs: -2 * MIN })).toBe('2분 빠름');
    expect(paceText({ kind: 'behind', deltaMs: 90_000 })).toBe('1분 30초 늦음');
    expect(paceText({ kind: 'behind', deltaMs: 45_000 })).toBe('45초 늦음');
  });
});

describe('zones, flash, format', () => {
  it('goes green, yellow, red', () => {
    expect(zoneOf(20 * MIN, 30 * MIN)).toBe('green');
    expect(zoneOf(5 * MIN, 30 * MIN)).toBe('yellow');
    expect(zoneOf(0, 30 * MIN)).toBe('yellow');
    expect(zoneOf(-1, 30 * MIN)).toBe('red');
    expect(zoneOf(3 * MIN, 8 * MIN)).toBe('green'); // short talk: a quarter of 8 min is 2 min
    expect(zoneOf(2 * MIN, 8 * MIN)).toBe('yellow');
  });
  it('flashes once per mark, going down', () => {
    const t = 30 * MIN;
    expect(flashMark(5 * MIN + 1000, 5 * MIN - 500, t)).toBe(5 * MIN);
    expect(flashMark(5 * MIN - 500, 5 * MIN - 1000, t)).toBeNull();
    expect(flashMark(MIN + 500, MIN - 500, t)).toBe(MIN);
    expect(flashMark(4 * MIN, 3 * MIN, 4 * MIN)).toBeNull();
    expect(flashMark(6 * MIN, 5 * MIN - 1, 5 * MIN)).toBeNull(); // target no longer than the mark
  });
  it('formats spans', () => {
    expect(formatSpan(65_000)).toBe('1:05');
    expect(formatSpan(-12_000)).toBe('-0:12');
    expect(formatSpan(3723_000)).toBe('1:02:03');
  });
  it('builds the view', () => {
    const s = defaultPacing(30);
    const idle = pacingView(idleClock(), s, 0, 0, 10);
    expect(idle.pace).toBeNull();
    const c = startClock(idleClock(), 0);
    const v = pacingView(c, s, 20 * MIN, 2, 10);
    expect(v).toMatchObject({ remainingMs: 10 * MIN, zone: 'green' });
    expect(v.pace?.kind).toBe('behind');
  });
});

describe('timer message', () => {
  it('round-trips and rejects junk', () => {
    const v = pacingView(startClock(idleClock(), 0), defaultPacing(30), 10 * MIN, 3, 10);
    const m = timerMessage(v);
    expect(parseTimerMessage(m)).toEqual(m);
    expect(parseTimerMessage({ type: 'timer', off: true })).toEqual({ type: 'timer', off: true });
    expect(parseTimerMessage({ type: 'timer', elapsedMs: 'a', targetMs: 5 })).toBeNull();
    expect(parseTimerMessage({ type: 'timer', elapsedMs: 1, targetMs: 0 })).toBeNull();
    expect(parseTimerMessage({ type: 'nope' })).toBeNull();
    expect(parseTimerMessage({ type: 'timer', elapsedMs: -5, targetMs: 1e15, pace: 'weird' })).toEqual({ type: 'timer', running: false, elapsedMs: 0, targetMs: 100 * 3600_000 });
  });
  it('keeps counting on the receiver', () => {
    const m = { type: 'timer' as const, running: true, elapsedMs: 10 * MIN, targetMs: 30 * MIN, pace: 'ahead' as const, paceMs: -MIN };
    const v = viewOfTimerMessage(m, 1000, 61_000);
    expect(v.elapsedMs).toBe(11 * MIN);
    expect(v.pace).toEqual({ kind: 'ahead', deltaMs: -MIN });
    expect(viewOfTimerMessage({ ...m, running: false }, 1000, 61_000).elapsedMs).toBe(10 * MIN);
  });
  it('rate limits sending', () => {
    expect(timerDue(1000, 1500, true)).toBe(false);
    expect(timerDue(1000, 2000, true)).toBe(true);
    expect(timerDue(1000, 5000, false)).toBe(false);
    expect(timerDue(1000, 1000 + TIMER_HEARTBEAT_MS, false)).toBe(true);
  });
});

describe('relay timer', () => {
  it('validates, rate-limits, and sends only to phones and stage displays', async () => {
    const server = http.createServer();
    const relay = attachRelay(server);
    const sockets: WebSocket[] = [];
    try {
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No port');
      const connect = async (hello: object) => {
        const ws = new WebSocket(`ws://127.0.0.1:${address.port}/freecast-ws`); sockets.push(ws); await once(ws, 'open');
        const got: Record<string, unknown>[] = [];
        ws.on('message', (r) => { const m = JSON.parse(String(r)); if (m.type === 'timer') got.push(m); });
        ws.send(JSON.stringify({ type: 'hello', ...hello }));
        return { ws, got };
      };
      const remote = await connect({ role: 'remote' });
      const stage = await connect({ role: 'viewer', stage: true });
      const audience = await connect({ role: 'viewer' });
      const host = await connect({ role: 'host' });
      await new Promise((r) => setTimeout(r, 100));
      host.ws.send(JSON.stringify({ type: 'timer', running: true, elapsedMs: 1000.4, targetMs: 1800000, pace: 'behind', paceMs: 5000 }));
      host.ws.send(JSON.stringify({ type: 'timer', running: true, elapsedMs: 2000, targetMs: 1800000 })); // too soon
      await new Promise((r) => setTimeout(r, 650));
      host.ws.send(JSON.stringify({ type: 'timer', elapsedMs: 'x', targetMs: 5 })); // junk
      host.ws.send(JSON.stringify({ type: 'timer', running: false, elapsedMs: 5e15, targetMs: 1800000, pace: 'sideways' }));
      await new Promise((r) => setTimeout(r, 200));
      expect(remote.got).toHaveLength(2);
      expect(remote.got[0]).toEqual({ type: 'timer', running: true, elapsedMs: 1000, targetMs: 1800000, pace: 'behind', paceMs: 5000 });
      expect(remote.got[1]).toEqual({ type: 'timer', running: false, elapsedMs: 100 * 3600_000, targetMs: 1800000 });
      expect(stage.got).toHaveLength(2);
      expect(audience.got).toHaveLength(0);
      // a phone that joins later gets the latest value; a phone cannot send timers
      const late = await connect({ role: 'remote' });
      late.ws.send(JSON.stringify({ type: 'timer', running: true, elapsedMs: 1, targetMs: 5 }));
      await new Promise((r) => setTimeout(r, 150));
      expect(late.got).toHaveLength(1);
      expect(remote.got).toHaveLength(2);
    } finally {
      sockets.forEach((s) => s.terminate());
      for (const client of relay.clients) client.terminate();
      await new Promise<void>((resolve) => relay.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
