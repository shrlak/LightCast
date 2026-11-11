// Design › Themes › Browse for Themes: the colour and font schemes of a PowerPoint theme, read from
// a .thmx / .pptx / .potx file (its theme part, DrawingML <a:clrScheme> and <a:fontScheme>).
import JSZip from 'jszip';

export interface ThemeFile { name: string; colors: string[]; major?: string; minor?: string; majorEa?: string; minorEa?: string }

const SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

/** The schemes in a theme part's XML (null when it has no complete colour scheme). */
export function parseThemeXml(xml: string): ThemeFile | null {
  const scheme = /<a:clrScheme\b[^>]*?(?:name="([^"]*)")?[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(xml);
  if (!scheme) return null;
  const colors: string[] = [];
  for (const slot of SLOTS) {
    const m = new RegExp(`<a:${slot}>([\\s\\S]*?)</a:${slot}>`).exec(scheme[2]);
    const c = m && (/srgbClr val="([0-9A-Fa-f]{6})"/.exec(m[1])?.[1] ?? /lastClr="([0-9A-Fa-f]{6})"/.exec(m[1])?.[1] ?? (/sysClr val="window"/.test(m[1]) ? 'FFFFFF' : /sysClr val="windowText"/.test(m[1]) ? '000000' : null));
    if (!c) return null;
    colors.push(`#${c.toLowerCase()}`);
  }
  const font = (part: 'majorFont' | 'minorFont', script: 'latin' | 'ea') => {
    const block = new RegExp(`<a:${part}>([\\s\\S]*?)</a:${part}>`).exec(xml)?.[1] ?? '';
    return new RegExp(`<a:${script} typeface="([^"]*)"`).exec(block)?.[1] || undefined;
  };
  const name = /<a:theme\b[^>]*name="([^"]*)"/.exec(xml)?.[1] || scheme[1] || '테마';
  return { name, colors, major: font('majorFont', 'latin'), minor: font('minorFont', 'latin'), majorEa: font('majorFont', 'ea'), minorEa: font('minorFont', 'ea') };
}

/** The scheme name the engine reads (`custom:<name>|<12 colours>`). */
export const customSchemeName = (t: ThemeFile) => `custom:${t.name.replace(/[|,]/g, ' ')}|${t.colors.join(',')}`;

/** Read a theme file: a .thmx or any Office file with a theme part. */
export async function readThemeFile(file: Blob): Promise<ThemeFile | null> {
  const zip = await JSZip.loadAsync(file);
  const part = Object.keys(zip.files).filter((n) => /(^|\/)theme\/theme\d*\.xml$/.test(n)).sort()[0];
  if (!part) return null;
  return parseThemeXml(await zip.file(part)!.async('string'));
}
