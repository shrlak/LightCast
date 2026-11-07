// Is this web page's lyrics the song on the 악보? — the check made before lyrics found on the
// internet go into a song whose 악보 the models could not read the lyrics off.
//
// Several Korean worship songs share a title, so a page found by title (and 작곡자) is only a
// candidate. The 악보 itself decides: the champion models are shown the page image with the
// candidates' lyrics beside it and asked which one is printed under the notes. Reading a whole
// page of small lyric type failed for this song, but recognizing lines one already holds is a far
// easier question, and a model that can read only a few lines can still answer it.
//
// Each model answers on its own. Its answer is also checked here, without a model: the lines it
// says it read off the 악보 must be found in the candidate it chose. A candidate is confirmed when
// more than half of the models that answered name it — otherwise nothing is applied, and the
// operator picks from the candidates while looking at the 악보.
import { RECOGNITION_PROXY } from '../proxy';
import type { AiSettings, RecognitionAttempt } from './aiSettings';
import type { ModelReliability } from './modelReliability';
import { championAttempts } from './adaptiveRecognition';
import { extractGeminiText, geminiError, splitDataUrl } from './scoreAi';
import { callOpenRouter, toImageDataUrl } from './scoreNvidia';
import { parseModelJson } from './scoreParser';
import { RecognitionError } from './recognitionError';
import { lineKey } from '../lyrics/textSimilarity';

/** How long the models get to answer; the check never holds a conti up longer than this. */
export const LYRICS_CHECK_TIMEOUT_MS = 30_000;
/** Candidates shown at once. */
export const MAX_CHECK_CANDIDATES = 4;
/** Lines of each candidate shown: enough to tell two songs apart. */
const LINES_PER_CANDIDATE = 16;
const CHARS_PER_CANDIDATE = 500;
/** A model's "this one" counts only with this many of the candidate's lines seen on the 악보. */
const MIN_MATCHED_LINES = 2;
/** Of the lines a model read off the 악보, at least this share must be in the candidate it chose. */
const MIN_CONTAINMENT = 0.35;

export interface LyricsToCheck {
  id: string;
  lines: string[];
}

/** One model's answer: the candidate it found on the 악보 (-1: none), and what it read there. */
export interface LyricsCheckAnswer {
  match: number;
  matchedLines: number;
  scoreLines: string[];
}

export interface LyricsCheck {
  /** The candidate the 악보 confirmed, or null. */
  matchId: string | null;
  /** Models that gave an answer. */
  answered: number;
  /** Of those, how many named the confirmed candidate (or the most-named one). */
  agreed: number;
}

/** What each candidate shows: its first lines, without blank ones, capped. */
export function candidateText(lines: string[]): string {
  const shown: string[] = [];
  let length = 0;
  for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
    if (shown.length >= LINES_PER_CANDIDATE || length + line.length > CHARS_PER_CANDIDATE) break;
    shown.push(line);
    length += line.length;
  }
  return shown.join('\n');
}

export function lyricsCheckPrompt(title: string, artist: string | undefined, candidates: LyricsToCheck[]): string {
  return [
    `이 이미지는 한국어 찬양 '${title.trim()}'${artist?.trim() ? ` (${artist.trim()})` : ''}의 악보입니다.`,
    `악보에서 가사를 다 읽지 못해, 인터넷에서 이 제목으로 찾은 가사 후보 ${candidates.length}개를 아래에 붙였습니다.`,
    '같은 제목의 다른 곡이 많습니다. 제목이 아니라, 악보의 음표 아래에 인쇄된 가사 글자를 후보의 가사와 한 줄씩 비교하세요.',
    '1) scoreLines: 악보에 인쇄된 가사 중 읽을 수 있는 줄을 최대 4줄, 보이는 그대로 적으세요. 후보에서 베끼지 마세요.',
    '2) match: 악보의 가사와 같은 노래인 후보의 번호. 어느 후보도 악보의 가사와 맞지 않거나, 악보의 가사가 보이지 않아 판단할 수 없으면 -1.',
    '3) matchedLines: 고른 후보의 줄 가운데 악보에 (거의) 그대로 인쇄된 줄의 수. match가 -1이면 0.',
    '띄어쓰기·맞춤법·줄바꿈 차이는 같은 것으로 봅니다. 후보에 악보에 없는 절이 더 있어도 괜찮습니다.',
    '반드시 {"scoreLines":[...],"match":번호,"matchedLines":숫자} 형태의 JSON 객체 하나만 출력하세요.',
    ...candidates.flatMap((candidate, index) => ['', `후보 ${index}:`, candidateText(candidate.lines)]),
  ].join('\n');
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    scoreLines: { type: 'array', items: { type: 'string' } },
    match: { type: 'integer' },
    matchedLines: { type: 'integer' },
  },
  required: ['scoreLines', 'match', 'matchedLines'],
};

export function buildLyricsCheckGeminiBody(image: string, prompt: string): unknown {
  const { mimeType, data } = splitDataUrl(image);
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
  };
}

export function buildLyricsCheckOpenRouterBody(image: string, prompt: string, model: string): unknown {
  return {
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: toImageDataUrl(image) } }] }],
    temperature: 0,
    // A reasoning model thinks out of the same budget before it answers.
    max_tokens: 4096,
  };
}

/** A model's answer, or null when it gave none that can be read. */
export function parseLyricsCheck(text: string, count: number): LyricsCheckAnswer | null {
  let payload: unknown;
  try {
    payload = parseModelJson(text, 'empty', 'unparsable');
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  const match = Number(value.match);
  if (!Number.isInteger(match) || match < -1 || match >= count) return null;
  const matchedLines = Number(value.matchedLines);
  const scoreLines = Array.isArray(value.scoreLines) ? value.scoreLines.filter((l): l is string => typeof l === 'string' && !!l.trim()) : [];
  return { match, matchedLines: Number.isFinite(matchedLines) ? Math.max(0, Math.round(matchedLines)) : 0, scoreLines };
}

function pairs(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i += 1) counts.set(text.slice(i, i + 2), (counts.get(text.slice(i, i + 2)) ?? 0) + 1);
  return counts;
}

/** Share (0–1) of the lines read off the 악보 that a candidate's lyrics hold, by character pairs. */
export function containment(read: string[], lines: string[]): number {
  const mine = pairs(read.map(lineKey).join(''));
  const theirs = pairs(lines.map(lineKey).join(''));
  let total = 0;
  let shared = 0;
  for (const [pair, count] of mine) {
    total += count;
    shared += Math.min(count, theirs.get(pair) ?? 0);
  }
  return total === 0 ? 0 : shared / total;
}

/** Enough lines read off the 악보 to hold the model to them. */
const readEnough = (lines: string[]) => lines.map(lineKey).join('').length >= 6;

/** The candidate a model's answer stands for, after holding it to what it read; -1 for none. */
export function answerVote(answer: LyricsCheckAnswer, candidates: LyricsToCheck[]): number {
  if (answer.match < 0 || answer.matchedLines < MIN_MATCHED_LINES) return -1;
  const chosen = candidates[answer.match];
  if (!chosen) return -1;
  if (readEnough(answer.scoreLines) && containment(answer.scoreLines, chosen.lines) < MIN_CONTAINMENT) return -1;
  return answer.match;
}

/** More than half of the models that answered must name the same candidate. */
export function tallyLyricsChecks(answers: (LyricsCheckAnswer | null)[], candidates: LyricsToCheck[]): LyricsCheck | null {
  const given = answers.filter((answer): answer is LyricsCheckAnswer => answer !== null);
  if (given.length === 0) return null;
  const votes = new Map<number, number>();
  for (const answer of given) {
    const vote = answerVote(answer, candidates);
    votes.set(vote, (votes.get(vote) ?? 0) + 1);
  }
  const [top, count] = [...votes.entries()].filter(([vote]) => vote >= 0).sort((a, b) => b[1] - a[1])[0] ?? [-1, 0];
  return { matchId: top >= 0 && count * 2 > given.length ? candidates[top].id : null, answered: given.length, agreed: count };
}

/** Ask one model; injectable for tests. Resolves to the model's raw text. */
export type LyricsCheckAsk = (attempt: RecognitionAttempt, image: string, prompt: string, settings: AiSettings) => Promise<string>;

const trimSlash = (url: string) => (url.endsWith('/') ? url.slice(0, -1) : url);

export const askModel: LyricsCheckAsk = async (attempt, image, prompt, settings) => {
  if (attempt.engine === 'gemini') {
    const key = settings.geminiApiKey.trim();
    const url = key
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(attempt.model)}:generateContent?key=${encodeURIComponent(key)}`
      : `${trimSlash(RECOGNITION_PROXY)}/gemini/${encodeURIComponent(attempt.model)}`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildLyricsCheckGeminiBody(image, prompt)) });
    if (!res.ok) throw await geminiError(res, 'Gemini 가사 대조 실패');
    return extractGeminiText((await res.json()) as unknown);
  }
  if (attempt.engine === 'openrouter') {
    return callOpenRouter(buildLyricsCheckOpenRouterBody(image, prompt, attempt.model), settings.openrouterApiKey.trim(), RECOGNITION_PROXY);
  }
  throw new RecognitionError('자동 인식이 꺼져 있습니다.', 400);
};

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new RecognitionError('가사 대조 응답 시간 초과', 408)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export interface LyricsCheckOptions {
  title: string;
  artist?: string;
  reliabilities?: ModelReliability[];
  timeoutMs?: number;
  ask?: LyricsCheckAsk;
}

/**
 * Show the 악보 and the candidates to the champion models, each at once, and tally their answers.
 * Null when it could not be checked: no candidates, no model, or no model answered in time.
 */
export async function checkLyricsAgainstScore(
  image: string,
  candidates: LyricsToCheck[],
  settings: AiSettings,
  opts: LyricsCheckOptions,
): Promise<LyricsCheck | null> {
  const shown = candidates.filter((candidate) => candidateText(candidate.lines)).slice(0, MAX_CHECK_CANDIDATES);
  if (!image || shown.length === 0) return null;
  const attempts = championAttempts(settings, opts.reliabilities);
  if (attempts.length === 0) return null;
  const prompt = lyricsCheckPrompt(opts.title, opts.artist, shown);
  const ask = opts.ask ?? askModel;
  const timeoutMs = opts.timeoutMs ?? LYRICS_CHECK_TIMEOUT_MS;
  const answers = await Promise.all(attempts.map(async (attempt) => {
    try {
      return parseLyricsCheck(await withTimeout(ask(attempt, image, prompt, settings), timeoutMs), shown.length);
    } catch (error) {
      // Only that it failed: a provider's error body can echo the prompt, which carries lyrics.
      console.warn(`${attempt.engine} (${attempt.model}) 가사 대조 실패: ${error instanceof RecognitionError ? error.status : 'error'}`);
      return null;
    }
  }));
  return tallyLyricsChecks(answers, shown);
}
