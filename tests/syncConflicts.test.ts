import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeLibrary } from '../src/domain/cloudMerge';
import { createSeedLibrary } from '../src/domain/defaults';
import { withQrElements } from '../src/domain/qrElements';
import type { Library, Presentation, Slide } from '../src/domain/types';

const deck = (slides: Slide[]): Presentation => ({ id: 'p1', title: '1101 Front', slides, themeId: 'theme_classic' });
const lib = (presentations: Presentation[]): Library => ({ ...createSeedLibrary(), presentations });
const page = (id: string, text: string, el: string): Slide => ({ id, group: 'Front', text, elements: [{ id: el, kind: 'text', text, x: 0, y: 0, w: 100, h: 100 }] });

describe('cloud sync: the same automatic change on two computers', () => {
  const base = lib([deck([page('a', '10/25/2026', 'a1')])]);

  it('is one change, not a "(다른 기기)" copy, when only the new ids differ', () => {
    // Both computers moved the Front to the next Sunday by themselves, each with its own new ids.
    const here = lib([deck([page('x1', '11/01/2026', 'x2')])]);
    const there = lib([deck([page('y1', '11/01/2026', 'y2')])]);
    const { library } = mergeLibrary(base, here, there);
    expect(library.presentations).toEqual(there.presentations); // every computer ends up with the cloud's copy
  });

  it('keeps a real edit made here when the cloud only renumbered the ids', () => {
    const here = lib([deck([page('a', '11/01/2026 · 이 기기에서 고침', 'a1')])]);
    const there = lib([deck([page('z1', '10/25/2026', 'z2')])]);
    const { library } = mergeLibrary(base, here, there);
    expect(library.presentations).toEqual(here.presentations);
  });

  it('takes the cloud’s real edit when this computer only renumbered the ids', () => {
    const here = lib([deck([page('z1', '10/25/2026', 'z2')])]);
    const there = lib([deck([page('a', '다른 기기에서 고침', 'a1')])]);
    const { library } = mergeLibrary(base, here, there);
    expect(library.presentations).toEqual(there.presentations);
  });

  it('takes the later edit when the two computers really changed it differently (no copy)', () => {
    const at = (p: Presentation, t: number): Presentation => ({ ...p, updatedAt: t, slides: p.slides.map((s) => ({ ...s, editedAt: t })) });
    const here = lib([at(deck([page('a', '이 기기', 'a1')]), 2000)]);
    const there = lib([at(deck([page('a', '저 기기', 'a1')]), 1000)]);
    const merged = mergeLibrary(base, here, there).library.presentations;
    expect(merged).toHaveLength(1);
    expect(merged[0].slides[0].text).toBe('이 기기');
    expect(mergeLibrary(base, there, here).library.presentations[0].slides[0].text).toBe('이 기기');
  });

  it('converts an older slide’s QR codes the same way on every computer', () => {
    const old: Slide = { id: 'ad', group: '광고', text: '', qr: ['https://a', 'https://b'] };
    expect(withQrElements(old)).toEqual(withQrElements(old));
    expect(withQrElements(old).elements!.map((e) => e.id)).toEqual(['ad-qr0', 'ad-qr1']);
  });
});

describe('cloud sync: media', () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock('../src/domain/media'); vi.unstubAllGlobals(); });

  it('skips a file that cannot be sent and carries on with the rest', async () => {
    const stored = new Map<string, Blob>([['m1', new Blob(['1'])], ['m2', new Blob(['2'])]]);
    vi.doMock('../src/domain/media', () => ({ getMedia: async (id: string) => stored.get(id), putMedia: async (id: string, b: Blob) => { stored.set(id, b); } }));
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/media')) return json(200, { items: [{ id: 'm3', size: 1 }] });
      if (url.endsWith('/media/m1') && init?.method === 'PUT') return json(413, { error: 'too large' });
      if (init?.method === 'PUT') { sent.push(url); return json(200, { ok: true }); }
      return new Response(new Blob(['3']), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    });
    const { syncMedia } = await import('../src/domain/cloud');
    const library = { ...createSeedLibrary(), media: [{ id: 'm1', name: '큰 영상.mp4', type: 'video' as const }, { id: 'm2', name: '포스터.png', type: 'image' as const }, { id: 'm3', name: '로고.png', type: 'image' as const }] };
    const result = await syncMedia('t', library, () => undefined);
    expect(result.failed).toEqual(['큰 영상.mp4']);
    expect(sent).toEqual(['/api/cloud/media/m2']);
    expect(stored.has('m3')).toBe(true); // the download after the failed upload still happened
  });
});
