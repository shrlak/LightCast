import type { TextRun } from '../domain/types';
import { drawnFamily, scriptPieces } from '../domain/fonts';
import { runStyle, runText } from './runStyle';

/** A run's characters, each script in its own typeface: Hangul / CJK in the run's 한글 글꼴 (a:ea), complex scripts in a:cs. */
export function RunChars({ r, text = runText(r.text) }: { r: TextRun; text?: string }) {
  const pieces = scriptPieces(text, r.fontFamilyEa, r.fontFamilyCs);
  if (pieces.length === 1 && !pieces[0].fontFamily) return <>{text}</>;
  return <>{pieces.map((p, i) => (p.fontFamily ? <span key={i} style={{ fontFamily: drawnFamily(p.fontFamily) }}>{p.text}</span> : p.text))}</>;
}

/** A run of text with its own formatting; a link carries its address for the slide show to open on a click. */
export function RunSpan({ r }: { r: TextRun }) {
  return <span style={runStyle(r)} {...(r.link ? { 'data-link': r.link, title: r.link } : {})}><RunChars r={r} /></span>;
}
