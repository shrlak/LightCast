import { describe, expect, it } from 'vitest';
import { importedOpeningDeck, titleFromFileName } from '../src/domain/sunday/openingImport';
import { findOpeningDeck, OPENING_FOLDER } from '../src/domain/sunday/openingSong';
import { buildService } from '../src/domain/sunday/service';
import { createSeedLibrary } from '../src/domain/defaults';
import { deckBytes, NO_PPT_CONVERTER, PPT_DESKTOP_ONLY, canTryPpt } from '../src/domain/io/pptDownload';
import { describeReport, importFilesWithSummary, isImportable, IMPORT_ACCEPT } from '../src/ui/importSummary';
import { syncable } from '../src/domain/cloudMerge';
import type { Slide } from '../src/domain/types';

const slide = (id: string): Slide => ({ id, group: 'g', text: '' });
const file = (name: string, type = '') => new File(['x'], name, { type });

describe('기도회 찬양 from a file', () => {
  it('names the deck after the file when no title was typed', () => {
    expect(titleFromFileName('주를 찾는 모든 자들이.pptx')).toBe('주를 찾는 모든 자들이');
    expect(titleFromFileName('Be_Thou_My_Vision.ppt')).toBe('Be Thou My Vision');
  });
  it('is a library deck in the searched decks folder that next week finds again by title', () => {
    const deck = importedOpeningDeck(' 은혜 ', [slide('a'), slide('b')], '은혜.ppt');
    expect(deck.folder).toBe(OPENING_FOLDER);
    expect(deck.title).toBe('은혜');
    expect(findOpeningDeck([deck], '은혜!')).toBe(deck);
    const again = importedOpeningDeck('은혜', [slide('c')], '은혜2.pptx');
    expect(findOpeningDeck([deck, again], '은혜')).toBe(again);
  });
  it('goes in front of the Front slides and syncs with the library', () => {
    const lib = createSeedLibrary();
    const deck = importedOpeningDeck('은혜', [slide('a')], '은혜.pptx');
    const built = buildService(lib, {
      date: new Date(2026, 10, 1), songs: [], scriptureSlides: [], sermonSlides: [], prayerTopics: [{ title: 'A', points: [] }], announcements: [], extraSlides: [], openingSong: deck,
    } as never);
    const ids = built.playlist.items.filter((i) => i.kind !== 'header').map((i) => (i as { presentationId: string }).presentationId);
    expect(ids[0]).toBe(deck.id);
    expect(syncable({ ...lib, presentations: [...lib.presentations, deck] }).presentations).toContain(deck);
  });
});

describe('.pptx / .ppt download', () => {
  const lib = createSeedLibrary();
  const source = { presentation: lib.presentations[0] };
  const build = async () => new Uint8Array([0x50, 0x4b, 3, 4]);
  it('gives .pptx everywhere', async () => {
    expect(await deckBytes(lib, source, 'pptx', undefined, build)).toEqual(await build());
  });
  it('says .ppt is desktop only in the browser', async () => {
    expect(canTryPpt(undefined)).toBe(false);
    await expect(deckBytes(lib, source, 'ppt', undefined, build)).rejects.toThrow(PPT_DESKTOP_ONLY);
  });
  it('says clearly when no converter is installed', async () => {
    await expect(deckBytes(lib, source, 'ppt', { pptxToPpt: async () => null }, build)).rejects.toThrow(NO_PPT_CONVERTER);
    await expect(deckBytes(lib, source, 'ppt', { pptxToPpt: async () => { throw new Error('x'); } }, build)).rejects.toThrow(NO_PPT_CONVERTER);
  });
  it('returns what the converter made', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]);
    expect(await deckBytes(lib, source, 'ppt', { pptxToPpt: async () => ole }, build)).toEqual(ole);
  });
});

describe('per-file import summary', () => {
  it('accepts every PowerPoint variant, .odp, .pdf and pictures', () => {
    for (const n of ['a.pptx', 'a.ppt', 'a.ppsx', 'a.ppsm', 'a.pptm', 'a.potx', 'a.potm', 'a.pps', 'a.pot', 'a.odp', 'a.pdf', 'a.png', 'a.JPG', 'a.svgz']) expect(isImportable(file(n)), n).toBe(true);
    expect(isImportable(file('a.docx'))).toBe(false);
    for (const ext of ['.ppsm', '.potm', '.pot', '.odp']) expect(IMPORT_ACCEPT).toContain(ext);
  });
  it('reports each file; one failure does not hide the others', async () => {
    const read = async (files: File[], _a: unknown, _p: unknown, approx?: (n: string) => void) => {
      const f = files[0];
      if (f.name === 'bad.ppt') throw new Error('bad.ppt: 슬라이드를 읽지 못했습니다.');
      if (f.name === 'rough.ppt') approx?.(f.name);
      return [slide(`${f.name}-1`), slide(`${f.name}-2`)];
    };
    const out = await importFilesWithSummary([file('ok.pptx'), file('bad.ppt'), file('rough.ppt'), file('notes.docx')], () => {}, undefined, read as never);
    expect(out.slides).toHaveLength(4);
    expect(out.reports.map((r) => [r.name, r.slides, !!r.error, r.warnings.length])).toEqual([['ok.pptx', 2, false, 0], ['bad.ppt', 0, true, 0], ['rough.ppt', 2, false, 1], ['notes.docx', 0, true, 0]]);
    expect(describeReport(out.reports[1])).toBe('bad.ppt: 가져오지 못함 — 슬라이드를 읽지 못했습니다.');
    expect(describeReport(out.reports[2])).toContain('근사치');
  });
});
