import { describe, expect, it } from 'vitest';
import type { Library, Presentation, Slide, SlideElement } from '../src/domain/types';
import { refreshZooms } from '../src/domain/zoomRefresh';
import { actionAt, actionOf, liveActionFor } from '../src/domain/showActions';

const s = (id: string, more: Partial<Slide> = {}): Slide => ({ id, group: 'G', text: id, ...more });
const pres = (slides: Slide[]): Presentation => ({ id: 'p', title: 'P', themeId: 't', slides } as unknown as Presentation);

describe('Zoom objects follow their target slide', () => {
  it('refreshes a zoom snapshot when the target changes, and leaves it alone otherwise', () => {
    const zoom: SlideElement = { id: 'z', kind: 'zoom', x: 0, y: 0, w: 100, h: 75, targetSlideId: 'b', zoomOf: { slide: s('b', { text: 'old' }), theme: {} as never, background: null } };
    const p = pres([s('a', { elements: [zoom] }), s('b', { text: 'new' })]);
    const once = refreshZooms(p);
    expect(once.slides[0].elements![0].zoomOf!.slide.text).toBe('new');
    expect(refreshZooms(once)).toBe(once);
    const edited = { ...once, slides: [once.slides[0], { ...once.slides[1], text: 'newer' }] };
    expect(refreshZooms(edited).slides[0].elements![0].zoomOf!.slide.text).toBe('newer');
  });
});

describe('Slide show clicks', () => {
  const btn: SlideElement = { id: 'n', kind: 'shape', x: 10, y: 10, w: 50, h: 50, action: { kind: 'slide', slideId: 'c' } };
  const zoom: SlideElement = { id: 'z', kind: 'zoom', x: 200, y: 200, w: 100, h: 75, targetSlideId: 'b' };
  const deck = pres([s('a', { elements: [btn, zoom] }), s('b'), s('c', { disabled: true }), s('d')]);
  const state = { cursor: { presentationId: 'p', seq: 0, playlistIndex: null }, library: { presentations: [deck] } as unknown as Library };
  it('maps clicked objects to live actions on the console', () => {
    expect(actionOf(actionAt(deck.slides[0], 20, 20)!)).toEqual({ kind: 'slide', slideId: 'c' });
    expect(actionOf(actionAt(deck.slides[0], 250, 230)!)).toEqual({ kind: 'zoom', slideId: 'b' });
    expect(liveActionFor(state, { kind: 'zoom', slideId: 'b' })).toMatchObject({ type: 'live/go', presentationId: 'p', seq: 1 });
    expect(liveActionFor(state, { kind: 'last' })).toMatchObject({ type: 'live/go', seq: 3 });
    expect(liveActionFor(state, { kind: 'next' })).toMatchObject({ type: 'live/next' });
    expect(liveActionFor(state, { kind: 'url', url: 'https://x' })).toBeNull();
  });
});

describe('SmartArt in Korean', async () => {
  const { smartArtCatalog } = await import('../src/engine');
  const { SMARTART_LAYOUT, SMARTART_STYLE, SMARTART_CATEGORIES } = await import('../src/ui/ppt/ko');
  it('names every layout and style, in a known category', () => {
    const cat = smartArtCatalog()!;
    for (const l of cat.layouts) {
      expect(SMARTART_LAYOUT[l.id], l.id).toBeTruthy();
      expect(SMARTART_CATEGORIES).toContain(SMARTART_LAYOUT[l.id][1]);
    }
    for (const st of cat.styles) expect(SMARTART_STYLE[st.id], st.id).toBeTruthy();
  });
});

describe('Character formatting in the slide text', async () => {
  const { slideLineRuns, slideTextPatch } = await import('../src/domain/richText');
  it('keeps runs only where formatted and still spelling the line', () => {
    const p = slideTextPatch([[{ text: 'H' }, { text: '2', baseline: 'sub' }, { text: 'O' }], [{ text: 'plain' }]]);
    expect(p.text).toBe('H2O\nplain');
    expect(slideLineRuns(p)[0]?.[1]).toEqual({ text: '2', baseline: 'sub' });
    expect(slideLineRuns(p)[1]).toBeNull();
    expect(slideTextPatch([[{ text: 'x' }]]).textRuns).toBeUndefined();
    expect(slideLineRuns({ text: 'H3O\nplain', textRuns: p.textRuns })[0]).toBeNull();
  });
});

describe('Arrange › Regroup', async () => {
  const { groupSelection, ungroupSelection, regroupSelection } = await import('../src/domain/editOps');
  it('puts ungrouped objects back into one group', () => {
    const els: SlideElement[] = ['a', 'b', 'c'].map((id, i) => ({ id, kind: 'shape', x: i * 10, y: 0, w: 5, h: 5 }));
    const g = groupSelection(els, ['a', 'b']);
    const u = ungroupSelection(g, ['a']);
    expect(u.every((e) => !e.groupId)).toBe(true);
    const r = regroupSelection(u, ['b']);
    expect(r.ids.sort()).toEqual(['a', 'b']);
    expect(r.elements.find((e) => e.id === 'a')!.groupId).toBe(r.elements.find((e) => e.id === 'b')!.groupId);
    expect(r.elements.find((e) => e.id === 'c')!.groupId).toBeUndefined();
  });
});

describe('Edit Points operations', async () => {
  const pe = await import('../src/domain/pathEdit');
  const sq = () => pe.parsePath('M0 0 L100 0 L100 100 L0 100 Z');
  it('adds a point on a segment and deletes it again', () => {
    const added = pe.insertPoint(sq(), 1, 0.5);
    expect(pe.anchors(added).map((a) => a.p)).toContainEqual([50, 0]);
    expect(pe.writePath(pe.deletePoint(added, 1))).toBe(pe.writePath(sq()));
  });
  it('splits a curve where clicked, keeping its shape', () => {
    const c = pe.parsePath('M0 0 C0 100 100 100 100 0');
    const mid = pe.pointOn(c, 1, 0.5)!;
    const split = pe.insertPoint(c, 1, 0.5);
    expect(split[1].pts[2][0]).toBeCloseTo(mid[0]);
    expect(split[1].pts[2][1]).toBeCloseTo(mid[1]);
    expect(pe.pointOn(split, 2, 0.5)![1]).toBeCloseTo(pe.pointOn(c, 1, 0.75)![1]);
  });
  it('changes segment and point types', () => {
    const curved = pe.setSegmentType(sq(), 1, 'curve');
    expect(curved[1].cmd).toBe('C');
    expect(pe.setSegmentType(curved, 1, 'line')[1].cmd).toBe('L');
    const smooth = pe.setPointType(pe.parsePath('M0 0 C10 0 40 0 50 50 C60 0 90 0 100 0'), 1, 'smooth');
    const [inH, p] = [smooth[1].pts[1], smooth[1].pts[2]], outH = smooth[2].pts[0];
    // Collinear and equal arms.
    expect(Math.hypot(p[0] - inH[0], p[1] - inH[1])).toBeCloseTo(Math.hypot(outH[0] - p[0], outH[1] - p[1]));
    expect((p[0] - inH[0]) * (outH[1] - p[1]) - (p[1] - inH[1]) * (outH[0] - p[0])).toBeCloseTo(0);
  });
  it('opens, closes and deletes segments', () => {
    const opened = pe.openPath(sq(), 2);
    expect(opened.some((s) => s.cmd === 'Z')).toBe(false);
    expect(opened[0].pts[0]).toEqual([100, 100]);
    expect(pe.anchors(opened)).toHaveLength(5);
    expect(pe.closePath(opened, 1).at(-1)!.cmd).toBe('Z');
    const cut = pe.deleteSegment(sq(), 1);
    expect(cut.some((s) => s.cmd === 'Z')).toBe(false);
    expect(pe.anchors(cut)).toHaveLength(4);
    const nearest = pe.nearestOnPath(sq(), [50, 2]);
    expect(nearest?.seg).toBe(1);
  });
});

describe('Korean shape names', async () => {
  const { shapeCatalog } = await import('../src/engine');
  const { shapeLabel } = await import('../src/ui/ppt/ko');
  it('names every preset shape in Korean', () => {
    expect(shapeCatalog().filter((s) => shapeLabel(s.name, '') === '').map((s) => s.name)).toEqual([]);
  });
});

describe('Korean animation and transition names', async () => {
  const { animationCatalog, transitionCatalog } = await import('../src/engine');
  const { ANIMATION, TRANSITION, optionLabel, animOptionLabel } = await import('../src/ui/ppt/ko');
  it('names every effect and option in Korean', () => {
    expect(animationCatalog().filter((e) => !ANIMATION[e.id]).map((e) => e.id)).toEqual([]);
    expect(transitionCatalog().filter((e) => !TRANSITION[e.id]).map((e) => e.id)).toEqual([]);
    expect([...new Set(animationCatalog().flatMap((e) => e.options).filter((o) => animOptionLabel(o) === o))]).toEqual([]);
    expect([...new Set(transitionCatalog().flatMap((e) => e.options.map((o) => o.label)).filter((l) => /[A-Za-z]/.test(optionLabel(l))))]).toEqual([]);
  });
});

describe('Pattern fills', async () => {
  const { PATTERNS, patternPath } = await import('../src/domain/patterns');
  it("has PowerPoint's presets as 8x8 bitmaps", () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(48);
    expect(PATTERNS.every((p) => p.rows.length === 8 && !/[A-Za-z]{3}/.test(p.label))).toBe(true);
    // 50%: every other pixel, 32 of 64.
    expect(patternPath('pct50').match(/M/g)).toHaveLength(32);
    expect(patternPath('horz', 2)).toBe(Array.from({ length: 8 }, (_, x) => `M${x * 2} 0h2v2h-2z`).join(''));
  });
});

describe('WordArt Transform', async () => {
  const { warpCatalog, warpGuides, smoothCorners } = await import('../src/engine');
  const tw = await import('../src/domain/textWarp');
  it("lays glyphs on DeckCraft's guides and names every preset in Korean", () => {
    const cat = warpCatalog();
    expect(cat).toHaveLength(40);
    expect(cat.filter((c) => !tw.WARP_LABEL[c.id])).toEqual([]);
    expect(tw.warpPreset('archUp')).toBe('textArchUp');
    const band = warpGuides('textInflate', 400, 200)![0];
    expect(band.kind).toBe('fill');
    if (band.kind !== 'fill') return;
    const g = tw.fillGlyphs(band, [{ chars: ['A', 'B', 'C'], widths: [10, 10, 10] }], 10);
    expect(g).toHaveLength(3);
    // The middle glyph is taller than the outer ones (the box bulges in the middle).
    expect(g[1].matrix[3]).toBeGreaterThan(g[0].matrix[3]);
    expect(tw.bandOfLine(3, 4, 2)).toBe(1);
    expect(tw.at([[0, 0], [10, 0]], 0.5)).toEqual([5, 0]);
    expect(smoothCorners(200, 100, 0.6)?.path).toContain('C');
  });
});

describe('Table borders, margins, Draw Table and Eraser', async () => {
  const { newTable, editTable } = await import('../src/engine');
  const tb = await import('../src/domain/tableBorders');
  const pen = { color: '#ff0000', width: 4 };
  it('draws outside and inside borders on a range', () => {
    const t = newTable(3, 3)!;
    const out = tb.applyBorders(t, { r: 0, c: 0, r1: 1, c1: 1 }, 'outside', pen);
    expect(out.rows[0][0].borders).toMatchObject({ t: pen, l: pen });
    expect(out.rows[0][0].borders?.r).toBeUndefined();
    expect(out.rows[1][1].borders).toMatchObject({ b: pen, r: pen });
    expect(out.rows[2][2].borders).toBeUndefined();
    const none = tb.applyBorders(out, { r: 0, c: 0, r1: 0, c1: 0 }, 'none', pen);
    expect(none.rows[0][0].borders?.t).toBeNull();
    // The neighbour's side counts for a shared line.
    expect(tb.sideOf(out, 1, 0, 't')).toBeUndefined();
    const inside = tb.applyBorders(t, { r: 0, c: 0, r1: 1, c1: 0 }, 'insideH', pen);
    expect(tb.sideOf(inside, 1, 0, 't')).toEqual(pen);
    // Borders survive an edit that goes through the engine.
    const edited = editTable(out, 'insertRowBelow', 2, 0)!;
    expect(edited.rows[0][0].borders).toMatchObject({ t: pen });
  });
  it('splits a cell with a drawn line and merges with the eraser', () => {
    const t = newTable(2, 2)!;
    const v = tb.drawLine(t, 0, 0, 'v', 0.5)!;
    expect(v.cols).toHaveLength(3);
    expect(v.cols[0] + v.cols[1]).toBeCloseTo(t.cols[0]);
    // Row 1 keeps one cell over the two new columns.
    expect(v.rows[1][0].span).toBe(2);
    expect(v.rows[0][0].span ?? 1).toBe(1);
    const h = tb.drawLine(t, 1, 1, 'h', 0.3)!;
    expect(h.rows).toHaveLength(3);
    const erased = tb.eraseLine(t, 0, 0, 'r')!;
    expect(erased.rows[0][0].span).toBe(2);
  });
});

describe('Handouts, notes pages and Inspect Document', async () => {
  const pr = await import('../src/ui/ppt/printing');
  it('pages handouts and finds hidden data', () => {
    expect(pr.paginate([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(pr.handoutGrid(6)).toEqual([2, 3]);
    const deck = pres([s('a', { comments: [{ id: 'c', text: 'x' } as never], notes: 'n', elements: [{ id: 'e', kind: 'shape', x: 2000, y: 0, w: 10, h: 10 }, { id: 'h', kind: 'shape', x: 0, y: 0, w: 10, h: 10, hidden: true }] }), s('b', { disabled: true })]);
    const found = Object.fromEntries(pr.inspectFindings(deck).map((f) => [f.id, f.count]));
    expect(found).toMatchObject({ comments: 1, notes: 1, hidden: 1, invisible: 1, offslide: 1, properties: 0 });
    const off = pr.inspectFindings(deck).find((f) => f.id === 'offslide')!.remove(deck);
    expect(off.slides![0].elements!.map((e) => e.id)).toEqual(['h']);
  });
});

describe('Slide Master layouts', async () => {
  const m = await import('../src/domain/master');
  it('makes slides from a layout with fresh placeholder objects, plus the master', () => {
    const [title] = m.defaultLayouts();
    const logo: SlideElement = { id: 'logo', kind: 'shape', x: 0, y: 0, w: 5, h: 5 };
    const sl = m.slideFromLayout(title, 'G', [logo]);
    expect(sl.layoutId).toBe(title.id);
    expect(sl.elements!.map((e) => e.placeholder ?? e.id)).toEqual([m.masterCopyId('logo'), 'title', 'text']);
    expect(sl.elements![1].id).not.toBe(title.elements[0].id);
    expect(m.PLACEHOLDER_PROMPT.title).toContain('제목');
    expect(m.makePlaceholder('picture').kind).toBe('shape');
  });
});

describe('Browse for Themes', async () => {
  const tf = await import('../src/domain/io/themeFile');
  const { colorPalette } = await import('../src/engine');
  it("reads a theme's colours and fonts and the engine uses them", () => {
    const slot = (n: string, v: string) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
    const xml = `<a:theme name="Church"><a:themeElements><a:clrScheme name="Church"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${slot('dk2', '1F2A44')}${slot('lt2', 'E7E6E6')}${slot('accent1', 'C00000')}${slot('accent2', 'ED7D31')}${slot('accent3', 'A5A5A5')}${slot('accent4', 'FFC000')}${slot('accent5', '5B9BD5')}${slot('accent6', '70AD47')}${slot('hlink', '0563C1')}${slot('folHlink', '954F72')}</a:clrScheme><a:fontScheme name="F"><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface="바탕"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
    const t = tf.parseThemeXml(xml)!;
    expect(t.name).toBe('Church');
    expect(t.colors[0]).toBe('#000000');
    expect(t.colors[4]).toBe('#c00000');
    expect([t.major, t.majorEa, t.minor, t.minorEa]).toEqual(['Georgia', '바탕', 'Calibri', undefined]);
    const pal = colorPalette(tf.customSchemeName(t));
    expect(JSON.stringify(pal).toLowerCase()).toContain('#c00000');
  });
});

describe('Spelling', async () => {
  const sp = await import('../src/domain/spelling');
  const bad = new Set(['teh', 'recieve']);
  const check = (w: string) => bad.has(w.toLowerCase());
  it('finds misspelled words in reading order and changes them', () => {
    expect(sp.wordsIn('teh NASA https://x.co/teh it’s 3rd').map((w) => w.word)).toEqual(['teh', 'it’s', 'rd']);
    const deck = pres([s('a', { title: 'Teh title', text: 'we recieve grace', notes: 'teh notes', elements: [{ id: 'b', kind: 'text', text: 'teh box', x: 0, y: 0, w: 1, h: 1 }, { id: 'q', kind: 'text', text: 'teh skip', noProof: true, x: 0, y: 0, w: 1, h: 1 }] })]);
    const hits = sp.misspellings(deck, check);
    expect(hits.map((h) => `${h.field}:${h.word}`)).toEqual(['title:Teh', 'text:recieve', 'el:teh', 'notes:teh']);
    expect(sp.misspellings(deck, check, new Set(['teh'])).map((h) => h.word)).toEqual(['recieve']);
    const one = sp.changeWord(deck.slides, hits[1], 'receive');
    expect(one[0].text).toBe('we receive grace');
    const all = sp.changeWord(deck.slides, hits[2], 'the', true);
    expect([all[0].elements![0].text, all[0].notes, all[0].title]).toEqual(['the box', 'the notes', 'Teh title']);
  });
});

describe('Review › Compare', async () => {
  const cmp = await import('../src/domain/compare');
  it('lists revisions and accepts them into this presentation', () => {
    const box: SlideElement = { id: 'b', kind: 'text', text: 'hi', x: 0, y: 0, w: 100, h: 50 };
    const mine = pres([s('a', { title: 'A', elements: [box, { id: 'gone', kind: 'shape', x: 0, y: 0, w: 1, h: 1 }] }), s('b'), s('c')]);
    const other = pres([s('a', { title: 'A2', elements: [{ ...box, x: 40, text: 'hello' }, { id: 'new', kind: 'shape', x: 5, y: 5, w: 5, h: 5 }] }), s('n'), s('b')]);
    const revs = cmp.compare(mine, other);
    expect(revs.map((r) => r.kind)).toEqual(['field', 'element', 'elementInsert', 'elementDelete', 'slideInsert', 'slideDelete']);
    expect(revs[1].label).toContain('텍스트, 이동');
    let slides = mine.slides;
    for (const r of revs) slides = cmp.accept(slides, r);
    expect(slides.map((x) => x.id)).toEqual(['a', 'n', 'b']);
    expect(slides[0].title).toBe('A2');
    expect(slides[0].elements!.map((e) => e.id)).toEqual(['b', 'new']);
    expect(slides[0].elements![0].text).toBe('hello');
  });
});

describe('Photo Album', async () => {
  const pa = await import('../src/domain/photoAlbum');
  it('lays pictures out and rebuilds the album in place', () => {
    const pics = ['a.jpg', 'b.jpg', 'c.jpg'].map((n) => ({ mediaId: `m-${n}`, name: n }));
    const album = pa.albumSlides(pics, { per: 2, frame: '', titles: false, captions: true }, 'G', 'al1');
    expect(album).toHaveLength(2);
    expect(album[0].elements!.filter((e) => e.kind === 'text').map((e) => e.text)).toEqual(['a', 'b']);
    const deck = [s('x'), ...album, s('y')];
    const read = pa.readAlbum(deck, 'al1')!;
    expect(read.pictures.map((p) => p.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(read.options.per).toBe(2);
    const rebuilt = pa.replaceAlbum(deck, 'al1', [pics[2], pics[0]], { ...read.options, per: 1 });
    expect(rebuilt.map((x) => (x.album ? `album:${x.elements!.find((e) => e.kind === 'image')!.name}` : x.id))).toEqual(['x', 'album:c.jpg', 'album:a.jpg', 'y']);
  });
});

describe('Morph', async () => {
  const mo = await import('../src/domain/morph');
  it("pairs objects by DeckCraft's rules and moves them between slides", () => {
    const a: SlideElement[] = [
      { id: 'a1', kind: 'shape', shape: 'ellipse', x: 0, y: 0, w: 100, h: 100, fill: '#000000' },
      { id: 'a2', kind: 'text', text: '찬양', x: 0, y: 200, w: 100, h: 50 },
      { id: 'a3', kind: 'shape', name: '!!logo', shape: 'rect', x: 0, y: 0, w: 10, h: 10, rotation: 350 },
      { id: 'a4', kind: 'shape', shape: 'star5', x: 0, y: 0, w: 10, h: 10 },
    ];
    const b: SlideElement[] = [
      { id: 'b3', kind: 'shape', name: '!!logo', shape: 'ellipse', x: 100, y: 0, w: 10, h: 10, rotation: 10 },
      { id: 'b2', kind: 'text', text: '찬양', x: 400, y: 200, w: 200, h: 50 },
      { id: 'b1', kind: 'shape', shape: 'ellipse', x: 200, y: 0, w: 100, h: 100, fill: '#ffffff' },
      { id: 'b5', kind: 'text', text: '새 글', x: 0, y: 0, w: 1, h: 1 },
    ];
    expect(mo.morphPairs(a, b)).toEqual([['a3', 'b3'], ['a2', 'b2'], ['a1', 'b1']]);
    const half = mo.morphFrame(a, b, 0.5);
    const circle = half.moving.find((e) => e.id === 'b1')!;
    expect(circle.x).toBe(100);
    expect(circle.fill).toBe('#808080');
    // 350° → 10° turns 20° the short way: halfway is 360° (0).
    expect((half.moving.find((e) => e.id === 'b3')!.rotation ?? 0) % 360).toBeCloseTo(0);
    expect(half.oldOnly.map((e) => e.id)).toEqual(['a4']);
    expect(half.newOnly.map((e) => e.id)).toEqual(['b5']);
    expect(half.newOnly[0].opacity).toBeCloseTo(0.5);
    expect(mo.morphFrame(a, b, 1).moving.find((e) => e.id === 'b2')!.x).toBe(400);
  });
});

describe('Custom motion paths', async () => {
  const an = await import('../src/domain/animations');
  const { prepareTimeline, sampleTimeline } = await import('../src/engine');
  it('turns drawn points into a path the engine moves the object along', () => {
    const path = an.customMotionPath([[100, 100], [400, 100], [400, 500]])!;
    expect(path).toBe('M 0 0 L 0.2083 0 L 0.2083 0.3704 E');
    expect(an.motionPathPoints(path, 100, 100)[2][1]).toBeCloseTo(500, 0);
    const spec = { anims: [{ elementId: 'a', effect: 'customPath', class: 'path' as const, start: 'click' as const, durationMs: 1000, delayMs: 0, path }], boxes: [{ id: 'a', x: 50, y: 50, w: 100, h: 100, rot: 0 }] };
    expect(prepareTimeline(spec)).toBeTruthy();
    const end = sampleTimeline(spec, 1, 1)?.a;
    const mid = sampleTimeline(spec, 1, 0.3)?.a;
    expect(Math.abs((end?.dx ?? 0) - 300)).toBeLessThan(2);
    expect(Math.abs((end?.dy ?? 0) - 400)).toBeLessThan(2);
    expect(mid?.dx ?? 0).toBeGreaterThan(0);
  });
});
