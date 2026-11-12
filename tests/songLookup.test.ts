import { describe, expect, it } from 'vitest';
import { mergeScores } from '../src/domain/sunday/songLookup';

describe('song lookup: reading 악보 photos', () => {
  it('folds pages into one song: first title/key/진행, each part once', () => {
    const r = mergeScores([
      { title: '주 신실하심', key: 'G', order: ['I', 'V1', 'C'], sections: [{ label: 'V1', lines: ['가'] }, { label: 'C', lines: ['나'] }] },
      { order: [], sections: [{ label: 'C', lines: ['다'] }, { label: 'V2', lines: ['라'] }, { label: 'B', lines: ['  '] }] },
    ]);
    expect(r.title).toBe('주 신실하심');
    expect(r.key).toBe('G');
    expect(r.progression).toEqual(['I', 'V1', 'C']);
    expect(r.sections.map((s) => s.label)).toEqual(['V1', 'C', 'V2']);
    expect(r.sections[1].lines).toEqual(['나']);
  });
  it('leaves 진행 out when it only names the intro', () => {
    expect(mergeScores([{ order: ['I'], sections: [{ label: 'V1', lines: ['가'] }] }]).progression).toBeUndefined();
  });
});
