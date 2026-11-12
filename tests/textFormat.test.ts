import { describe, expect, it } from 'vitest';
import { changeCase, clearTextFormat, FONT_SIZES, formatSpan, listMarker, listMarkers, mixedState, stepElementFont, stepFontSize, textSpans } from '../src/domain/textFormat';
import type { SlideElement } from '../src/domain/types';
import { autoFitMode, autoFitValue, drawnText, lineReduction, newTextBox, resizedTextBox, resizeToText, scaledText, shrinkScale } from '../src/domain/textFit';
import { patchElement } from '../src/domain/templates/convert';

const pt = (px: number) => px / 2;
const steps = (from: number, dir: 1 | -1, n: number) => { const out: number[] = []; let v = from * 2; for (let i = 0; i < n; i++) out.push(pt(v = stepFontSize(v, dir))); return out; };

describe('PowerPoint text commands', () => {
  it('steps font sizes through PowerPoint’s list (canvas px = 2 × pt)', () => {
    expect(stepFontSize(82, 1)).toBe(88);
    expect(stepFontSize(82, -1)).toBe(80);
    expect(stepFontSize(80, 1)).toBe(88);
    expect(stepFontSize(192, 1)).toBe(208);
    expect(stepFontSize(16, -1)).toBe(14);
  });

  it('uses DeckCraft’s size list (8 … 96 pt, the Font Size box lists the same sizes)', () => {
    expect(FONT_SIZES.map(pt)).toEqual([8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96]);
  });

  it('Decrease Font Size steps down one size at a time from any size (DeckCraft #2070)', () => {
    expect(steps(120, -1, 9)).toEqual([112, 104, 96, 88, 80, 72, 66, 60, 54]);
    expect(steps(54, 1, 7)).toEqual([60, 66, 72, 80, 88, 96, 104]);
    // Between list steps: the next one down; past the top: 8 pt at most.
    expect(pt(stepFontSize(99 * 2, -1))).toBe(96);
    expect(pt(stepFontSize(150 * 2, -1))).toBe(142);
    // Below the list 1 pt at a time, never under 1 pt; above it at most 4000 pt.
    expect(steps(8, -1, 8)).toEqual([7, 6, 5, 4, 3, 2, 1, 1]);
    expect(pt(stepFontSize(3998 * 2, 1))).toBe(4000);
  });

  it('grows and shrinks every run from its own size', () => {
    const el: SlideElement = { id: 'b', kind: 'text', x: 0, y: 0, w: 400, h: 100, text: 'Big small\nnext', fontSize: 80,
      runs: [[{ text: 'Big ', fontSize: 120 }, { text: 'small', fontSize: 40 }], [{ text: 'next' }]] };
    const up = stepElementFont(el, 1);
    expect(up.fontSize).toBe(88);
    expect(up.runs!.map((l) => l.map((r) => r.fontSize))).toEqual([[132, 48], [undefined]]);
    const paras: SlideElement = { id: 'p', kind: 'text', x: 0, y: 0, w: 400, h: 100, text: 'a\nb', paragraphs: [{ text: 'a', fontSize: 72 }, { text: 'b' }] };
    expect(stepElementFont(paras, -1).paragraphs!.map((p) => p.fontSize)).toEqual([64, undefined]);
    expect(stepElementFont(paras, -1).fontSize).toBe(56);
    expect(stepElementFont({ ...paras, paragraphs: undefined, fontSize: undefined }, 1, 40).fontSize).toBe(48);
  });

  it('shows a blank size box and font name for a mixed selection (format.state)', () => {
    expect(mixedState([{ fontSize: 64, fontFamily: 'Arial' }, { fontSize: 64, fontFamily: 'Arial' }])).toEqual({ fontSize: 64, fontFamily: 'Arial' });
    expect(mixedState([{ fontSize: 64 }, { fontSize: 40 }])).toEqual({ fontSize: null, fontFamily: undefined });
    expect(mixedState([{ fontSize: 64, fontFamily: 'Arial' }, { fontSize: 64 }])).toEqual({ fontSize: 64, fontFamily: null });
    const el: SlideElement = { id: 'b', kind: 'text', x: 0, y: 0, w: 400, h: 100, text: 'Big small\n\nend', fontSize: 64,
      runs: [[{ text: 'Big ', fontSize: 120, fontFamily: 'Georgia' }, { text: 'small' }], [], [{ text: 'end' }]] };
    expect(textSpans(el).map((s) => s.fontSize)).toEqual([120, 64, 64]);
    expect(mixedState(textSpans(el))).toEqual({ fontSize: null, fontFamily: null });
    expect(mixedState(textSpans({ ...el, runs: undefined }))).toEqual({ fontSize: 64, fontFamily: undefined });
  });

  it('numbers only the lines with text', () => {
    expect(listMarkers(['a', '', 'b', 'c'], 'number')).toEqual(['1.', null, '2.', '3.']);
    expect(listMarkers(['a'], undefined)).toEqual([null]);
    expect([listMarker('roman', 4), listMarker('alpha', 2), listMarker('hangul', 3), listMarker('number-paren', 1)]).toEqual(['IV.', 'B.', '다.', '1)']);
  });

  it('changes case like 대/소문자 바꾸기', () => {
    expect(changeCase('amazing GRACE. how sweet', 'sentence')).toBe('Amazing grace. How sweet');
    expect(changeCase('amazing grace', 'title')).toBe('Amazing Grace');
    expect(changeCase('Amazing', 'toggle')).toBe('aMAZING');
    expect(changeCase('주 예수 Lord', 'upper')).toBe('주 예수 LORD');
  });

  it('formats the word at the caret, or the whole box when the caret is between words', () => {
    expect(formatSpan('Amazing grace how', 10, 10)).toEqual([8, 13]);
    expect(formatSpan('주 예수 사랑', 3, 3)).toEqual([2, 4]);
    expect(formatSpan('Amazing grace', 7, 7)).toEqual([0, 13]);
    expect(formatSpan('Amazing grace', 0, 0)).toEqual([0, 13]);
    expect(formatSpan('Amazing grace', 9, 2)).toEqual([2, 9]);
  });

  it('Clear All Formatting removes character formatting only (format.clear)', () => {
    const el: SlideElement = { id: 'b', kind: 'text', x: 0, y: 0, w: 400, h: 100, text: 'a\nb', fontSize: 80, bold: true, color: '#ff0000', fontFamily: 'Georgia',
      align: 'left', list: 'bullet', lineHeight: 2, columns: 2, highlight: '#ffff00',
      paragraphs: [{ text: 'a', fontSize: 40, bold: true, align: 'right', runs: [{ text: 'a', italic: true }] }, { text: 'b' }] };
    const out = { ...el, ...clearTextFormat(el) };
    expect([out.fontSize, out.bold, out.color, out.fontFamily, out.highlight]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect([out.align, out.list, out.lineHeight, out.columns]).toEqual(['left', 'bullet', 2, 2]);
    expect(out.paragraphs).toEqual([{ text: 'a', align: 'right' }, { text: 'b' }]);
  });
});

describe('text box autofit (Format Shape › 텍스트 상자, DeckCraft format.autofit / fit_text_box)', () => {
  const box = (p: Partial<SlideElement> = {}): SlideElement => ({ id: 't', kind: 'text', x: 100, y: 200, w: 400, h: 300, text: 'Hello', fontSize: 64, ...p });

  it('has PowerPoint’s three modes, with LightCast’s own fit for template boxes', () => {
    expect([autoFitMode(box({ autoFit: false })), autoFitMode(box({ autoFit: 'shrink' })), autoFitMode(box({ autoFit: 'resize' })), autoFitMode(box()), autoFitMode(box({ autoFit: true }))])
      .toEqual(['none', 'shrink', 'resize', 'legacy', 'legacy']);
    expect([autoFitValue('none'), autoFitValue('shrink'), autoFitValue('resize')]).toEqual([false, 'shrink', 'resize']);
  });

  it('Resize shape to fit text: the height follows the text (grows and shrinks), top-left kept; no wrap → width too', () => {
    expect(resizeToText(box(), { w: 380, h: 520.2 })).toEqual({ x: 100, y: 200, w: 400, h: 521 });
    expect(resizeToText(box(), { w: 380, h: 80 })).toEqual({ x: 100, y: 200, w: 400, h: 80 });
    expect(resizeToText(box({ wrap: false }), { w: 912.4, h: 80 })).toEqual({ x: 100, y: 200, w: 913, h: 80 });
    // DeckCraft's minimum: 8 pt high, 20 pt wide.
    expect(resizeToText(box({ wrap: false }), { w: 3, h: 2 })).toEqual({ x: 100, y: 200, w: 40, h: 16 });
  });

  it('Shrink text on overflow: DeckCraft’s search for the largest scale that fits', () => {
    expect(shrinkScale(() => true)).toBe(1);
    expect(shrinkScale(() => false)).toBe(0.1);
    const s = shrinkScale((k) => k <= 0.62);
    expect(s).toBeGreaterThan(0.61); expect(s).toBeLessThanOrEqual(0.62);
    expect(lineReduction(1)).toBe(0); expect(lineReduction(0.9)).toBeCloseTo(0.08); expect(lineReduction(0.5)).toBe(0.2);
  });

  it('draws a shrunk box at its scale without changing the stored sizes', () => {
    const el = box({ autoFit: 'shrink', fontScale: 0.5, lineHeight: 1.25, letterSpacing: 4, paragraphs: [{ text: 'a', fontSize: 80, runs: [{ text: 'a', fontSize: 100 }] }] });
    const d = drawnText(el);
    expect([d.fontSize, d.letterSpacing, d.lineHeight]).toEqual([32, 2, 1]);
    expect(d.paragraphs![0].fontSize).toBe(40); expect(d.paragraphs![0].runs![0].fontSize).toBe(50);
    expect(el.fontSize).toBe(64);
    expect(drawnText(box({ autoFit: 'resize', fontScale: 0.5 }))).toEqual(box({ autoFit: 'resize', fontScale: 0.5 }));
    expect(scaledText(el, 1)).toBe(el);
  });

  it('a click makes a box that grows sideways without wrapping; a drag one of that width that wraps', () => {
    const click = newTextBox('a', { x: 300, y: 400 });
    expect(click).toMatchObject({ x: 300, y: 400, text: '', autoFit: 'resize', wrap: false, align: 'left', vAlign: 'top' });
    const drag = newTextBox('b', { x: 10, y: 20 }, { w: 500, h: 30 });
    expect(drag).toMatchObject({ x: 10, y: 20, w: 500, autoFit: 'resize', text: '' });
    expect(drag.wrap).toBeUndefined();
  });

  it('sizing with the handles keeps the autofit mode and turns wrapping on with a new width; fonts never scale', () => {
    const nb = { x: 100, y: 200, w: 600, h: 300 };
    expect(resizedTextBox(box({ autoFit: 'resize', wrap: false }), nb)).toEqual({ ...nb, wrap: undefined });
    expect(resizedTextBox(box({ autoFit: 'shrink' }), nb)).toEqual(nb);
    expect(resizedTextBox(box({ autoFit: 'resize', wrap: false }), { ...nb, w: 400, h: 500 })).toEqual({ ...nb, w: 400, h: 500 });
    expect(resizedTextBox(box(), nb)).toEqual({ ...nb, autoFit: false });
    expect('fontSize' in resizedTextBox(box({ autoFit: 'resize' }), nb)).toBe(false);
  });

  it('a new font size keeps PowerPoint’s autofit (only LightCast’s own fit stops)', () => {
    expect(patchElement(box({ autoFit: 'resize' }), { fontSize: 96 }).autoFit).toBe('resize');
    expect(patchElement(box({ autoFit: 'shrink' }), { fontSize: 96 }).autoFit).toBe('shrink');
    expect(patchElement(box({ autoFit: true }), { fontSize: 96 }).autoFit).toBe(false);
  });
});
