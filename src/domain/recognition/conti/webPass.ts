// The last stage of a recognition run, from the ppt site's LyricsGenerator: look each new song up
// on the web by its title and 작곡자, and put its published lyrics into the song part by part (the
// 악보 keeps the part labels and 진행, the web supplies the words — see mergeWebLyrics). Songs from
// the library never get here. Several plausible pages and none sure: the 악보's reading stays.
//
// A song whose 악보 gave no lyrics at all is also searched on the internet from this computer
// ("<제목> <작곡자> 찬양 가사", see searchLyricsOnline), and whatever is found is checked against
// the 악보 before it goes in (lyricsCheck): only lyrics the models find printed on it are used.
import {
  fetchWebLyricsForTitles,
  hasWebLyricsLookup,
  lyricSample,
  sameLyrics,
  searchLyricsOnline,
  type ScoredLyricsCandidate,
  type WebLyricsLookup,
} from '../lyrics/webLyrics';
import { mergeRankedWebLyrics, mergeWebLyrics } from '../lyrics/mergeWebLyrics';
import { hasSlideNumberParts, savedWordsInParts } from '../lyrics/savedLyrics';
import { applyScoreToSong } from '../ai/scoreMerge';
import { checkLyricsAgainstScore, type LyricsCheck } from '../ai/lyricsCheck';
import type { AiSettings } from '../ai/aiSettings';
import type { ModelReliability } from '../ai/modelReliability';
import { setSongs } from './job';
import type { RecognitionRun, WebQueued } from './songOutcomes';

export interface WebPassContext {
  settings: AiSettings;
  reliabilities?: ModelReliability[];
}

/** Ask the models whether the 악보 prints one of these; null when that could not be asked. */
export type CheckAgainstScore = (entry: WebQueued, candidates: ScoredLyricsCandidate[]) => Promise<LyricsCheck | null>;

function checkerFor(ctx: WebPassContext | undefined): CheckAgainstScore {
  return async (entry, candidates) => {
    if (!ctx || !entry.image) return null;
    return checkLyricsAgainstScore(
      entry.image,
      candidates.map((candidate) => ({ id: candidate.id, lines: candidate.sections.flatMap((section) => section.lines) })),
      ctx.settings,
      { title: entry.title, artist: entry.score.artist, reliabilities: ctx.reliabilities },
    );
  };
}

/** The pages both lookups found, each set of lyrics once: the shared proxy's first (it scored them). */
export function poolCandidates(lookup: WebLyricsLookup, searched: ScoredLyricsCandidate[]): ScoredLyricsCandidate[] {
  const pool = [...lookup.candidates];
  for (const candidate of searched) if (!pool.some((known) => sameLyrics(known, candidate))) pool.push(candidate);
  return pool;
}

export async function runWebLyricsPass(run: RecognitionRun, ctx?: WebPassContext, check: CheckAgainstScore = checkerFor(ctx)): Promise<void> {
  const { job } = run;
  const pending = [...run.webQueue.entries()];
  if (pending.length === 0) return;
  if (!hasWebLyricsLookup()) {
    for (const [id, { score, engine }] of pending) run.settleWithoutWeb(id, score, engine, '가사를 읽지 못했습니다.');
    return;
  }
  run.enterPhase('web', pending.map(([id]) => id));
  await Promise.all(pending.map(async ([id, entry]) => {
    const { score, engine, title, unread } = entry;
    const notFound = unread ? `${unread.trim()} 웹에서도 가사를 찾지 못했습니다.` : '가사를 읽지 못했고 웹에서도 찾지 못했습니다.';
    const standIn = job.standIns.get(id);
    // Nothing read off the 악보 (and no saved words to go by): the internet is searched as well, by
    // title and 작곡자, and the 악보 decides which page — if any — is this song.
    const unreadSong = score.sections.length === 0 && !standIn;
    // What the models read is sent as matching evidence, so a page that merely shares this title
    // cannot be mistaken for this song; the title read off the 악보 is searched as well as the
    // conti's, and the 작곡자 it prints. A stand-in's saved words are this song's own, and better
    // evidence.
    const [lookup, searched] = await Promise.all([
      title
        ? fetchWebLyricsForTitles([score.title, title], { artist: score.artist, sample: lyricSample(standIn ? standIn.entry.sections : score.sections) })
        : Promise.resolve<WebLyricsLookup>({ candidates: [], links: [] }),
      unreadSong && title ? searchLyricsOnline({ title, artist: score.artist }) : Promise.resolve([]),
    ]);

    if (unreadSong) {
      const pool = poolCandidates(lookup, searched);
      if (pool.length === 0) return run.settleWithoutWeb(id, score, engine, notFound);
      const verdict = await check(entry, pool).catch(() => null);
      const confirmed = verdict?.matchId ? pool.find((candidate) => candidate.id === verdict.matchId) : undefined;
      if (confirmed) {
        const merged = mergeWebLyrics(score, confirmed);
        run.applyRecognizedScore(id, merged.score, engine, 'web');
        job.webChecks.set(id, 'confirmed');
        job.notify(`'${title}' 가사를 악보에서 읽지 못해 ${confirmed.sourceHost || '웹'}에서 찾았고, 악보와 대조해 같은 곡임을 확인했습니다 (모델 ${verdict!.agreed}/${verdict!.answered}).`);
        return;
      }
      // Unchecked (no model answered), a page the proxy is sure of goes in as before.
      const auto = verdict ? undefined : pool.find((candidate) => candidate.decision === 'auto');
      if (auto) {
        const merged = mergeWebLyrics(score, auto);
        run.applyRecognizedScore(id, merged.score, engine, 'web');
        job.notify(`'${title}' 가사를 ${auto.sourceHost}에서 가져왔습니다.`);
        return;
      }
      // Found, but not shown to be this song: the operator picks one while looking at the 악보.
      job.webCandidates.set(id, pool);
      if (verdict) job.webChecks.set(id, 'unconfirmed');
      setSongs(job, (current) => current.map((song) => (song.id === id ? { ...applyScoreToSong(song, mergeWebLyrics(score, null).score), verification: 'draft' } : song)));
      job.sources.set(id, 'models');
      run.markDone([id], engine);
      return;
    }

    const auto = lookup.candidates.find((candidate) => candidate.decision === 'auto') ?? null;
    const review = lookup.candidates.filter((candidate) => candidate.decision === 'review');

    if (!auto && review.length > 0) {
      job.webCandidates.set(id, review);
      if (standIn) return run.settleWithoutWeb(id, score, engine, '');
      const normalized = mergeWebLyrics(score, null);
      setSongs(job, (current) => current.map((song) => (song.id === id ? { ...applyScoreToSong(song, normalized.score), verification: 'draft' } : song)));
      job.sources.set(id, 'models');
      run.markDone([id], engine);
      return;
    }
    if (!auto) return run.settleWithoutWeb(id, score, engine, notFound);
    const merged = mergeRankedWebLyrics(score, auto);
    if (merged.score.sections.length === 0) {
      run.failures.set(id, notFound);
      return;
    }
    // Saved words somebody confirmed stay: the 악보 and the page give the parts.
    if (standIn?.trusted) {
      const laid = savedWordsInParts(merged.score.sections, standIn.entry.sections, hasSlideNumberParts(standIn.entry.sections));
      if (laid.matched > 0) {
        run.applyRecognizedScore(id, { ...merged.score, sections: laid.sections }, engine, 'library');
        job.notify(`'${standIn.entry.title}'의 저장된 가사를 악보·웹의 파트 ${laid.matched}개에 나눠 넣었습니다.`);
        return;
      }
    }
    run.applyRecognizedScore(id, merged.score, engine, 'web');
    if (merged.outcome !== 'unused') {
      job.notify(merged.outcome === 'filled'
        ? `'${title}' 가사를 ${auto.sourceHost}에서 가져왔습니다.`
        : `'${title}' 가사를 ${auto.sourceHost}에서 찾아 ${merged.correctedParts}개 파트에 나눠 넣었습니다.`);
    }
  }));
}
