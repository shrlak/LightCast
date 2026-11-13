// Browser provider: the Web Speech API (Chrome, Edge, Safari). It listens through its own microphone access, so only
// one provider is ever running at a time (the service guarantees it).
import { SpeechError, type ProviderHandlers, type SpeechErrorKind, type SpeechLang, type SpeechProvider } from './types';

interface ResultLike { isFinal: boolean; 0: { transcript: string } }
interface EventLike { resultIndex: number; results: ArrayLike<ResultLike> }
export interface RecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: EventLike) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; onstart?: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
export type RecognitionCtor = new () => RecognitionLike;

export function browserRecognitionCtor(w: unknown = typeof window === 'undefined' ? undefined : window): RecognitionCtor | null {
  const o = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | undefined;
  return o?.SpeechRecognition ?? o?.webkitSpeechRecognition ?? null;
}

const KINDS: Record<string, SpeechErrorKind> = {
  'not-allowed': 'mic-denied', 'service-not-allowed': 'unsupported', network: 'network', 'audio-capture': 'no-mic', 'language-not-supported': 'unsupported',
};

export class BrowserSpeechProvider implements SpeechProvider {
  readonly kind = 'browser' as const;
  private wanted = false;
  private rec: RecognitionLike | null = null;
  constructor(private ctor: () => RecognitionCtor | null = () => browserRecognitionCtor(), private restartMs = 250) {}

  start(lang: SpeechLang, h: ProviderHandlers): void {
    const Ctor = this.ctor();
    if (!Ctor) throw new SpeechError('unsupported');
    this.wanted = true;
    const begin = () => {
      if (!this.wanted) return;
      const r = new Ctor();
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.onstart = () => h.listening();
      r.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) h.piece(e.results[i][0].transcript, e.results[i].isFinal);
      };
      r.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        this.wanted = false;
        h.error(new SpeechError(KINDS[e.error] ?? 'unknown', e.error));
      };
      // Browsers stop after a pause; listen again until stop() is called.
      r.onend = () => { if (this.wanted) setTimeout(begin, this.restartMs); };
      this.rec = r;
      try { r.start(); } catch { /* already started */ }
    };
    begin();
    // Some engines never fire onstart; the service still needs to know listening began.
    h.listening();
  }

  stop(): void {
    this.wanted = false;
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.rec = null;
  }
}
