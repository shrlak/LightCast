import { describe, expect, it } from 'vitest';
import { availableWeights, boldPatch, cssWeight, isBoldWeight, nearestAvailable, nearestWeight, pptxFontFor, weightLabel, weightOf, weightPatch, weightRange } from '../src/domain/fontWeight';
import { runStyle } from '../src/ui/runStyle';

describe('weightOf', () => {
  it('Bold is 700, nothing is 400, a weight wins', () => {
    expect(weightOf({})).toBe(400);
    expect(weightOf({ bold: true })).toBe(700);
    expect(weightOf({ bold: false, weight: 300 })).toBe(300);
    expect(weightOf({ weight: 640 })).toBe(600);
    expect(weightOf({}, { bold: true })).toBe(700);
    expect(weightOf({ bold: false }, { bold: true })).toBe(400);
    expect(weightOf({}, { weight: 900 })).toBe(900);
  });
  it('snaps to steps of 100', () => {
    expect(nearestWeight(0)).toBe(100);
    expect(nearestWeight(1200)).toBe(900);
    expect(nearestWeight(NaN)).toBe(400);
  });
  it('css weight only when there is one', () => {
    expect(cssWeight({ bold: true })).toBeUndefined();
    expect(cssWeight({ weight: 300 })).toBe(300);
  });
});

describe('weightPatch', () => {
  it('Regular and Bold stay the plain toggle', () => {
    expect(weightPatch(400)).toEqual({ weight: undefined, bold: false });
    expect(weightPatch(700)).toEqual({ weight: undefined, bold: true });
  });
  it('others keep the weight and the nearest bold flag', () => {
    expect(weightPatch(300)).toEqual({ weight: 300, bold: false });
    expect(weightPatch(500)).toEqual({ weight: 500, bold: false });
    expect(weightPatch(600)).toEqual({ weight: 600, bold: true });
    expect(weightPatch(900)).toEqual({ weight: 900, bold: true });
  });
  it('the Bold button replaces a chosen weight', () => {
    expect(boldPatch(true)).toEqual({ weight: undefined, bold: true });
    expect(boldPatch(false)).toEqual({ weight: undefined, bold: false });
    expect(isBoldWeight({ weight: 300 })).toBe(false);
    expect(isBoldWeight({ weight: 800 })).toBe(true);
    expect(isBoldWeight({ bold: true })).toBe(true);
  });
});

describe('availableWeights', () => {
  it('uses the faces the page declares', () => {
    const declared = [{ family: 'Nanum Gothic', weight: '400' }, { family: 'Nanum Gothic', weight: '700' }, { family: 'Nanum Gothic', weight: '800' }, { family: 'Arimo', weight: '400' }];
    expect(availableWeights('"Nanum Gothic", NanumGothic, sans-serif', declared)).toEqual([400, 700, 800]);
    expect(availableWeights('Arimo', declared)).toEqual([400]);
  });
  it('a variable face covers its range', () => {
    expect(weightRange('100 900')).toHaveLength(9);
    expect(availableWeights('Pretendard', [{ family: 'Pretendard', weight: '100 900' }])).toHaveLength(9);
  });
  it('knows Korean families by name, else Regular and Bold', () => {
    expect(availableWeights('"Noto Sans KR", sans-serif')).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(availableWeights('"Spoqa Han Sans Neo"')).toEqual([100, 300, 400, 500, 700]);
    expect(availableWeights('"Some Unknown Font"')).toEqual([400, 700]);
  });
  it('keeps the weight the text already has', () => {
    expect(availableWeights('"Some Unknown Font"', [], 300)).toEqual([300, 400, 700]);
  });
  it('snaps to the nearest weight the family has', () => {
    expect(nearestAvailable(300, [400, 700, 800])).toBe(400);
    expect(nearestAvailable(600, [400, 700])).toBe(700);
    expect(nearestAvailable(520, [400, 700])).toBe(400);
  });
  it('labels in Korean with the English name', () => {
    expect(weightLabel(300)).toBe('가늘게 (Light)');
    expect(weightLabel(900)).toBe('가장 굵게 (Black)');
  });
});

describe('PowerPoint family names', () => {
  it('Regular and Bold are the plain family', () => {
    expect(pptxFontFor('Noto Sans KR', {})).toEqual({ face: 'Noto Sans KR', bold: false });
    expect(pptxFontFor('Noto Sans KR', { bold: true })).toEqual({ face: 'Noto Sans KR', bold: true });
    expect(pptxFontFor('Noto Sans KR', { weight: 700 })).toEqual({ face: 'Noto Sans KR', bold: true });
  });
  it('other weights get the suffix and the nearest bold / regular', () => {
    expect(pptxFontFor('Noto Sans KR', { weight: 300 })).toEqual({ face: 'Noto Sans KR Light', bold: false });
    expect(pptxFontFor('Noto Sans KR', { weight: 500 })).toEqual({ face: 'Noto Sans KR Medium', bold: false });
    expect(pptxFontFor('Noto Sans KR', { weight: 600 })).toEqual({ face: 'Noto Sans KR SemiBold', bold: true });
    expect(pptxFontFor('Noto Sans KR', { weight: 800 })).toEqual({ face: 'Noto Sans KR ExtraBold', bold: true });
    expect(pptxFontFor('Noto Sans KR', { weight: 900 })).toEqual({ face: 'Noto Sans KR Black', bold: true });
  });
  it('a run inherits its box weight unless it says its own', () => {
    expect(pptxFontFor('Pretendard', {}, { weight: 300 })).toEqual({ face: 'Pretendard Light', bold: false });
    expect(pptxFontFor('Pretendard', { bold: true }, { weight: 300 })).toEqual({ face: 'Pretendard', bold: true });
  });
  it('does not name a weight twice', () => {
    expect(pptxFontFor('Calibri Light', { weight: 300 })).toEqual({ face: 'Calibri Light', bold: false });
    expect(pptxFontFor('Arial Black', { weight: 900 })).toEqual({ face: 'Arial Black', bold: true });
  });
});

describe('runStyle', () => {
  it('draws a run with CSS font-weight 100-900', () => {
    expect(runStyle({ text: 'a', weight: 300 }).fontWeight).toBe(300);
    expect(runStyle({ text: 'a', weight: 900, bold: true }).fontWeight).toBe(900);
    expect(runStyle({ text: 'a', bold: true }).fontWeight).toBe(800);
    expect(runStyle({ text: 'a', bold: false }).fontWeight).toBe(400);
    expect(runStyle({ text: 'a' }).fontWeight).toBeUndefined();
  });
});
