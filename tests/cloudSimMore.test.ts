import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { converge, pres, setup, SimClient, textOf } from './helpers/cloudSim';
import { importedOpeningDeck } from '../src/domain/sunday/openingImport';
import { OPENING_FOLDER, findOpeningDeck } from '../src/domain/sunday/openingSong';
import { createSeedLibrary } from '../src/domain/defaults';
import { retryDelay } from '../src/domain/syncStatus';
import { syncMedia } from '../src/domain/cloud';
import type { Slide } from '../src/domain/types';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T09:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const imageSlide = (id: string, mediaId: string): Slide => ({ id, group: 'g', text: '', elements: [{ id: `${id}_e`, kind: 'image', x: 0, y: 0, w: 100, h: 100, mediaId, fit: 'fill' }] });

describe('offline and retries', () => {
  it('keeps edits while the server is unreachable and sends them once it is back; the status never stays "syncing"', async () => {
    const { worker, clients: [a, b] } = await setup(2);
    await converge([a, b]);
    worker.down = true;
    a.dispatch({ type: 'presentation/create', presentation: pres('p_off', '오프라인 곡') });
    await a.sync();
    expect(a.status.state).toBe('offline');
    await a.sync();
    expect(a.ctl.failures).toBe(2);
    expect(retryDelay(a.ctl.failures)).toBeGreaterThan(retryDelay(0));
    a.online = false;
    await a.sync();
    expect(a.status.state).toBe('offline');
    a.online = true;
    worker.down = false;
    await converge([a, b]);
    expect(a.status.state).toBe('synced');
    expect(a.ctl.failures).toBe(0);
    expect(b.titles()).toContain('오프라인 곡');
  });

  it('a 500 from the server is an error, not offline, and the next round recovers', async () => {
    const { worker, clients: [a] } = await setup(1);
    worker.before = (r) => (r.method === 'PUT' && r.path === 'library' ? new Response(JSON.stringify({ error: '서버 오류' }), { status: 500, headers: { 'content-type': 'application/json' } }) : undefined);
    await a.sync();
    expect(a.status).toEqual({ state: 'error', message: '서버 오류' });
    worker.before = null;
    await a.settle();
    expect(a.status.state).toBe('synced');
  });

  it('a write the server took but whose answer was lost is not doubled', async () => {
    const { worker, clients: [a, b] } = await setup(2);
    await converge([a, b]);
    a.dispatch({ type: 'presentation/create', presentation: pres('p_lost', '잃어버린 응답') });
    let cut = true;
    worker.after = (r) => { if (cut && r.method === 'PUT' && r.path === 'library') { cut = false; throw new TypeError('fetch failed'); } };
    await a.sync();
    expect(a.status.state).toBe('offline');
    await converge([a, b]);
    for (const c of [a, b]) expect(c.titles().filter((t) => t.startsWith('잃어버린 응답'))).toEqual(['잃어버린 응답']);
  });

  it('a computer that keeps losing the race to other writers still gets its edit in', async () => {
    const { worker, clients: [a, b, c] } = await setup(3);
    await converge([a, b, c]);
    a.dispatch({ type: 'presentation/create', presentation: pres('p_a', 'A 곡') });
    // Another computer writes just before each of A's first two writes.
    let n = 0;
    const others = [b, c];
    worker.before = async (r) => {
      if (r.method !== 'PUT' || r.path !== 'library' || r.token !== a.session!.token || n >= 2) return;
      const other = others[n++];
      other.dispatch({ type: 'presentation/create', presentation: pres(`p_${other.name}`, `${other.name} 곡`) });
      await other.sync();
    };
    await a.sync();
    expect(a.status.state).toBe('synced');
    worker.before = null;
    await converge([a, b, c]);
    for (const x of [a, b, c]) expect(x.titles()).toEqual(expect.arrayContaining(['A 곡', 'B 곡', 'C 곡']));
  });

  it('two rounds asked for at once run one after the other, never together', async () => {
    const { clients: [a] } = await setup(1);
    const first = a.sync();
    await a.sync();
    expect(a.ctl.requested).toBe(true);
    await first;
    expect(a.laterPending).toBe(true);
    expect(a.ctl.busy).toBe(false);
    expect(a.status.state).toBe('synced');
  });

  it('an expired login stops syncing and says so', async () => {
    const { worker, clients: [a] } = await setup(1);
    worker.tokens.clear();
    await a.sync();
    expect(a.signedOut).toBe(true);
    expect(a.status.state).toBe('off');
    expect(a.laterPending).toBe(false);
  });
});

describe('media and fonts across computers', () => {
  it('a picture added on A appears on B, once, and is not uploaded again', async () => {
    const { worker, clients: [a, b] } = await setup(2);
    a.addMedia('m_pic', 'PNGDATA');
    a.dispatch({ type: 'presentation/create', presentation: { ...pres('p_pic', '그림 덱'), slides: [imageSlide('s1', 'm_pic')] } });
    await converge([a, b]);
    expect(await textOf(b.media.get('m_pic'))).toBe('PNGDATA');
    expect(worker.count('PUT', 'media/m_pic')).toBe(1);
    await converge([a, b]);
    expect(worker.count('PUT', 'media/m_pic')).toBe(1);
  });

  it('imported .pptx/.ppt/.odp slides bring their pictures to the other computer', async () => {
    const { clients: [a, b] } = await setup(2);
    // As filesToSlides stores them: one media entry per picture (backgroundHidden), slides marked with their source.
    const slides: Slide[] = [];
    for (const [i, format] of (['pptx', 'ppt', 'odp'] as const).entries()) {
      a.addMedia(`m_imp${i}`, `pic-${format}`, { backgroundHidden: true });
      slides.push({ ...imageSlide(`s_imp${i}`, `m_imp${i}`), importSource: { format: format === 'odp' ? 'pptx' : format, name: `x.${format}`, page: 1 } } as Slide);
    }
    a.dispatch({ type: 'presentation/create', presentation: { ...pres('p_imp', '가져온 덱'), slides } });
    await converge([a, b]);
    for (let i = 0; i < 3; i++) expect(b.media.has(`m_imp${i}`)).toBe(true);
    expect(b.presentation('p_imp')!.slides).toHaveLength(3);
  });

  it('a file that cannot be sent is retried next time without failing the round', async () => {
    const { worker, clients: [a, b] } = await setup(2);
    a.addMedia('m_big', 'DATA');
    let fail = true;
    worker.before = (r) => (fail && r.method === 'PUT' && r.path === 'media/m_big' ? new Response(JSON.stringify({ error: '잠시 후' }), { status: 500, headers: { 'content-type': 'application/json' } }) : undefined);
    await a.settle();
    expect(a.status.state).toBe('synced');
    expect(a.status.message).toContain('미디어 1개');
    fail = false;
    await converge([a, b]);
    expect(b.media.has('m_big')).toBe(true);
    expect(a.status.message).toBeNull();
  });

  it('an interrupted upload (connection lost mid-file) is sent again in full', async () => {
    const { worker, clients: [a, b] } = await setup(2);
    a.addMedia('m_cut', 'WHOLEFILE');
    let cut = true;
    worker.after = (r) => { if (cut && r.path === 'media/m_cut' && r.method === 'PUT') { cut = false; worker.account('church').media.delete('m_cut'); throw new TypeError('fetch failed'); } };
    await a.sync();
    expect(a.status.state).toBe('offline');
    await converge([a, b]);
    expect(await textOf(b.media.get('m_cut'))).toBe('WHOLEFILE');
  });

  it('a full server says which files waited, and sends them when there is room', async () => {
    const { worker, clients: [a, b] } = await setup(2, { quotaBytes: 5 });
    a.addMedia('m_q', 'TOO-LARGE');
    await a.settle();
    expect(a.status.state).toBe('synced');
    expect(a.status.message).toContain('미디어 1개');
    worker.quotaBytes = Infinity;
    await converge([a, b]);
    expect(b.media.has('m_q')).toBe(true);
  });

  it('a font imported on A is installed on B; removing it on A removes it on B', async () => {
    const { worker, clients: [a, b] } = await setup(2);
    a.importFont('은혜체', 'FONTBYTES');
    await converge([a, b]);
    expect(b.fonts.map((f) => f.family)).toEqual(['은혜체']);
    expect(b.lib.fonts?.length).toBe(1);
    const fontId = b.lib.fonts![0].id;
    expect(worker.account('church').media.has(fontId)).toBe(true);
    a.fonts = [];
    await converge([a, b]);
    expect(b.fonts).toEqual([]);
    expect(worker.account('church').media.has(fontId)).toBe(false);
  });
});

describe('기도회 찬양 deck', () => {
  it('an imported 기도회 찬양 deck and its sheet-music pictures reach the other computer, which finds it by title next week', async () => {
    const { clients: [a, b] } = await setup(2);
    a.addMedia('m_score1', 'SCORE-1', { backgroundHidden: true });
    a.addMedia('m_score2', 'SCORE-2', { backgroundHidden: true });
    const deck = importedOpeningDeck('주를 찾는 모든 자들이', [imageSlide('o1', 'm_score1'), imageSlide('o2', 'm_score2')], '주를 찾는.ppt');
    a.dispatch({ type: 'presentation/createMany', presentations: [deck] });
    await converge([a, b]);
    const got = findOpeningDeck(b.lib.presentations, '주를 찾는 모든 자들이');
    expect(got?.id).toBe(deck.id);
    expect(got?.folder).toBe(OPENING_FOLDER);
    expect(await textOf(b.media.get('m_score2'))).toBe('SCORE-2');
  });
});

describe('accounts, reset, scale and clocks', () => {
  it('switching account does not carry the old account\'s base into the new one', async () => {
    const { worker, clients: [a] } = await setup(1);
    await worker.fetch('/api/cloud/register', { method: 'POST', body: JSON.stringify({ username: 'youth', password: 'pw', adminPassword: 'admin' }), headers: { 'content-type': 'application/json' } });
    a.dispatch({ type: 'presentation/create', presentation: pres('p_church', '교회 곡') });
    await a.settle();
    // Another computer of the youth account wrote a library there.
    const y = new SimClient('Y', worker, { library: { ...createSeedLibrary(), presentations: [pres('p_youth', '청년부 곡')] } });
    await y.login('youth');
    await y.settle();
    await a.login('youth');
    await a.settle();
    const youth = worker.account('youth').library.data as { presentations: { title: string }[] };
    // Nothing the youth account had is lost; the church song comes along as this computer's own (no shared history).
    expect(youth.presentations.map((p) => p.title)).toEqual(expect.arrayContaining(['청년부 곡']));
    expect(a.titles()).toContain('청년부 곡');
    expect(a.titles()).toContain('교회 곡');
  });

  it('signing into another account during a round does not leave the status at "syncing"', async () => {
    const { worker, clients: [a] } = await setup(1);
    await worker.fetch('/api/cloud/register', { method: 'POST', body: JSON.stringify({ username: 'youth', password: 'pw', adminPassword: 'admin' }), headers: { 'content-type': 'application/json' } });
    let once = true;
    worker.before = async (r) => {
      if (!once || r.path !== 'media') return;
      once = false;
      await a.login('youth');
      await a.sync(); // what the hook does for the new sign-in: it finds the old round still running
    };
    await a.sync();
    expect(a.laterPending).toBe(true);
    a.laterPending = false;
    await a.sync('push');
    expect(a.status.state).toBe('synced');
    expect(worker.account('youth').library.version).toBeGreaterThan(0);
  });

  it('a cloud reset empties every computer and old media are not uploaded back', async () => {
    const { worker, clients: [a, b] } = await setup(2);
    a.addMedia('m_old', 'OLD');
    await converge([a, b]);
    const seed = createSeedLibrary();
    const empty = { ...seed, cloudResetId: 'reset-2', presentations: [], media: [], sunday: { ...seed.sunday, frontId: null, prayerId: null, backId: null } };
    worker.reset('church', empty);
    await b.settle();
    await a.settle();
    for (const c of [a, b]) {
      expect(c.lib.cloudResetId).toBe('reset-2');
      expect(c.titles()).toEqual([]);
    }
    expect(worker.account('church').media.has('m_old')).toBe(false);
    await converge([a, b]);
    expect(worker.account('church').media.size).toBe(0);
  });

  it('an upload from before a reset is refused, not counted as sent', async () => {
    const { worker, clients: [a] } = await setup(1);
    worker.account('church').resetId = 'newer';
    a.addMedia('m_stale', 'STALE');
    // A round that started before the reset still carries the old generation.
    const result = await syncMedia(a.session!.token, { ...a.lib, cloudResetId: 'older' }, () => {}, a.store);
    expect(worker.account('church').media.has('m_stale')).toBe(false);
    expect(result.failed).toEqual(['m_stale']);
    expect(result.some((m) => m.id === 'm_stale')).toBe(false);
  });

  it('a large library (200 slides, 50 pictures) syncs and then stays quiet', async () => {
    const { worker, clients: [a, b] } = await setup(2);
    for (let i = 0; i < 50; i++) a.addMedia(`m_${i}`, `pic${i}`);
    for (let p = 0; p < 20; p++) {
      a.dispatch({ type: 'presentation/create', presentation: { ...pres(`p_big${p}`, `큰 덱 ${p}`), slides: Array.from({ length: 10 }, (_, s) => imageSlide(`p${p}s${s}`, `m_${(p * 10 + s) % 50}`)) } });
    }
    await converge([a, b]);
    expect(b.lib.presentations.filter((p) => p.id.startsWith('p_big')).reduce((n, p) => n + p.slides.length, 0)).toBe(200);
    expect(b.media.size).toBe(50);
    expect(worker.count('PUT', 'media/')).toBe(50);
    const writes = worker.count('PUT', 'library');
    await converge([a, b]);
    expect(worker.count('PUT', 'library')).toBe(writes);
  });

  it('a computer whose clock is hours off still merges by history, not by time', async () => {
    const { clients: [a, b] } = await setup(2);
    await converge([a, b]);
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z')); // B's clock a month behind
    b.dispatch({ type: 'presentation/update', id: 'p_grace', patch: { title: '느린 시계' } });
    await b.settle();
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));
    await a.settle();
    expect(a.presentation('p_grace')!.title).toBe('느린 시계');
    await converge([a, b]);
  });

  it('ids made on two computers at once never collide', async () => {
    const { clients: [a, b] } = await setup(2);
    await converge([a, b]);
    const da = importedOpeningDeck('A', [imageSlide('x', 'm')], 'a.pptx');
    const db = importedOpeningDeck('B', [imageSlide('y', 'm')], 'b.pptx');
    expect(da.id).not.toBe(db.id);
    a.dispatch({ type: 'presentation/createMany', presentations: [da] });
    b.dispatch({ type: 'presentation/createMany', presentations: [db] });
    await converge([a, b]);
    for (const c of [a, b]) expect(c.titles()).toEqual(expect.arrayContaining(['A', 'B']));
  });
});
