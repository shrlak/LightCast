// The font list of Home › Font (DeckCraft's font menu: the theme fonts, then every family).
import { FONT_OPTIONS, officeFont } from './fonts';

export interface FontEntry { label: string; family: string }

/** The name a CSS font stack is shown by: an editor font's label, else its first face. */
export function fontLabel(family: string): string {
  return FONT_OPTIONS.find((o) => o.family === family)?.label ?? family.split(',')[0].replace(/["']/g, '').trim();
}

/** LightCast's own fonts, then the installed ones (by name, without repeats), each as a CSS stack. */
export function fontEntries(installed: string[]): FontEntry[] {
  const out: FontEntry[] = FONT_OPTIONS.map((o) => ({ label: o.label, family: o.family }));
  const seen = new Set(out.flatMap((o) => [o.label.toLowerCase(), fontLabel(o.family).toLowerCase(), FONT_OPTIONS.find((f) => f.label === o.label)!.pptx.toLowerCase()]));
  const rest = [...installed].sort((a, b) => a.localeCompare(b, 'ko'));
  for (const name of rest) {
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ label: name, family: officeFont(name) });
  }
  return out;
}
