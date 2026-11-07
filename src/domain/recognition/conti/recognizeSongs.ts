// Recognize a conti's songs as one staged job — the ppt site's LyricsGenerator.recognizeSongsBatch
// for a Sunday service, over a plain ContiJob:
//   1) render the cards' pages (and the spare ones);
//   2) one title-only pass over every page: a page whose title 찬양 라이브러리 holds ends here with
//      the saved lyrics, non-score pages and excluded songs drop out, pages are paired to songs;
//   3) one full-lyrics pass over the pages left (adaptive: champions read, a challenger settles
//      disagreements), every song's pages combined, learned safe corrections applied;
//   4) a rescue pass reads any page the batch left empty on its own;
//   5) the web pass checks the wording (webPass.ts); slow songs are read once more on their own.
import type { Song } from '../utils/types';
import type { ParsedScore } from '../ai/scoreParser';
import type { AiSettings } from '../ai/aiSettings';
import type { ModelReliability } from '../ai/modelReliability';
import { recognizeAdaptiveBatch } from '../ai/adaptiveRecognition';
import { planScoreBatch } from '../ai/scoreBatchPlan';
import { applyScoreToSong } from '../ai/scoreMerge';
import { ERROR_CATEGORY_LABELS } from '../ai/recognitionObservation';
import { createRecognitionDeadline, eachWithLimit, RESCUE_CONCURRENCY } from '../ai/recognitionBudget';
import { applySafeCorrections, promptExamplesFor, resolveTitleAlias, type LearningMemory } from '../learning/onlineLearning';
import { findLibrarySong } from '../storage/library';
import { combinePageReadings } from '../utils/scorePages';
import { isPlaceholderTitle, lyricsLookupTitle } from '../utils/contiAlignment';
import { setOutcome, setSongs, songHasLyrics, type ContiJob } from './job';
import { RecognitionRun } from './songOutcomes';
import { placePages } from './pagePlan';
import { rescuePages, RECOGNITION_RENDER_WIDTH } from './rescuePass';
import { runWebLyricsPass } from './webPass';

/** How often the progress percentage refreshes. */
const PROGRESS_TICK_MS = 400;

export interface RecognitionContext {
  settings: AiSettings;
  reliabilities: ModelReliability[];
  memory: LearningMemory;
}

export async function recognizeSongs(job: ContiJob, targets: Song[], ctx: RecognitionContext, retry = false): Promise<void> {
  const { doc } = job;
  const { settings, reliabilities, memory } = ctx;
  let active = targets.filter((song) => song.pageIndex != null);
  if (active.length === 0) return;
  const run = new RecognitionRun(job, active.map((song) => song.id), retry);

  // Songs already filled from 찬양 라이브러리 are done from the start. Saved slides standing in
  // for a song's parts are not its lyrics yet.
  const prefilled = active.filter((song) => songHasLyrics(song) && !job.standIns.has(song.id)).map((song) => song.id);
  if (prefilled.length > 0) run.markDone(prefilled, 'library');
  const regrouped = job.listedOrder ? active.flatMap((song) => song.extraPages ?? []) : [];
  const spares = [...new Set([...job.spares, ...regrouped])].filter((page) => !active.some((song) => song.pageIndex === page)).sort((a, b) => a - b);
  if (prefilled.length === active.length) return;

  const ticker = setInterval(run.tick, PROGRESS_TICK_MS);
  const exhausted = new Set<string>();
  try {
    run.enterPhase('render', active.map((song) => song.id));
    let rendered = 0;
    // PNG: lossless line art reads far better than JPEG for OCR.
    const [renderedImages, spareImages] = await Promise.all([
      Promise.all(active.map(async (song) => {
        const url = await doc.renderPage(song.pageIndex as number, RECOGNITION_RENDER_WIDTH, 'png');
        run.realFraction = ++rendered / active.length;
        return url;
      })),
      Promise.all(spares.map((page) => doc.renderPage(page, RECOGNITION_RENDER_WIDTH, 'png'))),
    ]);
    // Every model call runs against one clock (recognitionBudget.ts), from the pages drawn.
    const deadline = createRecognitionDeadline();

    // Quick title pass. Best-effort: on failure the full pass still runs.
    run.enterPhase('titles', active.map((song) => song.id));
    let titleScores: ParsedScore[] = [...active, ...spares].map(() => ({ order: [], sections: [] }));
    try {
      const titleResult = await recognizeAdaptiveBatch([...renderedImages, ...spareImages], settings, 'titles', undefined, reliabilities, undefined, promptExamplesFor({}, memory), deadline.stageEndsAt('titles'));
      titleScores = titleResult.scores;
      for (const modelKey of titleResult.exhaustedModels) exhausted.add(modelKey);
    } catch (error) {
      console.warn('제목 일괄 인식 실패, 전체 가사 인식으로 계속:', error instanceof Error ? error.message : error);
    }
    // A title the models are known to misread is resolved before the library and web are searched.
    const aliased = titleScores.map((identity) => (identity.title ? { ...identity, title: resolveTitleAlias(identity.title, memory) } : identity));
    const titlePages = [...active.map((song) => song.pageIndex as number), ...spares];
    const readByPage = new Map(titlePages.map((page, index) => [page, aliased[index]]));
    const imageByPage = new Map(titlePages.map((page, index) => [page, [...renderedImages, ...spareImages][index]]));
    const imageOf = (page: number): Promise<string | null> => {
      const drawn = imageByPage.get(page);
      return drawn ? Promise.resolve(drawn) : doc.renderPage(page, RECOGNITION_RENDER_WIDTH, 'png').catch(() => null);
    };
    const placed = placePages(run, { active, images: renderedImages, titles: aliased }, spares, spareImages, readByPage, imageByPage);
    active = placed.active;
    const { images, titles } = placed;

    // From here on the cards' pages are read — each card's own, and the further pages it was given.
    const unmatched: { song: Song; image: string; identity: ParsedScore }[] = [];
    const identityById = new Map<string, ParsedScore>();
    const titlePlan = planScoreBatch(titles, active.map((song) => song.title), job.library);
    active.forEach((song, index) => {
      if (songHasLyrics(song) && !job.standIns.has(song.id)) return run.markDone([song.id], 'library');
      const identity = titles[index] ?? { order: [], sections: [] };
      if (run.holdStandIn(song, identity, settings.excludedTitles)) return;
      if (run.discardNonScorePage(song, identity)) return;
      const recognizedTitle = identity.title?.trim();
      if (recognizedTitle && run.excludeRecognizedSong(song, recognizedTitle, settings.excludedTitles)) return;
      // 찬양 라이브러리 already holds this title: load the saved lyrics instead of reading the 악보.
      const match = titlePlan.libraryMatches[index];
      if (match && run.takeLibraryMatch(song, match, `'${match.title}'은(는) 라이브러리에 있어 가사 인식을 건너뛰고 불러왔습니다.`)) return;
      identityById.set(song.id, identity);
      unmatched.push({ song, image: images[index], identity });
    });
    // Show the recognized title/key while the remaining pages move into the full lyric pass.
    if (identityById.size > 0) setSongs(job, (current) => current.map((song) => (identityById.has(song.id) ? applyScoreToSong(song, identityById.get(song.id)!) : song)));
    const remaining = unmatched;
    if (remaining.length === 0) return;

    // Full-lyrics pass for every unmatched page in one request; the rescue pass below still tries
    // each page separately if the whole batch fails. The cover's title is ground truth as a hint.
    run.enterPhase('lyrics', remaining.map(({ song }) => song.id));
    const hintFor = ({ song, identity }: { song: Song; identity: ParsedScore }) => {
      const coverTitle = song.title.trim();
      if (coverTitle && !/^새 찬양/.test(coverTitle)) return coverTitle;
      return identity.title?.trim() || undefined;
    };
    const further = remaining.flatMap(({ song }) => (song.extraPages ?? []).map((page) => ({
      songId: song.id, page, hint: readByPage.get(page)?.title?.trim() || (isPlaceholderTitle(song.title) ? undefined : song.title.trim()),
    })));
    const furtherImages = await Promise.all(further.map(({ page }) => imageOf(page)));
    const furtherReads = further.map((entry, index) => ({ ...entry, image: furtherImages[index] })).filter((entry): entry is (typeof further)[number] & { image: string } => !!entry.image);
    let furtherScores: ParsedScore[] = [];
    const furtherFor = (id: string) => furtherReads.map((entry, index) => ({ page: entry.page, score: furtherScores[index] })).filter((entry, index) => furtherReads[index].songId === id && !!entry.score);
    let lyricScores: ParsedScore[] | null = null;
    let lyricEngine = '';
    try {
      const lyricResult = await recognizeAdaptiveBatch(
        [...remaining.map(({ image }) => image), ...furtherReads.map(({ image }) => image)],
        settings, 'full',
        [...remaining.map(hintFor), ...furtherReads.map(({ hint }) => hint)],
        reliabilities, undefined,
        promptExamplesFor({ title: remaining[0] ? hintFor(remaining[0]) : undefined, partLabels: ['V', 'C', 'B', 'PC'] }, memory),
        deadline.stageEndsAt('lyrics'),
      );
      lyricScores = lyricResult.scores.slice(0, remaining.length);
      furtherScores = lyricResult.scores.slice(remaining.length);
      lyricEngine = lyricResult.engine;
      for (const modelKey of lyricResult.exhaustedModels) exhausted.add(modelKey);
      remaining.forEach(({ song }, index) => job.confidence.set(song.id, lyricResult.confidence[index] ?? 0));
      run.reviewFlags = new Map(remaining.map(({ song }, index) => [song.id, lyricResult.needsReview[index] ?? false]));
    } catch (error) {
      console.warn('가사 일괄 인식 실패, 곡별 인식으로 전환:', error instanceof Error ? error.message : error);
    }

    const scoreById = new Map<string, ParsedScore>();
    remaining.forEach(({ song, identity }, index) => {
      // The song off all of its pages: the Korean ones are its lyrics (scorePages.ts).
      const read = [{ page: song.pageIndex as number, score: lyricScores?.[index] ?? { order: [], sections: [] } }, ...furtherFor(song.id)];
      const named = isPlaceholderTitle(song.title) ? (identity.title ?? '') : song.title;
      const { score: full } = combinePageReadings(read.map(({ score }) => score), /[가-힣]/.test(named));
      // Learned corrections land after the models agreed and before the web is consulted.
      scoreById.set(song.id, applySafeCorrections({ ...full, title: full.title ?? identity.title, artist: full.artist ?? identity.artist, key: full.key ?? identity.key }, memory));
    });

    // The lyrics pass can identify a title the title pass missed: exclusions first, then the library.
    for (const { song } of remaining) {
      const score = scoreById.get(song.id);
      if (!score) continue;
      if (run.holdStandIn(song, score, settings.excludedTitles) || run.discardNonScorePage(song, score)) {
        scoreById.delete(song.id);
        continue;
      }
      const recognizedTitle = score.title?.trim() || song.title;
      if (recognizedTitle && run.excludeRecognizedSong(song, recognizedTitle, settings.excludedTitles)) {
        scoreById.delete(song.id);
        continue;
      }
      const aliasedTitle = recognizedTitle ? resolveTitleAlias(recognizedTitle, memory) : '';
      const saved = aliasedTitle ? findLibrarySong(job.library, { title: aliasedTitle, artist: score.artist }) : undefined;
      if (saved && run.takeLibraryMatch(song, saved)) scoreById.delete(song.id);
    }

    // Show what the 악보 said straight away; the web pass still checks the wording.
    const recognized = [...scoreById.entries()].filter(([, score]) => score.sections.length > 0);
    if (recognized.length > 0) {
      setSongs(job, (current) => current.map((song) => {
        const score = scoreById.get(song.id);
        return score && score.sections.length > 0 ? applyScoreToSong(song, score) : song;
      }));
      for (const [id, score] of recognized) {
        const printed = remaining.find(({ song }) => song.id === id)?.song.title;
        run.webQueue.set(id, { score, engine: lyricEngine, title: lyricsLookupTitle(printed, score.title) });
      }
    }

    const needRescue = remaining.filter(({ song }) => !run.resolved.has(song.id) && !run.webQueue.has(song.id) && (scoreById.get(song.id)?.sections.length ?? 0) === 0);
    if (needRescue.length > 0) {
      run.enterPhase('rescue', needRescue.map(({ song }) => song.id));
      await rescuePages(run, needRescue, { settings, memory, deadline, lyricEngine, scoreById, furtherFor });
    }
    await runWebLyricsPass(run, { settings, reliabilities });
    run.reportFailures();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const song of active) {
      if (run.resolved.has(song.id)) continue;
      if (job.standIns.has(song.id)) run.keepStandIn(song.id);
      else setOutcome(job, song.id, { status: 'error', message });
    }
  } finally {
    clearInterval(ticker);
    // A spent free allowance is not a recognition failure: "try again tomorrow".
    if (exhausted.size > 0) job.notify(`${ERROR_CATEGORY_LABELS.quota}: ${exhausted.size}개 모델의 오늘 무료 한도가 끝났습니다.`);
  }
  if (run.readAgain.length > 0) await readSlowSongsAgain(job, run.readAgain, ctx);
}

/** Read the songs the models were too slow for again, each on its own, two at a time. */
async function readSlowSongsAgain(job: ContiJob, ids: string[], ctx: RecognitionContext): Promise<void> {
  for (const id of ids) job.autoRetried.add(id);
  await eachWithLimit(ids, RESCUE_CONCURRENCY, async (id) => {
    const song = job.songs.find((candidate) => candidate.id === id);
    if (!song || song.pageIndex == null || (songHasLyrics(song) && !job.standIns.has(id))) {
      if (job.outcomes.get(id)?.status === 'running') setOutcome(job, id, null);
      return;
    }
    await recognizeSongs(job, [song], ctx, true);
  });
}
