/** Present only inside the LightCast desktop app (see electron/preload.cjs). */
export interface DesktopDisplay {
  id: number;
  label: string;
  primary: boolean;
}

export interface DesktopInfo {
  version: string;
  platform: string;
  computerName?: string;
  displays: DesktopDisplay[];
  outputDisplays: Record<string, number | null>;
  ai: { proxyUrl: string; hasGeminiKey: boolean; hasOpenrouterKey: boolean };
  networkRemote: boolean;
  lanUrls: string[];
  internet: { on: boolean; status: 'off' | 'connecting' | 'on' | 'error'; url: string | null; error: string | null; note: string | null;
    /** The permanent address phones open (via the church Worker); null while the internet remote is off. */
    webAppUrl?: string; pairingUrl?: string | null;
    /** The code phones enter in the web app; never the registration secret. */
    connectionCode?: string | null;
    team?: { webAppUrl: string; pairingUrl: string | null; connectionCode: string | null; status: 'off' | 'pending' | 'ok' | 'unavailable' | 'error'; error: string | null };
    link: string | null; linkStatus: 'off' | 'pending' | 'ok' | 'unavailable' | 'error'; linkError: string | null };
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';
  version: string | null;
  progress: number;
  error: string | null;
  /** When LightCast last looked for a new release (ms since epoch). */
  checkedAt?: number | null;
}

export interface DesktopBridge {
  info(): Promise<DesktopInfo>;
  copyRemoteCode(): Promise<boolean>;
  copyTeamLink(): Promise<boolean>;
  /** A .pptx drawn by PowerPoint / LibreOffice on this computer, as a PDF; null when neither can. */
  pptxToPdf(bytes: Uint8Array): Promise<Uint8Array | null>;
  /** The pages being printed (body.printing) as a PDF with real text; null when it cannot. Older apps lack it. */
  printToPdf?(): Promise<Uint8Array | null>;
  /** Legacy binary PPT → editable PPTX via locally installed PowerPoint or LibreOffice. */
  pptToPptx(bytes: Uint8Array): Promise<Uint8Array | null>;
  /** Review › Spelling (desktop app versions that have it). */
  isMisspelled?(word: string): boolean;
  spellSuggestions?(word: string): string[];
  /** PowerPoint's own copy of shapes on the clipboard (its "Art::GVML ClipFormat" package), if any. */
  readOfficeClipboard?(): Promise<Uint8Array | null>;
  /** Insert › Screenshot: screens and windows with thumbnails, and the choice the next getDisplayMedia returns. Older apps lack them. */
  captureSources?(): Promise<import('./captureSources').RawCaptureSource[]>;
  selectCaptureSource?(id: string | null): Promise<boolean>;
  openView(url: string, displayId?: number | null): Promise<void>;
  /** Slide show starts: cover the projector (or this screen) right away, like PowerPoint. */
  present(url: string): Promise<void>;
  /** Slide show ends: close the window `present` opened. */
  endShow(): Promise<void>;
  /** The mixer window: float above everything (true) or not; without an argument, just report. Older apps lack it. */
  setOnTop?(on?: boolean): Promise<boolean>;
  setAiConfig(patch: { proxyUrl?: string; geminiKey?: string; openrouterKey?: string }): Promise<void>;
  setNetworkRemote(on: boolean): Promise<void>;
  setInternetRemote(on: boolean): Promise<void>;
  /** Make a new permanent link (the old one stops working). */
  newRemoteLink(): Promise<void>;
  closeOutputs(): Promise<void>;
  updateState(): Promise<UpdateState | null>;
  checkUpdates(): Promise<UpdateState | null>;
  installUpdate(): Promise<void>;
  onUpdate(cb: (s: UpdateState) => void): () => void;
  onDisplays(cb: (d: DesktopDisplay[]) => void): () => void;
}

export const desktop: DesktopBridge | undefined = typeof window === 'undefined' ? undefined : (window as unknown as { freecastDesktop?: DesktopBridge }).freecastDesktop;
