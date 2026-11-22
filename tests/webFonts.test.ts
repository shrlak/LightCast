import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain ESM server module
import { findFont, fontFile, googleCssUrl, matchFont, nameKey, parseFontName, parseGoogleCss, pickFaces } from '../server/fontFinder.mjs';
import { asDeckFace, webFontSummary, isWebSource } from '../src/domain/webFonts';
import { wantsSync, DEFAULT_FONT_SYNC } from '../src/domain/fontSync';
import { NEVER_MISSING } from '../src/domain/importedFonts';
import type { ParsedFont } from '../src/domain/fontFile';
import type { ImportedFont } from '../src/domain/importedFonts';

const CATALOG = [
  { id: 'nanum-myeongjo', family: 'Nanum Myeongjo', subsets: ['korean', 'latin'], weights: [400, 700, 800], styles: ['normal'], defSubset: 'latin', license: 'OFL-1.1', type: 'google', category: 'serif' },
  { id: 'noto-sans-kr', family: 'Noto Sans KR', subsets: ['korean', 'latin'], weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ['normal'], defSubset: 'latin', license: 'OFL-1.1', type: 'google' },
  { id: 'jua', family: 'Jua', subsets: ['korean', 'latin'], weights: [400], styles: ['normal'], defSubset: 'latin', license: 'OFL-1.1', type: 'google' },
  { id: 'roboto', family: 'Roboto', subsets: ['latin'], weights: [100, 300, 400, 500, 700, 900], styles: ['normal', 'italic'], defSubset: 'latin', license: 'OFL-1.1', type: 'google' },
  { id: 'firago', family: 'FiraGO', subsets: ['latin'], weights: [400, 700], styles: ['normal'], defSubset: 'latin', license: 'OFL-1.1', type: 'other' },
];

describe('font names', () => {
  it('keys ignore case, spaces, dashes and quotes', () => {
    expect(nameKey('"Nanum Myeongjo"')).toBe('nanummyeongjo');
    expect(nameKey('Noto_Sans-KR')).toBe('notosanskr');
  });
  it('reads the weight and italic a name ends with', () => {
    expect(parseFontName('Noto Sans KR Bold')).toEqual({ key: 'notosanskr', weight: 700, italic: false });
    expect(parseFontName('NotoSansKR-ExtraBold')).toEqual({ key: 'notosanskr', weight: 800, italic: false });
    expect(parseFontName('Roboto Light Italic')).toEqual({ key: 'roboto', weight: 300, italic: true });
    expect(parseFontName('NanumMyeongjoOTF')).toEqual({ key: 'nanummyeongjo', weight: null, italic: false });
  });
});

describe('matchFont', () => {
  const fam = (n: string) => matchFont(n, CATALOG)?.entry.family ?? null;
  it('finds a family by its own name, spelled any way', () => {
    expect(fam('Nanum Myeongjo')).toBe('Nanum Myeongjo');
    expect(fam('NanumMyeongjo')).toBe('Nanum Myeongjo');
    expect(fam('nanum-myeongjo')).toBe('Nanum Myeongjo');
  });
  it('finds Korean names and other names of the same family', () => {
    expect(fam('나눔명조')).toBe('Nanum Myeongjo');
    expect(fam('나눔명조 ExtraBold')).toBe('Nanum Myeongjo');
    expect(fam('본고딕')).toBe('Noto Sans KR');
    expect(fam('Source Han Sans KR')).toBe('Noto Sans KR');
    expect(fam('배달의민족 주아')).toBe('Jua');
    expect(fam('BM JUA')).toBe('Jua');
  });
  it('knows Pretendard although the catalogue has only its Latin files', () => {
    const m = matchFont('Pretendard', CATALOG);
    expect(m?.entry.type).toBe('extra');
    expect(matchFont('프리텐다드', CATALOG)?.entry.family).toBe('Pretendard');
  });
  it('keeps the weight a deck name asks for', () => {
    const m = matchFont('Noto Sans KR Light', CATALOG);
    expect(m?.entry.family).toBe('Noto Sans KR');
    expect(m?.weight).toBe(300);
  });
  it('does not invent a match for a font that is not free', () => {
    expect(fam('Calibri')).toBeNull();
    expect(fam('HY견고딕')).toBeNull();
    expect(fam('Times New Roman')).toBeNull();
  });
});

describe('pickFaces', () => {
  it('takes regular and bold, with italics when the family has them', () => {
    expect(pickFaces(CATALOG[3])).toEqual([{ weight: 400, italic: false }, { weight: 400, italic: true }, { weight: 700, italic: false }, { weight: 700, italic: true }]);
    expect(pickFaces(CATALOG[0])).toEqual([{ weight: 400, italic: false }, { weight: 700, italic: false }]);
  });
  it('takes the one weight a single-weight family has once', () => {
    expect(pickFaces(CATALOG[2])).toEqual([{ weight: 400, italic: false }]);
  });
  it('takes the nearest weight to the one the name asks for', () => {
    expect(pickFaces(CATALOG[0], { weight: 900 })).toEqual([{ weight: 800, italic: false }]);
    expect(pickFaces(CATALOG[3], { weight: 300, italic: true })).toEqual([{ weight: 300, italic: false }, { weight: 300, italic: true }]);
  });
});

describe('Google Fonts CSS', () => {
  it('builds the API address with sorted tuples', () => {
    expect(googleCssUrl('Nanum Myeongjo', [{ weight: 700, italic: false }, { weight: 400, italic: false }])).toBe('https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700');
    expect(googleCssUrl('Roboto', [{ weight: 700, italic: true }, { weight: 400, italic: false }])).toBe('https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,400;1,700');
  });
  it('reads weight, style and file of each rule', () => {
    const css = `@font-face {\n  font-family: 'Roboto';\n  font-style: italic;\n  font-weight: 400;\n  src: url(https://fonts.gstatic.com/s/roboto/a.ttf) format('truetype');\n}\n@font-face {\n  font-family: 'Roboto';\n  font-style: normal;\n  font-weight: 700;\n  src: url(https://fonts.gstatic.com/s/roboto/b.ttf) format('truetype');\n}`;
    expect(parseGoogleCss(css)).toEqual([
      { weight: 400, italic: true, url: 'https://fonts.gstatic.com/s/roboto/a.ttf' },
      { weight: 700, italic: false, url: 'https://fonts.gstatic.com/s/roboto/b.ttf' },
    ]);
  });
});

describe('find and download (network stubbed)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('finds a deck font and downloads the file from Google Fonts only', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url);
      if (url.startsWith('https://api.fontsource.org/')) return new Response(JSON.stringify(CATALOG));
      if (url.startsWith('https://fonts.googleapis.com/css2')) return new Response(`@font-face { font-style: normal; font-weight: 700; src: url(https://fonts.gstatic.com/s/nm/b.ttf) format('truetype'); }`);
      if (url === 'https://fonts.gstatic.com/s/nm/b.ttf') return new Response(new Uint8Array([0, 1, 0, 0, 9, 9]));
      return new Response('', { status: 404 });
    }));
    const found = await findFont('나눔명조');
    expect(found.match).toMatchObject({ family: 'Nanum Myeongjo', source: 'Google Fonts', license: 'OFL-1.1' });
    const file = await fontFile('나눔명조', 700, false);
    expect(file.family).toBe('Nanum Myeongjo');
    expect([...file.bytes]).toEqual([0, 1, 0, 0, 9, 9]);
    expect(seen).toContain('https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@700');
    const none = await findFont('HY견고딕');
    expect(none.match).toBeNull();
    expect(none.reason).toMatch(/상용/);
  });
});

describe('the app side', () => {
  const face = { family: 'Nanum Myeongjo', subfamily: 'Bold', fullName: 'Nanum Myeongjo Bold', weight: 700, italic: false, fsType: 0, format: 'truetype', nameFromFile: false, data: new Uint8Array() } as ParsedFont;
  it('keeps a downloaded face under the name the deck uses', () => {
    expect(asDeckFace(face, '나눔명조').family).toBe('나눔명조');
    expect(asDeckFace(face, 'Nanum Myeongjo')).toBe(face);
  });
  it('syncs downloaded fonts to the church server like imported ones', () => {
    const f = { family: 'X', source: 'web:Google Fonts' } as ImportedFont;
    expect(isWebSource(f.source)).toBe(true);
    expect(wantsSync(f, DEFAULT_FONT_SYNC, new Set())).toBe(true);
    expect(wantsSync({ ...f, sync: false }, DEFAULT_FONT_SYNC, new Set())).toBe(false);
  });
  it('treats 나눔명조 as missing when the computer lacks it (it is not bundled)', () => {
    expect(NEVER_MISSING.test('Nanum Myeongjo')).toBe(false);
    expect(NEVER_MISSING.test('Nanum Gothic')).toBe(true);
  });
  it('summarises what was found and what was not', () => {
    const s = webFontSummary([
      { name: '나눔명조', family: 'Nanum Myeongjo', source: 'Google Fonts', added: [{} as ImportedFont] },
      { name: 'HY견고딕', added: [], reason: '없음' },
    ]);
    expect(s).toContain('나눔명조(Nanum Myeongjo)');
    expect(s).toContain('Google Fonts');
    expect(s).toContain('찾지 못함: HY견고딕(없음)');
  });
});
