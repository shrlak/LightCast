// One 콘티 being read: the state the ppt site's LyricsGenerator keeps in React state and refs
// (songs, recognition status per card, stand-ins, spare pages), held here as a plain object so
// the pipeline runs outside any component. The operator reviews `songs` once the job is done.
import type { ContiDocument } from '../utils/contiPdf';
import type { ContiInfo, LibraryEntry, Song } from '../utils/types';
import type { RecognitionPhase } from '../ai/recognitionProgress';
import type { ScoredLyricsCandidate } from '../lyrics/webLyrics';

/** A card's recognition state, as the site's song card shows it. */
export type SongOutcome =
  | { status: 'running'; phase: RecognitionPhase; progress: number }
  | { status: 'done'; engine: string; needsReview?: boolean }
  | { status: 'error'; message: string };

/**
 * A song whose saved lyrics are not organized by part — saved slide by slide (1, 2, 3…) or in
 * one block: its words, but not its parts. With its 악보 in the conti it is read like a new
 * song, and the saved lyrics stand in until then.
 */
export interface StandIn {
  entry: LibraryEntry;
  /** The 진행 the conti wrote for the song, which its parts will follow. */
  contiOrder?: string[];
  /** Somebody confirmed the saved words: they are kept over a web page's. */
  trusted: boolean;
  slideSize?: number;
}

export interface ContiJob {
  doc: ContiDocument;
  info: ContiInfo;
  songs: Song[];
  library: LibraryEntry[];
  linesPerSlide: number;
  /** 악보 pages no card holds (a Plan B song, an extra score): read for their titles only. */
  spares: number[];
  /** The service's songs are known (from the cover), so a page none of them holds is not a song. */
  listedOrder: boolean;
  postSermonTitle: string | null;
  /** The English title the cover prints beside a song's Korean one, by card. */
  englishTitles: Map<string, string>;
  standIns: Map<string, StandIn>;
  outcomes: Map<string, SongOutcome>;
  /** Weighted-consensus confidence of each song's reading (0–1). */
  confidence: Map<string, number>;
  /** Several plausible web pages and none sure: the song keeps the 악보's reading. */
  webCandidates: Map<string, ScoredLyricsCandidate[]>;
  /**
   * For a song whose 악보 gave no lyrics: what the 악보 said about the lyrics found on the internet —
   * 'confirmed' (the models found them printed on it, and they are in) or 'unconfirmed' (they
   * could not, so they wait in webCandidates for the operator).
   */
  webChecks: Map<string, 'confirmed' | 'unconfirmed'>;
  /** Where each card's lyrics came from in the end. */
  sources: Map<string, 'library' | 'models' | 'web' | 'sheet'>;
  autoRetried: Set<string>;
  /** Unclaimed pages already reported, so they are said once. */
  reportedUnclaimed: string;
  notify: (message: string) => void;
  /** Called after every change to the songs or their outcomes. */
  changed: () => void;
}

export function setSongs(job: ContiJob, update: (songs: Song[]) => Song[]): void {
  job.songs = update(job.songs);
  job.changed();
}

export function setOutcome(job: ContiJob, id: string, outcome: SongOutcome | null): void {
  if (outcome) job.outcomes.set(id, outcome);
  else job.outcomes.delete(id);
  job.changed();
}

export function songHasLyrics(song: Song): boolean {
  return song.sections.some((s) => s.lines.some((l) => l.trim().length > 0));
}

/** Lines a slide a saved song used: its longest saved slide, so each saved slide stays whole. */
export function savedSlideSize(entry: LibraryEntry): number {
  return Math.min(6, Math.max(1, ...entry.sections.map((section) => section.lines.length)));
}
