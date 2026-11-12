// Picture export draws a slide through an SVG image, which cannot load the page's web fonts; the faces a
// slide uses are embedded in it instead. Fontsource splits Korean fonts into ~100 unicode-range slices, so
// only the slices that contain a character of the slide are embedded.

/** Does a CSS `unicode-range` value ("U+0000-00FF, U+4??, U+AC00") contain any character of `text`? An empty range covers everything. */
export function unicodeRangeCovers(range: string, text: string): boolean {
  const parts = range.split(',').map((x) => x.trim().replace(/^u\+/i, '')).filter(Boolean);
  if (!parts.length) return true;
  const spans = parts.map((x): [number, number] => {
    if (x.includes('?')) return [parseInt(x.replace(/\?/g, '0'), 16), parseInt(x.replace(/\?/g, 'F'), 16)];
    const [a, b] = x.split('-');
    const lo = parseInt(a, 16);
    return [lo, b ? parseInt(b, 16) : lo];
  });
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (spans.some(([lo, hi]) => c >= lo && c <= hi)) return true;
  }
  return false;
}

/** The families named in computed `font-family` values ("Nanum Gothic", sans-serif → nanum gothic, sans-serif). */
export function familiesOf(values: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const v of values) for (const f of v.split(',')) out.add(f.trim().replace(/^["']|["']$/g, '').toLowerCase());
  return out;
}
