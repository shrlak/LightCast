// Stress: several servers and accounts — switching account, moving to a new server, an administrator reset, quiet
// polling, and two windows on one computer. Deep run: SYNC_STRESS_RUNS=5000 npx vitest run tests/stress
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { check, scenario, timeoutFor, type Rng } from './helpers/stress';
import { syncSession } from './helpers/syncSession';
import { converge, FakeWorker, pres, SimClient } from './helpers/cloudSim';
import { createSeedLibrary } from '../src/domain/defaults';
import { createInitialState, reducer } from '../src/domain/reducer';
import { libraryKey, syncable } from '../src/domain/cloudMerge';
import { absorbOtherWindow } from '../src/domain/windowSync';
import type { Library } from '../src/domain/types';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const tick = (r: Rng) => vi.setSystemTime(Date.now() + r.int(1, 2000));
const titlesOf = (lib: Library) => lib.presentations.filter((p) => !p.online).map((p) => p.title).sort().join('|');

describe('sync stress: servers and accounts', () => {
  it('a device switches to another account: neither account loses anything, each ends in step', () =>
    scenario('account switch', async (r) => {
      const { worker, clients } = await syncSession(r, { devices: [2, 3], steps: [4, 10] });
      await worker.fetch('/api/cloud/register', { method: 'POST', body: JSON.stringify({ username: 'youth', password: 'pw', adminPassword: 'admin' }), headers: { 'content-type': 'application/json' } });
      const churchBefore = worker.account('church').library.version;
      const churchTitles = titlesOf(clients[0].lib);
      const mover = clients[clients.length - 1];
      for (let i = 0; i < r.int(0, 3); i++) { tick(r); mover.dispatch({ type: 'presentation/create', presentation: pres(`p_y${i}`, `청년부 ${i}`) }); }
      await mover.login('youth');
      await mover.settle();
      const stay = clients.filter((c) => c !== mover);
      await converge(stay);
      check(worker.account('church').library.version === churchBefore || titlesOf(stay[0].lib) === churchTitles, 'the church account changed because a device switched away');
      check(titlesOf(stay[0].lib) === churchTitles, 'the church library lost or gained presentations when a device switched account');
      const youth = worker.account('youth').library.data as Library;
      for (const t of churchTitles.split('|').filter(Boolean)) check(youth.presentations.some((p) => p.title === t), `the device's own copy of "${t}" did not reach its new account`);
      await mover.settle();
      check(libraryKey(syncable(mover.lib)) === libraryKey(syncable(new SimClient('x', worker, { library: youth }).lib)) || mover.status.state === 'synced', 'the switched device is not in step with its new account');
    }), timeoutFor(80));

  it('every device moves to a new, empty server: the newest library is rebuilt there and nothing is lost', () =>
    scenario('server migration', async (r) => {
      const { clients } = await syncSession(r, { devices: [2, 3], steps: [4, 12] });
      const before = titlesOf(clients[0].lib);
      // Edits made while the move happens.
      const edited = r.pick(clients);
      tick(r);
      edited.dispatch({ type: 'presentation/create', presentation: pres('p_move', '이사 중에 만든 자료') });
      const fresh = new FakeWorker().install();
      await fresh.fetch('/api/cloud/register', { method: 'POST', body: JSON.stringify({ username: 'church', password: 'pw', adminPassword: 'admin' }), headers: { 'content-type': 'application/json' } });
      for (const c of r.shuffle(clients)) { c.worker = fresh; await c.login('church'); }
      await converge(r.shuffle(clients), 12);
      const keys = clients.map((c) => libraryKey(syncable(c.lib)));
      check(keys.every((k) => k === keys[0]), 'devices differ on the new server');
      for (const t of before.split('|').filter(Boolean)) check(clients[0].lib.presentations.some((p) => p.title === t), `"${t}" was lost moving servers`);
      check(clients[0].lib.presentations.some((p) => p.id === 'p_move'), 'the edit made during the move was lost');
    }), timeoutFor(80));

  it('an administrator resets the server mid-session: every device ends with the reset library, nothing old comes back', () =>
    scenario('server reset', async (r) => {
      const { worker, clients } = await syncSession(r, { devices: [2, 3], steps: [4, 10], media: true });
      const seed = createSeedLibrary();
      const empty = { ...seed, cloudResetId: `reset-${r.int(1, 1e9)}`, presentations: [], media: [], sunday: { ...seed.sunday, frontId: null, prayerId: null, backId: null } };
      worker.reset('church', empty as Library);
      for (const c of r.shuffle(clients)) { if (r.chance(0.5)) { tick(r); c.addMedia(`m_late_${c.name}`, 'LATE'); } await c.settle(); }
      await converge(clients, 10);
      for (const c of clients) {
        check(c.lib.cloudResetId === empty.cloudResetId, `${c.name} did not take the reset`);
        check(!c.lib.presentations.some((p) => p.id.startsWith('p_s')), `${c.name} brought an old presentation back after the reset`);
      }
      check(![...worker.account('church').media.keys()].some((id) => id.startsWith('m_') && !id.startsWith('m_late')), 'an old media file was uploaded back after the reset');
    }), timeoutFor(80));

  it('once in step, polling asks one small question per round and sends nothing', () =>
    scenario('quiet polls', async (r) => {
      const { worker, clients } = await syncSession(r, { devices: [2, 3], steps: [4, 10], media: true, fonts: true });
      const before = worker.requests.length;
      const polls = r.int(3, 12);
      for (let i = 0; i < polls; i++) for (const c of clients) { tick(r); await c.sync('pull'); }
      const asked = worker.requests.slice(before);
      check(asked.every((q) => q.startsWith('GET library?known=')), `a quiet poll sent more than one question: ${[...new Set(asked.filter((q) => !q.startsWith('GET library?known=')))].join(', ')}`);
      check(asked.length === polls * clients.length, `${asked.length} requests for ${polls * clients.length} polls`);
    }), timeoutFor(80));

  it('two windows on one computer editing the same library end the same, each part its latest edit', () =>
    scenario('two windows', (r) => {
      // As useWindowSync + OperatorView: each window saves its library on every change, merging first whatever another
      // window saved since it last read or wrote (persistence.libraryChangedElsewhere); the other window also hears of
      // a save some time later (a storage event) and then merges what storage holds at that moment.
      let now = 1_800_000_000_000;
      const actor = (w: number) => ({ id: `win${w}`, name: `창${w}`, userName: '', platform: 'test' });
      // Both windows open the same stored library.
      const start = createSeedLibrary();
      const wins = [createInitialState(structuredClone(start)), createInitialState(structuredClone(start))];
      let storage = syncable(wins[0].library);
      const base: Library[] = [storage, storage];
      const seen: Library[] = [storage, storage];
      const heard = [0, 0];
      const last = new Map<string, { at: number; v: string }>();
      /** useWindowSync's reconcile: true when it merged (the save comes after, for the merged library). */
      const reconcile = (w: number) => {
        if (storage === seen[w]) return false;
        const stored = storage;
        seen[w] = stored;
        const merged = absorbOtherWindow(base[w], wins[w].library, stored);
        base[w] = stored;
        if (!merged) return false;
        wins[w] = reducer(wins[w], { type: 'library/merge', library: merged, from: wins[w].library });
        return true;
      };
      /** OperatorView's save effect, run after every change of the window's library. */
      const save = (w: number) => {
        if (reconcile(w)) return save(w);
        storage = syncable(wins[w].library); seen[w] = storage; heard[1 - w]++;
      };
      const hear = (w: number) => { if (!heard[w]) return; heard[w] = 0; if (reconcile(w)) save(w); };
      for (let i = 0; i < r.int(10, 40); i++) {
        const w = r.int(0, 1);
        if (r.chance(0.4)) { hear(w); continue; }
        now += r.int(1, 500);
        const slide = r.pick(['s0', 's1']);
        const p = wins[w].library.presentations.find((x) => x.id === 'p_grace')!;
        const target = slide === 's0' ? p.slides[0] : p.slides[1];
        const v = `w${w}-${i}`;
        wins[w] = reducer(wins[w], { type: 'slide/update', presentationId: 'p_grace', slideId: target.id, patch: { text: v }, actor: actor(w), eventId: `e${i}`, occurredAt: now });
        last.set(slide, { at: now, v });
        save(w);
      }
      for (let k = 0; k < 6; k++) { hear(0); hear(1); }
      check(libraryKey(syncable(wins[0].library)) === libraryKey(syncable(wins[1].library)), 'the two windows differ');
      const p = wins[0].library.presentations.find((x) => x.id === 'p_grace')!;
      for (const [slide, e] of last) check((slide === 's0' ? p.slides[0] : p.slides[1]).text === e.v, `${slide} is "${(slide === 's0' ? p.slides[0] : p.slides[1]).text}", the latest edit was "${e.v}"`);
    }), timeoutFor(20));
});
