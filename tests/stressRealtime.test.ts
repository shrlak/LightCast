// Stress: the real-time parts of sync — the server clock estimate, the order screens show live changes in, which
// device makes the Sunday copy, how often devices ask the server, and how fast an edit reaches the other devices
// through a network with delay. Deep run: SYNC_STRESS_RUNS=5000 npx vitest run tests/stress
import { afterEach, describe, it, vi } from 'vitest';
import { check, scenario, timeoutFor, type Rng } from './helpers/stress';
import { createServerClock } from '../src/domain/serverClock';
import { liveOrder } from '../src/domain/sync';
import { backupDevice, isChurchDevice, sundayBackupDecision, BACKUP_ACTION } from '../src/domain/sundayBackup';
import { pollDelay, POLL, retryDelay } from '../src/domain/syncStatus';
import { PUSH_DELAY } from '../src/domain/cloudSyncRound';
import { converge, setup, type SimClient } from './helpers/cloudSim';
import { createSeedLibrary } from '../src/domain/defaults';
import type { ActivityEntry, DeviceRegistration, Library } from '../src/domain/types';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('sync stress: real time', () => {
  it('the server clock estimate is within half a round trip (+½ s) of the true offset, and never runs backwards', () =>
    scenario('server clock', (r) => {
      let local = 1_700_000_000_000 + r.int(0, 1e9);
      // A clock that only runs forward (performance.now): the computer's own clock can be set, this one cannot.
      let mono = 0;
      let truth = r.int(-86_400_000, 86_400_000);
      const clock = createServerClock(() => local, null, () => mono);
      let minWidth = Infinity;
      let lastNow = -Infinity;
      const samples = r.int(1, 30);
      for (let i = 0; i < samples; i++) {
        // This computer's clock was changed (or it slept and NTP fixed it): the estimate must follow.
        if (i > 0 && r.chance(0.05)) { const jump = r.pick([r.int(-3_600_000, 3_600_000), r.int(-2000, 2000)]); local += jump; truth -= jump; lastNow = -Infinity; }
        const wait = r.int(0, 20_000);
        local += wait; mono += wait;
        const up = r.int(2, 1500), down = r.int(2, 1500);
        const sent = local;
        const serverAt = sent + up + truth;
        const date = Math.floor(serverAt / 1000) * 1000;
        local = sent + up + down; mono += up + down;
        clock.observe(sent, local, date);
        minWidth = Math.min(minWidth, up + down + 1000);
        const err = Math.abs(clock.offset() - truth);
        check(err <= minWidth / 2 + 1, `offset off by ${err} ms after ${i + 1} answers (bound ${minWidth / 2})`);
        const n = clock.now();
        check(n >= lastNow || lastNow - n > 2000, `server time went back ${lastNow - n} ms`);
        lastNow = n;
      }
    }), timeoutFor(5));

  it('a screen hearing every live change twice, in any order, never steps back to an older one', () =>
    scenario('live order', (r) => {
      const n = r.int(1, 60);
      const epoch = 'e' + r.int(1, 1e6);
      const arrivals: { at: number; seq: number }[] = [];
      for (let seq = 1; seq <= n; seq++) for (const delay of [r.int(0, 5), r.int(0, 400)]) arrivals.push({ at: seq * r.int(1, 50) + delay, seq });
      arrivals.sort((a, b) => a.at - b.at);
      const accept = liveOrder();
      let shown = 0;
      for (const m of arrivals) if (accept({ seq: m.seq, epoch })) { check(m.seq > shown, `showed ${m.seq} after ${shown}`); shown = m.seq; }
      check(shown === Math.max(...arrivals.map((a) => a.seq)), `ended on ${shown}, the newest was ${n}`);
      // A restarted console (new run) is taken at once.
      check(accept({ seq: 1, epoch: epoch + 'x' }), 'a restarted console was ignored');
    }), timeoutFor(2));

  it('every device picks the same one to make the Sunday 1:55 copy: the open church computer, else the newest open device', () =>
    scenario('Sunday copy', (r) => {
      const now = new Date(2026, 10, 29, 13, 55 + r.int(0, 29), r.int(0, 59));
      const t = now.getTime();
      const n = r.int(1, 6);
      const devices: DeviceRegistration[] = Array.from({ length: n }, (_, i) => ({
        id: `d${r.int(0, 9)}${i}`, name: r.pick(['교회 본당 Mac', '집 노트북', '전도사님 PC', 'Windows 기기', 'church laptop', 'iPad']), userName: '', platform: 'test', account: 'church',
        lastSeen: t - r.pick([0, 30_000, 90_000, 150_000, 400_000, 3_600_000]), ...(r.chance(0.3) ? { church: r.chance(0.7) } : {}),
      }));
      const activity: ActivityEntry[] = devices.flatMap((d) => (r.chance(0.8) ? [{ id: `o${d.id}`, at: t - r.int(0, 7_200_000), action: 'app/open', detail: d.name, device: d, account: 'church' }] : []));
      const showing = r.chance(0.2);
      if (showing) activity.push({ id: 'show', at: t - r.int(0, 3_000_000), action: 'show/start', detail: '1129 주일예배', device: r.pick(devices), account: 'church' });
      const lib: Library = { ...createSeedLibrary(), devices, activity, playlists: [{ id: 'pl', name: `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')} 주일예배`, items: [{ id: 'i', presentationId: 'p_grace' }] }] };
      // Open devices: those seen in the last 3 minutes. Each one decides by itself from the same synced view.
      const open = devices.filter((d) => t - d.lastSeen <= 180_000);
      const makers = open.filter((d) => sundayBackupDecision({ now, serverNow: t, lib, self: d, showingHere: false, shared: true, doneHere: false }).make);
      if (showing || !open.length) { check(makers.length === 0, `${makers.length} devices made a copy while a show was running / none open`); return; }
      const picks = new Set(open.map((d) => backupDevice(devices, activity, d, t)));
      check(picks.size === 1, `devices disagree on who makes the copy: ${[...picks].join(', ')}`);
      check(makers.length === 1, `${makers.length} devices made the copy`);
      const chosen = makers[0];
      const church = open.filter((d) => isChurchDevice(d));
      if (church.length) check(isChurchDevice(chosen), `${chosen.name} made the copy although the church computer was open`);
      // Once one device made it (synced activity), nobody makes it again.
      const done: Library = { ...lib, activity: [...activity, { id: 'b', at: t, action: BACKUP_ACTION, detail: '', device: chosen, account: 'church' }] };
      check(open.every((d) => !sundayBackupDecision({ now, serverNow: t, lib: done, self: d, showingHere: false, shared: true, doneHere: false }).make), 'a second copy was made after the first');
    }), timeoutFor(2));

  it('devices ask often while someone edits, less when idle or hidden, and back off from a server that is down', () =>
    scenario('poll timing', (r) => {
      const now = r.int(1e12, 2e12);
      const failures = r.chance(0.3) ? r.int(1, 12) : 0;
      const c = { failures, hidden: r.chance(0.3), focused: r.chance(0.7), now, activeAt: now - r.pick([0, 10_000, 60_000, 200_000, 900_000, 1e9]) };
      const d = pollDelay(c);
      if (failures) { check(d === retryDelay(failures) && d >= 5000 && d <= 180_000, `back-off ${d} ms after ${failures} failures`); return; }
      if (c.hidden) { check(d === POLL.hidden, `hidden window asks every ${d} ms`); return; }
      check(d >= POLL.live && d <= POLL.idle, `asks every ${d} ms`);
      if (now - c.activeAt < 180_000) check(d === POLL.live, `asks every ${d} ms while someone edits`);
    }), timeoutFor(1));

  it('an edit reaches every other device within about two seconds through a network with delay (and asking stays cheap)', () =>
    scenario('sync speed', async (r) => speedSession(r)), timeoutFor(120));
});

/**
 * Devices polling on the app's own schedule (useCloudSync: pollDelay, PUSH_DELAY) over a network with 20–250 ms each
 * way. Edits on random devices; how long until every other device shows each one.
 */
async function speedSession(r: Rng) {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-11-29T05:00:00Z'));
  const { worker, clients } = await setup(r.int(2, 4));
  await converge(clients);
  const latency = () => r.int(20, 250);
  worker.before = () => new Promise((done) => setTimeout(done, latency()));
  worker.after = () => new Promise((done) => setTimeout(done, latency()));
  let stop = false;
  const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const loops = clients.map(async (c) => {
    await wait(r.int(0, 3000));
    while (!stop) {
      await c.sync('pull');
      if (c.laterPending) { c.laterPending = false; await c.sync('push'); }
      await wait(pollDelay({ failures: c.ctl.failures, hidden: false, focused: true, now: Date.now(), activeAt: c.ctl.activeAt ?? 0 }));
    }
  });
  const pending: { value: string; at: number; from: SimClient; seen: Set<SimClient> }[] = [];
  const delays: number[] = [];
  const text = (c: SimClient) => c.presentation('p_grace')!.slides[0].text;
  const watch = () => {
    for (const p of pending) for (const c of clients) if (c !== p.from && !p.seen.has(c) && text(c) === p.value) { p.seen.add(c); delays.push(Date.now() - p.at); }
  };
  const before = worker.requests.length;
  const edits = r.int(2, 5);
  for (let i = 0; i < edits; i++) {
    for (let k = 0; k < r.int(20, 60); k++) { await vi.advanceTimersByTimeAsync(100); watch(); }
    const c = r.pick(clients);
    const value = `${c.name}-${i}`;
    c.dispatch({ type: 'slide/update', presentationId: 'p_grace', slideId: c.presentation('p_grace')!.slides[0].id, patch: { text: value } });
    pending.push({ value, at: Date.now(), from: c, seen: new Set() });
    // As useCloudSync's push effect: sent PUSH_DELAY after the change.
    c.ctl.activeAt = Date.now();
    void wait(PUSH_DELAY).then(() => c.sync('push'));
  }
  for (let k = 0; k < 80; k++) { await vi.advanceTimersByTimeAsync(100); watch(); }
  stop = true;
  await vi.advanceTimersByTimeAsync(15_000);
  await Promise.all(loops);
  vi.useRealTimers();
  // Only the latest edit has to reach everyone (an older one may be overwritten before it arrives).
  const last = pending.at(-1)!;
  check(last.seen.size === clients.length - 1, `the last edit reached ${last.seen.size} of ${clients.length - 1} devices within 8 s`);
  const worst = Math.max(...delays);
  // Sent after PUSH_DELAY (or right after a round already under way), one write (a round trip), the other device's
  // next ask (every second while editing, two seconds otherwise), one read — and now and then a write race (one more
  // round trip) or the change landing just after the other device asked.
  check(worst <= PUSH_DELAY + POLL.visible + 6 * 250 + 500, `an edit took ${worst} ms to reach another device`);
  const minutes = (Date.now() - new Date('2026-11-29T05:00:00Z').getTime()) / 60_000;
  const perDeviceMinute = (worker.requests.length - before) / clients.length / minutes;
  check(perDeviceMinute <= 75, `${perDeviceMinute.toFixed(0)} requests per device per minute`);
  speedStats.push(...delays);
}
const speedStats: number[] = [];
afterEach(() => {
  if (!speedStats.length || !process.env.SYNC_STRESS_REPORT) return;
  const sorted = [...speedStats].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  // eslint-disable-next-line no-console
  console.log(`sync speed: ${sorted.length} deliveries, median ${q(0.5)} ms, p95 ${q(0.95)} ms, max ${sorted.at(-1)} ms`);
  import('node:fs').then((fs) => fs.appendFileSync(`${process.env.SYNC_STRESS_REPORT}/speed.json`, JSON.stringify({ deliveries: sorted.length, median: q(0.5), p95: q(0.95), max: sorted.at(-1) }) + '\n'));
  speedStats.length = 0;
});
