// A song that is not in 찬양 라이브러리: find its lyrics on the internet ("AI로 검색"), or read them
// off a photo of its 악보 / lyrics ("악보 사진 업로드"). Both reuse the 콘티 recognition's parts.
import type { SongDraft, SongSection } from './songs';
import { fetchWebLyricsForTitles, hasWebLyricsLookup, sameLyrics, searchLyricsOnline, type ScoredLyricsCandidate } from '../recognition/lyrics/webLyrics';
import { getSyncedAiSettings } from '../recognition/ai/aiSettings';
import { recognizeScore } from '../recognition/ai/scoreRecognition';
import type { ParsedScore } from '../recognition/ai/scoreParser';

/** Lyrics a web page printed, for the operator to put in. */
export interface LyricsOption {
  id: string;
  host: string;
  url: string;
  title: string;
  sections: SongSection[];
  order: string[];
}

const toOption = (c: ScoredLyricsCandidate): LyricsOption => ({
  id: c.id,
  host: c.sourceHost,
  url: c.sourceUrl,
  title: c.title,
  sections: c.sections.map((s) => ({ label: s.label, lines: [...s.lines] })),
  order: [...c.order],
});

/** Search the internet for a song's lyrics: the shared lookup and this computer's search, pooled (each lyrics once). */
export async function searchSongLyrics(title: string, signal?: AbortSignal): Promise<LyricsOption[]> {
  const t = title.trim();
  if (!t) return [];
  const [lookup, searched] = await Promise.all([
    hasWebLyricsLookup() ? fetchWebLyricsForTitles([t], {}, signal) : Promise.resolve({ candidates: [], links: [] }),
    searchLyricsOnline({ title: t }, signal),
  ]);
  const pool = [...lookup.candidates];
  for (const c of searched) if (!pool.some((known) => sameLyrics(known, c))) pool.push(c);
  return pool.slice(0, 6).map(toOption);
}

/** A photo's longest side is cut to this before it goes to the models (phone photos are 4000+ px). */
const MAX_SIDE = 1800;

/** An image file as a JPEG data URL, scaled down so the upload stays small. */
export async function imageFileToDataUrl(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('이미지를 열 수 없습니다. JPG, PNG 사진을 올려 주세요.');
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지를 처리할 수 없습니다.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.88);
}

/** What was read off the photos: parts, and the title / key / 진행 when the page printed them. */
export type PhotoReading = Pick<SongDraft, 'sections'> & { title?: string; key?: string; progression?: string[] };

/** Fold the pages' readings into one song: the first page's title / key / 진행, every part once (a repeated label is skipped). */
export function mergeScores(scores: ParsedScore[]): PhotoReading {
  const sections: SongSection[] = [];
  const seen = new Set<string>();
  for (const score of scores) {
    for (const s of score.sections) {
      if (!s.lines.some((l) => l.trim()) || seen.has(s.label)) continue;
      seen.add(s.label);
      sections.push({ label: s.label, lines: [...s.lines] });
    }
  }
  const first = scores.find((s) => s.title || s.key || s.order.length) ?? scores[0];
  const order = scores.find((s) => s.order.length)?.order ?? [];
  return {
    sections,
    title: first?.title?.trim() || undefined,
    key: scores.find((s) => s.key)?.key || undefined,
    progression: order.some((t) => t !== 'I') ? [...order] : undefined,
  };
}

/** Read the lyrics (and title, key, 진행) off photos of a 악보 with the recognition models. */
export async function readScorePhotos(files: File[], progress?: (message: string) => void): Promise<PhotoReading> {
  const settings = await getSyncedAiSettings();
  const scores: ParsedScore[] = [];
  for (const [i, file] of files.entries()) {
    progress?.(`사진 ${i + 1}/${files.length} 읽는 중…`);
    const dataUrl = await imageFileToDataUrl(file);
    scores.push((await recognizeScore(dataUrl, settings)).score);
  }
  const reading = mergeScores(scores);
  if (!reading.sections.length) throw new Error('사진에서 가사를 읽지 못했습니다. 가사가 또렷하게 보이는 사진으로 다시 시도해 주세요.');
  return reading;
}
