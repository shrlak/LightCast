import { describe, expect, it } from 'vitest';
import { cloudFontId, planFontSync, runFontSync, sha256Hex, wantsSync, DEFAULT_FONT_SYNC, MAX_CLOUD_FONT_BYTES, type CloudFont, type FontCloudApi, type FontStoreApi } from '../src/domain/fontSync';
import type { ImportedFont } from '../src/domain/importedFonts';
import { createSeedLibrary } from '../src/domain/defaults';
import { mergeLibrary } from '../src/domain/cloudMerge';

const font = (o: Partial<ImportedFont> = {}): ImportedFont => ({ id: `impfont:${o.family ?? 'a'}`, family: 'A', subfamily: 'Regular', weight: 400, italic: false, format: 'truetype', bytes: 100, fsType: 0, source: 'user', at: 1, hash: 'h1', ...o });
const base = { manifest: [] as CloudFont[], remoteIds: new Set<string>(), known: new Set<string>(), settings: DEFAULT_FONT_SYNC, used: new Set<string>(), freeBytes: null as number | null };

describe('wantsSync defaults', () => {
  it('user fonts on, deck fonts only when used or enabled, own switch wins', () => {
    const s = DEFAULT_FONT_SYNC; const none = new Set<string>();
    expect(wantsSync(font(), s, none)).toBe(true);
    expect(wantsSync(font({ source: 'a.pptx' }), s, none)).toBe(false);
    expect(wantsSync(font({ source: 'a.pptx' }), s, new Set(['a']))).toBe(true);
    expect(wantsSync(font({ source: 'a.pptx' }), { ...s, includeDeckFonts: true }, none)).toBe(true);
    expect(wantsSync(font({ sync: false }), s, none)).toBe(false);
    expect(wantsSync(font({ source: 'a.pptx', sync: true }), s, none)).toBe(true);
  });
});

describe('planFontSync', () => {
  it('adds a new local font to the list and uploads it; planning again changes nothing', () => {
    const p = planFontSync({ ...base, local: [font()] });
    expect(p.manifest.map((e) => e.id)).toEqual([cloudFontId('h1')]);
    expect(p.upload).toHaveLength(1);
    const again = planFontSync({ ...base, local: [font()], manifest: p.manifest, remoteIds: new Set([cloudFontId('h1')]), known: p.known });
    expect(again.upload).toEqual([]); expect(again.download).toEqual([]); expect(again.removeLocal).toEqual([]);
  });
  it('same file hash is one entry', () => {
    const p = planFontSync({ ...base, local: [font(), font({ id: 'impfont:copy' })] });
    expect(p.manifest).toHaveLength(1); expect(p.upload).toHaveLength(1);
  });
  it('never shares a font whose fsType forbids embedding unless confirmed', () => {
    expect(planFontSync({ ...base, local: [font({ fsType: 2 })] }).skipped).toEqual([{ family: 'A', reason: 'restricted' }]);
    expect(planFontSync({ ...base, local: [font({ fsType: 2, allowRestricted: true })] }).upload).toHaveLength(1);
  });
  it('respects the size cap and the server quota', () => {
    expect(planFontSync({ ...base, local: [font({ bytes: MAX_CLOUD_FONT_BYTES + 1 })] }).skipped[0].reason).toBe('too-big');
    const p = planFontSync({ ...base, freeBytes: 150, local: [font({ hash: 'a', bytes: 100 }), font({ id: 'x', hash: 'b', bytes: 100 })] });
    expect(p.upload).toHaveLength(1); expect(p.skipped[0].reason).toBe('quota');
  });
  it('does nothing when the master switch or the font switch is off', () => {
    expect(planFontSync({ ...base, settings: { ...DEFAULT_FONT_SYNC, enabled: false }, local: [font()] }).upload).toEqual([]);
    expect(planFontSync({ ...base, local: [font({ sync: false })] }).upload).toEqual([]);
  });
  it('asks for a hash first when a stored font has none', () => {
    const p = planFontSync({ ...base, local: [font({ hash: undefined })] });
    expect(p.hashNeeded).toHaveLength(1); expect(p.upload).toEqual([]);
  });
  it('downloads fonts the library lists that are missing here, once the file is on the server', () => {
    const e: CloudFont = { id: cloudFontId('r'), family: 'R', subfamily: 'Regular', weight: 400, italic: false, format: 'truetype', bytes: 10, fsType: 0, source: 'user', at: 1 };
    expect(planFontSync({ ...base, local: [], manifest: [e], remoteIds: new Set([e.id]) }).download).toEqual([e]);
    expect(planFontSync({ ...base, local: [], manifest: [e] }).skipped[0].reason).toBe('missing-file');
    expect(planFontSync({ ...base, local: [font({ family: 'R' })], manifest: [e], remoteIds: new Set([e.id]) }).download).toEqual([]);
  });
  it('a font that left the library after being seen is removed here; one removed here leaves the library and the cloud', () => {
    const id = cloudFontId('h1');
    expect(planFontSync({ ...base, local: [font()], known: new Set([id]) }).removeLocal).toHaveLength(1);
    expect(planFontSync({ ...base, local: [font()], known: new Set([id]) }).known.has(id)).toBe(false);
    const e: CloudFont = { id, family: 'A', subfamily: 'Regular', weight: 400, italic: false, format: 'truetype', bytes: 100, fsType: 0, source: 'user', at: 1 };
    const p = planFontSync({ ...base, local: [], manifest: [e], remoteIds: new Set([id]), known: new Set([id]) });
    expect(p.manifest).toEqual([]); expect(p.removeCloud).toEqual([id]); expect(p.download).toEqual([]);
  });
});

// ── runFontSync with fakes: two computers sharing one fake cloud ───────────────────────────────
const bytesOf = (s: string) => new TextEncoder().encode(s);
function fakeCloud(files = new Map<string, Blob>()) {
  const calls: string[] = [];
  let down = false;
  const api: FontCloudApi = {
    list: async () => { if (down) throw Object.assign(new Error('x'), { network: true }); return [...files].map(([id, b]) => ({ id, size: b.size })); },
    upload: async (id, b) => { if (down) throw Object.assign(new Error('x'), { network: true }); calls.push(`up:${id}`); files.set(id, b); },
    download: async (id) => { calls.push(`down:${id}`); return files.get(id)!; },
    remove: async (id) => { calls.push(`rm:${id}`); files.delete(id); },
  };
  return { api, files, calls, offline: (v: boolean) => { down = v; } };
}
function fakeStore(initial: { f: ImportedFont; data: Uint8Array }[] = []) {
  const fonts = new Map(initial.map((x) => [x.f.id, x]));
  let known = new Set<string>();
  const api: FontStoreApi = {
    list: () => [...fonts.values()].map((x) => x.f),
    bytes: async (f) => fonts.get(f.id)?.data ?? null,
    setFields: async (id, patch) => { const x = fonts.get(id); if (x) fonts.set(id, { ...x, f: { ...x.f, ...patch } }); },
    add: async (e, data) => { fonts.set(`n:${e.id}`, { f: { ...font({ id: `n:${e.id}`, family: e.family, hash: e.id.slice(5), bytes: data.byteLength }) }, data: new Uint8Array(data) }); return true; },
    remove: async (id) => { fonts.delete(id); },
    loadKnown: async () => new Set(known), saveKnown: async (k) => { known = new Set(k); },
  };
  return { api, fonts };
}
const args = (manifest: CloudFont[]) => ({ manifest, settings: DEFAULT_FONT_SYNC, used: new Set<string>(), freeBytes: null });

describe('runFontSync (fake cloud, two computers)', () => {
  it('hashes, uploads on one computer, downloads on the other, and is idempotent', async () => {
    const cloud = fakeCloud();
    const a = fakeStore([{ f: font({ hash: undefined, family: 'Nanum Pen', id: 'impfont:p' }), data: bytesOf('font-bytes-1') }]);
    const r1 = await runFontSync({ cloud: cloud.api, store: a.api }, args([]));
    const id = cloudFontId(await sha256Hex(bytesOf('font-bytes-1')));
    expect(r1.report.uploaded).toBe(1); expect(r1.manifest?.[0].id).toBe(id); expect(cloud.files.has(id)).toBe(true);
    const r1b = await runFontSync({ cloud: cloud.api, store: a.api }, args(r1.manifest!));
    expect(r1b.report.uploaded).toBe(0); expect(r1b.manifest).toBeUndefined();
    const b = fakeStore();
    const r2 = await runFontSync({ cloud: cloud.api, store: b.api }, args(r1.manifest!));
    expect(r2.report.downloaded).toBe(1); expect(b.api.list()[0].family).toBe('Nanum Pen');
    const r2b = await runFontSync({ cloud: cloud.api, store: b.api }, args(r1.manifest!));
    expect(r2b.report.downloaded).toBe(0);
    expect(cloud.calls.filter((c) => c.startsWith('down')).length).toBe(1);
  });
  it('a removal on computer A reaches computer B and the cloud file goes away', async () => {
    const cloud = fakeCloud();
    const a = fakeStore([{ f: font({ id: 'impfont:p', hash: undefined }), data: bytesOf('zzz') }]);
    const r = await runFontSync({ cloud: cloud.api, store: a.api }, args([]));
    const b = fakeStore();
    await runFontSync({ cloud: cloud.api, store: b.api }, args(r.manifest!));
    await a.api.remove('impfont:p'); // the person deletes it in the manager on A
    const ra = await runFontSync({ cloud: cloud.api, store: a.api }, args(r.manifest!));
    expect(ra.manifest).toEqual([]); expect(ra.report.removedCloud).toBe(1); expect(cloud.files.size).toBe(0);
    const rb = await runFontSync({ cloud: cloud.api, store: b.api }, args([])); // B pulled the library without the entry
    expect(rb.report.removedHere).toBe(1); expect(b.api.list()).toEqual([]);
  });
  it('rejects a download whose bytes do not match the hash', async () => {
    const files = new Map<string, Blob>([[cloudFontId('abc'), new Blob([bytesOf('other')])]]);
    const cloud = fakeCloud(files); const b = fakeStore();
    const e: CloudFont = { id: cloudFontId('abc'), family: 'X', subfamily: '', weight: 400, italic: false, format: 'truetype', bytes: 5, fsType: 0, source: 'user', at: 1 };
    const r = await runFontSync({ cloud: cloud.api, store: b.api }, args([e]));
    expect(r.report.failed).toEqual(['X']); expect(b.api.list()).toEqual([]);
  });
  it('offline: throws so the sync is retried, and nothing is lost or marked done', async () => {
    const cloud = fakeCloud(); cloud.offline(true);
    const a = fakeStore([{ f: font({ id: 'impfont:p' }), data: bytesOf('q') }]);
    await expect(runFontSync({ cloud: cloud.api, store: a.api }, args([]))).rejects.toMatchObject({ network: true });
    cloud.offline(false);
    const r = await runFontSync({ cloud: cloud.api, store: a.api }, args([]));
    expect(r.report.uploaded).toBe(1);
  });
});

describe('the font list in the library merges like other lists', () => {
  it('a removal on one side wins when the other side left it untouched; a new font is kept', () => {
    const lib = createSeedLibrary();
    const e = (n: string): CloudFont => ({ id: cloudFontId(n), family: n, subfamily: '', weight: 400, italic: false, format: 'truetype', bytes: 1, fsType: 0, source: 'user', at: 1 });
    const base0 = { ...lib, fonts: [e('a'), e('b')] };
    const local = { ...lib, fonts: [e('a'), e('b'), e('c')] };
    const remote = { ...lib, fonts: [e('b')] };
    expect(mergeLibrary(base0, local, remote).library.fonts?.map((f) => f.family).sort()).toEqual(['b', 'c']);
  });
});
