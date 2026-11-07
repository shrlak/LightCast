// What one recognition run decides for each card — the closures inside the ppt site's
// LyricsGenerator.recognizeSongsBatch (fill from the library, keep a stand-in, drop a non-score
// page or an excluded song, commit a reading, report failures), over a plain ContiJob.
import type { LibraryEntry, Song } from '../utils/types';
import type { ParsedScore } from '../ai/scoreParser';
import type { RecognitionPhase } from '../ai/recognitionProgress';
import { RECOGNITION_PHASES, recognitionProgress } from '../ai/recognitionProgress';
import { applyScoreToSong } from '../ai/scoreMerge';
import { isGroundTruth, libraryLyrics } from '../storage/library';
import { hasSlideNumberParts, lacksParts, organizeSavedEntry, savedWordsInParts } from '../lyrics/savedLyrics';
import { mergeWebLyrics } from '../lyrics/mergeWebLyrics';
import { findSection } from '../utils/slidePlanner';
import { isPlaceholderTitle } from '../utils/contiAlignment';
import { isExcludedTitle } from '../utils/excludedTitles';
import { isSameSong } from './postSermon';
import { setOutcome, setSongs, songHasLyrics, type ContiJob } from './job';

/** Where a card waiting to be read again on its own sits: at the retry stage. */
export const RETRY_PROGRESS = RECOGNITION_PHASES.rescue.start;

/** Vision engines may mark a non-score page explicitly or by returning only sermon metadata. */
export function isNonScoreRecognition(score: ParsedScore): boolean {
  if (score.pageType === 'score') return false;
  return score.pageType === 'non_score' || ((!score.title || !score.title.trim()) && !!(score.sermonTitle?.trim() || score.scripture?.trim()));
}

export interface WebQueued {
  score: ParsedScore;
  engine: string;
  title: string;
  /** Why the 악보 gave no lyrics, said on the card if the web has none either. */
  unread?: string;
  /** The 악보 page as the models saw it, to check lyrics found on the web against. */
  image?: string;
}

/** One recognition run's bookkeeping over the job. */
export class RecognitionRun {
  readonly resolved = new Set<string>();
  readonly failures = new Map<string, string>();
  readonly slow = new Set<string>();
  readonly readAgain: string[] = [];
  readonly webQueue = new Map<string, WebQueued>();
  reviewFlags = new Map<string, boolean>();
  private tracked: { ids: string[]; phase: RecognitionPhase; startedAt: number; realFraction: number };

  constructor(readonly job: ContiJob, ids: string[], readonly retry: boolean) {
    this.tracked = { ids, phase: 'render', startedAt: Date.now(), realFraction: 0 };
  }

  /** Refresh every running card's percentage (the site ticks this every 400 ms). */
  tick = () => {
    const value = recognitionProgress(this.tracked.phase, Date.now() - this.tracked.startedAt, this.tracked.realFraction);
    for (const id of this.tracked.ids) if (!this.resolved.has(id)) this.job.outcomes.set(id, { status: 'running', phase: this.tracked.phase, progress: value });
    this.job.changed();
  };

  enterPhase(phase: RecognitionPhase, ids: string[]) {
    this.tracked = { ids, phase, startedAt: Date.now(), realFraction: 0 };
    this.tick();
  }

  set realFraction(value: number) {
    this.tracked.realFraction = value;
  }

  dropTracked(ids: Set<string>) {
    this.tracked.ids = this.tracked.ids.filter((id) => !ids.has(id));
  }

  markDone(ids: string[], engine: string) {
    for (const id of ids) {
      this.resolved.add(id);
      this.job.outcomes.set(id, { status: 'done', engine, needsReview: this.reviewFlags.get(id) || undefined });
    }
    this.job.changed();
  }

  /** Settle a stand-in on its saved slides: the 악보 gave nothing better. */
  keepStandIn(id: string) {
    const held = this.job.standIns.get(id);
    this.job.standIns.delete(id);
    if (!held) return;
    const saved = organizeSavedEntry(held.entry);
    setSongs(this.job, (current) => current.map((song) =>
      song.id === id && !songHasLyrics(song)
        ? { ...song, ...libraryLyrics(saved), ...(hasSlideNumberParts(saved.sections) ? { linesPerSlide: Math.max(song.linesPerSlide ?? 1, ...saved.sections.map((s) => s.lines.length)) } : {}) }
        : song));
    this.job.sources.set(id, 'library');
    this.markDone([id], 'library');
  }

  /** Fill a lyric-less song from the library: the saved lyrics are authoritative. */
  fillFromLibrary(song: Song, entry: LibraryEntry, message?: string) {
    const standIn = this.job.standIns.get(song.id);
    this.job.standIns.delete(song.id);
    const standInOrder = standIn?.contiOrder?.some((token) => token !== 'I' && findSection(entry.sections, token)) ? standIn.contiOrder : undefined;
    setSongs(this.job, (list) => list.map((s) => s.id === song.id
      ? {
          ...s,
          title: entry.title,
          key: s.key ?? entry.key,
          // The saved order is last time's arrangement; one the conti wrote is this week's.
          ...libraryLyrics(organizeSavedEntry(entry), s.orderFromConti ? s.order : standInOrder),
          ...(standIn ? { linesPerSlide: this.job.linesPerSlide, orderFromConti: s.orderFromConti || !!standInOrder || undefined } : {}),
        }
      : s));
    this.job.sources.set(song.id, 'library');
    this.markDone([song.id], 'library');
    this.job.notify(message ?? `라이브러리에서 '${entry.title}' 가사를 불러왔습니다.`);
  }

  /** Take a song the library holds by the title read off its 악보; one saved without parts waits as a stand-in. */
  takeLibraryMatch(song: Song, entry: LibraryEntry, message?: string): boolean {
    if (lacksParts(entry)) {
      if (!this.job.standIns.has(song.id)) this.job.standIns.set(song.id, { entry, contiOrder: song.orderFromConti ? [...song.order] : undefined, trusted: isGroundTruth(entry) });
      return false;
    }
    this.resolved.add(song.id);
    this.fillFromLibrary(song, entry, message);
    return true;
  }

  /** A stand-in's page read as no score, or as an excluded song: it keeps the saved slides. */
  holdStandIn(song: Song, score: ParsedScore, excludedTitles: string[]): boolean {
    if (!this.job.standIns.has(song.id)) return false;
    const title = score.title?.trim();
    if (!isNonScoreRecognition(score) && !(title && isExcludedTitle(title, excludedTitles))) return false;
    this.keepStandIn(song.id);
    return true;
  }

  private dropCard(id: string) {
    this.resolved.add(id);
    setSongs(this.job, (list) => list.filter((s) => s.id !== id));
    setOutcome(this.job, id, null);
  }

  /** Remove a page the models classified as no score, keeping any sermon info it carried. */
  discardNonScorePage(song: Song, result: ParsedScore): boolean {
    if (!isNonScoreRecognition(result)) return false;
    this.dropCard(song.id);
    const sermonTitle = result.sermonTitle?.trim();
    const scripture = result.scripture?.trim();
    if (sermonTitle || scripture) this.job.info = { ...this.job.info, sermonTitle: this.job.info.sermonTitle || sermonTitle, scripture: this.job.info.scripture || scripture };
    return true;
  }

  /** Drop a song whose recognized title is on the exclusion list (or repeats the 설교 후 찬양). */
  excludeRecognizedSong(song: Song, title: string, excludedTitles: string[]): boolean {
    const postSermon = this.job.postSermonTitle;
    const isPostSermonCopy = !!postSermon && !song.postSermon && isPlaceholderTitle(song.title) && isSameSong(title, postSermon);
    if (!isPostSermonCopy && !isExcludedTitle(title, excludedTitles)) return false;
    this.dropCard(song.id);
    this.job.notify(isPostSermonCopy ? `'${title}' 악보는 설교 후 찬양 '${postSermon}' 카드와 같은 곡이라 따로 넣지 않았습니다.` : `'${title}'은(는) 제외 목록에 있어 찬양 편집에서 제외했습니다.`);
    return true;
  }

  /** Commit a finished song: write the lyrics, mark it done. */
  applyRecognizedScore(id: string, score: ParsedScore, engine: string, source: 'models' | 'web' | 'library' = 'models') {
    // Saved slides standing in give way to its parts, in the 진행 the conti wrote (or the 악보's).
    const standIn = this.job.standIns.get(id);
    this.job.standIns.delete(id);
    setSongs(this.job, (current) => current.map((song) => {
      if (song.id !== id) return song;
      const base: Song = standIn
        ? { ...song, sections: [], order: standIn.contiOrder ? [...standIn.contiOrder] : ['I'], orderFromConti: standIn.contiOrder ? true : undefined, linesPerSlide: standIn.slideSize ?? this.job.linesPerSlide }
        : song;
      return { ...applyScoreToSong(base, score), verification: 'draft' };
    }));
    this.job.sources.set(id, source);
    this.markDone([id], engine);
  }

  /** Commit a song no web page was confirmed for: what the 악보 said, normalized. */
  settleWithoutWeb(id: string, score: ParsedScore, engine: string, failure: string) {
    const normalized = mergeWebLyrics(score, null).score;
    const standIn = this.job.standIns.get(id);
    if (standIn) {
      const laid = savedWordsInParts(normalized.sections, standIn.entry.sections, hasSlideNumberParts(standIn.entry.sections));
      if (laid.matched === 0) return this.keepStandIn(id);
      this.applyRecognizedScore(id, { ...normalized, sections: laid.sections }, engine, 'library');
      this.job.notify(`'${standIn.entry.title}'의 저장된 가사를 악보의 파트 ${laid.matched}개에 나눠 넣었습니다.`);
      return;
    }
    if (normalized.sections.length === 0) this.failures.set(id, failure);
    else this.applyRecognizedScore(id, normalized, engine);
  }

  /** Cards neither the models nor the web filled; slow ones are queued to be read again alone. */
  reportFailures() {
    for (const id of [...this.failures.keys()]) {
      if (!this.job.standIns.has(id)) continue;
      this.failures.delete(id);
      this.keepStandIn(id);
    }
    if (!this.retry) {
      for (const id of [...this.failures.keys()]) {
        if (!this.slow.has(id) || this.job.autoRetried.has(id)) continue;
        this.failures.delete(id);
        this.resolved.add(id);
        this.readAgain.push(id);
      }
      for (const id of this.readAgain) this.job.outcomes.set(id, { status: 'running', phase: 'rescue', progress: RETRY_PROGRESS });
    }
    for (const [id, message] of this.failures) {
      this.resolved.add(id);
      this.job.outcomes.set(id, { status: 'error', message });
    }
    this.job.changed();
  }
}
