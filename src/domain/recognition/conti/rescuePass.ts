// The rescue pass, from the ppt site's LyricsGenerator: a page the batch passes left without
// lyrics is rendered sharper and read on its own by the whole model pool, two pages at a time.
// A page still unread but with a known title goes on to the web pass instead of failing.
import type { Song } from '../utils/types';
import type { ParsedScore } from '../ai/scoreParser';
import type { AiSettings } from '../ai/aiSettings';
import { recognizeScoreRaced } from '../ai/scoreRecognition';
import { applyScoreToSong } from '../ai/scoreMerge';
import { classifyRecognitionError } from '../ai/recognitionObservation';
import { eachWithLimit, MIN_ATTEMPT_MS, RESCUE_CONCURRENCY, rescueAttemptMs, type RecognitionDeadline } from '../ai/recognitionBudget';
import { resolveTitleAlias, type LearningMemory } from '../learning/onlineLearning';
import { findLibrarySong } from '../storage/library';
import { combinePageReadings, readingLanguage } from '../utils/scorePages';
import { isPlaceholderTitle, lyricsLookupTitle } from '../utils/contiAlignment';
import { setSongs } from './job';
import type { RecognitionRun } from './songOutcomes';

/** Width (CSS px) score pages are rendered at for recognition: small lyric type stays readable. */
export const RECOGNITION_RENDER_WIDTH = 1600;
/** The rescue pass renders its page even larger: a page the batch failed is usually dense. */
const RESCUE_RENDER_WIDTH = 2200;

/** What a card says when its page could not be read, by what went wrong. */
export function rescueFailureMessage(error: unknown, retried = false): string {
  const category = classifyRecognitionError(error);
  if (category === 'timeout') {
    return retried
      ? 'AI 모델이 제한 시간 안에 답하지 않아, 이 곡만 한 번 더 읽었지만 이번에도 답이 없었습니다. 잠시 뒤 다시 인식해 주세요.'
      : 'AI 모델이 제한 시간 안에 답하지 않았습니다. 이 곡만 다시 인식하면 대개 읽힙니다.';
  }
  if (category === 'server' || category === 'rate-limit') {
    return retried
      ? 'AI 모델에 요청이 몰려, 이 곡만 한 번 더 읽었지만 이번에도 읽지 못했습니다. 잠시 뒤 다시 인식해 주세요.'
      : 'AI 모델에 요청이 몰려 악보를 읽지 못했습니다. 잠시 뒤 이 곡만 다시 인식하면 대개 읽힙니다.';
  }
  return error instanceof Error ? error.message : String(error);
}

/** The models were slow or busy — or the connection dropped — rather than wrong. */
function isSlowModelError(error: unknown): boolean {
  const category = classifyRecognitionError(error);
  return category === 'timeout' || category === 'server' || category === 'rate-limit' || category === 'network';
}

export interface RescueContext {
  settings: AiSettings;
  memory: LearningMemory;
  deadline: RecognitionDeadline;
  lyricEngine: string;
  scoreById: Map<string, ParsedScore>;
  furtherFor: (id: string) => { page: number; score: ParsedScore }[];
}

export async function rescuePages(run: RecognitionRun, pages: { song: Song; image: string; identity: ParsedScore }[], ctx: RescueContext): Promise<void> {
  const { job } = run;
  const { settings, memory, deadline, lyricEngine } = ctx;
  await eachWithLimit(pages, RESCUE_CONCURRENCY, async ({ song, image, identity }) => {
    const known: ParsedScore = ctx.scoreById.get(song.id) ?? { ...identity, order: [], sections: [] };
    // No lyrics off the page: a title — the conti's, or the one read off the 악보 — is still
    // enough for the web pass to find them.
    const toWebOrFail = (score: ParsedScore, engine: string, failure: string, why?: string) => {
      const lookupTitle = lyricsLookupTitle(song.title, score.title);
      if (lookupTitle && !isPlaceholderTitle(lookupTitle)) run.webQueue.set(song.id, { score, engine, title: lookupTitle, unread: why, image });
      else run.failures.set(song.id, failure);
    };
    if (deadline.remainingTotal() < MIN_ATTEMPT_MS) {
      const late = '인식 시간이 초과되어 가사를 읽지 못했습니다.';
      run.slow.add(song.id);
      return toWebOrFail(known, lyricEngine, late, late);
    }
    try {
      const rescueImage = await job.doc.renderPage(song.pageIndex as number, RESCUE_RENDER_WIDTH, 'png').catch(() => image);
      // The song's further pages the batch read are taken as read; one it could not read is
      // tried again beside this one.
      const earlier = ctx.furtherFor(song.id);
      const [single, ...more] = await Promise.all([
        recognizeScoreRaced(rescueImage, settings, rescueAttemptMs(deadline)),
        ...(song.extraPages ?? []).map(async (page) => {
          const had = earlier.find((entry) => entry.page === page)?.score;
          if (had && readingLanguage(had) !== 'none') return { page, score: had };
          try {
            const url = await job.doc.renderPage(page, RESCUE_RENDER_WIDTH, 'png');
            return { page, score: (await recognizeScoreRaced(url, settings, rescueAttemptMs(deadline))).score };
          } catch {
            return { page, score: { order: [], sections: [] } as ParsedScore };
          }
        }),
      ]);
      const read = [{ page: song.pageIndex as number, score: single.score }, ...more];
      const pagesRead = combinePageReadings(read.map(({ score }) => score), /[가-힣]/.test(isPlaceholderTitle(song.title) ? (known.title ?? '') : song.title));
      const merged: ParsedScore = { ...pagesRead.score, title: pagesRead.score.title ?? known.title, key: pagesRead.score.key ?? known.key };
      if (run.holdStandIn(song, merged, settings.excludedTitles) || run.discardNonScorePage(song, merged)) return;
      const mergedTitle = merged.title?.trim();
      if (mergedTitle && run.excludeRecognizedSong(song, mergedTitle, settings.excludedTitles)) return;
      const aliasedTitle = mergedTitle ? resolveTitleAlias(mergedTitle, memory) : '';
      const saved = aliasedTitle ? findLibrarySong(job.library, { title: aliasedTitle, artist: merged.artist }) : undefined;
      if (saved && run.takeLibraryMatch(song, saved)) return;
      if (merged.sections.length === 0) return toWebOrFail(merged, single.engine, '가사를 읽지 못했습니다.');
      setSongs(job, (current) => current.map((s) => (s.id === song.id ? applyScoreToSong(s, merged) : s)));
      run.webQueue.set(song.id, { score: merged, engine: single.engine, title: lyricsLookupTitle(song.title, merged.title) });
    } catch (error) {
      // Most often every model was too slow; a song whose title is known still gets its lyrics
      // from the web rather than a failed card.
      const why = rescueFailureMessage(error, run.retry);
      if (isSlowModelError(error)) run.slow.add(song.id);
      toWebOrFail(known, lyricEngine, why, why);
    }
  });
}
