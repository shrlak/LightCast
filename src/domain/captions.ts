// Slide Show › 자막: live speech-to-text shown as a caption band at the bottom of the audience screen.
// Pure logic only: merging interim/final speech, wrapping into 1–2 lines, expiry, and the message that travels.
export type CaptionSize = 'sm' | 'md' | 'lg';
export type CaptionLang = 'ko-KR' | 'en-US';
export const CAPTION_LANGS: { id: CaptionLang; label: string }[] = [{ id: 'ko-KR', label: '한국어' }, { id: 'en-US', label: '영어' }];
export const CAPTION_SIZES: { id: CaptionSize; label: string; vw: number }[] = [{ id: 'sm', label: '작게', vw: 2.2 }, { id: 'md', label: '보통', vw: 3 }, { id: 'lg', label: '크게', vw: 4 }];
/** Captions fade out this long after the last words (a pause in speaking). */
export const CAPTION_FADE_MS = 4000;
/** Only this much recent text is ever kept. */
export const CAPTION_KEEP = 400;
/** Width the band holds per line, by size (see textWidth: Korean letters count double). */
export const CAPTION_LINE_WIDTH: Record<CaptionSize, number> = { sm: 64, md: 48, lg: 36 };

export interface CaptionState { finals: string; interim: string; at: number }
export const emptyCaption = (): CaptionState => ({ finals: '', interim: '', at: 0 });

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Add one piece of recognised speech. A final piece is kept; an interim piece replaces the previous interim. */
export function applyCaption(s: CaptionState, text: string, final: boolean, now: number): CaptionState {
  const base = captionExpired(s, now) ? emptyCaption() : s;
  const piece = clean(text);
  if (final) {
    if (!piece) return { ...base, interim: '', at: now };
    return { finals: clean(`${base.finals} ${piece}`).slice(-CAPTION_KEEP), interim: '', at: now };
  }
  return { ...base, interim: piece, at: now };
}

/** Everything to show right now: final text followed by the words still being recognised. */
export const captionText = (s: CaptionState): string => clean(`${s.finals} ${s.interim}`);

/** True once nothing has arrived for `fadeMs` (or nothing was ever heard). */
export const captionExpired = (s: { at: number }, now: number, fadeMs = CAPTION_FADE_MS): boolean => !s.at || now - s.at >= fadeMs;

/** Display width: Hangul, kanji and kana count 2, everything else 1. */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿]/.test(ch) ? 2 : 1;
  return w;
}

/**
 * Break text into lines no wider than `maxWidth` (see textWidth), at spaces where possible, and keep the LAST
 * `maxLines` lines so the newest words are always visible.
 */
export function wrapCaption(text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  const push = () => { if (line) lines.push(line); line = ''; };
  for (const word of clean(text).split(' ').filter(Boolean)) {
    let w = word;
    // A word wider than a whole line is cut.
    while (textWidth(w) > maxWidth) {
      push();
      let cut = '';
      for (const ch of w) { if (textWidth(cut + ch) > maxWidth) break; cut += ch; }
      if (!cut) break;
      lines.push(cut);
      w = w.slice(cut.length);
    }
    if (!w) continue;
    if (!line) line = w;
    else if (textWidth(`${line} ${w}`) <= maxWidth) line = `${line} ${w}`;
    else { push(); line = w; }
  }
  push();
  return lines.slice(-Math.max(1, maxLines));
}

/** Sent from the presenter's window to the audience window(s). */
export type CaptionMessage =
  | { type: 'caption'; text: string; final: boolean; size: CaptionSize; lines: 1 | 2 }
  | { type: 'caption'; off: true };

export const captionMessage = (text: string, final: boolean, size: CaptionSize, lines: 1 | 2): CaptionMessage => ({ type: 'caption', text, final, size, lines });
export const captionOffMessage = (): CaptionMessage => ({ type: 'caption', off: true });

/** A caption message that came over the network: anything not shaped right is dropped; text is length-limited. */
export function parseCaptionMessage(m: unknown): CaptionMessage | null {
  if (!m || typeof m !== 'object' || (m as { type?: unknown }).type !== 'caption') return null;
  const o = m as { off?: unknown; text?: unknown; final?: unknown; size?: unknown; lines?: unknown };
  if (o.off === true) return { type: 'caption', off: true };
  if (typeof o.text !== 'string') return null;
  const size: CaptionSize = o.size === 'sm' || o.size === 'lg' ? o.size : 'md';
  return { type: 'caption', text: o.text.slice(-CAPTION_KEEP), final: o.final === true, size, lines: o.lines === 1 ? 1 : 2 };
}

/** Plain-language reason speech recognition cannot run here, or null when it can. */
export function captionUnavailableReason(supported: boolean, isDesktopApp: boolean): string | null {
  if (supported) return null;
  return isDesktopApp
    ? '이 데스크톱 앱에는 음성 인식이 들어 있지 않아 자막을 쓸 수 없습니다. 크롬이나 엣지 브라우저로 LightCast를 열면 자막을 쓸 수 있습니다.'
    : '이 브라우저는 음성 인식을 지원하지 않아 자막을 쓸 수 없습니다. 크롬, 엣지 또는 사파리를 쓰세요.';
}
