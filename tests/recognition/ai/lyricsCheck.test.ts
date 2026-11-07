import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_SETTINGS } from '../../../src/domain/recognition/ai/aiSettings';
import {
  answerVote,
  buildLyricsCheckGeminiBody,
  buildLyricsCheckOpenRouterBody,
  candidateText,
  checkLyricsAgainstScore,
  containment,
  lyricsCheckPrompt,
  parseLyricsCheck,
  tallyLyricsChecks,
  type LyricsCheckAsk,
} from '../../../src/domain/recognition/ai/lyricsCheck';

const right = { id: 'right', lines: ['주 신실하심 놀라워', '매일 아침마다 새롭고', '', '오 신실하신 주', '내 삶의 모든 순간 함께하시네'] };
const other = { id: 'other', lines: ['주 신실하심 놀라워라', '온 땅이 주를 찬양해', '하늘과 바다가 노래해', '영원히 높임 받으소서'] };
const candidates = [other, right];
const answer = (match: number, matchedLines: number, scoreLines: string[] = []) => JSON.stringify({ match, matchedLines, scoreLines });

describe('checking web lyrics against the 악보', () => {
  it('shows the models the title, the 작곡자 and each candidate’s first lines', () => {
    const prompt = lyricsCheckPrompt('주 신실하심 놀라워', '마커스', candidates);
    expect(prompt).toContain("'주 신실하심 놀라워' (마커스)");
    expect(prompt).toContain('후보 0:\n주 신실하심 놀라워라');
    expect(prompt).toContain('후보 1:\n주 신실하심 놀라워\n매일 아침마다 새롭고\n오 신실하신 주');
    expect(prompt).toContain('-1');
    // Long pages are cut, blank lines left out.
    expect(candidateText(Array.from({ length: 40 }, (_, i) => `줄 ${i}`)).split('\n')).toHaveLength(16);
  });

  it('sends the page image with the question, to Gemini and to OpenRouter', () => {
    const gemini = buildLyricsCheckGeminiBody('data:image/png;base64,AAA', 'q') as { contents: { parts: Record<string, unknown>[] }[]; generationConfig: { responseMimeType: string } };
    expect(gemini.contents[0].parts).toEqual([{ text: 'q' }, { inline_data: { mime_type: 'image/png', data: 'AAA' } }]);
    expect(gemini.generationConfig.responseMimeType).toBe('application/json');
    const openrouter = buildLyricsCheckOpenRouterBody('data:image/png;base64,AAA', 'q', 'm') as { model: string; messages: { content: unknown[] }[] };
    expect(openrouter.model).toBe('m');
    expect(openrouter.messages[0].content).toEqual([{ type: 'text', text: 'q' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }]);
  });

  it('reads an answer, wrapped in prose or not, and drops one that names no candidate', () => {
    expect(parseLyricsCheck('```json\n{"match":1,"matchedLines":3,"scoreLines":["오 신실하신 주"]}\n```', 2)).toEqual({ match: 1, matchedLines: 3, scoreLines: ['오 신실하신 주'] });
    expect(parseLyricsCheck(answer(-1, 0), 2)).toEqual({ match: -1, matchedLines: 0, scoreLines: [] });
    expect(parseLyricsCheck(answer(5, 3), 2)).toBeNull();
    expect(parseLyricsCheck('모르겠습니다', 2)).toBeNull();
  });

  it('holds a model to the lines it says it read off the 악보', () => {
    expect(containment(['오 신실하신 주'], right.lines)).toBe(1);
    expect(containment(['오 신실하신 주', '내 삶의 모든 순간 함께하시네'], other.lines)).toBeLessThan(0.35);
    // Picked the right one, and what it read is in it.
    expect(answerVote({ match: 1, matchedLines: 3, scoreLines: ['오 신실하신 주', '매일 아침마다'] }, candidates)).toBe(1);
    // Picked the other song although what it read is not in it: no vote.
    expect(answerVote({ match: 0, matchedLines: 3, scoreLines: ['오 신실하신 주', '내 삶의 모든 순간'] }, candidates)).toBe(-1);
    // Too few lines seen to count.
    expect(answerVote({ match: 1, matchedLines: 1, scoreLines: [] }, candidates)).toBe(-1);
  });

  it('confirms a candidate only when more than half of the models that answered name it', () => {
    const yes = { match: 1, matchedLines: 4, scoreLines: [] };
    const no = { match: -1, matchedLines: 0, scoreLines: [] };
    expect(tallyLyricsChecks([yes, yes, no], candidates)).toEqual({ matchId: 'right', answered: 3, agreed: 2 });
    expect(tallyLyricsChecks([yes, no], candidates)).toEqual({ matchId: null, answered: 2, agreed: 1 });
    // A model that did not answer does not count either way.
    expect(tallyLyricsChecks([yes, null, null], candidates)).toEqual({ matchId: 'right', answered: 1, agreed: 1 });
    expect(tallyLyricsChecks([null, null], candidates)).toBeNull();
  });

  it('asks the champion models together and tallies what comes back in time', async () => {
    const asked: string[] = [];
    let call = 0;
    const ask: LyricsCheckAsk = async (attempt, image, prompt) => {
      asked.push(attempt.model);
      expect(image).toBe('data:image/png;base64,page');
      expect(prompt).toContain('후보 1:');
      call += 1;
      if (call === 1) throw new Error('busy');
      return answer(1, 3, ['오 신실하신 주']);
    };
    const result = await checkLyricsAgainstScore('data:image/png;base64,page', candidates, DEFAULT_AI_SETTINGS, { title: '주 신실하심 놀라워', artist: '마커스', ask });
    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(result).toEqual({ matchId: 'right', answered: asked.length - 1, agreed: asked.length - 1 });
    // A model that never answers is cut off.
    const silent: LyricsCheckAsk = () => new Promise(() => undefined);
    expect(await checkLyricsAgainstScore('data:image/png;base64,page', candidates, DEFAULT_AI_SETTINGS, { title: 't', ask: silent, timeoutMs: 20 })).toBeNull();
    // Nothing to check without a page or candidates.
    expect(await checkLyricsAgainstScore('', candidates, DEFAULT_AI_SETTINGS, { title: 't', ask })).toBeNull();
    expect(await checkLyricsAgainstScore('data:image/png;base64,page', [], DEFAULT_AI_SETTINGS, { title: 't', ask })).toBeNull();
  });
});
