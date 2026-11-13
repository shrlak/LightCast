// File › Export › 개요 내보내기: slide titles and body text as a plain-text or RTF outline
// (PowerPoint's Outline/RTF export): a numbered title per slide, body text indented by level, notes optional.
import type { Presentation, Slide } from './types';
import { sequence } from './arrangement';

export interface OutlineLine { /** 1+ = body levels. */ level: number; text: string; note?: boolean }
export interface OutlineSlide { number: number; title: string; lines: OutlineLine[] }
export interface OutlineOptions { notes: boolean; includeHidden: boolean }

const lines = (t: string | undefined): string[] => (t ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

/** The outline of one slide: title (or its first text line), then its text, subtext and text boxes. */
export function slideOutline(s: Slide, number: number, o: Pick<OutlineOptions, 'notes'>): OutlineSlide {
  const body: OutlineLine[] = [];
  const boxes = (s.elements ?? []).filter((e) => !e.master && e.kind === 'text' && e.text?.trim());
  let title = lines(s.title)[0];
  for (const t of lines(s.text)) body.push({ level: 1, text: t });
  for (const t of lines(s.subtext)) body.push({ level: 1, text: t });
  for (const e of boxes) {
    const ls = lines(e.text);
    if (e.placeholder === 'title' && !title) title = ls.shift() ?? '';
    for (const t of ls) body.push({ level: 1 + Math.max(0, Math.round(e.indent ?? 0)), text: t });
  }
  if (!title && body.length) title = body.shift()!.text;
  if (o.notes) for (const t of lines(s.notes)) body.push({ level: 1, text: t, note: true });
  return { number, title: title ?? '', lines: body };
}

export function buildOutline(p: Presentation, o: OutlineOptions): OutlineSlide[] {
  return sequence(p).map((x, i) => ({ slide: x.slide, number: i + 1 }))
    .filter((x) => o.includeHidden || !x.slide.disabled)
    .map((x) => slideOutline(x.slide, x.number, o));
}

const INDENT = '    ';
/** Plain-text outline: `1. 제목`, then body lines indented per level, notes marked `[메모]`. */
export function outlineToText(slides: OutlineSlide[]): string {
  const out: string[] = [];
  for (const s of slides) {
    out.push(`${s.number}. ${s.title}`.trimEnd());
    for (const l of s.lines) out.push(`${INDENT.repeat(l.level)}${l.note ? '[메모] ' : ''}${l.text}`);
  }
  return out.join('\r\n') + (out.length ? '\r\n' : '');
}

/** Text as RTF: `\`, `{`, `}` escaped; everything past ASCII as `\uN?` (signed 16-bit UTF-16 units), so Korean survives. */
export function rtfEscape(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const ch = text[i];
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
    else if (ch === '\n') out += '\\line ';
    else if (ch === '\t') out += '\\tab ';
    else if (c < 0x20) continue;
    else if (c < 0x80) out += ch;
    else out += `\\u${c > 32767 ? c - 65536 : c}?`;
  }
  return out;
}

/** RTF outline: bold numbered titles, body paragraphs indented 360 twips per level, notes in italics. */
export function outlineToRtf(slides: OutlineSlide[], font = '맑은 고딕'): string {
  const out: string[] = [`{\\rtf1\\ansi\\ansicpg949\\deff0\\uc1{\\fonttbl{\\f0\\fnil\\fcharset129 ${rtfEscape(font)};}}\\f0\\fs24`];
  for (const s of slides) {
    out.push(`\\pard\\sb200\\sa60\\b\\fs28 ${rtfEscape(`${s.number}. ${s.title}`)}\\b0\\fs24\\par`);
    for (const l of s.lines) out.push(`\\pard\\li${l.level * 360}\\sa40 ${l.note ? '\\i ' : ''}${rtfEscape(l.text)}${l.note ? '\\i0' : ''}\\par`);
  }
  out.push('}');
  return out.join('\r\n');
}
