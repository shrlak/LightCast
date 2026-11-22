import type { SongDraft, SongSection } from '../sunday/songs';

/** ChordPro (.cho/.chopro/.crd): {title:}, {start_of_verse}, inline [chords] kept. */
export function parseChordPro(text: string, fallback: string): SongDraft {
  let title = fallback;
  let key: string | undefined;
  const sections: SongSection[] = [];
  let current: SongSection | null = null;
  const open = (label: string) => {
    current = { label, lines: [] };
    sections.push(current);
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const dir = /^\{\s*([\w_]+)\s*(?::\s*(.*?))?\s*\}$/.exec(line);
    if (dir) {
      const [, name, value = ''] = dir;
      const n = name.toLowerCase();
      if (n === 'title' || n === 't') title = value || title;
      else if (n === 'key') key = value;
      else if (/^(start_of_|so)(verse|v)$/.test(n)) open(value || 'Verse');
      else if (/^(start_of_|so)(chorus|c)$/.test(n)) open(value || 'Chorus');
      else if (/^(start_of_|so)(bridge|b)$/.test(n)) open(value || 'Bridge');
      else if (/^(comment|c|ci)$/.test(n) && /^(verse|chorus|bridge|intro|tag|pre-?chorus)/i.test(value)) open(value);
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    if (!current) open('Verse');
    current!.lines.push(line);
  }
  return { title, key, sections: sections.filter((s) => s.lines.length) };
}

const xmlText = (s: string) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** OpenLyrics XML (used by OpenLP and others). */
export function parseOpenLyrics(xml: string, fallback: string): SongDraft {
  const title = xmlText(/<title[^>]*>([\s\S]*?)<\/title>/.exec(xml)?.[1] ?? fallback).trim();
  const key = /<key>([^<]*)<\/key>/.exec(xml)?.[1];
  const order = /<verseOrder>([^<]*)<\/verseOrder>/.exec(xml)?.[1]?.trim().split(/\s+/);
  const sections: SongSection[] = [];
  for (const m of xml.matchAll(/<verse[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/verse>/g)) {
    const lines = [...m[2].matchAll(/<lines[^>]*>([\s\S]*?)<\/lines>/g)].flatMap((l) => xmlText(l[1]).split('\n')).map((l) => l.trim()).filter(Boolean);
    sections.push({ label: m[1].toUpperCase(), lines });
  }
  return { title, key, sections, progression: order?.map((o) => o.toUpperCase()) };
}

/** OpenSong song file: <lyrics> with [V1] headers and "." chord lines. */
export function parseOpenSong(xml: string, fallback: string): SongDraft {
  const title = xmlText(/<title>([\s\S]*?)<\/title>/.exec(xml)?.[1] ?? fallback).trim();
  const lyrics = xmlText(/<lyrics>([\s\S]*?)<\/lyrics>/.exec(xml)?.[1] ?? '');
  const order = /<presentation>([^<]*)<\/presentation>/.exec(xml)?.[1]?.trim().split(/\s+/).filter(Boolean);
  const sections: SongSection[] = [];
  for (const raw of lyrics.split('\n')) {
    const h = /^\[(.+)\]/.exec(raw.trim());
    if (h) sections.push({ label: h[1], lines: [] });
    else if (raw.startsWith(' ') && raw.trim()) {
      if (!sections.length) sections.push({ label: 'V', lines: [] });
      sections[sections.length - 1].lines.push(raw.trim().replace(/\s*\|\s*/g, ' '));
    }
  }
  return { title, sections, progression: order?.length ? order : undefined };
}

/** cp1252 bytes 0x80-0x9f (the rest of `\'hh` is Latin-1). */
const CP1252 = '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';
const cp1252 = (h: number) => (h >= 0x80 && h <= 0x9f ? CP1252[h - 0x80] : String.fromCharCode(h));

/** Destinations whose text is not part of the slide. */
const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'expandedcolortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'listtable', 'listoverridetable', 'generator']);
const RTF_CHAR: Record<string, string> = { emdash: '\u2014', endash: '\u2013', bullet: '\u2022', lquote: '\u2018', rquote: '\u2019', ldblquote: '\u201c', rdblquote: '\u201d', tab: '\t' };

/**
 * Plain text out of the RTF ProPresenter 6 stores per text element. Tokenised the way DeckCraft's shared
 * `craft-rtf` tokenizer does (DeckCraft c355c063): `\uN` is read (it used to be swallowed as an unknown control
 * word, losing Hangul) and the `\ucN` fallback after it is skipped, counting a `\'hh` or a control symbol as one
 * character; the skip ends at a group boundary; `\*` marks an ignorable destination wherever it appears.
 */
export function rtfToText(rtf: string): string {
  type St = { skip: boolean; uc: number };
  const stack: St[] = [];
  let st: St = { skip: false, uc: 1 };
  let pending = 0;
  let out = '';
  const re = /\\([a-z]{1,32})(-?\d{1,10})? ?|\\'([0-9a-f]{2})|\\([^a-z'])|([{}])|([^\\{}\r\n]+)|[\r\n]+|\\/giy;
  for (let m = re.exec(rtf); m; m = re.exec(rtf)) {
    const [, word, param, hex, sym, brace, text] = m;
    if (brace === '{') { pending = 0; stack.push(st); st = { ...st }; }
    else if (brace === '}') { pending = 0; st = stack.pop() ?? { skip: false, uc: 1 }; }
    else if (word !== undefined) {
      const w = word.toLowerCase();
      if (w === 'bin') { re.lastIndex += Math.max(0, Number(param ?? 0)); pending = 0; continue; }
      if (pending > 0 && w !== 'u') { pending--; continue; }
      if (w === 'u') {
        if (!st.skip) out += String.fromCharCode((Number(param ?? 0) + 65536) % 65536);
        pending = st.uc;
      } else if (w === 'uc') st.uc = Math.min(8, Math.max(0, Number(param ?? 1)));
      else if (RTF_SKIP.has(w)) st.skip = true;
      else if (st.skip) continue;
      else if (w === 'par' || w === 'line') out += '\n';
      else if (RTF_CHAR[w]) out += RTF_CHAR[w];
    } else if (hex !== undefined) {
      if (pending > 0) { pending--; continue; }
      const h = parseInt(hex, 16);
      if (!st.skip && h) out += cp1252(h);
    } else if (sym !== undefined) {
      if (sym === '*') { pending = 0; st.skip = true; continue; }
      if (pending > 0) { pending--; continue; }
      if (st.skip) continue;
      if ('\\{}'.includes(sym)) out += sym;
      else if (sym === '~') out += ' ';
      else if (sym === '_') out += '-';
      else if (sym === '\n' || sym === '\r') out += '\n';
    } else if (text !== undefined) {
      const chars = [...text];
      const drop = Math.min(pending, chars.length);
      pending -= drop;
      if (!st.skip) out += chars.slice(drop).join('');
    }
  }
  return out.replace(/\n{2,}/g, '\n').trim();
}

const b64 = (s: string) => {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  } catch {
    return '';
  }
};

/** ProPresenter 6 document (.pro6, XML). Groups become sections; one slide per element text. */
export function parsePro6(xml: string, fallback: string): SongDraft & { slides: { group: string; text: string }[] } {
  const title = /<RVPresentationDocument[^>]*CCLISongTitle="([^"]*)"/.exec(xml)?.[1] || fallback;
  const slides: { group: string; text: string }[] = [];
  const sections: SongSection[] = [];
  for (const g of xml.matchAll(/<RVSlideGrouping[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/RVSlideGrouping>/g)) {
    const group = g[1] || 'Slide';
    const section: SongSection = { label: group, lines: [] };
    for (const sl of g[2].matchAll(/<RVDisplaySlide[\s\S]*?<\/RVDisplaySlide>/g)) {
      const texts = [...sl[0].matchAll(/<NSString[^>]*rvXMLIvarName="PlainText"[^>]*>([^<]*)<\/NSString>/g)].map((m) => b64(m[1]))
        .concat([...sl[0].matchAll(/<NSString[^>]*rvXMLIvarName="RTFData"[^>]*>([^<]*)<\/NSString>/g)].map((m) => rtfToText(b64(m[1]))));
      const text = texts.find((t) => t.trim())?.trim() ?? '';
      slides.push({ group, text });
      section.lines.push(...text.split('\n'));
    }
    sections.push(section);
  }
  return { title, sections, slides };
}

import type { Presentation } from '../types';
import { parseLyrics, uid } from '../lyrics';
import { parseLyricsMarkdown, songToPresentation } from '../sunday/songs';

/** Turn any supported song file into a presentation (by extension, then by sniffing the content). */
export function presentationFromSongFile(name: string, text: string, linesPerSlide: number): Presentation {
  const base = name.replace(/\.[^.]+$/, '');
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
  const opts = { themeId: 'theme_classic', linesPerSlide, folder: 'Songs' };
  if (ext === 'pro6' || text.includes('<RVPresentationDocument')) {
    const pro = parsePro6(text, base);
    return {
      id: uid('p'), title: pro.title, themeId: 'theme_classic', folder: 'Songs',
      slides: pro.slides.filter((s) => s.text).map((s) => ({ id: uid('s'), group: s.group, text: s.text })),
    };
  }
  if (['cho', 'chopro', 'chordpro', 'crd'].includes(ext) || /^\s*\{(title|t):/m.test(text)) return songToPresentation(parseChordPro(text, base), opts);
  if (text.includes('<song') && text.includes('openlyrics')) return songToPresentation(parseOpenLyrics(text, base), opts);
  if (text.includes('<song') && text.includes('<lyrics>')) return songToPresentation(parseOpenSong(text, base), opts);
  if (ext === 'md') return songToPresentation(parseLyricsMarkdown(text, base), opts);
  return { id: uid('p'), title: base, slides: parseLyrics(text), themeId: 'theme_classic', folder: 'Songs' };
}
