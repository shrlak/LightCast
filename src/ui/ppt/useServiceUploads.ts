import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import { PROTECTED_MESSAGE } from '../../domain/materialProtection';
import type { Action } from '../../domain/reducer';
import type { Library, Presentation, Slide, Theme } from '../../domain/types';
import { readConti } from '../../domain/recognition/conti';
import { presentationFromSongFile } from '../../domain/io/songFormats';
import { findSong, songToPresentation, withProgression, type SongDraft } from '../../domain/sunday/songs';
import { CHURCH_BACKGROUNDS } from '../../domain/defaults';
import { mmdd, serviceDate, upcomingSunday } from '../../domain/sunday/notice';
import { acceptedDrafts, type ContiReview } from './contiReview';
import { parseRefs } from '../../domain/bible/refs';
import { loadScriptureChunks } from '../../domain/bible/slides';
import { uid } from '../../domain/lyrics';
import { loadServiceTemplates, type ServiceTemplates } from '../../domain/templates/serviceTemplates';
import { templateDeckUpdates } from '../../domain/templates/register';
import { announcementSlides, scriptureSlides, sermonTitleSlide, songInTemplate, songStyleUpdates, templateLyricsTheme } from '../../domain/templates/fill';
import { createLiveService, findLiveService, ensureServiceSection, insertIntoSection, liveFolder, SECTION, sectionRange, sectionPresentations, type SectionTitle } from '../../domain/sunday/liveDeck';
import { DEFAULT_CONFESSION_SONG } from '../../domain/defaults';
import { withSharedSongs } from '../../domain/online';
import { announcementPages, parseAnnouncements } from '../../domain/sunday/announcements';
import { qrElements } from '../../domain/qrElements';
import { applyConfessionSong, pickConfessionSong } from '../../domain/templates/confession';
import { loadTranslations } from '../BibleModal';
import { saveRestorePoint } from '../../domain/restorePoints';
import { replaceDeckSlides } from '../../domain/serviceReadiness';
import { filesToSlides } from '../importFiles';

/** The theme with a fingerprint of its own settings, so a later edit to it can be recognised. */
function themeWithFingerprint(theme: Theme): Theme {
  const { generated: _, ...rest } = theme;
  const text = JSON.stringify(rest);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return { ...rest, generated: (h >>> 0).toString(36) };
}

export interface ServiceUploads {
  templates: 'loading' | 'ok' | 'error';
  busy: string | null;
  /** Open (or create) this week's 주일예배 playlist. */
  open: () => Promise<void>;
  conti: (file: File) => Promise<void>;
  /** A 콘티 read and waiting for the operator to check its songs, one at a time. */
  review: ContiReview | null;
  /** The checked song (null = leave it out); after the last one the songs go into the 예배. */
  answerReview: (draft: SongDraft | null) => void;
  cancelReview: () => void;
  lyrics: (files: File[]) => Promise<void>;
  sermon: (files: File[]) => Promise<void>;
  /** Files dropped on the window: 콘티 PDF → 찬양, lyric files → 찬양, PPTX/PDF/images → 설교. */
  drop: (files: File[]) => void;
  /** The church templates (throws when they cannot be loaded). */
  needTemplates: () => Promise<ServiceTemplates>;
  /** Bible verses (and the sermon title) straight into the selected 주일예배 playlist, in the church template's design. Resolves to the playlist's name. */
  scripture: (info: ScriptureInput) => Promise<string>;
  /**
   * The wizard's changes straight into that week's playlist, section by section (only `parts`).
   * `before` holds the sermon slides the wizard had earlier. Resolves to warnings, or null when that
   * week has no playlist yet (the wizard creates it).
   */
  syncWizard: (d: WizardSync, parts: WizardPart[], before: Slide[], date: Date) => Promise<string[] | null>;
}

/** What the 주일예배 마법사 holds that goes into the playlist. */
export interface WizardSync {
  songs: SongDraft[]; refs: string; sermonTitle: string; preacher: string; confession: string;
  sermonSlides: Slide[]; prayer: string; announcements: string; extraSlides: Slide[];
  /** 기도회 찬양: the sheet-music deck (in the library) sung before the Front, if any. */
  openingDeckId?: string | null;
}
export type WizardPart = 'opening' | 'songs' | 'scripture' | 'sermon' | 'prayer' | 'announcements' | 'extra' | 'confession';
export const WIZARD_PARTS: WizardPart[] = ['opening', 'songs', 'scripture', 'sermon', 'prayer', 'announcements', 'extra', 'confession'];

export interface ScriptureInput { refs: string; sermonTitle: string; preacher: string; translations: string[]; versesPerSlide: number }

const LYRIC_FILE = /\.(txt|md|pro6|cho|chopro|chordpro|crd|xml)$/i;
const CONTI_NAME = /콘티|conti/i;
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Uploads go straight into this week's 주일예배 playlist (built from the church templates the
 * ppt program uses), section by section and slide by slide as they are read — the playlist can
 * be open, or live on screen, the whole time.
 */
export function useServiceUploads(library: Library, dispatch: Dispatch<Action>, notify: (m: string) => void, activePlaylistId: string | null = null): ServiceUploads {
  const [templates, setTemplates] = useState<ServiceUploads['templates']>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<ContiReview | null>(null);
  const lib = useRef(library);
  lib.current = library;
  const activeId = useRef(activePlaylistId);
  activeId.current = activePlaylistId;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const tpl = useRef<ServiceTemplates | null>(null);

  useEffect(() => {
    let current = true;
    tpl.current = null; setTemplates('loading');
    loadServiceTemplates(!!library.cloudResetId)
      .then((t) => {
        if (!current) return;
        tpl.current = t;
        // The lyrics theme follows the church template — unless the operator has changed it since.
        const theme = themeWithFingerprint(templateLyricsTheme(t));
        const have = lib.current.themes.find((x) => x.id === theme.id);
        // (A theme from before fingerprints was written by LightCast alone, so it counts as untouched.)
        const untouched = !have || !have.generated || have.generated === themeWithFingerprint(have).generated;
        if (untouched && have?.generated !== theme.generated) dispatch({ type: 'theme/upsert', theme });
        setTemplates('ok');
      })
      .catch(() => { if (current) setTemplates('error'); });
    return () => { current = false; };
  }, [dispatch, library.cloudResetId]);

  // The library's 주일예배 Front / Back decks follow the church templates and this season's 고백송
  // (re-checked as songs load from the server and when the 고백송 setting changes).
  // Every song — saved, online, or added later — in the church template's design, up to
  // `linesPerSlide` lines per slide by part.
  useEffect(() => {
    if (templates !== 'ok' || !tpl.current) return;
    const restyled = songStyleUpdates(library.presentations, tpl.current, library.sunday.linesPerSlide);
    if (restyled.length) dispatch({ type: 'presentation/replaceMany', presentations: restyled });
  }, [templates, library.presentations, library.sunday.linesPerSlide, dispatch]);

  // Re-checked every 30 minutes too, so the Front deck moves on to the next Sunday's date by itself.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 30 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (templates !== 'ok' || !tpl.current) return;
    for (const u of templateDeckUpdates(library, tpl.current, new Date(clock))) dispatch({ type: 'presentation/update', id: u.id, patch: u.patch });
  }, [templates, library, dispatch, clock]);

  /** The church templates, loaded again once if the first try failed. Never null: without them songs would be added in the old watercolor look. */
  const templatesNow = async (): Promise<ServiceTemplates> => {
    if (tpl.current) return tpl.current;
    try {
      tpl.current = await loadServiceTemplates();
    } catch {
      tpl.current = await loadServiceTemplates(true).catch(() => {
        throw new Error('교회 PPT 템플릿을 불러오지 못했습니다 — 인터넷 연결을 확인하고 다시 시도해 주세요 (옛 디자인으로는 추가하지 않습니다)');
      });
    }
    return tpl.current;
  };
  const playlist = (id: string) => lib.current.playlists.find((p) => p.id === id);

  /** This week's playlist id, created from the templates when it does not exist yet. */
  const ensure = useCallback(async (date = upcomingSunday(new Date())): Promise<string> => {
    const existing = findLiveService(lib.current, date);
    if (existing) {
      dispatch({ type: 'playlist/set', playlist: ensureServiceSection(existing, SECTION.songs, lib.current.presentations), activate: true });
      return existing.id;
    }
    const built = createLiveService(lib.current, await templatesNow().catch(() => null), date);
    dispatch({ type: 'presentation/createMany', presentations: built.presentations, playlist: built.playlist });
    await tick();
    return built.playlist.id;
  }, [dispatch]);

  const place = async (id: string, section: SectionTitle, ids: string[], replace = false) => {
    await tick();
    const pl = playlist(id);
    if (pl) dispatch({ type: 'playlist/set', playlist: insertIntoSection(pl, section, ids, { replace, presentations: lib.current.presentations }) });
  };

  /** Select a presentation of the service so its slides show (and fill in) in the slide pane. */
  const show = async (id: string, presentationId: string | undefined) => {
    await tick();
    const index = playlist(id)?.items.findIndex((i) => i.kind !== 'header' && i.presentationId === presentationId) ?? -1;
    if (index >= 0) dispatch({ type: 'playlist/select', index });
  };

  const add = async (p: Presentation) => {
    dispatch({ type: 'presentation/createMany', presentations: [p] });
    await tick();
  };

  const run = async (label: string, job: () => Promise<string | void>) => {
    setBusy(label);
    try {
      await saveRestorePoint(lib.current, 'import', Date.now(), playlist(activeId.current ?? '')?.name ?? '주일예배 준비');
      const done = await job();
      setBusy(done ? `✓ ${done}` : null);
      if (done) setTimeout(() => setBusy((b) => (b === `✓ ${done}` ? null : b)), 5000);
    } catch (e) {
      setBusy(null);
      notify(`${label.replace(/…$/, '')} 실패: ${(e as Error).message}`);
    }
  };

  const songFor = (draft: SongDraft, folder: string, t: ServiceTemplates | null): { pres: Presentation; isNew: boolean } => {
    const existing = (draft.presentationId && lib.current.presentations.find((p) => p.id === draft.presentationId)) || findSong(lib.current.presentations, draft.title);
    const progression = draft.progression?.length ? draft.progression : undefined;
    let base: Presentation;
    if (existing && !draft.sections.length) base = progression ? withProgression(existing, progression) : existing;
    else base = songToPresentation({ ...draft, progression }, { themeId: 'theme_sunday', linesPerSlide: lib.current.sunday.linesPerSlide, folder });
    if (t) return { pres: songInTemplate(base, t, folder, lib.current.sunday.linesPerSlide), isNew: true };
    if (base === existing) return { pres: existing, isNew: false };
    return { pres: { ...base, id: base.id === existing?.id ? uid('p') : base.id, online: undefined, folder, background: CHURCH_BACKGROUNDS.watercolor }, isNew: true };
  };

  /** Sermon title + 성경 말씀 from the 콘티's or the Bible window's service info; the playlist's own 성경 말씀 deck is updated in place. */
  const serviceInfo = async (id: string, info: { scripture: string; sermonTitle: string; preacher: string }, t: ServiceTemplates | null, opts: { translations?: string[]; versesPerSlide?: number } = {}) => {
    if (!t || (!info.scripture.trim() && !info.sermonTitle.trim())) return;
    const refs = parseRefs(info.scripture).refs;
    const pl = playlist(id);
    const sermonId = pl && sectionPresentations(pl, SECTION.sermon, lib.current.presentations)[0];
    const sermon = sermonId && lib.current.presentations.find((p) => p.id === sermonId);
    if (sermon && (refs.length || info.sermonTitle.trim() || info.preacher.trim())) {
      const title = sermonTitleSlide(t, { refs, sermonTitle: info.sermonTitle, preacher: info.preacher });
      const rest = sermon.slides[0]?.group === '설교' ? sermon.slides.slice(1) : sermon.slides;
      dispatch({ type: 'presentation/update', id: sermon.id, patch: { slides: [title, ...rest] } });
    }
    if (!refs.length) return;
    const { sunday } = lib.current;
    const all = loadTranslations();
    const translations = (opts.translations ?? sunday.translations).map((x) => all.find((tr) => tr.id === x)).filter((x): x is (typeof all)[number] => !!x);
    if (!translations.length) return;
    const chunks = await loadScriptureChunks(refs, { translations, versesPerSlide: opts.versesPerSlide ?? sunday.versesPerSlide });
    const slides = scriptureSlides(t, { refs, chunks, sermonTitle: info.sermonTitle, preacher: info.preacher });
    if (!slides.length) return;
    const bibleId = (pl && sectionPresentations(pl, SECTION.bible, lib.current.presentations)[0]) || undefined;
    if (bibleId && lib.current.presentations.some((p) => p.id === bibleId)) {
      dispatch({ type: 'presentation/update', id: bibleId, patch: { slides } });
      return;
    }
    const folder = sermon ? sermon.folder : liveFolder(upcomingSunday(new Date()));
    const p: Presentation = { id: uid('p'), title: '성경 말씀', slides, themeId: 'theme_classic', folder, background: { kind: 'color', value: '#000000' } };
    await add(p);
    await place(id, SECTION.bible, [p.id], true);
  };

  /**
   * Read a 콘티 the way the ppt site does (domain/recognition): cover, songs and 진행, the 찬양
   * 라이브러리 first, the AI models through the church Worker for the rest. The songs then wait for
   * the operator to check each one (review) before they go into the 예배.
   */
  const conti = (file: File) => run('콘티 읽는 중…', async () => {
    const notes: string[] = [];
    const { sunday } = lib.current;
    const reading = await readConti(file, {
      presentations: lib.current.presentations,
      linesPerSlide: sunday.linesPerSlide,
      confessionSong: sunday.confessionSong,
      notify: (m) => notes.push(m),
      progress: setBusy,
    });
    if (!reading.songs.length) throw new Error(['콘티에서 찬양을 찾지 못했습니다.', ...notes].join(' '));
    setReview({ reading, index: 0, answers: [], notes });
    return `콘티 ${reading.songs.length}곡을 읽었습니다 — 한 곡씩 확인해 주세요`;
  });

  /** The checked songs into this week's 예배: 찬양 (and 설교 후 찬양), then the sermon info. */
  const placeSongs = (done: ContiReview) => run('찬양 넣는 중…', async () => {
    const { reading } = done;
    const songs = acceptedDrafts(done);
    const date = serviceDate(reading.date, new Date());
    const id = await ensure(date);
    const t = await templatesNow();
    const folder = liveFolder(date);
    const cleared = new Set<SectionTitle>();
    for (const [i, song] of songs.entries()) {
      setBusy(`찬양 넣는 중 ${i + 1}/${songs.length}: ${song.title}`);
      const { pres, isNew } = songFor(song, folder, t);
      if (isNew) await add(pres);
      const section = song.postSermon ? SECTION.after : SECTION.songs;
      await place(id, section, [pres.id], !cleared.has(section));
      if (!cleared.size) await show(id, pres.id);
      cleared.add(section);
    }
    for (const section of [SECTION.songs, SECTION.after]) if (!cleared.has(section)) await place(id, section, [], true);
    await serviceInfo(id, { scripture: reading.scripture, sermonTitle: reading.sermonTitle, preacher: '' }, t);
    return `${mmdd(date)} 콘티: ${songs.length}곡을 예배에 넣었습니다`;
  });

  const answerReview = (draft: SongDraft | null) => {
    if (!review) return;
    const answers = [...review.answers];
    answers[review.index] = draft;
    const next = { ...review, answers, index: review.index + 1 };
    if (next.index < review.reading.songs.length) return setReview(next);
    setReview(null);
    void placeSongs(next);
  };

  const lyrics = (files: File[]) => run('가사 넣는 중…', async () => {
    const id = await ensure();
    const t = await templatesNow();
    const folder = liveFolder(upcomingSunday(new Date()));
    for (const f of files) {
      const song = presentationFromSongFile(f.name, await f.text(), lib.current.sunday.linesPerSlide);
      const pres = t ? songInTemplate(song, t, folder, lib.current.sunday.linesPerSlide) : { ...song, folder };
      await add(pres);
      await place(id, SECTION.songs, [pres.id]);
      await show(id, pres.id);
    }
    return `가사 ${files.length}곡을 찬양에 넣었습니다`;
  });

  const sermon = (files: File[]) => run('설교 슬라이드 넣는 중…', async () => {
    const active = activeId.current ? playlist(activeId.current) : undefined;
    const id = active && sectionRange(active, SECTION.sermon) ? active.id : await ensure();
    await tick();
    const pl = playlist(id);
    let sermonId = pl ? sectionPresentations(pl, SECTION.sermon, lib.current.presentations)[0] : undefined;
    if (!sermonId) {
      const p: Presentation = { id: uid('p'), title: `${mmdd(upcomingSunday(new Date()))} 설교`, slides: [], themeId: 'theme_classic', folder: liveFolder(upcomingSunday(new Date())), background: { kind: 'color', value: '#000000' } };
      await add(p);
      await place(id, SECTION.sermon, [p.id]);
      sermonId = p.id;
    }
    await show(id, sermonId);
    const original = lib.current.presentations.find((p) => p.id === sermonId);
    if (!original) throw new Error('설교 프레젠테이션을 찾지 못했습니다');
    if (original.protected) throw new Error(PROTECTED_MESSAGE);
    const added: Slide[] = [];
    const push = (s: Slide) => {
      added.push(s);
      // Stage all slides first; failed imports must not erase the current sermon.
    };
    for (const file of files) {
      const beforeCount = added.length;
      const name = file.name.replace(/\.[^.]+$/, '');
      setBusy(`설교 슬라이드 읽는 중: ${name}`);
      for (const s of await filesToSlides([file], (m) => dispatch({ type: 'media/add', media: m }), setBusy)) push(s);
      if (added.length === beforeCount) throw new Error(`${file.name}: 슬라이드를 읽지 못했습니다. 기존 PPT는 유지됩니다.`);
    }
    const replacement = replaceDeckSlides(original, added);
    dispatch({ type: 'presentation/update', id: sermonId, patch: { slides: replacement.slides } });
    return `설교 슬라이드 ${added.length}장으로 교체했습니다 (예배 순서·설정 유지)`;
  });

  const drop = (files: File[]) => {
    const lyricFiles = files.filter((f) => LYRIC_FILE.test(f.name));
    const contiFile = files.find((f) => /\.pdf$/i.test(f.name) && CONTI_NAME.test(f.name));
    const sermonFiles = files.filter((f) => !lyricFiles.includes(f) && f !== contiFile && (/\.(pptx?|pdf|wmf|emf)$/i.test(f.name) || f.type.startsWith('image/')));
    (async () => {
      if (contiFile) await conti(contiFile);
      if (lyricFiles.length) await lyrics(lyricFiles);
      if (sermonFiles.length) await sermon(sermonFiles);
    })();
  };

  /** The selected playlist when it is a 주일예배 (has a 성경 말씀 section), else this week's. Calls run one after another. */
  const scripture = (info: ScriptureInput) => {
    const job = queue.current.then(async () => {
      await saveRestorePoint(lib.current, 'import', Date.now(), playlist(activeId.current ?? '')?.name ?? '주일예배 준비');
      const active = activeId.current ? playlist(activeId.current) : undefined;
      const id = active && sectionRange(active, SECTION.bible) ? active.id : await ensure();
      await serviceInfo(id, { scripture: info.refs, sermonTitle: info.sermonTitle, preacher: info.preacher }, await templatesNow(), info);
      await tick();
      return playlist(id)?.name ?? '';
    });
    queue.current = job.catch(() => undefined);
    return job;
  };

  const syncWizard = (d: WizardSync, parts: WizardPart[], before: Slide[], date: Date) => {
    const job = queue.current.then(async (): Promise<string[] | null> => {
      const found = findLiveService(lib.current, date);
      if (!found) return null;
      await saveRestorePoint(lib.current, 'import', Date.now(), playlist(activeId.current ?? '')?.name ?? '주일예배 준비');
      const id = found.id;
      const t = await templatesNow();
      const folder = liveFolder(date);
      const warnings: string[] = [];
      const deckOf = (section: SectionTitle) => {
        const pl = playlist(id);
        const pid = pl && sectionPresentations(pl, section, lib.current.presentations)[0];
        return pid ? lib.current.presentations.find((p) => p.id === pid) : undefined;
      };
      /** Drop service decks that left the playlist (library songs and shared decks stay). */
      const sweep = (ids: string[]) => {
        for (const old of ids) {
          const p = lib.current.presentations.find((x) => x.id === old);
          const used = playlist(id)?.items.some((i) => i.kind !== 'header' && i.presentationId === old);
          if (p && p.folder === folder && !used) dispatch({ type: 'presentation/delete', id: old });
        }
      };
      /** One deck for a section: its slides replaced in place, made when missing, removed when empty. */
      const setDeck = async (section: SectionTitle, title: string, slides: Slide[]) => {
        const have = deckOf(section);
        if (have && slides.length) return dispatch({ type: 'presentation/update', id: have.id, patch: { slides } });
        if (have) {
          await place(id, section, [], true);
          return sweep([have.id]);
        }
        if (!slides.length) return;
        const p: Presentation = { id: uid('p'), title, slides, themeId: 'theme_classic', folder, background: { kind: 'color', value: '#000000' } };
        await add(p);
        await place(id, section, [p.id], true);
      };

      for (const part of parts) {
        if (part === 'opening') {
          // The sheet-music deck stays in the library (기도회 찬양 악보) for another week; only the playlist changes.
          const deck = d.openingDeckId && lib.current.presentations.some((p) => p.id === d.openingDeckId) ? d.openingDeckId : null;
          const pl = playlist(id);
          if (deck || (pl && sectionRange(pl, SECTION.opening))) await place(id, SECTION.opening, deck ? [deck] : [], true);
          if (!deck) {
            // An emptied section loses its heading too.
            await tick();
            const now = playlist(id);
            const r = now && sectionRange(now, SECTION.opening);
            if (now && r && r[1] === r[0]) dispatch({ type: 'playlist/set', playlist: { ...now, items: now.items.filter((_, i) => i !== r[0] - 1) } });
          }
        } else if (part === 'songs') {
          for (const [section, postSermon] of [[SECTION.songs, false], [SECTION.after, true]] as const) {
            const pl = playlist(id);
            const old = pl ? sectionPresentations(pl, section, lib.current.presentations) : [];
            const made: string[] = [];
            for (const song of d.songs.filter((x) => !!x.postSermon === postSermon)) {
              const { pres, isNew } = songFor(song, folder, t);
              if (isNew) await add(pres);
              made.push(pres.id);
            }
            await place(id, section, made, true);
            await tick();
            sweep(old.filter((x) => !made.includes(x)));
          }
        } else if (part === 'scripture') {
          const refs = parseRefs(d.refs).refs;
          if (refs.length) await serviceInfo(id, { scripture: d.refs, sermonTitle: d.sermonTitle, preacher: d.preacher }, t);
          else await setDeck(SECTION.bible, '성경 말씀', []);
        } else if (part === 'sermon') {
          const gone = new Set([...before, ...d.sermonSlides].map((x) => x.id));
          const have = deckOf(SECTION.sermon);
          const kept = (have?.slides ?? []).filter((x) => !gone.has(x.id));
          await setDeck(SECTION.sermon, `${mmdd(date)} 설교`, [...kept, ...d.sermonSlides]);
        } else if (part === 'prayer') {
          dispatch({ type: 'sunday/settings', patch: { prayerText: d.prayer.trim() } });
        } else if (part === 'announcements') {
          const items = parseAnnouncements(d.announcements);
          const slides = t
            ? announcementSlides(t, items)
            : items.flatMap((a, i) => announcementPages(a).map((pg) => ({ id: uid('s'), group: '광고', title: `${i + 1}. ${a.title}`, text: pg.body.join('\n'), elements: pg.links.length ? qrElements(pg.links) : undefined })));
          await setDeck(SECTION.announcements, '광고', slides);
        } else if (part === 'extra') {
          await setDeck('추가 자료' as SectionTitle, '추가 자료', d.extraSlides);
        } else if (part === 'confession') {
          const back = deckOf(SECTION.back);
          if (!back) continue;
          const { sunday } = lib.current;
          const presentations = await withSharedSongs(lib.current.presentations, [d.confession, sunday.confessionSong, DEFAULT_CONFESSION_SONG], sunday.linesPerSlide);
          const { song, missing } = pickConfessionSong(presentations, [d.confession, sunday.confessionSong, DEFAULT_CONFESSION_SONG]);
          if (missing) warnings.push(`공동체 고백 “${missing}” is not in the library${song ? ` — “${song.title}” is used instead` : ''}`);
          const rewritten = song ? applyConfessionSong(back.slides, song, sunday.linesPerSlide) : null;
          if (!rewritten) continue;
          const slides = rewritten.map((x) => ({ ...x, id: uid('s') }));
          if (back.folder === folder) dispatch({ type: 'presentation/update', id: back.id, patch: { slides } });
          else {
            // The library's shared Back deck keeps the season's song; this week gets its own copy.
            const own: Presentation = { ...back, id: uid('p'), title: `${mmdd(date)} Back`, folder, slides, templateKey: undefined };
            await add(own);
            await place(id, SECTION.back, [own.id], true);
          }
        }
      }
      await tick();
      return warnings;
    });
    queue.current = job.catch(() => undefined);
    return job;
  };

  const open = () => run('예배 여는 중…', async () => {
    const id = await ensure();
    const pl = playlist(id);
    await show(id, pl && sectionPresentations(pl, SECTION.front, lib.current.presentations)[0]);
  });

  return { templates, busy, open, conti, review, answerReview, cancelReview: () => setReview(null), lyrics, sermon, drop, scripture, syncWizard, needTemplates: templatesNow };
}
