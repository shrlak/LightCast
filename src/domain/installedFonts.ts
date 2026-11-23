// The same font on every computer. A presentation draws in the fonts its text names; a font installed on one computer
// (맑은 고딕 and Calibri on Windows, Apple SD Gothic Neo on a Mac, a church font someone installed) is missing on
// another, which then draws the text in a different font — other widths, other line breaks, other bold. So when a
// presentation is open on a computer that has its fonts installed, the regular / bold / italic faces are copied from
// the computer (Chromium's queryLocalFonts) into LightCast's own fonts under the name the presentation uses, and from
// there the church cloud gives them to every other computer, exactly as a font file someone imported. Fonts whose
// licence forbids embedding stay where they are. Nothing here throws.
import { embeddingForbidden, parseFontFile, type ParsedFont } from './fontFile';
import { importedFamilies, keepParsedFonts, updateImportedFont, type ImportedFont } from './importedFonts';
import { officeNames } from './fonts';
import { asDeckFace } from './webFonts';

const PREF_KEY = 'lightcast.fonts.shareInstalled';
/** Copy a presentation's installed fonts so every computer draws it alike (default on). */
export function loadShareInstalledFonts(): boolean {
  try { return localStorage.getItem(PREF_KEY) !== '0'; } catch { return true; }
}
export function saveShareInstalledFonts(on: boolean): void {
  try { localStorage.setItem(PREF_KEY, on ? '1' : '0'); } catch { /* this window only */ }
}

/** Families every computer has the same file for (bundled with LightCast, or the same on Windows and macOS), and generic names. */
export const EVERYWHERE = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui|inherit|inter|nanum gothic|나눔고딕|nanumgothic|carlito|arimo|arial|arial black|helvetica|georgia|times new roman|courier new|verdana|tahoma|trebuchet ms|impact)$/i;

/** One font of the computer, as queryLocalFonts gives it. */
export interface LocalFont { family: string; fullName?: string; postscriptName?: string; style: string; blob(): Promise<Blob> }

export type FaceStyle = 'regular' | 'bold' | 'italic' | 'boldItalic';
/** The four faces PowerPoint uses (Bold is 700, plain 400); other weights of a family are left alone. */
export function faceStyleOf(style: string): FaceStyle | null {
  const s = style.trim().toLowerCase();
  if (/^(regular|normal|book|roman|plain)$/.test(s)) return 'regular';
  if (/^bold$/.test(s)) return 'bold';
  if (/^(italic|oblique)$/.test(s)) return 'italic';
  if (/^bold (italic|oblique)$/.test(s)) return 'boldItalic';
  return null;
}

const low = (s: string) => s.trim().toLowerCase();
/** The name a shared font is kept under: the typeface's English name when it has one (맑은 고딕 → Malgun Gothic). */
export function storedName(family: string): string {
  const names = officeNames(family);
  return names.find((n) => /^[\x20-\x7e]+$/.test(n) && /\s/.test(n)) ?? names.find((n) => /^[\x20-\x7e]+$/.test(n)) ?? family.trim();
}

/** The computer's faces of `family` (any of its Office names: 맑은 고딕 = Malgun Gothic), one per PowerPoint style. */
export function pickFaces(locals: LocalFont[], family: string): { font: LocalFont; style: FaceStyle }[] {
  const names = new Set(officeNames(family).map(low));
  const out = new Map<FaceStyle, LocalFont>();
  for (const f of locals) {
    if (!names.has(low(f.family))) continue;
    const st = faceStyleOf(f.style);
    if (st && !out.has(st)) out.set(st, f);
  }
  return [...out].map(([style, font]) => ({ font, style }));
}

/** The faces of a font file (a .ttc holds several) that are the one queryLocalFonts named. */
function faceOf(faces: ParsedFont[], font: LocalFont, style: FaceStyle): ParsedFont | null {
  if (faces.length === 1) return faces[0];
  const bold = style === 'bold' || style === 'boldItalic', italic = style === 'italic' || style === 'boldItalic';
  return faces.find((f) => (f.weight >= 600) === bold && f.italic === italic && (!font.fullName || low(`${f.family} ${f.subfamily}`) === low(font.fullName) || low(f.family) === low(font.family)))
    ?? faces.find((f) => (f.weight >= 600) === bold && f.italic === italic) ?? null;
}

const tried = new Set<string>();

/**
 * Copy the installed fonts of `families` that LightCast does not have yet into its own fonts (and so to the church
 * cloud), named as the presentation names them. `source` is the presentation's name. Returns the fonts added.
 */
export async function shareInstalledFonts(families: string[], source: string, query?: () => Promise<LocalFont[]>): Promise<ImportedFont[]> {
  if (!loadShareInstalledFonts()) return [];
  const own = new Set(importedFamilies().map(low));
  // One typeface once, however many of its names the presentation uses (맑은 고딕 and Malgun Gothic), kept under its
  // English name: every stack that names it (the deck's own and LightCast's Korean fallback) lists that one.
  const todo: string[] = [];
  for (const f of families.map((x) => x.trim()).filter(Boolean)) {
    const names = officeNames(f);
    if (EVERYWHERE.test(f) || names.some((n) => own.has(low(n)) || tried.has(low(n)))) continue;
    names.forEach((n) => tried.add(low(n)));
    todo.push(storedName(f));
  }
  if (!todo.length) return [];
  let locals: LocalFont[] = [];
  try {
    const q = query ?? (typeof window !== 'undefined' ? (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts?.bind(window) : undefined);
    if (!q) return [];
    locals = await q();
  } catch { return []; /* no permission or not supported */ }
  const parsed: { face: ParsedFont; fileName: string }[] = [];
  for (const family of todo) {
    for (const { font, style } of pickFaces(locals, family)) {
      try {
        const data = new Uint8Array(await (await font.blob()).arrayBuffer());
        const r = await parseFontFile(data, `${font.postscriptName || font.family}.ttf`);
        const face = faceOf(r.faces, font, style);
        if (!face || embeddingForbidden(face.fsType)) continue;
        parsed.push({ face: asDeckFace(face, family), fileName: `${family} ${style}` });
      } catch { /* this face stays on this computer */ }
    }
  }
  if (!parsed.length) return [];
  const added = (await keepParsedFonts(parsed, source)).added;
  // They are copied to be on the other computers: synced whether or not a synced deck names them first.
  for (const f of added) await updateImportedFont(f.id, { sync: true }).catch(() => undefined);
  return added;
}

/**
 * LightCast's standard Korean face: the text of LightCast's own slides and any Korean text whose font is missing falls
 * back to it (fonts.ts), so it is shared like a font a presentation names.
 */
export const STANDARD_KOREAN = 'Malgun Gothic';
/** The families of an open presentation to share: the ones it names, and the standard Korean face. */
export const familiesToShare = (used: string[]): string[] => [...used, STANDARD_KOREAN];

/** Forget which families were looked at (tests). */
export const resetSharedFonts = (): void => tried.clear();
