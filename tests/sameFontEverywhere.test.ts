// The same font on every computer: Bold / plain drawn at PowerPoint's 700 / 400, Korean fallbacks in the same order,
// and a presentation's installed fonts copied (licence permitting) so the church cloud gives them to other computers.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drawnFamily, officeNames } from '../src/domain/fonts';
import { BOLD_WEIGHT, REGULAR_WEIGHT } from '../src/domain/fontWeight';
import { elementTextStyle } from '../src/domain/textBoxLayout';
import { EVERYWHERE, faceStyleOf, familiesToShare, pickFaces, resetSharedFonts, shareInstalledFonts, type LocalFont } from '../src/domain/installedFonts';

const kept: { family: string; source: string }[] = [];
vi.mock('../src/domain/importedFonts', () => ({
  importedFamilies: () => ['Already Here'],
  keepParsedFonts: async (parsed: { face: { family: string } }[], source: string) => {
    const added = parsed.map((p, i) => ({ id: `f${i}`, family: p.face.family, source }));
    kept.push(...added);
    return { added, skipped: [], notes: [] };
  },
  updateImportedFont: async () => undefined,
}));
vi.mock('../src/domain/fontFile', () => ({
  embeddingForbidden: (fsType: number) => (fsType & 0x0302) !== 0,
  // The test "file" is its fsType and weight as text.
  parseFontFile: async (bytes: Uint8Array) => {
    const [fsType, weight] = new TextDecoder().decode(bytes).split(',').map(Number);
    return { faces: [{ family: 'Parsed', subfamily: 'Regular', weight, italic: false, fsType, format: 'ttf', data: bytes }] };
  },
}));

const local = (family: string, style: string, fsType = 8, weight = 400): LocalFont => ({ family, style, blob: async () => new Blob([`${fsType},${weight}`]) });

describe('weights and fallbacks', () => {
  it('Bold is 700 and plain text 400 wherever LightCast draws text', () => {
    expect([BOLD_WEIGHT, REGULAR_WEIGHT]).toEqual([700, 400]);
    expect(elementTextStyle({ id: 'a', kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'x', bold: true }).fontWeight).toBe(700);
    expect(elementTextStyle({ id: 'b', kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'x' }).fontWeight).toBe(400);
  });

  it('a stack falls back to Malgun Gothic before Apple SD Gothic Neo; the stored stack is untouched', () => {
    const stored = 'Inter, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", Helvetica, Arial, sans-serif';
    expect(drawnFamily(stored)).toBe('Inter, "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", Helvetica, Arial, sans-serif');
    expect(drawnFamily('"맑은 고딕", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif')).toBe('"맑은 고딕", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif');
    expect(drawnFamily('Georgia, serif')).toBe('Georgia, serif');
    expect(drawnFamily(undefined)).toBeUndefined();
  });

  it('names one typeface by its Korean and English names, never by a stand-in', () => {
    expect(officeNames('맑은 고딕')).toEqual(['맑은 고딕', 'Malgun Gothic']);
    expect(officeNames('Calibri')).toEqual(['Calibri']);
  });
});

describe('sharing a presentation\'s installed fonts', () => {
  beforeEach(() => { kept.length = 0; resetSharedFonts(); });

  it('picks the regular, bold and italic faces under any of the font\'s names', () => {
    const faces = pickFaces([local('Malgun Gothic', 'Regular'), local('Malgun Gothic', 'Bold'), local('Malgun Gothic', 'Semilight'), local('Batang', 'Regular')], '맑은 고딕');
    expect(faces.map((f) => f.style)).toEqual(['regular', 'bold']);
    expect(faceStyleOf('Bold Italic')).toBe('boldItalic');
  });

  it('copies them under the name the presentation uses, leaving out fonts every computer has and fonts that may not be embedded', async () => {
    const locals = [local('Malgun Gothic', 'Regular'), local('Malgun Gothic', 'Bold', 8, 700), local('Church Font', 'Regular', 0x0002), local('Calibri', 'Regular', 0)];
    const added = await shareInstalledFonts(familiesToShare(['맑은 고딕', 'Church Font', 'Arial', 'Already Here', 'Calibri']), '주일예배', async () => locals);
    // 맑은 고딕 and Malgun Gothic are one typeface, copied once under its English name.
    expect(added.map((f) => f.family)).toEqual(['Malgun Gothic', 'Malgun Gothic', 'Calibri']);
    expect(kept.every((f) => f.source === '주일예배')).toBe(true);
    expect(EVERYWHERE.test('Arial') && EVERYWHERE.test('나눔고딕')).toBe(true);
    // Each family is looked at once per window.
    expect(await shareInstalledFonts(['맑은 고딕'], '주일예배', async () => locals)).toEqual([]);
  });

  it('does nothing without access to the computer\'s fonts', async () => {
    expect(await shareInstalledFonts(['맑은 고딕'], 'x', async () => { throw new Error('denied'); })).toEqual([]);
  });
});
