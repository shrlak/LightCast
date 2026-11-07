// Read a 콘티 PDF the way the ppt site does (src/components/LyricsGenerator.tsx with the modules
// under src/domain/recognition) and hand back each song as a SongDraft for the operator to review.
import type { Presentation } from '../../types';
import type { SongDraft } from '../../sunday/songs';
import type { Song } from '../utils/types';
import { loadConti } from '../utils/contiPdf';
import { dateFromFileName } from '../utils/contiPages';
import { getSyncedAiSettings, DEFAULT_CONFESSION_SONG } from '../ai/aiSettings';
import { progressPercent } from '../ai/recognitionProgress';
import { fetchLearningMemory, fetchModelReliabilities } from '../learning/learningClient';
import { loadRecognitionLibrary } from './library';
import { startContiJob } from './contiSongs';
import { recognizeSongs } from './recognizeSongs';
import type { ContiJob, SongOutcome } from './job';

export interface RecognizedSong {
  id: string;
  draft: SongDraft;
  /** Where the lyrics came from: the library, the models, a web page, or the chord sheet's text. */
  source?: 'library' | 'models' | 'web' | 'sheet';
  outcome?: SongOutcome;
  /** The models did not settle on this page: look before using it. */
  needsReview: boolean;
  confidence?: number;
  /** Web pages that might be this song, none sure enough to use. */
  webCandidates: number;
  /** Those pages' lyrics, for the operator to put in while looking at the 악보. */
  webOptions?: WebLyricsOption[];
  /** The 악보 gave no lyrics: whether the models found the web's on it ('confirmed') or not. */
  webCheck?: 'confirmed' | 'unconfirmed';
  /** The song's 악보 page(s), as small JPEG previews for the review. */
  pageImages: string[];
}

/** Lyrics a web page printed for a song, as parts. */
export interface WebLyricsOption {
  id: string;
  /** Where it came from (blog.naver.com, bugs.co.kr …). */
  host: string;
  url: string;
  /** The page's own title. */
  title: string;
  sections: { label: string; lines: string[] }[];
  /** The order the page printed the parts in. */
  order: string[];
}

export interface ContiReading {
  date?: { year?: number; month: number; day: number };
  sermonTitle: string;
  scripture: string;
  songs: RecognizedSong[];
}

export interface ReadContiOptions {
  presentations: Presentation[];
  linesPerSlide: number;
  /** FreeCast's 공동체 고백송 setting; the shared (site) setting is used while it is the default. */
  confessionSong: string;
  notify: (message: string) => void;
  progress: (message: string) => void;
}

const PREVIEW_WIDTH = 900;
const PHASE_LABEL: Record<string, string> = {
  render: '악보 페이지 준비', titles: '제목 인식', lyrics: '가사 인식', crosscheck: '교차 확인', rescue: '다시 읽기', web: '웹 가사 확인',
};

/** "2026.10.18", "10/18/26" → its parts. */
export function parseContiDate(text: string | undefined): ContiReading['date'] {
  const iso = text?.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (iso) return { year: +iso[1], month: +iso[2], day: +iso[3] };
  const us = text?.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) return { year: us[3].length === 2 ? 2000 + +us[3] : +us[3], month: +us[1], day: +us[2] };
  return undefined;
}

/** A recognized song as FreeCast's song draft: parts, 진행 (when it names a part), key, pages. */
export function songToDraft(song: Song): SongDraft {
  const progression = song.order.some((token) => token !== 'I') ? [...song.order] : undefined;
  const pages = song.pageIndex != null ? [song.pageIndex, ...(song.extraPages ?? [])] : undefined;
  return {
    title: song.title.trim(),
    key: song.key || undefined,
    sections: song.sections.map((s) => ({ label: s.label, lines: [...s.lines] })),
    progression,
    postSermon: song.postSermon || undefined,
    pages,
  };
}

function progressLine(job: ContiJob): string {
  const running = [...job.outcomes.values()].filter((o): o is Extract<SongOutcome, { status: 'running' }> => o.status === 'running');
  if (!running.length) return `콘티 ${job.songs.length}곡 정리 중…`;
  const percent = Math.max(...running.map((o) => progressPercent(o.progress)));
  return `AI가 악보를 읽는 중 · ${PHASE_LABEL[running[0].phase] ?? running[0].phase} ${percent}% (${running.length}/${job.songs.length}곡)`;
}

export async function readConti(file: File, opts: ReadContiOptions): Promise<ContiReading> {
  opts.progress('콘티 PDF 여는 중…');
  const doc = await loadConti(await file.arrayBuffer());
  try {
    opts.progress('찬양 라이브러리와 AI 설정 불러오는 중…');
    const [library, settings, reliabilities, memory] = await Promise.all([
      loadRecognitionLibrary(opts.presentations), getSyncedAiSettings(), fetchModelReliabilities(), fetchLearningMemory(),
    ]);
    const confessionSong = opts.confessionSong && opts.confessionSong !== DEFAULT_CONFESSION_SONG ? opts.confessionSong : settings.confessionSong;
    let last = 0;
    const job = startContiJob(doc, library, settings, {
      linesPerSlide: opts.linesPerSlide,
      confessionSong,
      notify: opts.notify,
      changed: () => {
        if (Date.now() - last < 250) return;
        last = Date.now();
        opts.progress(progressLine(job));
      },
    });
    // Every card with a page goes in, as the site's auto-recognition does: the title pass is what
    // keeps non-score pages out, and cards the library filled are simply done (a chord sheet has none).
    const pending = job.songs.filter((song) => song.pageIndex != null);
    if (pending.length) await recognizeSongs(job, pending, { settings, reliabilities, memory });

    opts.progress('검토할 곡 정리 중…');
    const songs: RecognizedSong[] = [];
    for (const song of job.songs) {
      const pages = song.pageIndex != null ? [song.pageIndex, ...(song.extraPages ?? [])] : [];
      const pageImages = await Promise.all(pages.map((page) => doc.renderPage(page, PREVIEW_WIDTH).catch(() => '')));
      const outcome = job.outcomes.get(song.id);
      songs.push({
        id: song.id,
        draft: songToDraft(song),
        source: job.sources.get(song.id),
        outcome,
        needsReview: outcome?.status === 'error' || (outcome?.status === 'done' && !!outcome.needsReview) || !song.sections.length,
        confidence: job.confidence.get(song.id),
        webCandidates: job.webCandidates.get(song.id)?.length ?? 0,
        webOptions: (job.webCandidates.get(song.id) ?? []).map((c) => ({ id: c.id, host: c.sourceHost, url: c.sourceUrl, title: c.title, sections: c.sections.map((s) => ({ label: s.label, lines: [...s.lines] })), order: [...c.order] })),
        webCheck: job.webChecks.get(song.id),
        pageImages: pageImages.filter(Boolean),
      });
    }
    return {
      date: parseContiDate(job.info.date ?? dateFromFileName(file.name)),
      sermonTitle: job.info.sermonTitle ?? '',
      scripture: job.info.scripture ?? '',
      songs,
    };
  } finally {
    doc.destroy();
  }
}
