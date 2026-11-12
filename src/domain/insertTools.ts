// Insert tab rules ported from DeckCraft (crates/engine/src/cmd/insert/{links,text_fields}.rs and
// crates/ui-egui/src/dialogs/{hyperlink,date_time,equation}.rs, MIT OR Apache-2.0): Date & Time
// formats, the Equation dialog's linear-form prettifier, Insert Hyperlink's targets, the actions
// action buttons carry and the Symbol dialog's groups.
import type { ElementAction, Slide, SlideElement } from './types';

// ── Date & Time ─────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ampm = (d: Date) => `${d.getHours() < 12 ? '오전' : '오후'} ${d.getHours() % 12 || 12}:${pad(d.getMinutes())}`;
const ampmEn = (d: Date) => `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;

/** Date & Time formats: Korean first (PowerPoint's 한국어 list), then English (DeckCraft's datetime1…13 kinds). */
export const DATE_FORMATS: { id: string; lang: 'ko' | 'en'; format: (d: Date) => string }[] = [
  { id: 'ko1', lang: 'ko', format: (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` },
  { id: 'ko2', lang: 'ko', format: (d) => `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS_KO[d.getDay()]}요일` },
  { id: 'ko3', lang: 'ko', format: (d) => `${String(d.getFullYear()).slice(2)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` },
  { id: 'ko4', lang: 'ko', format: (d) => `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일` },
  { id: 'ko5', lang: 'ko', format: (d) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}` },
  { id: 'ko6', lang: 'ko', format: (d) => `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.` },
  { id: 'ko7', lang: 'ko', format: (d) => `${d.getFullYear()}년 ${d.getMonth() + 1}월` },
  { id: 'ko8', lang: 'ko', format: (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAYS_KO[d.getDay()]})` },
  { id: 'ko9', lang: 'ko', format: (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${ampm(d)}` },
  { id: 'ko10', lang: 'ko', format: ampm },
  { id: 'ko11', lang: 'ko', format: (d) => `${ampm(d)}:${pad(d.getSeconds())}` },
  { id: 'ko12', lang: 'ko', format: (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}` },
  { id: 'ko13', lang: 'ko', format: (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` },
  { id: 'en1', lang: 'en', format: (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` },
  { id: 'en2', lang: 'en', format: (d) => `${DAYS_EN[d.getDay()]}, ${MONTHS_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` },
  { id: 'en3', lang: 'en', format: (d) => `${d.getDate()} ${MONTHS_EN[d.getMonth()]} ${d.getFullYear()}` },
  { id: 'en4', lang: 'en', format: (d) => `${MONTHS_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` },
  { id: 'en5', lang: 'en', format: (d) => `${d.getDate()}-${MONTHS_EN[d.getMonth()].slice(0, 3)}-${String(d.getFullYear()).slice(2)}` },
  { id: 'en6', lang: 'en', format: (d) => `${MONTHS_EN[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` },
  { id: 'en7', lang: 'en', format: (d) => `${MONTHS_EN[d.getMonth()].slice(0, 3)}-${String(d.getFullYear()).slice(2)}` },
  { id: 'en8', lang: 'en', format: (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${ampmEn(d)}` },
  { id: 'en9', lang: 'en', format: ampmEn },
  { id: 'en10', lang: 'en', format: (d) => `${d.getHours() % 12 || 12}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getHours() < 12 ? 'AM' : 'PM'}` },
];

/** The text of date field `id` at `d` (unknown ids fall back to the first Korean format). */
export function formatDateField(id: string, d: Date): string {
  return (DATE_FORMATS.find((f) => f.id === id) ?? DATE_FORMATS[0]).format(d);
}

/** What Date & Time inserts: a field that updates by itself, or the date as fixed text. */
export const dateFieldText = (id: string, update: boolean, now: Date) => (update ? `{date:${id}}` : formatDateField(id, now));

// ── Equation ────────────────────────────────────────────────────────────────────────────────

const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', n: 'ⁿ', i: 'ⁱ', '+': '⁺', '-': '⁻' };

/** DeckCraft's Equation dialog: linear form (a^2+b^2=c^2, sqrt, <=, pi, +-) as display text. */
export function prettyEquation(s: string): string {
  let out = '';
  const cs = [...s];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c === '^') {
      // Digits run on; a letter or sign takes one character.
      // (DeckCraft also raises a '+' that follows the digits, turning a^2+b^2 into a²⁺b²; only a sign right after ^ is an exponent sign here.)
      let first = true;
      while (i + 1 < cs.length && (first ? /[A-Za-z0-9+-]/ : /[0-9]/).test(cs[i + 1])) {
        const n = cs[++i];
        out += SUP[n] ?? n;
        if (!/[0-9]/.test(n)) break;
        first = false;
      }
    } else out += c === '*' ? '·' : c;
  }
  return out.replaceAll('sqrt', '√').replaceAll('<=', '≤').replaceAll('>=', '≥').replaceAll('!=', '≠').replaceAll('pi', 'π').replaceAll('+-', '±');
}

// ── Hyperlinks ──────────────────────────────────────────────────────────────────────────────

export type LinkMode = 'web' | 'slide' | 'email';
export interface LinkSeed { mode: LinkMode; url: string; email: string; subject: string; slideId: string; tip: string }

/** The Insert Hyperlink dialog's fields for an object's link (DeckCraft seed_of_link). */
export function linkSeed(el: Pick<SlideElement, 'href' | 'action' | 'tooltip'> | undefined, firstSlideId = ''): LinkSeed {
  const seed: LinkSeed = { mode: 'web', url: 'https://', email: '', subject: '', slideId: firstSlideId, tip: el?.tooltip ?? '' };
  const href = el?.href ?? (el?.action?.kind === 'url' ? el.action.url : undefined);
  if (el?.action?.kind === 'slide' && el.action.slideId) return { ...seed, mode: 'slide', slideId: el.action.slideId };
  if (href?.startsWith('mailto:')) {
    const [addr, query] = href.slice(7).split('?');
    const subject = new URLSearchParams(query ?? '').get('subject') ?? '';
    return { ...seed, mode: 'email', email: decodeURIComponent(addr), subject };
  }
  if (href) return { ...seed, url: href };
  return seed;
}

/** What OK writes: the object's link (href) or slide action, and its ScreenTip. Null: nothing valid to link. */
export function linkPatch(mode: LinkMode, f: { url: string; email: string; subject: string; slideId: string; tip: string }): Partial<SlideElement> | null {
  const tooltip = f.tip.trim() || undefined;
  if (mode === 'slide') return f.slideId ? { href: undefined, action: { kind: 'slide', slideId: f.slideId }, tooltip } : null;
  if (mode === 'email') {
    const addr = f.email.trim().replace(/^mailto:/i, '');
    if (!addr) return null;
    return { href: `mailto:${addr}${f.subject.trim() ? `?subject=${encodeURIComponent(f.subject.trim())}` : ''}`, action: undefined, tooltip };
  }
  let url = f.url.trim();
  if (!url || url === 'https://' || url === 'http://') return null;
  // A bare address is a web page, as PowerPoint reads it.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  return { href: url, action: undefined, tooltip };
}

/** The text a link shows when nothing was selected (DeckCraft: the address, or the slide's title). */
export function linkDisplay(mode: LinkMode, f: { url: string; email: string; slideId: string }, slides: Slide[]): string {
  if (mode === 'email') return f.email.trim().replace(/^mailto:/i, '');
  if (mode === 'slide') {
    const i = slides.findIndex((s) => s.id === f.slideId);
    const s = slides[i];
    return s ? (s.title || s.text.split('\n')[0] || `슬라이드 ${i + 1}`).trim() || `슬라이드 ${i + 1}` : '';
  }
  return f.url.trim();
}

// ── Action buttons ──────────────────────────────────────────────────────────────────────────

/** The action an action button carries when it is drawn (DeckCraft insert.actionButton). */
export function actionButtonAction(preset: string | undefined): ElementAction | undefined {
  switch (preset) {
    case 'actionButtonBackPrevious': return { kind: 'prev' };
    case 'actionButtonForwardNext': return { kind: 'next' };
    case 'actionButtonBeginning': case 'actionButtonHome': return { kind: 'first' };
    case 'actionButtonEnd': return { kind: 'last' };
    case 'actionButtonReturn': return { kind: 'lastViewed' };
    case 'actionButtonMovie': case 'actionButtonSound': return { kind: 'playMedia' };
    default: return undefined;
  }
}

// ── Symbol ──────────────────────────────────────────────────────────────────────────────────

/** The Symbol dialog's groups (DeckCraft's sets plus the Korean brackets and church marks LightCast had). */
export const SYMBOL_GROUPS: [label: string, chars: string][] = [
  ['문장 부호', '–—‘’“”…•·§¶†‡‰′″‹›«»¡¿「」『』《》〈〉※'],
  ['통화', '$€£¥¢₹₩₽₺₿'],
  ['수학', '±×÷≠≈≤≥∞√∑∏∫∂∆∇∈∉∩∪⊂⊃∀∃¬∧∨⇒⇔°'],
  ['그리스 문자', 'αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ'],
  ['화살표', '←↑→↓↔↕⇐⇑⇒⇓↖↗↘↙⟵⟶'],
  ['도형', '■□▪▫▲△▶▷▼▽◀◁◆◇○●◎★☆✓✔✗✘♠♣♥♦♡'],
  ['기타', '©®™♪♫✝☩✞☀☁☂☺'],
];
