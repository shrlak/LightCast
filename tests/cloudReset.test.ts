import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSeedLibrary } from '../src/domain/defaults';
import { mergeLibrary, syncable } from '../src/domain/cloudMerge';
import { createInitialState, reducer } from '../src/domain/reducer';
import { normalizeLibrary } from '../src/domain/persistence';
import { cloudApi, syncMedia } from '../src/domain/cloud';
const media = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../src/domain/media', () => ({ getMedia: media.get, putMedia: media.put }));
const reset = () => {
  const lib = createSeedLibrary();
  return { ...lib, cloudResetId: 'server-reset-1', presentations: [], media: [], trash: [], protectionChanges: [], activity: [], devices: [],
    playlists: [{ id: 'empty', name: '재생목록', items: [] }], sunday: { ...lib.sunday, frontId: null, prayerId: null, backId: null } };
};
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('server reset generation', () => {
  it('replaces old protected and unsynced local data instead of merging deleted files back', () => {
    const old = createSeedLibrary(); old.presentations[0].protected = true;
    old.media = [{ id: 'old', name: 'old', type: 'image' }];
    const empty = reset();
    expect(mergeLibrary(old, old, empty)).toEqual({ library: empty });
    expect(mergeLibrary(null, old, empty).library.presentations).toEqual([]);
  });
  it('preserves the generation on reload without recreating deleted Front/template material', () => {
    const loaded = normalizeLibrary(JSON.parse(JSON.stringify(reset())))!;
    expect(loaded.cloudResetId).toBe('server-reset-1'); expect(loaded.presentations).toEqual([]);
    expect(syncable(loaded).cloudResetId).toBe('server-reset-1');
  });
  it('clears Undo/live/protected content after an authenticated reset and cannot undo the reset', () => {
    let state = createInitialState(createSeedLibrary());
    state = reducer(state, { type: 'presentation/protect', id: state.library.presentations[0].id, on: true });
    state = reducer(state, { type: 'playlist/rename', id: state.library.playlists[0].id, name: '예전 자료' });
    state = reducer(state, { type: 'library/cloudReset', library: reset() });
    expect(state.library.presentations).toEqual([]); expect(state.past).toEqual([]); expect(state.future).toEqual([]);
    expect(state.cursor).toBe(null); expect(state.live.slide).toBe(null);
    expect(reducer(state, { type: 'undo' })).toBe(state);
  });
  it('keeps the current generation when the user intentionally restores a local backup later', () => {
    const state = reducer(createInitialState(reset()), { type: 'library/replace', library: createSeedLibrary() });
    expect(state.library.cloudResetId).toBe('server-reset-1');
    expect(state.library.presentations.length).toBeGreaterThan(0);
  });
  it('still merges ordinary new edits within the same generation', () => {
    const base = reset(), local = { ...base, media: [{ id: 'new', name: 'new', type: 'image' as const }] };
    expect(mergeLibrary(base, local, base).library.media).toEqual(local.media);
    expect(mergeLibrary(base, local, base).library.cloudResetId).toBe(base.cloudResetId);
  });
  it('sends the reset generation when uploading new media', async () => {
    const fetcher = vi.fn(async (url: string) => String(url).endsWith('/media')
      ? Response.json({ items: [] }) : Response.json({ ok: true })); vi.stubGlobal('fetch', fetcher);
    media.get.mockResolvedValue(new Blob(['new'], { type: 'image/png' }));
    await syncMedia('test-token', { ...reset(), media: [{ id: 'asset', name: 'asset', type: 'image' }] }, () => {});
    const call = fetcher.mock.calls.find(([url]) => String(url).endsWith('/media/asset'))! as unknown as [string, RequestInit];
    expect(new Headers(call[1].headers).get('X-Freecast-Reset-Id')).toBe('server-reset-1');
  });
  it('requires a preview revision/password request and surfaces conflicts as errors', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: '서버 자료가 변경되었습니다.' }, { status: 409 })); vi.stubGlobal('fetch', fetcher);
    await expect(cloudApi.clearAll('token', 'password', '7:2:')).rejects.toThrow('서버 자료가 변경');
  });
});
