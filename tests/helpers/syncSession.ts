// One randomised cloud-sync session for the stress suites: a fresh simulated church server, 2–4 simulated devices
// running the real sync code on the real reducer, a random mix of edits, syncs, faults and time passing, and at the
// end the checks every session must pass:
//   1. every device ends with the same library (after the network is back and everyone synced);
//   2. each slide's text and each presentation's title is the one of its latest edit (server time) — exactly with
//      exact clocks, within the clock uncertainty with skewed ones;
//   3. a presentation / slide exists exactly when its latest event (by server time) is an edit, not a deletion;
//   4. sync settles: no endless follow-up rounds, nothing left "syncing";
//   5. no media file and no font is lost.
import { vi } from 'vitest';
import { converge, FakeWorker, pres, serverTime, setup, SimClient, type Req } from './cloudSim';
import { libraryKey, syncable } from '../../src/domain/cloudMerge';
import type { Library } from '../../src/domain/types';
import { check, type Rng } from './stress';

export interface SessionOptions {
  devices?: [number, number];
  steps?: [number, number];
  /** Residual error of each device's server-time estimate (ms, ±). */
  skewMs?: number;
  /** Chance per step that the server goes down / comes back. */
  outages?: number;
  /** Chance per request that the answer is lost after the server applied it. */
  lostAnswers?: number;
  /** Chance per library write that another device writes first (a 409 race). */
  races?: number;
  /** Chance per request that the device's own person types meanwhile (an edit during the round). */
  typing?: number;
  deletes?: boolean;
  media?: boolean;
  /** Chance per media transfer that it fails (disk / network). */
  mediaFaults?: number;
  fonts?: boolean;
  /** Slides with text boxes edited one by one (element level). */
  elements?: boolean;
  /** 주일예배 설정 edited field by field. */
  settings?: boolean;
}

interface Event { at: number; kind: 'edit' | 'delete'; value?: string }

const at = () => Date.now();
const TRACE = process.env.SYNC_TRACE;
const trace = (...xs: unknown[]) => { if (TRACE) console.log(...xs); };
/** Server time moves on (the fake clock every device shares). */
const pass = (r: Rng, max = 2500) => vi.setSystemTime(at() + r.int(1, max));

export async function syncSession(r: Rng, o: SessionOptions = {}): Promise<{ worker: FakeWorker; clients: SimClient[] }> {
  vi.setSystemTime(new Date('2026-11-29T04:00:00Z').getTime() + r.int(0, 3_600_000));
  serverTime.offset = 0;
  const n = r.int(...(o.devices ?? [2, 3]));
  const { worker, clients } = await setup(n);
  const skew = o.skewMs ?? 0;
  for (const c of clients) c.skewMs = skew ? r.int(-skew, skew) : 0;
  const [a] = clients;
  // The shared starting point: a few presentations made on the first device.
  const decks = Array.from({ length: r.int(2, 4) }, (_, i) => `p_s${i}`);
  for (const id of decks) a.dispatch({ type: 'presentation/create', presentation: { ...pres(id, `제목 ${id}`, ['가', '나', '다']), ...(o.elements ? { slides: pres(id, '', ['가', '나', '다']).slides.map((s) => ({ ...s, elements: [0, 1, 2].map((k) => ({ id: `${s.id}_e${k}`, kind: 'text', text: `상자${k}`, x: 10 * k, y: 0, w: 100, h: 50 })) })) } as never : {}) } });
  await converge(clients, 10);
  // What each field should end as: every edit and deletion with its server time.
  const titles = new Map<string, Event[]>();
  const texts = new Map<string, Event[]>();
  const elems = new Map<string, Event[]>();
  const presEvents = new Map<string, Event[]>();
  const slideEvents = new Map<string, Event[]>();
  const prayer: Event[] = [];
  const confession: Event[] = [];
  const add = (m: Map<string, Event[]>, k: string, e: Event) => { const list = m.get(k) ?? []; list.push(e); m.set(k, list); };
  let made = 0;
  let inHook = false;
  const value = (c: SimClient) => `${c.name}${++made}`;

  /** One thing a person does on device `c` (only on what that device shows). */
  const edit = (c: SimClient) => {
    const mine = c.lib.presentations.filter((p) => !p.online && p.id.startsWith('p_s'));
    const p = mine.length ? r.pick(mine) : null;
    const t = c.serverNow();
    const kinds = ['text', 'text', 'text', 'title', ...(o.deletes ? ['deleteSlide', 'addSlide', 'deletePres', 'addPres'] : ['addSlide']), ...(o.elements ? ['element', 'element'] : []), ...(o.settings ? ['prayer', 'confession'] : []), ...(o.media ? ['media'] : []), ...(o.fonts ? ['font'] : [])];
    const kind = r.pick(kinds);
    if (kind === 'media') { const id = `m_${c.name}${++made}`; trace(`  ${c.name} adds media ${id}`); c.addMedia(id, `bytes-${made}`); return; }
    if (kind === 'font') { if (c.fonts.length && r.chance(0.3)) c.fonts = c.fonts.slice(1); else c.importFont(`글꼴${c.name}${++made}`, `FONT-${made}`); return; }
    if (kind === 'prayer') { const v = value(c); c.dispatch({ type: 'sunday/settings', patch: { prayerText: v } }); prayer.push({ at: t, kind: 'edit', value: v }); return; }
    if (kind === 'confession') { const v = value(c); c.dispatch({ type: 'sunday/settings', patch: { confessionSong: v } }); confession.push({ at: t, kind: 'edit', value: v }); return; }
    if (kind === 'addPres' || !p) {
      const id = `p_s${c.name}${++made}`;
      c.dispatch({ type: 'presentation/create', presentation: pres(id, `새 ${id}`, ['하나']) });
      add(presEvents, id, { at: t, kind: 'edit' });
      return;
    }
    if (kind === 'title') {
      const v = value(c);
      trace(`  ${c.name} title ${p.id} = ${v} @${t}`);
      c.dispatch({ type: 'presentation/update', id: p.id, patch: { title: v } });
      add(titles, p.id, { at: t, kind: 'edit', value: v }); add(presEvents, p.id, { at: t, kind: 'edit' });
      return;
    }
    if (kind === 'deletePres') {
      trace(`  ${c.name} delete pres ${p.id} @${t}`);
      c.dispatch({ type: 'presentation/delete', id: p.id });
      add(presEvents, p.id, { at: t, kind: 'delete' });
      return;
    }
    if (kind === 'addSlide') {
      const id = `${p.id}_n${c.name}${++made}`;
      trace(`  ${c.name} add slide ${p.id}/${id} @${t}`);
      c.dispatch({ type: 'presentation/update', id: p.id, patch: { slides: [...p.slides, { id, group: 'V', text: '새 장' }] } });
      add(presEvents, p.id, { at: t, kind: 'edit' }); add(slideEvents, `${p.id}/${id}`, { at: t, kind: 'edit' }); add(texts, `${p.id}/${id}`, { at: t, kind: 'edit', value: '새 장' });
      return;
    }
    const s = p.slides.length ? r.pick(p.slides) : null;
    if (!s) return;
    if (kind === 'deleteSlide' && p.slides.length > 1) {
      trace(`  ${c.name} delete slide ${p.id}/${s.id} @${t}`);
      c.dispatch({ type: 'slide/delete', presentationId: p.id, slideIds: [s.id] });
      add(presEvents, p.id, { at: t, kind: 'edit' }); add(slideEvents, `${p.id}/${s.id}`, { at: t, kind: 'delete' });
      return;
    }
    if (kind === 'element' && s.elements?.length) {
      const e = r.pick(s.elements);
      const v = value(c);
      trace(`  ${c.name} box ${p.id}/${s.id}/${e.id} = ${v} @${t}${inHook ? ' (in hook)' : ''}`);
      c.dispatch({ type: 'slide/update', presentationId: p.id, slideId: s.id, patch: { elements: s.elements.map((x) => (x.id === e.id ? { ...x, text: v } : x)) } });
      add(elems, `${p.id}/${s.id}/${e.id}`, { at: t, kind: 'edit', value: v }); add(presEvents, p.id, { at: t, kind: 'edit' }); add(slideEvents, `${p.id}/${s.id}`, { at: t, kind: 'edit' });
      return;
    }
    const v = value(c);
    trace(`  ${c.name} text ${p.id}/${s.id} = ${v} @${t}`);
    c.dispatch({ type: 'slide/update', presentationId: p.id, slideId: s.id, patch: { text: v } });
    add(texts, `${p.id}/${s.id}`, { at: t, kind: 'edit', value: v }); add(presEvents, p.id, { at: t, kind: 'edit' }); add(slideEvents, `${p.id}/${s.id}`, { at: t, kind: 'edit' });
  };

  // Faults while the session runs.
  worker.before = async (req: Req) => {
    if (inHook) return;
    const who = clients.find((c) => c.session?.token === req.token);
    if (!who) return;
    if (o.typing && r.chance(o.typing)) { pass(r, 300); trace(`  [${who.name} types during ${req.method} ${req.path}]`); edit(who); }
    if (o.races && req.method === 'PUT' && req.path === 'library' && r.chance(o.races)) {
      const other = r.pick(clients.filter((c) => c !== who));
      inHook = true;
      try { pass(r, 300); trace(`  [race: ${other.name} writes first]`); edit(other); await other.sync('push'); } finally { inHook = false; }
    }
  };
  worker.after = async (req: Req) => {
    if (o.lostAnswers && !inHook && r.chance(o.lostAnswers)) { trace(`  [answer lost: ${req.method} ${req.path}]`); throw new TypeError('fetch failed (answer lost)'); }
  };
  if (o.mediaFaults) for (const c of clients) c.failMedia = (id, dir) => { const f = r.chance(o.mediaFaults!); if (f) trace(`  [${c.name} disk ${dir} fails for ${id}]`); return f; };

  const steps = r.int(...(o.steps ?? [8, 24]));
  for (let i = 0; i < steps; i++) {
    pass(r);
    if (o.outages && r.chance(o.outages)) { worker.down = !worker.down; trace(`server ${worker.down ? 'DOWN' : 'up'}`); }
    const c = r.pick(clients);
    const roll = r.next();
    if (roll < 0.5) edit(c);
    else if (roll < 0.8) { const how = r.chance(0.5) ? 'push' : 'pull'; await c.sync(how).catch(() => undefined); trace(`  ${c.name} sync ${how} → ${c.status.state} v${c.session?.version}`); }
    else { await c.settle().catch(() => undefined); trace(`  ${c.name} settle → ${c.status.state} v${c.session?.version}`); }
    if (TRACE) trace('    ' + clients.map((x) => `${x.name}:[${x.lib.presentations.filter((p) => p.id.startsWith('p_s')).map((p) => `${p.id}(${p.slides.map((s) => (TRACE === '2' ? `${s.id.split('_').pop()}:${s.text}@${((s as { editedAt?: number }).editedAt ?? 0) % 100000}` : s.text)).join(',')})`).join(' ')}]`).join(' | '));
  }

  // The network comes back; everyone syncs until quiet.
  worker.down = false; worker.before = null; worker.after = null;
  for (const c of clients) c.failMedia = null;
  pass(r);
  try { await converge(clients, 12); }
  catch (e) { throw new Error(`no convergence: ${(e as Error).message}`); }
  // Polling goes on (as in the app): a few more rounds 20 s apart, for files still on their way.
  for (let k = 0; k < 3; k++) { vi.setSystemTime(at() + 20_000); for (const c of clients) await c.settle(); }
  if (TRACE === '2') {
    const show = (l: Library | null | undefined) => l?.presentations.filter((p) => p.id.startsWith('p_s')).map((p) => `${p.id}(${p.slides.map((x) => x.id.split('_').pop()).join(',')})`).join(' ');
    trace('END server', show(worker.account('church').library.data as Library), 'trash', JSON.stringify(((worker.account('church').library.data as Library).trash ?? []).map((e) => [e.kind, e.presentation.id, e.deletedAt % 100000, e.slides?.map((x) => x.slide.id.split('_').pop())])));
    for (const c of clients) trace(`END ${c.name}`, show(c.lib), '| base', show(c.base));
  }

  // 1. One library everywhere.
  const keys = clients.map((c) => libraryKey(syncable(c.lib)));
  check(keys.every((k) => k === keys[0]), `devices differ after sync (${clients.map((c) => c.titles().length).join('/')} presentations)`);
  const lib = a.lib;
  for (const c of clients) check(c.status.state === 'synced', `${c.name} ended "${c.status.state}": ${c.status.message}`);

  // 2–3. Every part as its latest edit; existence by the latest event.
  const tol = 2 * skew;
  const latest = (events: Event[]) => events.reduce((m, e) => (e.at > m.at ? e : m));
  const fits = (events: Event[], v: unknown, what: string) => {
    const top = latest(events);
    if (!tol) check(v === top.value || events.some((e) => e.at === top.at && e.value === v), `${what} is "${String(v)}", the latest edit was "${top.value}"`);
    else check(events.some((e) => e.value === v && e.at >= top.at - tol), `${what} is "${String(v)}", not one of the latest edits (latest "${top.value}")`);
  };
  const exists = (events: Event[] | undefined) => {
    if (!events?.length) return undefined;
    const top = latest(events);
    const tied = events.filter((e) => Math.abs(e.at - top.at) <= tol);
    return tied.some((e) => e.kind === 'edit') ? (tied.some((e) => e.kind === 'delete') ? undefined : true) : false;
  };
  for (const [pid, events] of presEvents) {
    const want = exists(events);
    const has = lib.presentations.some((p) => p.id === pid);
    if (want !== undefined) check(has === want, `presentation ${pid} ${has ? 'exists' : 'is gone'}, its latest event was ${want ? 'an edit' : 'a deletion'}`);
  }
  for (const [key, events] of slideEvents) {
    const [pid, sid] = key.split('/');
    const p = lib.presentations.find((x) => x.id === pid);
    if (!p) continue;
    const want = exists(events);
    const has = p.slides.some((x) => x.id === sid);
    if (want !== undefined) check(has === want, `slide ${key} ${has ? 'exists' : 'is gone'}, its latest event was ${want ? 'an edit' : 'a deletion'}`);
  }
  for (const [pid, events] of titles) { const p = lib.presentations.find((x) => x.id === pid); if (p) fits(events, p.title, `title of ${pid}`); }
  for (const [key, events] of texts) {
    const [pid, sid] = key.split('/');
    const s = lib.presentations.find((x) => x.id === pid)?.slides.find((x) => x.id === sid);
    if (s) fits(events, s.text, `text of ${key}`);
  }
  for (const [key, events] of elems) {
    const [pid, sid, eid] = key.split('/');
    const e = lib.presentations.find((x) => x.id === pid)?.slides.find((x) => x.id === sid)?.elements?.find((x) => x.id === eid);
    if (e) fits(events, (e as { text?: string }).text, `text box ${key}`);
  }
  if (prayer.length) fits(prayer, lib.sunday.prayerText, '기도제목');
  if (confession.length) fits(confession, lib.sunday.confessionSong, '고백송');

  // 4. Quiet: one more round each sends nothing.
  const puts = worker.count('PUT', 'library');
  for (const c of clients) await c.settle();
  check(worker.count('PUT', 'library') === puts, 'sync did not settle (another write after convergence)');

  // 5. Media and fonts: every file the library names is on every device and on the server.
  if (o.media) for (const m of lib.media.filter((x) => x.id.startsWith('m_'))) {
    for (const c of clients) check(c.media.has(m.id), `${c.name} lacks media ${m.id}`);
    check(worker.account('church').media.has(m.id), `server lacks media ${m.id}`);
  }
  if (o.fonts) {
    const families = (c: SimClient) => c.fonts.map((f) => f.family).sort().join('|');
    for (const c of clients) check(families(c) === families(a), `${c.name} fonts ${families(c)} ≠ ${families(a)}`);
  }
  return { worker, clients };
}
