import { describe, expect, it } from 'vitest';
import { chordRows, hasChords, parseLyrics, stripChords } from '../src/domain/lyrics';
import { parseChordPro, parseOpenLyrics, parseOpenSong, parsePro6, presentationFromSongFile } from '../src/domain/io/songFormats';
import { buildMeeting, defaultRetreat, lyricSlides, meetingFileName, newBlock } from '../src/domain/retreat';
import { createInitialState, reducer, type Action, type AppState } from '../src/domain/reducer';
import { createSeedLibrary } from '../src/domain/defaults';
import { sequence } from '../src/domain/arrangement';

const run = (s: AppState, ...actions: Action[]) => actions.reduce(reducer, s);
const fresh = () => createInitialState(createSeedLibrary());

describe('chords', () => {
  it('hides chords from the audience and aligns them for the stage', () => {
    const line = '[G]Amazing [C]grace how [G/B]sweet';
    expect(hasChords(line)).toBe(true);
    expect(stripChords(line)).toBe('Amazing grace how sweet');
    const r = chordRows(line);
    expect(r.lyric).toBe('Amazing grace how sweet');
    expect(r.chords.indexOf('C')).toBe(r.lyric.indexOf('grace'));
  });

  it('does not treat a chord line as a section header', () => {
    expect(parseLyrics('[Verse 1]\n[G]Amazing [C]grace')[0]).toMatchObject({ group: 'Verse 1', text: '[G]Amazing [C]grace' });
  });
});

describe('song formats', () => {
  it('reads ChordPro', () => {
    const s = parseChordPro('{title: Test Song}\n{key: G}\n{start_of_verse}\n[G]Line one\n{end_of_verse}\n{soc}\nChorus line\n{eoc}', 'x');
    expect(s).toMatchObject({ title: 'Test Song', key: 'G' });
    expect(s.sections.map((x) => x.label)).toEqual(['Verse', 'Chorus']);
  });

  it('reads OpenLyrics with verse order', () => {
    const xml = '<song xmlns="http://openlyrics.info/namespace/2009/song"><properties><titles><title>Hymn</title></titles><verseOrder>v1 c v1</verseOrder></properties><lyrics><verse name="v1"><lines>One<br/>Two</lines></verse><verse name="c"><lines>Chorus</lines></verse></lyrics></song>';
    const s = parseOpenLyrics(xml, 'x');
    expect(s.title).toBe('Hymn');
    expect(s.sections[0].lines).toEqual(['One', 'Two']);
    expect(s.progression).toEqual(['V1', 'C', 'V1']);
  });

  it('reads OpenSong, skipping chord lines', () => {
    const s = parseOpenSong('<song><title>OS</title><lyrics>[V1]\n.G     C\n Hello world\n[C]\n Chorus</lyrics><presentation>V1 C</presentation></song>', 'x');
    expect(s.sections).toEqual([{ label: 'V1', lines: ['Hello world'] }, { label: 'C', lines: ['Chorus'] }]);
  });

  it('reads ProPresenter 6 groups and slide text', () => {
    const b64 = (t: string) => btoa(unescape(encodeURIComponent(t)));
    const xml = `<RVPresentationDocument CCLISongTitle="P6 Song"><array><RVSlideGrouping name="Verse 1"><array><RVDisplaySlide><NSString rvXMLIvarName="PlainText">${b64('첫 줄\nSecond')}</NSString></RVDisplaySlide></array></RVSlideGrouping></array></RVPresentationDocument>`;
    const p = parsePro6(xml, 'x');
    expect(p.title).toBe('P6 Song');
    expect(p.slides).toEqual([{ group: 'Verse 1', text: '첫 줄\nSecond' }]);
    expect(presentationFromSongFile('a.pro6', xml, 2).slides[0].text).toBe('첫 줄\nSecond');
  });
});

describe('수련회 builder', () => {
  it('splits long stanzas evenly at the line limit', () => {
    expect(lyricSlides('1\n2\n3\n4\n5\n6\n\n7', 4)).toEqual(['1\n2\n3', '4\n5\n6', '7']);
  });

  it('builds a meeting in block order with poster, songs, scripture and QR announcements', () => {
    const lib = createSeedLibrary();
    const d = defaultRetreat('2026-01-16');
    d.name = '2026 겨울 수련회';
    const m = d.meetings[0];
    m.posterMediaId = 'poster1';
    const worship = m.blocks.find((b) => b.kind === 'worship')!;
    if (worship.kind === 'worship') worship.songs = [{ title: 'Amazing Grace', text: '' }, { title: '새 노래', text: 'a\nb\n\nc' }];
    const ann = m.blocks.find((b) => b.kind === 'announcements')!;
    if (ann.kind === 'announcements') ann.text = '1. <OT>\n신청: https://forms.gle/x';
    const sermon = m.blocks.find((b) => b.kind === 'sermonTitle')!;
    if (sermon.kind === 'sermonTitle') sermon.title = '포도나무';
    const scripture = m.blocks.find((b) => b.kind === 'scripture')!;
    const built = buildMeeting(lib, d, m, new Map([[scripture.id, [{ id: 'v', group: '요15', text: '1 나는 참포도나무요' }]]]));
    expect(built.playlist.name).toBe('0116 수련회 · 금요일 저녁예배');
    expect(meetingFileName(m)).toBe('0116_Retreat_Evening');
    const titles = built.playlist.items.map((i) => (i.kind === 'header' ? `#${i.title}` : lib.presentations.concat(built.presentations).find((p) => p.id === i.presentationId)?.title));
    expect(titles).toEqual(['#금요일 저녁예배', '0116 금요일 저녁예배', '수련회 제목', '#찬양', '찬양', 'Amazing Grace', '새 노래', '설교말씀', '설교 제목', '빈 화면', '기도회', '기도', '축도', 'OT | 광고']);
    const annPres = built.presentations.find((p) => p.title === 'OT | 광고')!;
    expect(annPres.slides[1].elements).toMatchObject([{ kind: 'qr', link: 'https://forms.gle/x' }]);
    expect(built.presentations.find((p) => p.title === '새 노래')!.slides.map((s) => s.caption)).toEqual(['새 노래', '새 노래']);
  });

  it('creates blocks of each kind', () => {
    expect(newBlock('prayer')).toMatchObject({ kind: 'prayer', title: '기도' });
  });
});

describe('ProPresenter-style live features', () => {
  it('loops a presentation back to its first slide', () => {
    let s = run(fresh(), { type: 'presentation/update', id: 'p_doxology', patch: { loop: true } });
    const n = sequence(s.library.presentations.find((p) => p.id === 'p_doxology')!).length;
    s = run(s, { type: 'live/go', presentationId: 'p_doxology', seq: n - 1 }, { type: 'live/next' });
    expect(s.cursor?.seq).toBe(0);
  });

  it('runs slide actions when the slide goes live', () => {
    let s = fresh();
    const slide = s.library.presentations.find((p) => p.id === 'p_welcome')!.slides[0];
    s = run(s,
      { type: 'slide/update', presentationId: 'p_welcome', slideId: slide.id, patch: { actions: [{ type: 'prop', propId: 'prop_clock', on: true }, { type: 'runMacro', macroId: 'macro_sermon' }, { type: 'stageMessage', text: 'Go' }] } },
      { type: 'live/go', presentationId: 'p_welcome', seq: 0, now: 5 },
    );
    expect(s.live.activeProps).toContain('prop_clock');
    expect(s.library.timers.find((t) => t.id === 'timer_sermon')!.running).toBe(true);
    expect(s.live.stageMessage).toBe('Go');
  });

  it('cycles the announcements layer independently of the live slide', () => {
    let s = run(fresh(), { type: 'live/go', presentationId: 'p_grace', seq: 0 }, { type: 'announce/start', presentationId: 'p_welcome' });
    expect(s.live.announcement?.slide.text).toMatch(/^Welcome!/);
    s = run(s, { type: 'announce/next' }, { type: 'announce/next' }, { type: 'announce/next' });
    expect(s.live.announcement?.slide.text).toMatch(/^Welcome!/); // wrapped around 3 slides
    expect(s.live.slide?.text).toMatch(/^Amazing grace/);
    expect(run(s, { type: 'announce/stop' }).live.announcement).toBeNull();
  });

  it('toggles the logo layer with the chosen logo', () => {
    const s = run(fresh(), { type: 'library/logo', mediaId: 'm9' }, { type: 'live/logo' });
    expect(s.live).toMatchObject({ logo: true, logoMediaId: 'm9' });
  });

  it('runs a schedule once per slot and records it', () => {
    let s = run(fresh(), { type: 'schedule/upsert', schedule: { id: 'sc', name: 'pre', macroId: 'macro_pre', time: '10:45', days: [0], enabled: true } });
    s = run(s, { type: 'schedule/ran', id: 'sc', slot: '2026-10-18 10:45', now: 1 });
    expect(s.library.schedules[0].lastRun).toBe('2026-10-18 10:45');
    expect(s.live.activeProps).toContain('prop_countdown');
  });
});

describe('updater version compare', () => {
  it('orders versions numerically', async () => {
    // @ts-expect-error plain ESM module
    const { newer } = await import('../electron/version.mjs');
    expect(newer('0.1.10', '0.1.9')).toBe(true);
    expect(newer('v1.0.0', '0.9.9')).toBe(true);
    expect(newer('0.1.0', '0.1.0')).toBe(false);
    expect(newer('0.1.0', '0.2.0')).toBe(false);
  });
});

describe('live editing', () => {
  it('updates the live output when the slide on screen is edited, keeping black/logo', () => {
    let s = run(fresh(), { type: 'live/go', presentationId: 'p_welcome', seq: 0 }, { type: 'live/logo', on: true });
    const id = s.live.slide!.id;
    s = run(s, { type: 'slide/update', presentationId: 'p_welcome', slideId: id, patch: { text: '수정된 문구', style: { fontFamily: 'Arial', fontSize: 120 } } });
    expect(s.live.slide?.text).toBe('수정된 문구');
    expect(s.live.slide?.style?.fontSize).toBe(120);
    expect(s.live.logo).toBe(true);
    expect(s.cursor?.seq).toBe(0);
  });

  it('does not touch the live output when another presentation is edited', () => {
    let s = run(fresh(), { type: 'live/go', presentationId: 'p_welcome', seq: 0 });
    const before = s.live;
    s = run(s, { type: 'presentation/update', id: 'p_grace', patch: { title: 'Changed' } });
    expect(s.live.slide).toBe(before.slide);
  });
});

describe('update checks while LightCast is open', () => {
  it('look for a new release every 30 minutes', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../electron/updater.mjs', import.meta.url), 'utf8'));
    expect(src).toMatch(/export const CHECK_EVERY_MS = 30 \* 60 \* 1000;/);
    expect(src).toMatch(/setInterval\(auto, CHECK_EVERY_MS\)/);
  });
});
