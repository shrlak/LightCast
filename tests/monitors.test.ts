import { describe, expect, it } from 'vitest';
import { changeNotice, diffMonitors, fromDesktop, fromScreenDetails, loadChoice, normalizeChoice, popupFeatures, resolveMonitors, saveChoice, type Monitor } from '../src/domain/monitors';

const main: Monitor = { id: '1', label: '노트북', primary: true };
const tv: Monitor = { id: '2', label: '프로젝터', primary: false };
const tv2: Monitor = { id: '3', label: 'TV', primary: false };

describe('monitors', () => {
  it('uses no explicit monitor with a single display', () => {
    expect(resolveMonitors([main], { audience: null, presenter: null })).toEqual({ audience: null, presenter: null, notes: [] });
    expect(resolveMonitors([main], { audience: '2', presenter: null }).notes).toHaveLength(1);
  });

  it('defaults to audience on the other display and presenter on the main one', () => {
    const r = resolveMonitors([main, tv], { audience: null, presenter: null });
    expect(r.audience).toBe(tv);
    expect(r.presenter).toBe(main);
  });

  it('keeps a valid choice', () => {
    const r = resolveMonitors([main, tv, tv2], { audience: '3', presenter: '2' });
    expect([r.audience?.id, r.presenter?.id]).toEqual(['3', '2']);
    expect(r.notes).toEqual([]);
  });

  it('falls back and says so when a chosen display is gone', () => {
    const r = resolveMonitors([main, tv], { audience: '9', presenter: '8' });
    expect(r.audience).toBe(tv);
    expect(r.presenter).toBe(main);
    expect(r.notes).toHaveLength(2);
  });

  it('never gives both roles to one display', () => {
    const r = resolveMonitors([main, tv], { audience: '1', presenter: '1' });
    expect(r.audience?.id).toBe('2');
    expect(r.presenter?.id).toBe('1');
    expect(r.notes.length).toBe(1);
  });

  it('reports added and removed displays', () => {
    expect(diffMonitors([main], [main, tv]).added).toEqual([tv]);
    expect(diffMonitors([main, tv], [main]).removed).toEqual([tv]);
    expect(changeNotice([main, tv], [main])).toContain('프로젝터');
    expect(changeNotice([main], [main, tv])).toContain('연결되었습니다');
    expect(changeNotice([main], [main])).toBeNull();
  });

  it('reads Electron and Window Management displays', () => {
    expect(fromDesktop([{ id: 5, label: 'A', primary: true }])[0].id).toBe('5');
    const m = fromScreenDetails([{ label: 'X', isPrimary: true, left: 0, top: 0, width: 1920, height: 1080 }, { left: 1920, top: 0, width: 1280, height: 720 }]);
    expect(m).toHaveLength(2);
    expect(m[1].label).toContain('모니터 2');
    expect(popupFeatures(m[1])).toContain('left=1920');
    expect(popupFeatures(null)).toBe('popup,width=960,height=540');
  });

  it('normalizes and stores the choice, tolerating bad data', () => {
    expect(normalizeChoice('x')).toEqual({ audience: null, presenter: null });
    expect(normalizeChoice({ audience: 4, presenter: {} })).toEqual({ audience: '4', presenter: null });
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveChoice({ audience: '2', presenter: '1' }, storage);
    expect(loadChoice(storage)).toEqual({ audience: '2', presenter: '1' });
    expect(loadChoice({ getItem: () => '{bad' })).toEqual({ audience: null, presenter: null });
    expect(loadChoice({ getItem: () => { throw new Error('x'); } })).toEqual({ audience: null, presenter: null });
  });
});
