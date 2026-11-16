import { beforeEach, describe, expect, it } from 'vitest';
import {
  contiDoneMessage, dismissContiRun, getContiRun, markContiAnnounced, markContiApplied, resetContiRunForTests,
  songsUnchangedSince, startContiRun, subscribeContiRun, type ContiReader,
} from '../src/domain/sunday/contiRun';
import type { ContiReading } from '../src/domain/recognition/conti';

const file = (name = '1122 콘티.pdf') => new File(['x'], name, { type: 'application/pdf' });
const reading = (n = 2, review = 0): ContiReading => ({
  sermonTitle: '제목', scripture: '요 3:16',
  songs: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, draft: { title: `곡${i}`, sections: [] }, needsReview: i < review, webCandidates: 0, pageImages: [] })),
});
const opts = { presentations: [], linesPerSlide: 2, confessionSong: '', songsAtStart: '[]' };

/** A reader that finishes when the test says so. */
function gate() {
  let finish!: (r: ContiReading) => void, fail!: (e: Error) => void, progress!: (m: string) => void, notify!: (m: string) => void;
  const reader: ContiReader = (_f, o) => new Promise((res, rej) => { finish = res; fail = rej; progress = o.progress; notify = o.notify; });
  return { reader, finish: (r: ContiReading) => finish(r), fail: (e: Error) => fail(e), progress: (m: string) => progress(m), notify: (m: string) => notify(m) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => resetContiRunForTests());

describe('콘티 reading outside the screens', () => {
  it('starts running, shows progress, and ends with the result', async () => {
    const g = gate();
    const seen: string[] = [];
    subscribeContiRun(() => seen.push(getContiRun()?.status ?? 'none'));
    const run = startContiRun(file(), opts, g.reader)!;
    expect(run).toMatchObject({ status: 'running', fileName: '1122 콘티.pdf', applied: false });
    g.progress('2/5곡 읽는 중');
    expect(getContiRun()?.progress).toBe('2/5곡 읽는 중');
    g.notify('한 쪽은 곡이 아니라 건너뛰었습니다.');
    g.finish(reading(2));
    await tick();
    const done = getContiRun()!;
    expect(done).toMatchObject({ status: 'done', progress: '', notes: ['한 쪽은 곡이 아니라 건너뛰었습니다.'] });
    expect(done.reading?.songs).toHaveLength(2);
    expect(seen.at(0)).toBe('running');
    expect(seen.at(-1)).toBe('done');
  });

  it('goes on when every screen is gone: nobody listening does not stop it, and the late notice is told once', async () => {
    const g = gate();
    const told: string[] = [];
    const off = subscribeContiRun(() => undefined); // a screen is showing it
    startContiRun(file(), { ...opts, notifyLate: (m) => told.push(m) }, g.reader);
    off();                                          // the wizard is closed, or another tab is open
    expect(getContiRun()?.status).toBe('running');
    g.finish(reading(3, 1));
    await tick();
    expect(getContiRun()).toMatchObject({ status: 'done', announced: true });
    expect(told).toHaveLength(1);
    expect(told[0]).toContain('3곡');
    expect(told[0]).toContain('1곡은 악보와 맞는지 확인하세요');
    expect(told[0]).toContain('주일예배 마법사의 찬양 단계');
  });

  it('does not tell it late while a screen is listening (the wizard tells it itself)', async () => {
    const g = gate();
    const told: string[] = [];
    subscribeContiRun(() => undefined);
    startContiRun(file(), { ...opts, notifyLate: (m) => told.push(m) }, g.reader);
    g.finish(reading());
    await tick();
    expect(told).toEqual([]);
    expect(getContiRun()?.announced).toBe(false);
  });

  it('reads one 콘티 at a time: a second start while one runs changes nothing', async () => {
    const g = gate();
    const first = startContiRun(file('a.pdf'), opts, g.reader)!;
    const second = startContiRun(file('b.pdf'), opts, gate().reader);
    expect(second).toBeNull();
    expect(getContiRun()?.id).toBe(first.id);
    expect(getContiRun()?.fileName).toBe('a.pdf');
    g.finish(reading());
    await tick();
    // once it has ended, the next 콘티 can be read
    const third = startContiRun(file('c.pdf'), opts, gate().reader);
    expect(third?.fileName).toBe('c.pdf');
    expect(third?.id).toBeGreaterThan(first.id);
  });

  it('a failed reading is an error with its message, and the next one can start', async () => {
    const g = gate();
    startContiRun(file(), opts, g.reader);
    g.fail(new Error('AI 키가 없습니다'));
    await tick();
    expect(getContiRun()).toMatchObject({ status: 'error', error: 'AI 키가 없습니다' });
    expect(startContiRun(file(), opts, gate().reader)).not.toBeNull();
  });

  it('a late failure is told once too', async () => {
    const g = gate();
    const told: string[] = [];
    startContiRun(file(), { ...opts, notifyLate: (m) => told.push(m) }, g.reader);
    g.fail(new Error('PDF를 열지 못했습니다'));
    await tick();
    expect(told).toEqual(['콘티 읽기에 실패했습니다: PDF를 열지 못했습니다']);
  });

  it('applied / announced / dismissed', async () => {
    const g = gate();
    const { id } = startContiRun(file(), opts, g.reader)!;
    dismissContiRun(id);
    expect(getContiRun()?.status).toBe('running');   // a running one stays
    g.finish(reading());
    await tick();
    markContiAnnounced(id);
    expect(getContiRun()).toMatchObject({ announced: true, applied: false });
    markContiApplied(id);
    expect(getContiRun()).toMatchObject({ applied: true, announced: true });
    markContiApplied(id + 99);                        // another run's id changes nothing
    dismissContiRun(id);
    expect(getContiRun()).toBeNull();
  });

  it('the snapshot changes on every update, so a screen subscribed to it redraws', () => {
    const g = gate();
    startContiRun(file(), opts, g.reader);
    const a = getContiRun();
    g.progress('1/3');
    const b = getContiRun();
    expect(b).not.toBe(a);
    expect(a?.progress).toBe('콘티 읽는 중…');
    expect(b?.progress).toBe('1/3');
  });

  it('the result replaces the songs only if nobody changed them since the reading started', () => {
    const g = gate();
    const run = startContiRun(file(), { ...opts, songsAtStart: JSON.stringify([{ title: 'A', sections: [] }]) }, g.reader)!;
    expect(songsUnchangedSince(run, JSON.stringify([{ title: 'A', sections: [] }]))).toBe(true);
    expect(songsUnchangedSince(run, JSON.stringify([{ title: 'A', sections: [] }, { title: 'B', sections: [] }]))).toBe(false);
  });

  it('says how many songs it read and which need a look', () => {
    const g = gate();
    startContiRun(file(), opts, g.reader);
    g.finish(reading(4, 2));
    return tick().then(() => {
      const m = contiDoneMessage(getContiRun()!);
      expect(m).toContain('4곡');
      expect(m).toContain('2곡은 악보와 맞는지 확인하세요');
    });
  });
});
