import type { CloudStatus } from '../useCloudSync';
import type { ServiceUploads } from './useServiceUploads';

export type Modal = 'teamRequests' | 'trash' | 'rehearsal' | 'remoteControl' | 'edit' | 'source' | 'new' | 'themes' | 'bible' | 'ai' | 'screens' | 'sunday' | 'retreat' | 'retreatBg' | 'chords' | 'sync' | 'account' | 'confession' | 'aiUsage' | 'prayer' | 'song' | 'songNew' | 'songLibrary' | 'find' | 'restore' | 'preparation' | 'preflight' | 'activity' | 'follow' | 'songStats' | 'ccli' | 'safeMode' | 'standby' | 'settings' | 'templateMarket' | null;
export type ImportKind = 'library' | 'slides' | 'lyrics' | 'backup';
export type PptViewMode = 'normal' | 'sorter' | 'presenter' | 'outline' | 'reading';

export interface OnlineStatus {
  status: 'loading' | 'ok' | 'error';
  count: number;
  error?: string;
}

/** Everything the ribbon can do; implemented once in OperatorView. */
export interface Commands {
  open: (m: Modal) => void;
  /** 단계별 수정: the 주일예배 마법사 on one step alone (index into SUNDAY_STEPS). */
  editSundayStep: (step: number) => void;
  notify: (msg: string) => void;
  pickFiles: (kind: ImportKind, accept: string) => void;
  exportPlaylistPptx: () => void;
  exportBackup: () => void;
  exportLibrary: () => void;
  exportUsage: () => void;
  clearUsage: () => void;
  reloadOnline: () => void;
  startShow: (fromCurrent: boolean) => void;
  endShow: () => void;
  setView: (v: PptViewMode) => void;
  online: OnlineStatus;
  relayConnected: boolean;
  remoteCount: number;
  teamRequestCount: number;
  remoteRequests: number;
  view: PptViewMode;
  /** Slide selected for editing in the PowerPoint layout. */
  slideId: string | null;
  slideSeq: number | null;
  setSlideId: (id: string | null, seq?: number) => void;
  cloud: CloudStatus;
  /** 🔒 While a slide is on screen, Enter / Delete in the editor do nothing. */
  locked: boolean;
  setLocked: (on: boolean) => void;
  /** This week's 주일예배: uploads go straight into it. */
  service: ServiceUploads;
  /** 🛡 안전 모드, 💻 대기 컴퓨터, 🎙 가사 따라가기 are on. */
  followOn: boolean;
  /** 실험 기능 turned on in 설정 → 일반. */
  templateMarket: boolean;
}

export const ACCEPT = {
  slides: '.pptx,.ppt,.pdf,image/*',
  lyrics: '.txt,.md,.pro6,.cho,.chopro,.chordpro,.crd,.xml,text/plain,text/markdown',
  backup: '.zip,application/zip',
  library: '.json,application/json',
} as const;
