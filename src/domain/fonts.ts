// Fonts offered in the editor. Korean text falls back to the system Korean font when a
// Latin-only font (Arial, Calibri) is chosen. 나눔고딕 ships with the app (SIL OFL); Calibri and
// Arial are used from the computer when installed, otherwise their metric-compatible free twins
// (Carlito, Arimo), which are bundled.
const KO = '"Apple SD Gothic Neo", "Malgun Gothic", "Nanum Gothic", sans-serif';

export interface FontOption {
  label: string;
  family: string;
  /** Font name written into exported PowerPoint files. */
  pptx: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { label: '나눔고딕', family: '"Nanum Gothic", NanumGothic, "나눔고딕", sans-serif', pptx: '나눔고딕' },
  { label: 'Arial', family: `Arial, Arimo, ${KO}`, pptx: 'Arial' },
  { label: 'Calibri', family: `Calibri, Carlito, ${KO}`, pptx: 'Calibri' },
  { label: 'Sans (기본)', family: 'Inter, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", Helvetica, Arial, sans-serif', pptx: 'Malgun Gothic' },
  { label: 'Serif (명조)', family: 'Georgia, "Nanum Myeongjo", "AppleMyungjo", "Times New Roman", serif', pptx: 'Batang' },
  { label: 'Heavy', family: '"Arial Black", Impact, Inter, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", Helvetica, Arial, sans-serif', pptx: 'Arial Black' },
  { label: 'Mono', family: '"Courier New", monospace', pptx: 'Courier New' },
];

/** PowerPoint font name for a CSS font-family stack. */
export function pptxFont(family: string): string {
  const known = FONT_OPTIONS.find((f) => f.family === family);
  if (known) return known.pptx;
  const first = family.split(',')[0].replace(/"/g, '').trim();
  return first === 'Nanum Gothic' ? '나눔고딕' : first;
}

const OFFICE_ALIAS: Record<string, string> = {
  '맑은 고딕': '"맑은 고딕", "Malgun Gothic"', 'Malgun Gothic': '"Malgun Gothic", "맑은 고딕"',
  '굴림': '"굴림", Gulim', '돋움': '"돋움", Dotum', '바탕': '"바탕", Batang', '궁서': '"궁서", Gungsuh',
  '나눔고딕': '"Nanum Gothic", NanumGothic, "나눔고딕"', '나눔명조': '"Nanum Myeongjo", "나눔명조"',
  Calibri: 'Calibri, Carlito', 'Calibri Light': '"Calibri Light", Calibri, Carlito', Arial: 'Arial, Arimo',
};

/**
 * A typeface named by PowerPoint / Word / a web page → the CSS font stack LightCast stores: one of the
 * editor's own fonts when it is one of them, else that face with the Korean fallbacks after it.
 */
export function officeFont(name: string): string {
  const face = name.replace(/^['"]|['"]$/g, '').trim();
  const known = FONT_OPTIONS.find((f) => f.pptx === face || f.label === face);
  if (known) return known.family;
  const head = OFFICE_ALIAS[face] ?? (/^[\w-]+$/.test(face) ? face : `"${face.replace(/"/g, '')}"`);
  const serif = /명조|바탕|Myeongjo|Batang|Times|Georgia|serif/i.test(face) && !/sans/i.test(face);
  return serif ? `${head}, "Nanum Myeongjo", AppleMyungjo, serif` : `${head}, ${KO}`;
}
