// Font weights 100–900 (CSS font-weight) beside Bold. A text's weight is `weight` when it has one;
// else Bold (`bold`) means 700 and nothing means Regular (400), so files and code from before weights
// keep working. Only the weights a family really has are offered, and a PowerPoint file gets the
// nearest bold / regular plus the weight's name on the family ("Noto Sans KR Light") — PowerPoint
// finds weights by family name, not by number.

export interface WeightInfo { weight: number; /** PowerPoint / CSS name, also the family-name suffix. */ en: string; ko: string }

export const WEIGHTS: WeightInfo[] = [
  { weight: 100, en: 'Thin', ko: '가장 가늘게' },
  { weight: 200, en: 'ExtraLight', ko: '아주 가늘게' },
  { weight: 300, en: 'Light', ko: '가늘게' },
  { weight: 400, en: 'Regular', ko: '보통' },
  { weight: 500, en: 'Medium', ko: '중간' },
  { weight: 600, en: 'SemiBold', ko: '약간 굵게' },
  { weight: 700, en: 'Bold', ko: '굵게' },
  { weight: 800, en: 'ExtraBold', ko: '아주 굵게' },
  { weight: 900, en: 'Black', ko: '가장 굵게' },
];

/** "가늘게 (Light)" as the picker and the 글꼴 dialog list it. */
export const weightLabel = (weight: number): string => {
  const w = WEIGHTS.find((x) => x.weight === nearestWeight(weight));
  return w ? `${w.ko} (${w.en})` : String(weight);
};

/** A weight snapped to 100 … 900 in steps of 100. */
export const nearestWeight = (w: number): number => Math.min(900, Math.max(100, Math.round((Number.isFinite(w) ? w : 400) / 100) * 100));

interface WeightSource { bold?: boolean; weight?: number }

/** The weight text with this formatting is drawn at: its own weight, else Bold → 700, else 400. */
export function weightOf(own: WeightSource, inherited?: WeightSource): number {
  if (own.weight !== undefined) return nearestWeight(own.weight);
  if (own.bold !== undefined) return own.bold ? 700 : 400;
  return inherited ? weightOf(inherited) : 400;
}

/** The CSS font-weight of a piece of text: its weight if it has one (else undefined, so the caller's own Bold look stays). */
export const cssWeight = (own: WeightSource): number | undefined => (own.weight === undefined ? undefined : nearestWeight(own.weight));

/**
 * What choosing `weight` stores. Regular and Bold stay the plain toggle (no `weight`, so such text is
 * exactly what it was before weights); the others store `weight`, with `bold` set for 600 and up so
 * code that only knows bold / regular (other exporters, older versions) sees the nearest of the two.
 */
export function weightPatch(weight: number): { weight: number | undefined; bold: boolean } {
  const w = nearestWeight(weight);
  if (w === 400) return { weight: undefined, bold: false };
  if (w === 700) return { weight: undefined, bold: true };
  return { weight: w, bold: w >= 600 };
}

/** The Bold button / Ctrl+B: Bold (700) on, or off (400); a chosen weight is replaced. */
export const boldPatch = (on: boolean): { weight: undefined; bold: boolean } => ({ weight: undefined, bold: on });

/** Is the text bold for the Bold button's highlight: 600 and up, or the Bold flag. */
export const isBoldWeight = (own: WeightSource): boolean => weightOf(own) >= 600;

/** Weights of families LightCast knows by name (the editor's fonts and the usual Korean / office families). */
const KNOWN: Record<string, number[]> = {
  'nanum gothic': [400, 700, 800], '나눔고딕': [400, 700, 800],
  'nanum myeongjo': [400, 700, 800], '나눔명조': [400, 700, 800],
  'nanumbarungothic': [300, 400, 700], '나눔바른고딕': [300, 400, 700],
  '나눔스퀘어': [300, 400, 700, 800],
  'noto sans kr': [100, 200, 300, 400, 500, 600, 700, 800, 900],
  'noto sans cjk kr': [100, 300, 400, 500, 700, 900],
  'noto serif kr': [200, 300, 400, 500, 600, 700, 900],
  pretendard: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  'spoqa han sans neo': [100, 300, 400, 500, 700],
  'ibm plex sans kr': [100, 200, 300, 400, 500, 600, 700],
  'gothic a1': [100, 200, 300, 400, 500, 600, 700, 800, 900],
  'black han sans': [400], 'do hyeon': [400], 'jua': [400],
  inter: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  roboto: [100, 300, 400, 500, 700, 900],
  'segoe ui': [300, 400, 600, 700, 900],
  'calibri': [300, 400, 700], 'calibri light': [300, 400, 700],
  'helvetica neue': [100, 200, 300, 400, 500, 700],
  'apple sd gothic neo': [100, 200, 300, 400, 500, 600, 700, 800, 900],
  'malgun gothic': [400, 700], '맑은 고딕': [400, 700],
  arial: [400, 700], arimo: [400, 700], carlito: [400, 700],
  'arial black': [900], impact: [400],
};

/** The first family named in a CSS font stack, lower-case and unquoted. */
export function firstFamily(stack: string | undefined): string {
  return (stack ?? '').split(',')[0].replace(/["']/g, '').trim();
}

/** One @font-face the page has: its family and CSS weight ("400", "100 900", "bold"). */
export interface DeclaredFace { family: string; weight: string }

/** A face's CSS weight as a list of the 100-steps it covers ("100 900" is a variable font: all nine). */
export function weightRange(css: string): number[] {
  const t = css.trim().toLowerCase();
  const named = t === 'normal' ? 400 : t === 'bold' ? 700 : undefined;
  if (named) return [named];
  const nums = t.split(/\s+/).map(Number).filter(Number.isFinite);
  if (!nums.length) return [400];
  const lo = nearestWeight(Math.min(...nums)), hi = nearestWeight(Math.max(...nums));
  const out: number[] = [];
  for (let w = lo; w <= hi; w += 100) out.push(w);
  return out;
}

/**
 * The weights the family `stack` offers. Faces the page loads itself (`declared`, from document.fonts:
 * the bundled 나눔고딕, Arimo, Carlito …) are exact; otherwise the table above for families LightCast
 * knows; any other family offers Regular and Bold only (a computer's font can't be asked which weights
 * it has). The weight the text already has is always included so it can be seen and changed.
 */
export function availableWeights(stack: string | undefined, declared: DeclaredFace[] = [], current?: number): number[] {
  const fam = firstFamily(stack).toLowerCase();
  const set = new Set<number>();
  const own = declared.filter((d) => firstFamily(d.family).toLowerCase() === fam);
  if (own.length) for (const d of own) for (const w of weightRange(d.weight)) set.add(w);
  else if (KNOWN[fam]) for (const w of KNOWN[fam]) set.add(w);
  else { set.add(400); set.add(700); }
  // A face with only Bold or only Black (a display font) still lets the text be Regular / Bold: those are what the buttons set.
  if (current !== undefined) set.add(nearestWeight(current));
  return [...set].sort((a, b) => a - b);
}

/** The nearest weight the family has (ties go to the bolder one, as CSS does for weights over 500). */
export function nearestAvailable(weight: number, available: number[]): number {
  if (!available.length) return nearestWeight(weight);
  return available.reduce((best, w) => {
    const d = Math.abs(w - weight), db = Math.abs(best - weight);
    return d < db || (d === db && w > best) ? w : best;
  });
}

/**
 * A text's font for PowerPoint, which picks weights by family name. Regular and Bold are the plain
 * family (bold off / on); every other weight becomes "Family Light", "Family SemiBold" … with bold on
 * for 600 and up — the nearest of bold / regular, as PowerPoint's own font list does it.
 */
export function pptxFontFor(face: string, own: WeightSource, inherited?: WeightSource): { face: string; bold: boolean } {
  const w = weightOf(own, inherited);
  if (w === 400 || w === 700) return { face, bold: w === 700 };
  const info = WEIGHTS.find((x) => x.weight === w)!;
  // A family that already names a weight ("Arial Black", "Calibri Light") is not named twice.
  if (new RegExp(`\\b(${WEIGHTS.map((x) => x.en).join('|')})$`, 'i').test(face)) return { face, bold: w >= 600 };
  return { face: `${face} ${info.en}`, bold: w >= 600 };
}

/**
 * A slide's theme text weight (100–900) for PowerPoint. Like pptxFontFor, but a weight the family is not
 * known to have keeps the old behaviour (bold from 700, never an invented "Family SemiBold"), so the
 * themes' default weights (500 / 600 / 800 on Malgun Gothic …) export exactly as before.
 */
export function pptxFontForTheme(face: string, weight: number): { face: string; bold: boolean } {
  const w = nearestWeight(weight);
  if (w === 400 || w === 700) return { face, bold: w === 700 };
  if (!availableWeights(face).includes(w)) return { face, bold: w >= 700 };
  return pptxFontFor(face, { weight: w });
}

/** The family and weight in a PowerPoint / ODP face name: "Noto Sans KR Light" → { family: "Noto Sans KR", weight: 300 }. A plain name gives no weight. */
export function splitWeightedFace(name: string): { family: string; weight?: number } {
  const t = name.trim();
  const names = [...WEIGHTS.map((w) => w.en), 'Extra Light', 'Extra Bold', 'Semi Bold', 'Demi Bold', 'DemiBold', 'UltraLight', 'Ultra Light', 'Heavy', 'Book'];
  const m = new RegExp(`^(.+?)[ -](${names.join('|')})$`, 'i').exec(t);
  if (!m) return { family: t };
  const key = m[2].toLowerCase().replace(/[ -]/g, '');
  const map: Record<string, number> = { thin: 100, extralight: 200, ultralight: 200, light: 300, medium: 500, semibold: 600, demibold: 600, extrabold: 800, black: 900, heavy: 900, bold: 700 };
  const weight = map[key];
  // "Arial Black" / "Calibri Light" are families of their own that PowerPoint knows by that name; only names of families with a known weight set split.
  if (weight === undefined || KNOWN[t.toLowerCase()]) return { family: t };
  const fam = m[1].trim();
  return KNOWN[fam.toLowerCase()] ? { family: fam, weight } : { family: t };
}
