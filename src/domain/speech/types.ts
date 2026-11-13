// One app-wide speech service: captions, the Bible-reference listener, PastorStage and FollowDock all share it.
export type SpeechLang = 'ko-KR' | 'en-US';
export type ProviderKind = 'browser' | 'cloud';
/** What the person picked: 자동 / 브라우저 / 클라우드. */
export type ProviderPref = 'auto' | ProviderKind;

export type SpeechErrorKind = 'mic-denied' | 'no-mic' | 'no-key' | 'bad-key' | 'offline' | 'quota' | 'network' | 'unsupported' | 'unknown';

/** A failure with a kind the UI can explain; `retryable` ones are tried again with a growing wait. */
export class SpeechError extends Error {
  constructor(public kind: SpeechErrorKind, message: string = kind) { super(message); this.name = 'SpeechError'; }
  get retryable(): boolean { return this.kind === 'offline' || this.kind === 'quota' || this.kind === 'network' || this.kind === 'unknown'; }
}

/** What a provider tells the service. `piece` is one recognised piece: interim pieces replace each other, finals stay. */
export interface ProviderHandlers {
  piece(text: string, final: boolean): void;
  /** The microphone / recognizer is really running now. */
  listening(): void;
  error(err: SpeechError): void;
}

export interface SpeechProvider {
  readonly kind: ProviderKind;
  start(lang: SpeechLang, handlers: ProviderHandlers): void;
  stop(): void;
}

export interface SpeechStatus {
  state: 'idle' | 'starting' | 'listening' | 'error';
  provider: ProviderKind | null;
  error: SpeechError | null;
  /** The error is temporary and another try is already scheduled (ms from now). */
  retryInMs: number | null;
}

export interface SpeechListener {
  onPiece(text: string, final: boolean): void;
}
