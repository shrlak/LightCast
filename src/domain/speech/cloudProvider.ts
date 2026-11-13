// Cloud provider: one microphone stream, cut into short chunks (~1.5–3 s), each sent to a transcription endpoint;
// the answers are put back in order, cleaned, and passed on as final pieces. The browser parts (microphone, recorder,
// network) are injected, so this logic runs in tests with a mock.
import { dedupeOverlap, isPhantom } from './audioChunks';
import { withRetry } from './retry';
import { SpeechError, type ProviderHandlers, type SpeechLang, type SpeechProvider } from './types';

export interface AudioChunk { blob: unknown; loud: boolean }
export interface Mic {
  /** Record the next chunk (ends at a pause or after ~3 s); null when the mic was closed meanwhile. */
  record(): Promise<AudioChunk | null>;
  close(): void;
}
export interface CloudDeps {
  /** Open the microphone; rejects with a SpeechError (mic-denied, no-mic). */
  openMic(): Promise<Mic>;
  /** Send one chunk, get its text; rejects with a SpeechError (offline, quota, no-key, …). */
  transcribe(chunk: AudioChunk, lang: SpeechLang): Promise<string>;
  sleep?(ms: number): Promise<void>;
  /** Chunks waiting for an answer at once; more are dropped so captions never fall far behind. Default 3. */
  maxInFlight?: number;
}

export class CloudSpeechProvider implements SpeechProvider {
  readonly kind = 'cloud' as const;
  private stopped = true;
  private mic: Mic | null = null;
  constructor(private deps: CloudDeps) {}

  start(lang: SpeechLang, h: ProviderHandlers): void {
    this.stopped = false;
    void this.loop(lang, h);
  }

  stop(): void {
    this.stopped = true;
    this.mic?.close();
    this.mic = null;
  }

  private async loop(lang: SpeechLang, h: ProviderHandlers) {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const maxInFlight = this.deps.maxInFlight ?? 3;
    let mic: Mic;
    try { mic = await this.deps.openMic(); } catch (e) {
      if (!this.stopped) h.error(e instanceof SpeechError ? e : new SpeechError('no-mic'));
      return;
    }
    if (this.stopped) { mic.close(); return; }
    this.mic = mic;
    h.listening();
    let inFlight = 0;
    let order: Promise<void> = Promise.resolve();
    let lastText = '';
    let failed = false;
    while (!this.stopped && !failed) {
      let chunk: AudioChunk | null;
      try { chunk = await mic.record(); } catch (e) {
        if (!this.stopped) h.error(e instanceof SpeechError ? e : new SpeechError('no-mic'));
        return;
      }
      if (this.stopped || !chunk) break;
      if (!chunk.loud || inFlight >= maxInFlight) continue;
      inFlight++;
      const job = withRetry(() => this.deps.transcribe(chunk as AudioChunk, lang), {
        retries: 2, sleep, isCancelled: () => this.stopped,
        isRetryable: (e) => e instanceof SpeechError && (e.kind === 'network' || e.kind === 'unknown'),
      }).then((text) => ({ text }), (error: unknown) => ({ error }));
      // Answers can come back in any order; they are shown in the order the speech was said.
      order = order.then(() => job).then((r) => {
        inFlight--;
        if (this.stopped || failed) return;
        if ('error' in r) { failed = true; h.error(r.error instanceof SpeechError ? r.error : new SpeechError('unknown')); return; }
        const raw = r.text.replace(/\s+/g, ' ').trim();
        if (isPhantom(raw)) return;
        const text = dedupeOverlap(lastText, raw);
        if (!text) return;
        lastText = `${lastText} ${text}`.slice(-200);
        h.piece(text, true);
      });
    }
  }
}
