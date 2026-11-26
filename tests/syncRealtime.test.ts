// The pieces behind "the later edit wins, at once": the server clock, edit stamps, field-level merging, edits made
// while a sync round is in flight, the app server's caching and compression, and the Sunday copy rules.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { createServerClock, learnServerTime, SERVER_DATE_HEADER } from '../src/domain/serverClock';
import { stampEdits, withoutStamps } from '../src/domain/editStamps';
import { mergeLibrary, syncable } from '../src/domain/cloudMerge';
import { createSeedLibrary } from '../src/domain/defaults';
import { createInitialState, reducer, type Action } from '../src/domain/reducer';
import { backupFileName, backupWindow, isChurchDevice, showRunningSomewhere, todaysService } from '../src/domain/sundayBackup';
import type { Library, Presentation } from '../src/domain/types';
// @ts-expect-error plain ESM server module
import { staticHandler } from '../server/app.mjs';

const actor = { id: 'dev', name: 'test', userName: '', platform: 'test' };
const edit = (s: ReturnType<typeof createInitialState>, a: Action, at: number) => reducer(s, { ...a, actor, eventId: `e${at}`, occurredAt: at } as Action);
const pres = (id: string, texts: string[]): Presentation => ({ id, title: id, themeId: 'theme_classic', slides: texts.map((text, i) => ({ id: `${id}_${i}`, group: 'V', text })) });

describe('server clock', () => {
  it('learns the offset from Date headers within half a round trip, and keeps it for the next start', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    let local = 1_000_000;
    const clock = createServerClock(() => local, storage);
    // The server is 90 s ahead; answers take 100 ms each way.
    for (let i = 0; i < 5; i++) {
      const sent = local; const at = sent + 100 + 90_000 + i * 137;
      local = sent + 200;
      clock.observe(sent, local, Math.floor(at / 1000) * 1000);
      local += 3_000;
    }
    expect(Math.abs(clock.offset() - 90_000)).toBeLessThanOrEqual(600);
    expect(createServerClock(() => local, storage).offset()).toBe(clock.offset());
  });
  it('reads the header the local server passes on, and ignores answers without it', () => {
    const clock = createServerClock(() => 0);
    learnServerTime({ headers: { get: () => null } }, 0, 10, clock);
    expect(clock.uncertainty()).toBe(Infinity);
    learnServerTime({ headers: { get: (k) => (k === SERVER_DATE_HEADER ? new Date(5_000).toUTCString() : null) } }, 0, 10, clock);
    expect(clock.offset()).toBeGreaterThanOrEqual(4_990);
    expect(clock.offset()).toBeLessThanOrEqual(6_000);
  });
});

describe('edit stamps', () => {
  it('stamp exactly what an edit changed: the presentation, the field, the slide body, the text box', () => {
    const lib = { ...createSeedLibrary(), presentations: [{ ...pres('p', ['a', 'b']), slides: [{ id: 'p_0', group: 'V', text: 'a', elements: [{ id: 'e1', kind: 'text', text: 'x', x: 0, y: 0, w: 1, h: 1 }, { id: 'e2', kind: 'text', text: 'y', x: 0, y: 0, w: 1, h: 1 }] }, { id: 'p_1', group: 'V', text: 'b' }] } as Presentation] };
    let s = createInitialState(lib);
    s = edit(s, { type: 'presentation/update', id: 'p', patch: { title: '새 제목' } }, 100);
    s = edit(s, { type: 'slide/update', presentationId: 'p', slideId: 'p_1', patch: { text: 'B' } }, 200);
    const el = s.library.presentations[0].slides[0].elements!;
    s = edit(s, { type: 'slide/update', presentationId: 'p', slideId: 'p_0', patch: { elements: [el[0], { ...el[1], text: 'Y' }] } }, 300);
    const p = s.library.presentations[0];
    expect(p.updatedAt).toBe(300);
    expect(p.fieldsEditedAt?.title).toBe(100);
    expect((p.slides[1] as { editedAt?: number }).editedAt).toBe(200);
    expect((p.slides[0] as { editedAt?: number }).editedAt).toBeUndefined();
    expect((p.slides[0].elements![0] as { editedAt?: number }).editedAt).toBeUndefined();
    expect((p.slides[0].elements![1] as { editedAt?: number }).editedAt).toBe(300);
  });
  it('do not stamp what sync or the app does by itself', () => {
    const s = createInitialState(createSeedLibrary());
    const merged = reducer(s, { type: 'library/merge', library: { ...s.library, presentations: s.library.presentations.map((p) => ({ ...p, title: p.title + '!' })) }, actor, eventId: 'x', occurredAt: 5 } as Action);
    expect(merged.library.presentations.every((p) => p.updatedAt === undefined || p.updatedAt !== 5)).toBe(true);
    expect(stampEdits(s.library, s.library, 9)).toBe(s.library);
  });
  it('leave content comparisons alone', () => {
    expect(withoutStamps({ a: 1, editedAt: 5, fieldsEditedAt: { a: 5 }, updatedAt: 6 })).toBe(withoutStamps({ a: 1 }));
  });
});

describe('the later edit wins, part by part', () => {
  const start = () => createInitialState({ ...createSeedLibrary(), presentations: [pres('p', ['가', '나'])] });
  it('a title edited on two devices takes the later title, even when the other device edited something else afterwards', () => {
    const base = start();
    const a1 = edit(base, { type: 'presentation/update', id: 'p', patch: { title: 'A 제목' } }, 1000);
    const b = edit(base, { type: 'presentation/update', id: 'p', patch: { title: 'B 제목' } }, 2000);
    const a = edit(a1, { type: 'slide/update', presentationId: 'p', slideId: 'p_0', patch: { text: 'A가 나중에 고친 가사' } }, 3000);
    for (const merged of [mergeLibrary(syncable(base.library), syncable(a.library), syncable(b.library)).library, mergeLibrary(syncable(base.library), syncable(b.library), syncable(a.library)).library]) {
      const p = merged.presentations.find((x) => x.id === 'p')!;
      expect(p.title).toBe('B 제목');
      expect(p.slides[0].text).toBe('A가 나중에 고친 가사');
      expect(merged.presentations.filter((x) => x.id.startsWith('p')).length).toBe(1);
    }
  });
  it('a deletion later than an edit wins, and the trash keeps that edit for restoring', () => {
    const base = start();
    const a = edit(base, { type: 'slide/update', presentationId: 'p', slideId: 'p_1', patch: { text: 'A의 가사' } }, 1000);
    const b = edit(base, { type: 'presentation/delete', id: 'p' }, 2000);
    const merged = mergeLibrary(syncable(base.library), syncable(a.library), syncable(b.library)).library;
    expect(merged.presentations.some((x) => x.id === 'p')).toBe(false);
    expect(merged.trash?.find((e) => e.presentation.id === 'p')?.presentation.slides[1].text).toBe('A의 가사');
  });
  it('an edit later than a deletion brings the presentation back with both devices\' work', () => {
    const base = start();
    const b1 = edit(base, { type: 'slide/update', presentationId: 'p', slideId: 'p_0', patch: { text: 'B가 먼저 고침' } }, 1000);
    const b = edit(b1, { type: 'presentation/delete', id: 'p' }, 2000);
    const a = edit(base, { type: 'slide/update', presentationId: 'p', slideId: 'p_1', patch: { text: 'A가 나중에 고침' } }, 3000);
    const merged = mergeLibrary(syncable(base.library), syncable(a.library), syncable(b.library)).library;
    expect(merged.presentations.find((x) => x.id === 'p')?.slides.map((x) => x.text)).toEqual(['B가 먼저 고침', 'A가 나중에 고침']);
  });
  it('typing while a sync round was in flight is never lost: the merge is redone against it', () => {
    const base = start();
    const remote = edit(base, { type: 'slide/update', presentationId: 'p', slideId: 'p_0', patch: { text: '다른 기기' } }, 1000);
    const merged = mergeLibrary(syncable(base.library), syncable(base.library), syncable(remote.library)).library;
    // The person typed after the round read the library and before its merge arrived.
    const typed = edit(base, { type: 'slide/update', presentationId: 'p', slideId: 'p_1', patch: { text: '방금 친 글자' } }, 1500);
    const after = reducer(typed, { type: 'library/merge', library: merged, from: base.library });
    expect(after.library.presentations.find((x) => x.id === 'p')!.slides.map((x) => x.text)).toEqual(['다른 기기', '방금 친 글자']);
  });
});

describe('app server delivery', () => {
  let dir = '';
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
  const serve = async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-static-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>x</title>' + 'x'.repeat(4000));
    fs.writeFileSync(path.join(dir, 'assets', 'index-AbCdEf12.js'), 'console.log(1);'.repeat(2000));
    const handler = staticHandler(dir);
    const server = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    const get = (p: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((done) => {
      http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => { const chunks: Buffer[] = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => done({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) })); });
    });
    return { get, close: () => new Promise((done) => server.close(done)) };
  };
  it('sends built files compressed to phones and keeps them cached; the page is checked each time', async () => {
    const { get, close } = await serve();
    try {
      const js = await get('/assets/index-AbCdEf12.js', { 'accept-encoding': 'br, gzip', host: 'abc.trycloudflare.com' });
      expect(js.headers['content-encoding']).toBe('br');
      expect(js.headers['cache-control']).toContain('immutable');
      expect(zlib.brotliDecompressSync(js.body).toString()).toBe('console.log(1);'.repeat(2000));
      const page = await get('/', { 'accept-encoding': 'gzip', host: 'abc.trycloudflare.com' });
      expect(page.headers['content-encoding']).toBe('gzip');
      expect(page.headers['cache-control']).toBe('no-cache');
      expect((await get('/', { 'if-none-match': String(page.headers.etag) })).status).toBe(304);
      // This computer's own windows get the files as they are (compressing would only cost time).
      expect((await get('/assets/index-AbCdEf12.js', { 'accept-encoding': 'br' })).headers['content-encoding']).toBeUndefined();
      // Nothing outside the app folder.
      expect((await get('/../../etc/passwd')).body.toString()).toContain('<title>x</title>');
    } finally { await close(); }
  });
});

describe('the Sunday 1:55 copy', () => {
  const lib = (extra: Partial<Library> = {}): Library => ({ ...createSeedLibrary(), playlists: [{ id: 'pl', name: '1129 주일예배', items: [{ id: 'i', presentationId: 'p_grace' }] }], ...extra });
  it('is made on Sundays from 1:55 to 2:25 PM, for the playlist named after today', () => {
    expect(backupWindow(new Date(2026, 10, 29, 13, 55))).toBe(true);
    expect(backupWindow(new Date(2026, 10, 29, 13, 54))).toBe(false);
    expect(backupWindow(new Date(2026, 10, 29, 14, 25))).toBe(false);
    expect(backupWindow(new Date(2026, 10, 28, 13, 55))).toBe(false);
    expect(todaysService(lib(), new Date(2026, 10, 29, 13, 55))?.id).toBe('pl');
    expect(todaysService(lib(), new Date(2026, 11, 6, 13, 55))).toBeNull();
    expect(backupFileName(lib().playlists[0], new Date(2026, 10, 29, 13, 55))).toBe('1129 주일예배 (자동 저장 13시55분).pptx');
  });
  it('knows the church computer by its mark or its name, and a running show by the activity of every device', () => {
    expect(isChurchDevice({ name: '교회 본당 Mac' })).toBe(true);
    expect(isChurchDevice({ name: '집 노트북' })).toBe(false);
    expect(isChurchDevice({ name: '집 노트북', church: true })).toBe(true);
    expect(isChurchDevice({ name: '교회 노트북', church: false })).toBe(false);
    const device = { ...actor, id: 'x' };
    const at = Date.UTC(2026, 10, 29, 4, 50);
    expect(showRunningSomewhere([{ id: '1', at, action: 'show/start', detail: '', device, account: null }], at + 60_000)).toBe(true);
    expect(showRunningSomewhere([{ id: '1', at, action: 'show/start', detail: '', device, account: null }, { id: '2', at: at + 1, action: 'show/end', detail: '', device, account: null }], at + 60_000)).toBe(false);
    expect(showRunningSomewhere([{ id: '1', at, action: 'show/start', detail: '', device, account: null }], at + 5 * 3_600_000)).toBe(false);
  });
});
