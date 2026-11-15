import { describe, expect, it } from 'vitest';
import { cloudFontId, fontConflicts, pickWinner, planFontSync, runFontSync, sha256Hex, DEFAULT_FONT_SYNC, type CloudFont, type FontCloudApi, type FontStoreApi } from '../src/domain/fontSync';
import { mergePrefs, reconcilePrefs } from '../src/domain/fontPrefs';
import { FONT_TRASH_DAYS, addToFontTrash, expiredFontFiles, restoreFontEntry } from '../src/domain/fontTrash';
import { TRASH_DAYS } from '../src/domain/trash';
import { embeddedAsFont, styleOfFace } from '../src/domain/embeddedFonts';
import { createSeedLibrary } from '../src/domain/defaults';
import { mergeLibrary } from '../src/domain/cloudMerge';
import type { ImportedFont } from '../src/domain/importedFonts';

const font = (o: Partial<ImportedFont> = {}): ImportedFont => ({ id: `impfont:${o.hash ?? 'a'}`, family: 'A', subfamily: 'Regular', weight: 400, italic: false, format: 'truetype', bytes: 100, fsType: 0, source: 'user', at: 1, hash: 'h1', ...o });
const entry = (o: Partial<CloudFont> = {}): CloudFont => ({ id: cloudFontId('h1'), family: 'A', subfamily: 'Regular', weight: 400, italic: false, format: 'truetype', bytes: 100, fsType: 0, source: 'user', at: 1, ...o });
const base = { manifest: [] as CloudFont[], remoteIds: new Set<string>(), known: new Set<string>(), settings: DEFAULT_FONT_SYNC, used: new Set<string>(), freeBytes: null as number | null };

describe('font trash', () => {
  it('lasts as long as the media trash', () => { expect(FONT_TRASH_DAYS).toBe(TRASH_DAYS); });
  it('restores before it expires and purges after', () => {
    const e = entry();
    const t = addToFontTrash([], [e], 1000);
    expect(restoreFontEntry([], t, e.id, 2000).manifest).toEqual([e]);
    expect(restoreFontEntry([], t, e.id, t[0].expiresAt + 1).manifest).toEqual([]);
    expect(expiredFontFiles(t, [], t[0].expiresAt)).toEqual([e.id]);
    expect(expiredFontFiles(t, [e], t[0].expiresAt)).toEqual([]);
  });
  it('a removed font keeps its server file; an expired one is deleted by the next round', async () => {
    const e = entry();
    const t = addToFontTrash([], [e], 0);
    const p = planFontSync({ ...base, local: [], trash: t, now: t[0].expiresAt + 5, remoteIds: new Set([e.id]) });
    expect(p.purge).toEqual([e.id]); expect(p.trash).toEqual([]);
  });
  it('re-adding the same file takes it out of the trash without uploading again', () => {
    const e = entry();
    const p = planFontSync({ ...base, local: [font()], trash: addToFontTrash([], [e], 0), remoteIds: new Set([e.id]), now: 10 });
    expect(p.upload).toEqual([]); expect(p.manifest.map((x) => x.id)).toEqual([e.id]); expect(p.trash).toEqual([]);
  });
  it('the library merges the trash and the prefs', () => {
    const a = { ...createSeedLibrary(), fontTrash: addToFontTrash([], [entry()], 0), fontPrefs: { global: { enabled: true, includeDeckFonts: false, at: 1 } } };
    const b = { ...createSeedLibrary(), fontPrefs: { global: { enabled: false, includeDeckFonts: false, at: 5 } } };
    const m = mergeLibrary(null, a, b).library;
    expect(m.fontTrash).toHaveLength(1); expect(m.fontPrefs?.global?.enabled).toBe(false);
  });
});

describe('synced settings (last writer wins)', () => {
  it('takes the newer global switch from either side', () => {
    const acc = { global: { enabled: false, includeDeckFonts: true, at: 50 } };
    const r = reconcilePrefs({ global: { enabled: true, includeDeckFonts: false, at: 10 }, fonts: [] }, acc);
    expect(r.globalFromAccount).toBe(true); expect(r.global.enabled).toBe(false);
    const r2 = reconcilePrefs({ global: { enabled: true, includeDeckFonts: false, at: 90 }, fonts: [] }, acc);
    expect(r2.changed).toBe(true); expect(r2.prefs?.global?.at).toBe(90);
  });
  it('a never-changed local switch publishes nothing', () => {
    expect(reconcilePrefs({ global: { enabled: true, includeDeckFonts: false }, fonts: [] }, undefined).prefs).toBeUndefined();
  });
  it('per font by hash, both directions', () => {
    const acc = { fonts: { h1: { sync: false, at: 20 }, h2: { sync: null, at: 5 } } };
    const r = reconcilePrefs({ global: { enabled: true, includeDeckFonts: false }, fonts: [{ hash: 'h1', sync: true, syncAt: 10 }, { hash: 'h2', sync: true, syncAt: 9 }] }, acc);
    expect(r.apply).toEqual([{ hash: 'h1', sync: false, at: 20 }]);
    expect(r.prefs?.fonts?.h2).toEqual({ sync: true, at: 9 });
  });
  it('mergePrefs is order independent', () => {
    const a = { fonts: { x: { sync: true, at: 1 } } }, b = { fonts: { x: { sync: false, at: 2 }, y: { sync: null, at: 1 } } };
    expect(mergePrefs(a, b)).toEqual(mergePrefs(b, a));
  });
  it('runFontSync takes over the account switch and applies a font switch', async () => {
    const store = fakeStore([{ f: font({ sync: true, syncAt: 1 }), data: bytes('x') }]);
    const r = await runFontSync({ cloud: fakeCloud().api, store: store.api }, { manifest: [], settings: { ...DEFAULT_FONT_SYNC, at: 1 }, used: new Set(), freeBytes: null,
      prefs: { global: { enabled: false, includeDeckFonts: true, at: 9 }, fonts: { h1: { sync: false, at: 9 } } } });
    expect(r.settings).toEqual({ enabled: false, includeDeckFonts: true, at: 9 });
    expect(store.fonts.get('impfont:a')?.f.sync).toBe(false);
    expect(r.report.uploaded).toBe(0);
  });
});

describe('two files for one face', () => {
  const small = entry({ id: cloudFontId('s'), bytes: 100 }), big = entry({ id: cloudFontId('b'), bytes: 300, at: 9 });
  it('the larger file wins, then the earlier upload, then the id', () => {
    expect(pickWinner(small, big)).toBe(big); expect(pickWinner(big, small)).toBe(big);
    expect(pickWinner(entry({ id: 'font-a', at: 2 }), entry({ id: 'font-b', at: 1 })).id).toBe('font-b');
    expect(pickWinner(entry({ id: 'font-b' }), entry({ id: 'font-a' })).id).toBe('font-a');
  });
  it('finds the conflict and who holds what', () => {
    const c = fontConflicts([small, big], [font({ hash: 's' })]);
    expect(c).toHaveLength(1); expect(c[0].winner.id).toBe(big.id); expect(c[0].holdsWinner).toBe(false); expect(c[0].holdsOthers).toEqual([small.id]);
  });
  it('the holder of the losing file replaces it with the winner; the loser stays in the library', async () => {
    const bigId = cloudFontId(await sha256Hex(bytes('BIG')));
    const files = new Map<string, Blob>([[bigId, new Blob([bytes('BIG')])], [small.id, new Blob([bytes('sm')])]]);
    const cloud = fakeCloud(files);
    const b2 = { ...big, id: bigId };
    const mine = fakeStore([{ f: font({ id: 'impfont:s', hash: 's', bytes: 2 }), data: bytes('sm') }]);
    const r = await runFontSync({ cloud: cloud.api, store: mine.api }, { manifest: [small, b2], settings: DEFAULT_FONT_SYNC, used: new Set(), freeBytes: null, remote: [{ id: small.id, size: 2 }, { id: bigId, size: 3 }] });
    expect(r.report.replaced).toHaveLength(1);
    expect(mine.api.list().map((f) => f.hash)).toEqual([bigId.slice(5)]);
    expect(r.manifest).toBeUndefined();
    // next round: nothing is downloaded or removed, the loser is not treated as removed here
    const again = await runFontSync({ cloud: cloud.api, store: mine.api }, { manifest: [small, b2], settings: DEFAULT_FONT_SYNC, used: new Set(), freeBytes: null });
    expect(again.report.downloaded).toBe(0); expect(again.report.trashed).toBe(0); expect(again.manifest).toBeUndefined();
  });
  it('an own font that is not in the library is never replaced', () => {
    const p = planFontSync({ ...base, manifest: [big], remoteIds: new Set([big.id]), local: [font({ hash: 'zz', sync: false })] });
    expect(p.download).toEqual([]); expect(p.replace).toEqual([]);
  });
});

describe('fonts from .pptx files', () => {
  const emb = { id: 'embfont:1', family: 'Deck', style: 'bold' as const, bytes: 50, source: 'a.pptx', at: 3, hash: 'e1' };
  it('looks like a font to the sync, tagged embedded and by source', () => {
    const f = embeddedAsFont(emb);
    expect(f).toMatchObject({ weight: 700, italic: false, embedded: true, source: 'a.pptx', hash: 'e1' });
    expect(styleOfFace({ weight: 700, italic: true })).toBe('boldItalic');
  });
  it('follows the deck-font rules and uploads with the embedded tag; one hash is one entry', () => {
    const f = embeddedAsFont(emb);
    expect(planFontSync({ ...base, local: [f] }).upload).toEqual([]);
    const p = planFontSync({ ...base, local: [f, font({ hash: 'e1', id: 'impfont:x' })], used: new Set(['deck']) });
    expect(p.upload).toHaveLength(1); expect(p.manifest[0].embedded).toBe(true);
    expect(planFontSync({ ...base, local: [{ ...f, sync: true }] }).upload).toHaveLength(1);
  });
});

// helpers
const bytes = (s: string) => new TextEncoder().encode(s);
function fakeCloud(files = new Map<string, Blob>()) {
  const api: FontCloudApi = {
    list: async () => [...files].map(([id, b]) => ({ id, size: b.size })),
    upload: async (id, b) => { files.set(id, b); },
    download: async (id) => files.get(id)!,
    remove: async (id) => { files.delete(id); },
  };
  return { api, files };
}
function fakeStore(initial: { f: ImportedFont; data: Uint8Array }[] = []) {
  const fonts = new Map(initial.map((x) => [x.f.id, x]));
  let known = new Set<string>();
  const api: FontStoreApi = {
    list: () => [...fonts.values()].map((x) => x.f),
    bytes: async (f) => fonts.get(f.id)?.data ?? null,
    setFields: async (id, patch) => { const x = fonts.get(id); if (x) fonts.set(id, { ...x, f: { ...x.f, ...patch } }); },
    add: async (e, data) => { fonts.set(`n:${e.id}`, { f: font({ id: `n:${e.id}`, family: e.family, hash: e.id.slice(5), bytes: data.byteLength, weight: e.weight, italic: e.italic }), data: new Uint8Array(data) }); return true; },
    remove: async (id) => { fonts.delete(id); },
    loadKnown: async () => new Set(known), saveKnown: async (k) => { known = new Set(k); },
  };
  return { api, fonts };
}
