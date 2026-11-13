import { describe, expect, it } from 'vitest';
import { embedStyleOf, faceDescriptors, familyWeights, groupFamilies, mergeFont, trimToBudget, isFontFileName, type ImportedFont } from '../src/domain/importedFonts';
import { availableWeights, pptxFontForTheme, splitWeightedFace } from '../src/domain/fontWeight';
import { saveNative, openNative } from '../src/domain/io/lcastFile';
import { parseEotHeader, skipReason } from '../src/domain/io/pptxFonts';
import { exportFontNotice, skippedFontsNotice } from '../src/domain/embeddedFonts';

const f = (over: Partial<ImportedFont>): ImportedFont => ({ id: 'impfont:' + Math.random(), family: 'Fam', subfamily: '', weight: 400, italic: false, format: 'truetype', bytes: 100, fsType: 0, source: 'user', at: 1, ...over });

describe('imported font registry logic', () => {
  it('builds the FontFace descriptors with the right weight and style', () => {
    expect(faceDescriptors(f({ weight: 300 }))).toEqual({ weight: '300', style: 'normal' });
    expect(faceDescriptors(f({ weight: 700, italic: true }))).toEqual({ weight: '700', style: 'italic' });
    expect(faceDescriptors(f({ weightRange: [100, 900] }))).toEqual({ weight: '100 900', style: 'normal' });
  });
  it('groups weights under one family and lists them', () => {
    const list = [f({ family: 'Noto', weight: 700 }), f({ family: 'noto', weight: 300 }), f({ family: 'Alpha', weight: 400 })];
    expect(familyWeights(list, 'NOTO')).toEqual([300, 700]);
    const g = groupFamilies(list);
    expect(g.map((x) => x.family)).toEqual(['Alpha', 'Noto']);
    expect(g[1].weights).toEqual([300, 700]);
    expect(familyWeights([f({ family: 'V', weightRange: [200, 500] })], 'V')).toEqual([200, 300, 400, 500]);
  });
  it('feeds fontWeight.availableWeights through the declared faces', () => {
    const declared = [{ family: '"Fam"', weight: '300' }, { family: 'Fam', weight: '700' }];
    expect(availableWeights('"Fam", sans-serif', declared)).toEqual([300, 700]);
    expect(availableWeights('"Fam", sans-serif', [{ family: 'Fam', weight: '100 900' }])).toHaveLength(9);
  });
  it('replaces the same family / weight / style and keeps the rest', () => {
    const a = f({ family: 'X', weight: 400 }), b = f({ family: 'x', weight: 700 });
    const m = mergeFont([a, b], f({ family: 'X', weight: 400 }));
    expect(m.replaced).toBe(a);
    expect(m.list).toHaveLength(2);
  });
  it('trims the oldest fonts to the byte budget but keeps the newest', () => {
    const list = [f({ at: 1, bytes: 60 }), f({ at: 2, bytes: 60 }), f({ at: 3, bytes: 60 })];
    const { keep, drop } = trimToBudget(list, 100);
    expect(drop.map((x) => x.at)).toEqual([1, 2]);
    expect(keep.map((x) => x.at)).toEqual([3]);
  });
  it('maps faces to PPTX embed slots and recognises font files', () => {
    expect(embedStyleOf({ weight: 400, italic: false })).toBe('regular');
    expect(embedStyleOf({ weight: 700, italic: true })).toBe('boldItalic');
    expect(embedStyleOf({ weight: 300, italic: false })).toBeNull();
    expect(['a.TTF', 'b.woff2', 'c.ttc', 'd.otf', 'e.woff'].every(isFontFileName)).toBe(true);
    expect(isFontFileName('x.pdf')).toBe(false);
  });
});

describe('weight mapping for PowerPoint', () => {
  it('keeps default theme weights exporting as before', () => {
    expect(pptxFontForTheme('Malgun Gothic', 400)).toEqual({ face: 'Malgun Gothic', bold: false });
    expect(pptxFontForTheme('Malgun Gothic', 600)).toEqual({ face: 'Malgun Gothic', bold: false });
    expect(pptxFontForTheme('Malgun Gothic', 800)).toEqual({ face: 'Malgun Gothic', bold: true });
    expect(pptxFontForTheme('Unknown Font', 300)).toEqual({ face: 'Unknown Font', bold: false });
    expect(pptxFontForTheme('Arial', 700).bold).toBe(true);
  });
  it('names the weight on families that have it', () => {
    expect(pptxFontForTheme('Noto Sans KR', 300)).toEqual({ face: 'Noto Sans KR Light', bold: false });
    expect(pptxFontForTheme('Noto Sans KR', 600)).toEqual({ face: 'Noto Sans KR SemiBold', bold: true });
    expect(pptxFontForTheme('Pretendard', 900)).toEqual({ face: 'Pretendard Black', bold: true });
  });
  it('reads the weight back from a family suffix', () => {
    expect(splitWeightedFace('Noto Sans KR Light')).toEqual({ family: 'Noto Sans KR', weight: 300 });
    expect(splitWeightedFace('Pretendard SemiBold')).toEqual({ family: 'Pretendard', weight: 600 });
    expect(splitWeightedFace('Noto Sans KR')).toEqual({ family: 'Noto Sans KR' });
    expect(splitWeightedFace('Arial Black')).toEqual({ family: 'Arial Black' });
    expect(splitWeightedFace('Some Unknown Light')).toEqual({ family: 'Some Unknown Light' });
  });
});

describe('.lcast carries fonts', () => {
  const pres = { id: 'p', title: 't', slides: [], folder: 'x' } as never;
  it('round-trips font files and survives a file without fonts', async () => {
    const bytes = Uint8Array.from([0, 1, 0, 0, 9, 9, 9, 9]);
    const file = await saveNative(pres, [], undefined, [{ family: 'Fam', subfamily: 'Light', weight: 300, italic: false, format: 'truetype', bytes }]);
    const back = await openNative(file);
    expect(back.fonts).toHaveLength(1);
    expect(back.fonts[0]).toMatchObject({ family: 'Fam', weight: 300, format: 'truetype' });
    expect(Array.from(back.fonts[0].bytes)).toEqual(Array.from(bytes));
    expect((await openNative(await saveNative(pres, []))).fonts).toEqual([]);
  });
  it('bounds the number of fonts', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ family: 'F' + i, subfamily: '', weight: 400, italic: false, format: 'truetype' as const, bytes: Uint8Array.from([1, 2, 3]) }));
    expect((await openNative(await saveNative(pres, [], undefined, many))).fonts).toHaveLength(24);
  });
});

describe('notices', () => {
  it('reads an EOT header and explains why MTX fonts are skipped', () => {
    const b = new Uint8Array(120);
    const v = new DataView(b.buffer);
    v.setUint16(34, 0x504c, true); v.setUint32(12, 0x4, true); v.setUint16(84, 8, true);
    'Test'.split('').forEach((c, i) => v.setUint16(86 + i * 2, c.charCodeAt(0), true));
    expect(parseEotHeader(b)).toMatchObject({ family: 'Test', compressed: true });
    expect(skipReason(b)).toMatch(/MTX/);
    expect(skipReason(new Uint8Array(10))).toMatch(/형식/);
  });
  it('lists skipped / missing fonts', () => {
    expect(skippedFontsNotice([])).toBeNull();
    expect(skippedFontsNotice([{ family: 'A', reason: 'x' }, { family: 'A', reason: 'x' }, { family: 'B', reason: 'y' }])).toMatch(/2개.*A\(x\), B\(y\)/);
    expect(exportFontNotice({ missingFonts: [], embedded: [] })).toBeNull();
    expect(exportFontNotice({ missingFonts: ['Z'], embedded: ['Q'] })).toMatch(/1개를 파일에 넣었습니다.*Z/);
  });
});
