// Slide Show › 자막 › 번역: a second caption line in another language.
// Pure logic: the language list, the cache, and CaptionTranslator, which decides WHEN to ask the AI backend
// (every final piece, in order; interim text only debounced and throttled) and keeps the translated text in step
// with the captions. The network call itself is injected, so everything here is testable without a service.
import { CAPTION_KEEP, type CaptionLang } from './captions';

export type TranslateLang = 'en' | 'ko' | 'zh' | 'ja' | 'es' | 'vi' | 'th' | 'id' | 'fr' | 'ru';
export const TRANSLATE_LANGS: { id: TranslateLang; label: string; name: string }[] = [
  { id: 'en', label: 'English', name: 'English' },
  { id: 'ko', label: '한국어', name: 'Korean' },
  { id: 'zh', label: '中文', name: 'Simplified Chinese' },
  { id: 'ja', label: '日本語', name: 'Japanese' },
  { id: 'es', label: 'Español', name: 'Spanish' },
  { id: 'vi', label: 'Tiếng Việt', name: 'Vietnamese' },
  { id: 'th', label: 'ภาษาไทย', name: 'Thai' },
  { id: 'id', label: 'Bahasa Indonesia', name: 'Indonesian' },
  { id: 'fr', label: 'Français', name: 'French' },
  { id: 'ru', label: 'Русский', name: 'Russian' },
];
export const isTranslateLang = (v: unknown): v is TranslateLang => TRANSLATE_LANGS.some((l) => l.id === v);
export const translateLangName = (id: string): string | null => TRANSLATE_LANGS.find((l) => l.id === id)?.name ?? null;

/** The speaker's language already is the target: nothing to translate. */
export const sameLanguage = (source: CaptionLang, target: TranslateLang): boolean => source.slice(0, 2) === target;

/** Longest piece of text one translation request carries. */
export const TRANSLATE_MAX_CHARS = 600;
/** An interim piece is asked for at most this often, and only after the words stopped changing for DEBOUNCE ms. */
export const INTERIM_DEBOUNCE_MS = 500;
export const INTERIM_MIN_GAP_MS = 1500;
/** Finals waiting for the service: the oldest are dropped past this (the speaker is ahead of the service). */
export const MAX_PENDING_FINALS = 4;
/** After a key / quota failure no more requests are made for this long. */
export const FATAL_PAUSE_MS = 30_000;

export type TranslateErrorCode = 'no-key' | 'bad-key' | 'quota' | 'offline' | 'error';
export class TranslateError extends Error {
  constructor(public code: TranslateErrorCode, message: string = code) { super(message); }
}

export type TranslateStatus =
  | { state: 'off' }
  | { state: 'ok' }
  | { state: 'busy' }
  | { state: 'error'; code: TranslateErrorCode };

/** One line for the 자막 menu / presenter bar. */
export function translateStatusText(s: TranslateStatus): string {
  switch (s.state) {
    case 'off': return '번역 꺼짐';
    case 'ok': return '번역 중';
    case 'busy': return '번역 중…';
    case 'error':
      return s.code === 'no-key' ? '번역 키가 없어 원문만 표시합니다 (설정 › AI)'
        : s.code === 'bad-key' ? '번역 키가 맞지 않아 원문만 표시합니다'
        : s.code === 'quota' ? '번역 사용량 한도에 도달해 원문만 표시합니다'
        : s.code === 'offline' ? '인터넷에 연결할 수 없어 원문만 표시합니다'
        : '번역에 실패해 원문만 표시합니다';
  }
}

/** Small LRU: the same sentence is never paid for twice. */
export class TranslationCache {
  private map = new Map<string, string>();
  constructor(private max = 300) {}
  static key(target: string, text: string) { return `${target}\n${text}`; }
  get(target: string, text: string): string | undefined {
    const k = TranslationCache.key(target, text);
    const v = this.map.get(k);
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v); }
    return v;
  }
  set(target: string, text: string, value: string) {
    const k = TranslationCache.key(target, text);
    this.map.delete(k);
    this.map.set(k, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  get size() { return this.map.size; }
  clear() { this.map.clear(); }
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export interface TranslatedCaption { finals: string; interim: string }
export type TranslateFn = (text: string, target: TranslateLang) => Promise<string>;

export interface TranslatorOptions {
  translate: TranslateFn;
  onChange: (t: TranslatedCaption, status: TranslateStatus) => void;
  cache?: TranslationCache;
  now?: () => number;
}

/**
 * Keeps the translation of what was said. Finals are translated one after another, in order, and appended;
 * the newest interim text is translated after a short quiet moment and no more often than INTERIM_MIN_GAP_MS.
 * A failed request never blocks the captions: the status says why and the original stays on screen.
 */
export class CaptionTranslator {
  private target: TranslateLang | null = null;
  private finals: string[] = [];
  private interim = '';
  private status: TranslateStatus = { state: 'off' };
  private queue: string[] = [];
  private running = false;
  private epoch = 0;
  private interimText = '';
  private interimTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInterimAt = -Infinity;
  private pausedUntil = 0;
  readonly cache: TranslationCache;
  private now: () => number;

  constructor(private opts: TranslatorOptions) {
    this.cache = opts.cache ?? new TranslationCache();
    this.now = opts.now ?? Date.now;
  }

  get current(): TranslatedCaption { return { finals: clean(this.finals.join(' ')).slice(-CAPTION_KEEP), interim: this.interim }; }
  get state(): TranslateStatus { return this.status; }

  /** Choose the language (null = off). Changing it starts over. */
  setTarget(target: TranslateLang | null) {
    if (target === this.target) return;
    this.target = target;
    this.reset();
    this.pausedUntil = 0;
    this.status = target ? { state: 'ok' } : { state: 'off' };
    this.emit();
  }

  /** New caption session (speech stopped, or the band faded after a pause). */
  reset() {
    this.epoch++;
    this.finals = [];
    this.interim = '';
    this.interimText = '';
    this.queue = [];
    this.running = false;
    if (this.interimTimer) clearTimeout(this.interimTimer);
    this.interimTimer = null;
    if (this.target) this.emit();
  }

  /** A final piece of speech: always translated, in order. */
  pushFinal(text: string) {
    const piece = clean(text).slice(0, TRANSLATE_MAX_CHARS);
    this.interimText = '';
    this.interim = '';
    if (this.interimTimer) { clearTimeout(this.interimTimer); this.interimTimer = null; }
    if (!this.target || !piece) { this.emit(); return; }
    const hit = this.cache.get(this.target, piece);
    if (hit !== undefined && !this.running && !this.queue.length) { this.addFinal(hit); this.emit(); return; }
    this.queue.push(piece);
    while (this.queue.length > MAX_PENDING_FINALS) this.queue.shift();
    void this.drain();
  }

  /** The words being recognised right now: asked for after a quiet moment, and not too often. */
  pushInterim(text: string) {
    if (!this.target) return;
    const piece = clean(text).slice(-TRANSLATE_MAX_CHARS);
    if (piece === this.interimText) return;
    this.interimText = piece;
    if (!piece) { this.interim = ''; this.emit(); return; }
    if (this.interimTimer) clearTimeout(this.interimTimer);
    const wait = Math.max(INTERIM_DEBOUNCE_MS, this.lastInterimAt + INTERIM_MIN_GAP_MS - this.now());
    this.interimTimer = setTimeout(() => { this.interimTimer = null; void this.sendInterim(); }, wait);
  }

  dispose() { this.epoch++; if (this.interimTimer) clearTimeout(this.interimTimer); this.interimTimer = null; this.queue = []; }

  private paused() { return this.now() < this.pausedUntil; }

  private async sendInterim() {
    const target = this.target;
    const piece = this.interimText;
    if (!target || !piece || this.paused()) return;
    const hit = this.cache.get(target, piece);
    if (hit !== undefined) { this.interim = hit; this.emit(); return; }
    // A final waiting for the service always goes first.
    if (this.running || this.queue.length) return;
    const epoch = this.epoch;
    this.lastInterimAt = this.now();
    try {
      const out = clean(await this.opts.translate(piece, target));
      if (epoch !== this.epoch) return;
      this.cache.set(target, piece, out);
      // Only words still being said are shown; once they became a final the final's own translation replaces them.
      if (piece === this.interimText) this.interim = out;
      this.fine();
    } catch (e) {
      if (epoch !== this.epoch) return;
      this.fail(e);
    }
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    const epoch = this.epoch;
    while (this.queue.length) {
      const target = this.target;
      if (!target) break;
      const piece = this.queue.shift() as string;
      if (this.paused()) continue; // the service is refusing: this piece stays original-only
      try {
        let out = this.cache.get(target, piece);
        if (out === undefined) {
          this.status = { state: 'busy' };
          this.emit();
          out = clean(await this.opts.translate(piece, target));
          if (epoch !== this.epoch) return;
          this.cache.set(target, piece, out);
        }
        this.addFinal(out);
        this.fine();
      } catch (e) {
        if (epoch !== this.epoch) return;
        this.fail(e);
      }
    }
    if (epoch === this.epoch) this.running = false;
  }

  private addFinal(t: string) {
    if (!t) return;
    this.finals.push(t);
    if (this.finals.length > 20) this.finals.shift();
  }

  private fine() { this.status = { state: 'ok' }; this.emit(); }

  private fail(e: unknown) {
    const code: TranslateErrorCode = e instanceof TranslateError ? e.code : 'error';
    if (code === 'no-key' || code === 'bad-key' || code === 'quota') this.pausedUntil = this.now() + FATAL_PAUSE_MS;
    this.status = { state: 'error', code };
    this.emit();
  }

  private emit() { this.opts.onChange(this.current, this.status); }
}

/** The translated line for a message: finals translated so far plus the interim translation, or ''. */
export const translatedText = (t: TranslatedCaption): string => clean(`${t.finals} ${t.interim}`).slice(-CAPTION_KEEP);

/**
 * Which lines the audience band draws. `trOnly` shows just the translation, but only once there is one — until
 * then (or when translation failed) the original stays, so the band never goes blank while someone is speaking.
 */
export function bandLines(text: string, tr: string | undefined, trOnly: boolean): { original: string; translation: string } {
  const t = tr?.trim() ?? '';
  if (!t) return { original: text, translation: '' };
  return trOnly ? { original: '', translation: t } : { original: text, translation: t };
}
