// The one speech service. Components subscribe; the first subscriber starts the single recognizer (one microphone
// stream), the last one stops it. Temporary failures are retried with a growing wait; fatal ones stop and say why.
import { backoffMs } from './retry';
import { SpeechError, type ProviderKind, type SpeechLang, type SpeechListener, type SpeechProvider, type SpeechStatus } from './types';

export interface ServiceDeps {
  /** Which provider to use right now, or null when none can run here. */
  resolve(): ProviderKind | null;
  create(kind: ProviderKind): SpeechProvider;
  lang(): SpeechLang;
  /** Why nothing can run (shown when resolve() is null). */
  unavailable?(): SpeechError;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

const IDLE: SpeechStatus = { state: 'idle', provider: null, error: null, retryInMs: null };

export class SpeechService {
  private listeners = new Set<SpeechListener>();
  private watchers = new Set<(s: SpeechStatus) => void>();
  private provider: SpeechProvider | null = null;
  private status: SpeechStatus = IDLE;
  private attempt = 0;
  private timer: unknown = null;
  /** Bumped on every start/stop so a stale provider's late callbacks are ignored. */
  private run = 0;
  private startedLang: SpeechLang | null = null;
  constructor(private deps: ServiceDeps) {}

  getStatus = (): SpeechStatus => this.status;
  /** Number of components listening right now. */
  get subscribers(): number { return this.listeners.size; }

  watch(fn: (s: SpeechStatus) => void): () => void { this.watchers.add(fn); return () => { this.watchers.delete(fn); }; }

  /** Start receiving speech. Returns the unsubscribe function; the last unsubscribe stops the microphone. */
  subscribe(l: SpeechListener): () => void {
    this.listeners.add(l);
    if (!this.provider && this.timer == null) this.begin();
    return () => {
      if (!this.listeners.delete(l)) return;
      if (!this.listeners.size) this.halt(false);
    };
  }

  /** The provider or language setting changed: listen again with the new one. */
  reconfigure(): void {
    if (!this.listeners.size) return;
    const kind = this.deps.resolve();
    if (this.provider && kind === this.provider.kind && this.deps.lang() === this.startedLang) return;
    this.halt(true);
    this.begin();
  }

  /** Try again now (after the person fixed the microphone or key). */
  retry(): void {
    if (!this.listeners.size) return;
    this.halt(true);
    this.attempt = 0;
    this.begin();
  }

  private set(next: SpeechStatus) { this.status = next; this.watchers.forEach((f) => f(next)); }
  private clearTimer() { if (this.timer != null) { (this.deps.clearTimeout ?? clearTimeout)(this.timer as never); this.timer = null; } }

  /** Stop the provider and timers. A real stop goes back to idle, but a fatal error stays visible so the page can explain it. */
  private halt(restart: boolean) {
    this.run++;
    this.clearTimer();
    const p = this.provider;
    this.provider = null;
    this.startedLang = null;
    try { p?.stop(); } catch { /* already stopped */ }
    if (restart) return;
    this.attempt = 0;
    const keep = this.status.state === 'error' && !!this.status.error && !this.status.error.retryable;
    this.set(keep ? { ...this.status, retryInMs: null } : IDLE);
  }

  private begin() {
    const kind = this.deps.resolve();
    if (!kind) {
      this.set({ state: 'error', provider: null, error: this.deps.unavailable?.() ?? new SpeechError('unsupported'), retryInMs: null });
      return;
    }
    const run = ++this.run;
    const provider = this.deps.create(kind);
    this.provider = provider;
    this.startedLang = this.deps.lang();
    this.set({ state: 'starting', provider: kind, error: null, retryInMs: null });
    const live = () => run === this.run;
    try {
      provider.start(this.startedLang, {
        piece: (text, final) => {
          if (!live()) return;
          this.attempt = 0;
          this.listeners.forEach((l) => { try { l.onPiece(text, final); } catch { /* one listener must not break the others */ } });
        },
        listening: () => { if (live()) this.set({ state: 'listening', provider: kind, error: null, retryInMs: null }); },
        error: (err) => { if (live()) this.fail(err, kind); },
      });
    } catch (e) {
      if (live()) this.fail(e instanceof SpeechError ? e : new SpeechError('unknown', (e as Error)?.message), kind);
    }
  }

  private fail(err: SpeechError, kind: ProviderKind) {
    this.run++;
    try { this.provider?.stop(); } catch { /* ignore */ }
    this.provider = null;
    if (!err.retryable || !this.listeners.size) {
      this.set({ state: 'error', provider: kind, error: err, retryInMs: null });
      return;
    }
    const wait = backoffMs(this.attempt++, err.kind === 'quota');
    this.set({ state: 'error', provider: kind, error: err, retryInMs: wait });
    this.timer = (this.deps.setTimeout ?? setTimeout)(() => { this.timer = null; if (this.listeners.size) this.begin(); }, wait);
  }
}
