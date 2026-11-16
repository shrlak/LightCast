import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { converge, pres, setup, textOf } from './helpers/cloudSim';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T09:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('two computers, ordinary editing', () => {
  it('a new computer gets the first one\'s library and then both are quiet', async () => {
    const { worker, clients: [a, b] } = await setup(2);
    a.dispatch({ type: 'presentation/create', presentation: pres('p_new', '새 찬양') });
    await converge([a, b]);
    expect(b.titles()).toContain('새 찬양');
    expect(a.titles()).toEqual(b.titles());
    const puts = worker.count('PUT', 'library');
    await converge([a, b]);
    expect(worker.count('PUT', 'library')).toBe(puts);
  });

  it('an edit on A reaches B', async () => {
    const { clients: [a, b] } = await setup(2);
    await converge([a, b]);
    a.dispatch({ type: 'slide/update', presentationId: 'p_grace', slideId: a.presentation('p_grace')!.slides[0].id, patch: { text: '고친 가사' } });
    await converge([a, b]);
    expect(b.presentation('p_grace')!.slides[0].text).toBe('고친 가사');
  });

  it('edits to different presentations on both sides are both kept', async () => {
    const { clients: [a, b] } = await setup(2);
    await converge([a, b]);
    a.dispatch({ type: 'presentation/update', id: 'p_grace', patch: { title: 'A가 바꿈' } });
    b.dispatch({ type: 'presentation/update', id: 'p_doxology', patch: { title: 'B가 바꿈' } });
    await converge([a, b]);
    for (const c of [a, b]) {
      expect(c.presentation('p_grace')!.title).toBe('A가 바꿈');
      expect(c.presentation('p_doxology')!.title).toBe('B가 바꿈');
    }
  });

  it('the same presentation changed on both sides is kept twice, on both computers', async () => {
    const { clients: [a, b] } = await setup(2);
    await converge([a, b]);
    a.dispatch({ type: 'presentation/update', id: 'p_grace', patch: { title: 'A 제목' } });
    b.dispatch({ type: 'presentation/update', id: 'p_grace', patch: { title: 'B 제목' } });
    await a.settle();
    await b.settle();
    await converge([a, b]);
    expect(a.titles()).toEqual(b.titles());
    expect(a.titles().filter((t) => /A 제목|B 제목/.test(t)).length).toBe(2);
  });

  it('a delete on A is not undone by B, and an edit on B beats an older delete', async () => {
    const { clients: [a, b] } = await setup(2);
    await converge([a, b]);
    a.dispatch({ type: 'presentation/delete', id: 'p_doxology' });
    await converge([a, b]);
    expect(b.presentation('p_doxology')).toBeUndefined();
    expect(a.presentation('p_doxology')).toBeUndefined();
  });

  it('deleted on one, edited on the other: the edit survives', async () => {
    const { clients: [a, b] } = await setup(2);
    await converge([a, b]);
    a.dispatch({ type: 'presentation/delete', id: 'p_doxology' });
    b.dispatch({ type: 'presentation/update', id: 'p_doxology', patch: { title: '고친 송영' } });
    await a.settle(); await b.settle();
    await converge([a, b]);
    expect(a.presentation('p_doxology')?.title).toBe('고친 송영');
    expect(b.presentation('p_doxology')?.title).toBe('고친 송영');
    void textOf;
  });

  it('three computers editing the same slide end with one copy per other version, the same everywhere', async () => {
    const { clients } = await setup(3);
    await converge(clients);
    const slideId = clients[0].presentation('p_grace')!.slides[0].id;
    for (const c of clients) c.dispatch({ type: 'slide/update', presentationId: 'p_grace', slideId, patch: { text: `${c.name}의 가사` } });
    for (const c of clients) await c.settle();
    await converge(clients);
    const texts = (c: typeof clients[number]) => c.lib.presentations.filter((p) => p.title.startsWith('Amazing Grace')).map((p) => p.slides[0].text).sort();
    expect(texts(clients[0])).toEqual(['A의 가사', 'B의 가사', 'C의 가사']);
    for (const c of clients) expect(texts(c)).toEqual(texts(clients[0]));
  });
});
