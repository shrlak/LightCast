// DeckCraft parity pass (v1.3.0): features DeckCraft has that LightCast lacked or drew differently —
// Quick Access Toolbar, the Animation Pane's advanced timeline, Dark Mode, Show Media Controls, the
// Eyedropper, SmartArt Design's Convert to Text, Rescan Installed Fonts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QAT_DEFAULTS, addQat, loadQat, moveQat, qatKey, removeQat, saveQat, toggleQat, type QatItem } from '../src/domain/qat';
import { MAX_MS, dragBar, pixelsPerSecond, timelineBars, timelineTicks } from '../src/domain/animTimeline';
import { REPEAT_UNTIL_CLICK } from '../src/domain/animations';
import { loadAppearance } from '../src/domain/appearance';
import { createSeedLibrary } from '../src/domain/defaults';
import { goLive } from '../src/domain/live';
import { createInitialState } from '../src/domain/reducer';
import type { Slide, SlideAnimation, SlideElement } from '../src/domain/types';
import { liveCanvasProps } from '../src/ui/liveProps';
import { eyedropHex } from '../src/ui/ppt/ribbonParts';
import { smartArtToText, ADD_SHAPE } from '../src/ui/ppt/tabSmartArt';
import { mediaClock } from '../src/ui/SlideCanvas';
import { rescanInstalledFonts } from '../src/ui/ppt/FontPicker';
// @ts-expect-error plain ESM script module
import { darkCss, darkColor } from '../scripts/darkCss.mjs';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe('Quick Access Toolbar (빠른 실행 도구 모음)', () => {
  it('starts with 저장 · 실행 취소 · 다시 실행 · 처음부터 시작 and keeps what is saved', () => {
    const s = mem();
    expect(loadQat(s)).toEqual(QAT_DEFAULTS);
    const ribbon: QatItem = { kind: 'ribbon', tab: '홈', group: '글꼴', label: '굵게' };
    const next = addQat(toggleQat(QAT_DEFAULTS, 'print'), ribbon);
    saveQat(next, s);
    expect(loadQat(s)).toEqual(next);
  });

  it('puts a ticked command in PowerPoint\'s order and unticks it again', () => {
    const on = toggleQat(QAT_DEFAULTS, 'print');
    expect(on.map(qatKey)).toEqual(['cmd:save', 'cmd:print', 'cmd:undo', 'cmd:redo', 'cmd:fromStart']);
    expect(toggleQat(on, 'print')).toEqual(QAT_DEFAULTS);
  });

  it('adds a ribbon button once, removes and moves it', () => {
    const b: QatItem = { kind: 'ribbon', tab: '삽입', group: '표', label: '표' };
    const one = addQat(addQat(QAT_DEFAULTS, b), b);
    expect(one.length).toBe(QAT_DEFAULTS.length + 1);
    expect(qatKey(moveQat(one, b, -1)[QAT_DEFAULTS.length - 1])).toBe(qatKey(b));
    expect(moveQat(one, b, 1)).toEqual(one);
    expect(removeQat(one, b)).toEqual(QAT_DEFAULTS);
  });

  it('ignores a broken or tampered saved toolbar', () => {
    const s = mem();
    s.setItem('lightcast.qat', '{oops');
    expect(loadQat(s)).toEqual(QAT_DEFAULTS);
    s.setItem('lightcast.qat', JSON.stringify([{ kind: 'command', id: 'rm -rf' }, { kind: 'ribbon', tab: '홈', label: '' }, { kind: 'command', id: 'find' }, { kind: 'command', id: 'find' }]));
    expect(loadQat(s)).toEqual([{ kind: 'command', id: 'find' }]);
  });
});

const anim = (id: string, start: SlideAnimation['start'], durationMs = 500, delayMs = 0, more: Partial<SlideAnimation> = {}): SlideAnimation =>
  ({ id, elementId: 'e', effect: 'fade', class: 'entrance', start, durationMs, delayMs, ...more });

describe('Animation Pane › advanced timeline', () => {
  it('places each effect in its click step: With starts with the one before, After when it ends', () => {
    const bars = timelineBars([anim('a', 'click', 500, 0), anim('b', 'with', 1000, 250), anim('c', 'after', 500, 0), anim('d', 'click', 400, 100)]);
    expect(bars.map((b) => [b.id, b.step, b.start, b.span])).toEqual([['a', 1, 0, 0.5], ['b', 1, 0.25, 1], ['c', 1, 1.25, 0.5], ['d', 2, 0.1, 0.4]]);
  });

  it('effects before the first click play as the slide comes on (step 0); repeats lengthen the bar; triggers are their own', () => {
    const bars = timelineBars([anim('a', 'with', 500), anim('b', 'click', 500, 0, { repeat: 3 }), anim('t', 'click', 700, 0, { trigger: 'x' }), anim('r', 'click', 500, 0, { repeat: REPEAT_UNTIL_CLICK })]);
    expect(bars.find((b) => b.id === 'a')).toMatchObject({ step: 0, start: 0 });
    expect(bars.find((b) => b.id === 'b')).toMatchObject({ step: 1, span: 1.5 });
    expect(bars.find((b) => b.id === 't')).toMatchObject({ step: null, start: 0, span: 0.7 });
    expect(bars.find((b) => b.id === 'r')).toMatchObject({ step: 2, span: 0.5 });
  });

  it('dragging a bar moves its delay in 0.05 s steps, never before its start; its end stretches the duration', () => {
    const a = anim('b', 'after', 1000, 0);
    const [, bar] = timelineBars([anim('a', 'click', 500), a]);
    expect(dragBar(a, bar, 'move', 0.333)).toEqual({ delayMs: 350 });
    expect(dragBar(a, bar, 'move', -5)).toBeNull();
    expect(dragBar(a, bar, 'end', 0.52)).toEqual({ durationMs: 1500 });
    expect(dragBar(a, bar, 'end', -9)).toEqual({ durationMs: 50 });
    expect(dragBar(a, bar, 'move', 10_000)).toEqual({ delayMs: MAX_MS });
    const rep = anim('r', 'click', 500, 0, { repeat: 2 });
    expect(dragBar(rep, timelineBars([rep])[0], 'end', 1)).toEqual({ durationMs: 1000 });
  });

  it('keeps a readable scale and ticks', () => {
    expect(pixelsPerSecond(240, 0.2)).toBe(120);
    expect(pixelsPerSecond(240, 1000)).toBe(8);
    expect(timelineTicks(3, 60)).toEqual([0, 1, 2, 3]);
    expect(timelineTicks(20, 10)).toEqual([0, 5, 10, 15, 20]);
  });
});

describe('View › Dark Mode (어두운 모드)', () => {
  it('is light unless dark was chosen on this computer', () => {
    const s = mem();
    expect(loadAppearance(s)).toBe('light');
    s.setItem('lightcast.appearance', 'dark');
    expect(loadAppearance(s)).toBe('dark');
  });

  it('turns light surfaces dark, dark text light, and leaves coloured accents', () => {
    expect(darkColor('#ffffff', 'bg')).toBe('#1f1f1f');
    expect(darkColor('#1f8a52', 'bg')).toBeNull();
    expect(darkColor('#252423', 'text')).not.toBeNull();
    expect(darkColor('#ffffff', 'text')).toBeNull();
    const css = darkCss('/* ================= PowerPoint-style layout ================= */\n.x { background: #fff; color: #252423; }\n.btn { background: #1f8a52; color: #111; }\n.canvas-frame { background: #fff; }');
    expect(css).toContain('html[data-appearance="dark"] .x { background: #1f1f1f; color:');
    expect(css).not.toContain('.btn');
    expect(css).not.toContain('.canvas-frame');
  });

  it('the committed dark stylesheet is up to date with styles.css (node scripts/make-dark-css.mjs)', () => {
    const root = new URL('../', import.meta.url);
    const src = readFileSync(new URL('src/styles.css', root), 'utf8') + '\n' + readFileSync(new URL('src/ui/ppt/backgroundRemoval.css', root), 'utf8');
    expect(readFileSync(new URL('src/ui/ppt/dark.css', root), 'utf8')).toBe(darkCss(src));
  });
});

describe('Slide Show › Show Media Controls (미디어 컨트롤 표시)', () => {
  const video: SlideElement = { id: 'v', kind: 'video', mediaId: 'm', x: 0, y: 0, w: 800, h: 450 };
  const slide: Slide = { id: 's', group: 'Slide', text: '', elements: [video] };
  const live = (showSetup?: { noMediaControls?: boolean }) => {
    const lib = createSeedLibrary();
    lib.presentations = [{ id: 'd', title: 'D', themeId: 'theme_classic', slides: [slide], ...(showSetup ? { showSetup } : {}) } as (typeof lib.presentations)[number]];
    return goLive(createInitialState(lib), { presentationId: 'd', seq: 0 }, 0).live;
  };
  it('is on by default, as in DeckCraft and PowerPoint, and off when the deck turns it off', () => {
    expect(live().mediaControls).toBe(true);
    expect(liveCanvasProps(live()).mediaControls).toBe(true);
    expect(live({ noMediaControls: true }).mediaControls).toBe(false);
    expect(liveCanvasProps(live({ noMediaControls: true })).mediaControls).toBe(false);
  });
  it('shows the play position as m:ss', () => {
    expect(mediaClock(0)).toBe('0:00');
    expect(mediaClock(75.9)).toBe('1:15');
  });
});

describe('Eyedropper (스포이트), SmartArt Design, fonts', () => {
  it('reads the eyedropper colour in either form', () => {
    expect(eyedropHex('#A1B2C3')).toBe('#a1b2c3');
    expect(eyedropHex('rgb(255, 0, 16)')).toBe('#ff0010');
    expect(eyedropHex('nonsense')).toBeNull();
  });

  it('SmartArt Design › Convert to Text keeps the outline levels in one bulleted box', () => {
    const owner: SlideElement = { id: 'o', kind: 'shape', groupId: 'g', x: 0, y: 0, w: 10, h: 10, smartArt: { kind: 'list', style: 'flat', colors: 'colorful', nodes: [{ text: '첫째', level: 0 }, { text: '세부', level: 1 }], box: { x: 10, y: 20, w: 300, h: 200 } } };
    const member: SlideElement = { id: 'm', kind: 'shape', groupId: 'g', x: 0, y: 0, w: 10, h: 10 };
    const other: SlideElement = { id: 'x', kind: 'text', x: 0, y: 0, w: 10, h: 10 };
    const r = smartArtToText([owner, member, other], owner)!;
    expect(r.elements.map((e) => e.id)).toEqual(['x', r.id]);
    expect(r.elements[1]).toMatchObject({ kind: 'text', text: '첫째\n\t세부', list: 'bullet', x: 10, y: 20, w: 300, h: 200 });
    expect(ADD_SHAPE.map(([p]) => p)).toEqual(['after', 'before', 'above', 'below', 'assistant']);
  });

  it('Rescan Installed Fonts adds every family the computer lists', async () => {
    const n = await rescanInstalledFonts(async () => [{ family: 'Zeta Sans' }, { family: '나눔고딕' }, { family: 'Zeta Sans' }]);
    expect(n).toBe(2);
    expect(await rescanInstalledFonts(async () => { throw new Error('denied'); })).toBe(0);
  });
});

describe('DeckCraft #2069: WMF scale and offset mapping records place sub-pictures', () => {
  it('two sub-pictures with a halved viewport land in their own halves of the frame', async () => {
    const { metafileToSvg } = await import('../src/domain/metafile');
    const u16 = (...v: number[]) => v.flatMap((x) => [x & 255, (x >> 8) & 255]);
    const u32 = (x: number) => [x & 255, (x >> 8) & 255, (x >> 16) & 255, (x >>> 24) & 255];
    const rec = (fn: number, ...w: number[]) => [...u32(3 + w.length), ...u16(fn), ...u16(...w.map((x) => x & 0xffff))];
    // SAVEDC, MM_ANISOTROPIC, SCALEVIEWPORTEXT x 1/2, SETWINDOWORG, SETWINDOWEXT 400 × 400, a brush, ELLIPSE, RESTOREDC.
    const sub = (ox: number, colorref: number) => [
      rec(0x001e), rec(0x0103, 8), rec(0x0412, 1, 1, 2, 1), rec(0x020b, 0, ox), rec(0x020c, 400, 400),
      rec(0x02fc, 0, colorref & 0xffff, colorref >>> 16, 0), rec(0x012d, 0), rec(0x0418, 380, 380, 20, 20), rec(0x0127, -1), rec(0x01f0, 0),
    ];
    const body = [rec(0x020b, 0, 0), rec(0x020c, 400, 800), ...sub(0, 0x0000ff), ...sub(-400, 0xff0000)].flat();
    const bytes = Uint8Array.from([...u16(1, 9, 0x300), ...u32(9 + 3 + body.length / 2), ...u16(1), ...u32(10), ...u16(0), ...body, ...u32(3), ...u16(0)]);
    const r = metafileToSvg(bytes)!;
    expect([r.width, r.height]).toEqual([800, 400]);
    const red = r.svg.match(/<path d="M(\d+) 200[^"]*" fill="#ff0000"/), blue = r.svg.match(/<path d="M(\d+) 200[^"]*" fill="#0000ff"/);
    expect(Number(red?.[1])).toBeLessThan(400);
    expect(Number(blue?.[1])).toBeGreaterThan(400);
  });
});
