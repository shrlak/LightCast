import { describe, expect, it, vi } from 'vitest';
import type { Library } from '../src/domain/types';
import { createSeedLibrary } from '../src/domain/defaults';
import { createInitialState, reducer, type Action } from '../src/domain/reducer';
import { mergeLibrary } from '../src/domain/cloudMerge';
import { finishedServices } from '../src/domain/sunday/cleanup';
import { normalizeLibrary } from '../src/domain/persistence';
import { dedupeSongs } from '../src/domain/sunday/dedupe';
import { protectedMediaIds } from '../src/domain/materialProtection';
import { importBackup } from '../src/domain/io/backup';
import JSZip from 'jszip';

const media = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('../src/domain/media', () => ({ putMedia: media.put }));

function library(): Library {
  const lib = createSeedLibrary();
  lib.presentations = [
    { id: 'essential', title: '필수 신앙고백', themeId: lib.themes[0].id, folder: '1025 주일예배', slides: [{ id: 'e', group: 'Confession', text: '보존할 원문', background: { kind: 'media', mediaId: 'essential-photo', mediaType: 'image' }, elements: [{ id: 'image', kind: 'image', mediaId: 'logo', x: 0, y: 0, w: 200, h: 200 }] }] },
    { id: 'temporary', title: '주일 설교', themeId: lib.themes[0].id, folder: '1025 주일예배', slides: [{ id: 't', group: 'Sermon', text: '일반 설교' }] },
  ];
  lib.playlists = [{ id: 'service', name: '1025 주일예배', items: [{ id: 'i1', presentationId: 'essential' }, { id: 'i2', presentationId: 'temporary' }] }];
  lib.media = [{ id: 'essential-photo', name: '필수 배경', type: 'image' }, { id: 'logo', name: '필수 로고', type: 'image' }];
  return lib;
}
const lock = () => reducer(createInitialState(library()), { type: 'presentation/protect', id: 'essential', on: true, occurredAt: 1000 });

describe('essential presentation protection', () => {
  it('requires an explicit action to lock/unlock, persists on reload, and protects undo/redo history', () => {
    let state = lock(); const protectedDeck = state.library.presentations[0];
    expect(protectedDeck).toMatchObject({ protected: true, protectionChangedAt: 1000 });
    expect(normalizeLibrary(JSON.parse(JSON.stringify(state.library)))?.presentations[0]).toEqual(protectedDeck);
    state = reducer(state, { type: 'undo' }); expect(state.library.presentations[0]).toEqual(protectedDeck);
    state = reducer(state, { type: 'presentation/protect', id: 'essential', on: false, occurredAt: 500 });
    expect(state.library.presentations[0]).toMatchObject({ protected: false, protectionChangedAt: 1001 });
    state = reducer(state, { type: 'presentation/update', id: 'essential', patch: { title: '수정한 제목', protected: true, protectionChangedAt: 9999 } });
    expect(state.library.presentations[0]).toMatchObject({ title: '수정한 제목', protected: false, protectionChangedAt: 1001 });
    state = reducer(state, { type: 'undo' }); expect(state.library.presentations[0].title).toBe('필수 신앙고백');
  });
  it('blocks slide edits, deletion, whole-deck reimport, arrangements, timelines and owned-media deletion', () => {
    const state = lock();
    const actions: Action[] = [
      { type: 'slide/update', presentationId: 'essential', slideId: 'e', patch: { text: '덮어쓰기' } },
      { type: 'slide/delete', presentationId: 'essential', slideIds: ['e'], seqs: [0] },
      { type: 'presentation/update', id: 'essential', patch: { slides: [], protected: false } },
      { type: 'presentation/delete', id: 'essential' },
      { type: 'arrangement/upsert', presentationId: 'essential', arrangement: { id: 'a', name: 'Override', groups: [] } },
      { type: 'timeline/set', presentationId: 'essential', timeline: { audioMediaId: null, cues: [] } },
      { type: 'media/remove', id: 'essential-photo' }, { type: 'media/remove', id: 'logo' },
      { type: 'theme/delete', id: state.library.presentations[0].themeId },
    ];
    for (const action of actions) expect(reducer(state, action)).toBe(state);
    expect([...protectedMediaIds(state.library)].sort()).toEqual(['essential-photo', 'logo']);
  });
  it('still allows presentation, playlist changes, and unrelated edits, while batch replacement skips the protected deck', () => {
    let state = lock(); const essential = state.library.presentations[0];
    state = reducer(state, { type: 'live/go', presentationId: 'essential', seq: 0, now: 1 });
    expect(state.live.slide?.text).toBe('보존할 원문');
    state = reducer(state, { type: 'playlist/addItem', item: { id: 'extra', presentationId: 'essential' } });
    expect(state.library.playlists[0].items).toHaveLength(3);
    state = reducer(state, { type: 'presentation/replaceMany', presentations: state.library.presentations.map((p) => ({ ...p, title: '새 제목' })) });
    expect(state.library.presentations[0]).toEqual(essential); expect(state.library.presentations[1].title).toBe('새 제목');
    state = reducer(state, { type: 'slide/update', presentationId: 'temporary', slideId: 't', patch: { text: '일반 자료 수정' } });
    expect(state.library.presentations[1].slides[0].text).toBe('일반 자료 수정');
  });
  it('manual and automatic service cleanup keep protected material and its media after deleting the playlist', () => {
    const state = lock(); const done = finishedServices(state.library, new Date(2026, 9, 25, 18));
    expect(done.presentationIds).toEqual(['temporary']); expect(done.mediaIds).toEqual([]);
    for (const action of [{ type: 'playlist/delete', id: 'service' }, { type: 'services/finish', playlistIds: ['service'], presentationIds: ['essential', 'temporary'], mediaIds: ['logo'] }] as Action[]) {
      const next = reducer(state, action);
      expect(next.library.presentations.map((p) => p.id)).toEqual(['essential']); expect(next.library.media).toEqual(state.library.media);
      expect(next.library.trash?.some((e) => e.presentation.id === 'essential')).toBe(false);
    }
  });
  it('full library restore keeps locked files, media metadata and their theme', () => {
    const state = lock(), backup = library(); backup.presentations = []; backup.media = [];
    backup.themes = backup.themes.map((t) => ({ ...t, color: '#ff0000' }));
    const next = reducer(state, { type: 'library/replace', library: backup });
    expect(next.library.presentations).toEqual([state.library.presentations[0]]); expect(next.library.media).toEqual(state.library.media);
    expect(next.library.themes.find((t) => t.id === state.library.presentations[0].themeId)).toEqual(state.library.themes[0]);
  });
  it('restoring a deleted page cannot overwrite a deck protected after the deletion', () => {
    let state = createInitialState(library());
    state = reducer(state, { type: 'slide/delete', presentationId: 'essential', slideIds: ['e'], occurredAt: 500 });
    const entry = state.library.trash![0];
    state = reducer(state, { type: 'presentation/protect', id: 'essential', on: true, occurredAt: 1000 });
    expect(reducer(state, { type: 'trash/restore', id: entry.id, occurredAt: 1500 })).toBe(state);
  });
  it('deduplication retains every protected song and an online song becomes a local saved copy when protected', () => {
    const state = createInitialState(library()); state.library.presentations[0] = { ...state.library.presentations[0], online: true };
    const next = reducer(state, { type: 'presentation/protect', id: 'essential', on: true, occurredAt: 1000 });
    const p = next.library.presentations[0]; expect(p.online).toBeUndefined(); expect(p.folder).toBe('Songs');
    const songs = [p, { ...p, id: 'other-protected' }, { ...p, id: 'newer-unprotected', protected: false, updatedAt: 99999 }];
    expect(dedupeSongs(songs).presentations.map((p) => p.id)).toEqual(['essential', 'other-protected']);
  });
  it('backup restore never overwrites cached bytes referenced by protected material', async () => {
    media.put.mockReset(); const zip = new JSZip(); zip.file('library.json', JSON.stringify(library()));
    zip.file('media/logo', 'wrong new pixels'); zip.file('media/new-image', 'new pixels');
    await importBackup(new Blob([new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))]), protectedMediaIds(lock().library));
    expect(media.put.mock.calls.map((call) => call[0])).toEqual(['new-image']);
  });
  it('empty imported titles cannot bypass protection and restoring a backup keeps explicit unlock history', () => {
    const locked = lock(); locked.library.presentations[0].title = '';
    expect(reducer(locked, { type: 'presentation/delete', id: 'essential' })).toBe(locked);
    const unlocked = reducer(locked, { type: 'presentation/protect', id: 'essential', on: false, occurredAt: 2000 });
    const restored = reducer(unlocked, { type: 'library/replace', library: library() });
    expect(restored.library.protectionChanges).toContainEqual({ id: 'essential', on: false, at: 2000 });
  });
});

describe('protection across device synchronization', () => {
  it('an old device cannot overwrite or delete a protected deck or its media, including on first sync', () => {
    const local = lock().library, old = library(); old.presentations[0].slides[0].text = '다른 기기의 오래된 내용';
    for (const base of [null, local]) {
      const result = mergeLibrary(base, local, old);
      expect(result.library.presentations[0]).toEqual(local.presentations[0]); expect(result.library.presentations).toHaveLength(local.presentations.length);
    }
    old.presentations = []; old.media = [];
    const result = mergeLibrary(local, local, old).library;
    expect(result.presentations).toEqual([local.presentations[0]]); expect(result.media).toEqual(local.media);
    const next = reducer(createInitialState(local), { type: 'library/merge', library: old });
    expect(next.library.presentations).toEqual([local.presentations[0]]);
  });
  it('an explicit newer unlock on another device propagates and permits subsequent edits', () => {
    const base = lock().library;
    const unlocked = reducer(createInitialState(base), { type: 'presentation/protect', id: 'essential', on: false, occurredAt: 2000 }).library;
    unlocked.presentations[0] = { ...unlocked.presentations[0], slides: [{ id: 'new', group: 'Confession', text: '해제 후 수정' }] };
    const result = mergeLibrary(base, base, unlocked).library;
    expect(result.presentations[0].protected).toBe(false); expect(result.presentations[0].slides[0].text).toBe('해제 후 수정');
    const state = reducer(createInitialState(base), { type: 'library/merge', library: result });
    expect(state.library.presentations[0].protected).toBe(false); expect(state.past).toEqual([]);
  });
  it('a newer remote lock beats concurrent edits and clears history that could remove the locked file', () => {
    const base = library(); let local = reducer(createInitialState(base), { type: 'slide/update', presentationId: 'essential', slideId: 'e', patch: { text: '동시 편집' } });
    const remote = lock().library, merged = mergeLibrary(base, local.library, remote).library;
    local = reducer(local, { type: 'library/merge', library: merged });
    expect(local.library.presentations[0]).toEqual(remote.presentations[0]); expect(local.past).toEqual([]);
    expect(reducer(local, { type: 'undo' }).library.presentations[0].protected).toBe(true);
  });
  it('unlock followed immediately by deletion syncs without resurrecting the file and still supports Undo', () => {
    const base = lock().library;
    let local = reducer(createInitialState(base), { type: 'presentation/protect', id: 'essential', on: false, occurredAt: 2000 });
    local = reducer(local, { type: 'presentation/delete', id: 'essential' });
    expect(local.library.presentations.some((p) => p.id === 'essential')).toBe(false);
    expect(reducer(local, { type: 'undo' }).library.presentations.some((p) => p.id === 'essential')).toBe(true);
    const merged = mergeLibrary(base, local.library, base).library;
    expect(merged.presentations.some((p) => p.id === 'essential')).toBe(false);
    const remote = reducer(createInitialState(base), { type: 'library/merge', library: merged });
    expect(remote.library.presentations.some((p) => p.id === 'essential')).toBe(false);
    expect(normalizeLibrary(JSON.parse(JSON.stringify(merged)))?.protectionChanges).toContainEqual({ id: 'essential', on: false, at: 2000 });
  });
  it('a newer explicit unlock also wins on first sync against an older locked copy', () => {
    const old = lock().library;
    const local = reducer(createInitialState(old), { type: 'presentation/protect', id: 'essential', on: false, occurredAt: 2000 }).library;
    expect(mergeLibrary(null, local, old).library.presentations[0].protected).toBe(false);
  });
});
