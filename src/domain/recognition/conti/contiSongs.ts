// A 콘티 just opened, as songs to read: the ppt site's LyricsGenerator.handleFile for a Sunday
// service (no 카톡 공지 pasted). The cover lists the songs (else every 악보 page is one); a title the
// 찬양 라이브러리 holds is loaded from it and its page never read for lyrics; the 공동체 고백송 is set
// apart and the song after it sung after the sermon. A chord-sheet PDF is read from its text.
import type { ContiDocument } from '../utils/contiPdf';
import type { ContiInfo, LibraryEntry, Song } from '../utils/types';
import type { AiSettings } from '../ai/aiSettings';
import { findLibrarySong, isGroundTruth, libraryLyrics } from '../storage/library';
import { lacksParts, organizeSavedEntry } from '../lyrics/savedLyrics';
import { findSection } from '../utils/slidePlanner';
import { parseChordSheet } from '../utils/chordSheet';
import { songFromChordSheet } from '../utils/chordSlides';
import { deriveSongsFromMusicPages, splitLyricsAndConfessionSongs } from '../utils/contiPages';
import { isExcludedTitle } from '../utils/excludedTitles';
import { settlePostSermonEntry } from './postSermon';
import { songHasLyrics, type ContiJob } from './job';

export function songFromLibrary(entry: LibraryEntry, pageIndex?: number, contiOrder?: string[], linesPerSlide = 4): Song {
  // Saved without parts, it loads organized by the parts its lyrics show.
  const lyrics = libraryLyrics(organizeSavedEntry(entry), contiOrder);
  return { id: crypto.randomUUID(), title: entry.title, key: entry.key, sections: lyrics.sections, order: lyrics.order, linesPerSlide, pageIndex };
}

function blankSong(title = '', linesPerSlide = 4): Song {
  return { id: crypto.randomUUID(), title, sections: [], order: ['I'], linesPerSlide };
}

/** Korean lines whose word spacing can be trusted, to space a chord sheet's lyrics by. */
function spacingCorpus(entries: LibraryEntry[]): string[] {
  return entries.flatMap((entry) => entry.sections.flatMap((section) => section.lines));
}

export interface ContiStartOptions {
  linesPerSlide: number;
  /** 공동체 고백송 title (관리자 설정). */
  confessionSong: string;
  notify: (message: string) => void;
  changed: () => void;
}

/** The job for a freshly opened conti, its songs laid out as the site's cards are. */
export function startContiJob(doc: ContiDocument, lib: LibraryEntry[], shared: AiSettings, opts: ContiStartOptions): ContiJob {
  const parsed = doc.parsed;
  const { linesPerSlide, notify } = opts;
  const job: ContiJob = {
    doc, info: parsed.info, songs: [], library: lib, linesPerSlide, spares: [], listedOrder: false, postSermonTitle: null, englishTitles: new Map(),
    standIns: new Map(), outcomes: new Map(), confidence: new Map(), webCandidates: new Map(), webChecks: new Map(), sources: new Map(),
    autoRetried: new Set(), reportedUnclaimed: '', notify, changed: opts.changed,
  };

  // A chord sheet prints every song's lyrics as text: they are read from it directly, in the
  // sheet's order, and no page is recognized.
  const sheet = parsed.chordSheetPages ? parseChordSheet(parsed.chordSheetPages, { corpus: spacingCorpus(lib) }) : null;
  if (sheet) {
    const imported = sheet.map((entry) => songFromChordSheet(entry, { id: crypto.randomUUID(), linesPerSlide, bilingual: false }).song);
    const listed = imported.filter((song) => !isExcludedTitle(song.title, shared.excludedTitles));
    const excluded = imported.filter((song) => !listed.includes(song));
    if (excluded.length > 0) notify(`${excluded.map((song) => `'${song.title}'`).join(', ')}은(는) 제외 목록에 있어 찬양 편집에서 제외했습니다.`);
    // The Sunday deck sets the 공동체 고백송 and the 설교 후 찬양 apart, as for a cover list.
    const entries = listed.map((song) => ({ title: song.title }));
    const roles = splitLyricsAndConfessionSongs(entries, opts.confessionSong);
    const kept = listed.filter((_, index) => entries[index] !== roles.confessionSong);
    const postSermon = listed.find((_, index) => entries[index] === roles.postSermonSong);
    if (postSermon) postSermon.postSermon = true;
    if (roles.confessionSong) notify(`'${roles.confessionSong.title}'은 공동체 고백송으로 찬양 슬라이드에서 제외했습니다 (백 슬라이드에 포함).`);
    job.info = { songs: [] };
    job.songs = kept;
    for (const song of kept) {
      job.outcomes.set(song.id, { status: 'done', engine: 'sheet' });
      job.sources.set(song.id, 'sheet');
    }
    notify(`코드 악보에서 ${kept.length}곡의 가사를 그대로 읽었습니다. 띄어쓰기와 줄 나눔을 확인해 주세요.`);
    return job;
  }

  const next: Song[] = [];
  const assigned = new Set<number>();
  // A conti without a recognized cover page still has usable sheet music: derive the song list
  // straight from the score pages, in page order.
  const hasCover = parsed.info.songs.length > 0;
  const contiSongs = hasCover ? parsed.info.songs : deriveSongsFromMusicPages(parsed.pageTexts, parsed.musicPages, lib);
  const split = splitLyricsAndConfessionSongs(contiSongs, opts.confessionSong);
  const { confessionSong } = split;
  const excludedPages = new Set<number>();
  if (confessionSong?.pageIndex != null) excludedPages.add(confessionSong.pageIndex);
  const settled = settlePostSermonEntry(split.lyricsSongs, split.postSermonSong, shared.postSermonSong);
  const postSermonSong = settled?.entry;
  const praiseEntries = split.lyricsSongs.filter((entry) => entry !== settled?.replaces);
  const lyricsSongs = [...praiseEntries, ...(postSermonSong ? [postSermonSong] : [])];
  const listedOrder = hasCover;
  const detected: ContiInfo = parsed.info;

  for (const entry of lyricsSongs) {
    // The conti names the song: when 찬양 라이브러리 already holds that title, its saved lyrics
    // are loaded right away and the 악보 is never read for lyrics.
    const hit = findLibrarySong(lib, { title: entry.title });
    // The 진행 순서 written on the conti is this week's arrangement — unless its tokens cannot
    // name the saved parts at all (a song saved slide by slide has parts 1, 2, 3…).
    const loaded = hit ? organizeSavedEntry(hit) : undefined;
    const orderFits = !loaded || (entry.order ?? []).some((token) => token !== 'I' && findSection(loaded.sections, token));
    const song = hit ? songFromLibrary(hit, entry.pageIndex, orderFits ? entry.order : undefined, linesPerSlide) : blankSong(entry.title, linesPerSlide);
    // Saved without parts, the song has its words but not its parts. With its 악보 in the conti
    // it is read like a new song, and the saved lyrics stand in until then.
    if (hit && entry.pageIndex != null && lacksParts(hit)) {
      job.standIns.set(song.id, { entry: hit, contiOrder: entry.order && entry.order.length > 0 ? [...entry.order] : undefined, trusted: isGroundTruth(hit) });
    }
    if (hit) job.sources.set(song.id, 'library');
    song.title = entry.title;
    if (entry.englishTitle) job.englishTitles.set(song.id, entry.englishTitle);
    song.key = entry.key ?? song.key;
    song.description = entry.description;
    song.pageIndex = entry.pageIndex;
    if (entry.order && entry.order.length > 0 && orderFits) {
      song.order = [...entry.order];
      song.orderFromConti = true;
    }
    // The song right after the 공동체 고백송 is sung after the sermon.
    if (postSermonSong && entry === postSermonSong) song.postSermon = true;
    next.push(song);
    if (entry.pageIndex != null) assigned.add(entry.pageIndex);
  }
  // 악보 pages the cover's order does not list are not songs of this service. They get no card;
  // their titles only help the listed songs find their own pages. Without a cover, none is spare.
  const unlisted = parsed.musicPages.filter((page) => !assigned.has(page) && !excludedPages.has(page));
  // A 설교 후 찬양 the library has no lyrics for takes the first page no song holds; the title
  // pass moves it to the page its title is printed on.
  const unreadPostSermon = next.find((song) => song.postSermon && song.pageIndex == null && !songHasLyrics(song));
  if (unreadPostSermon && listedOrder && unlisted.length > 0) unreadPostSermon.pageIndex = unlisted.shift();
  job.spares = listedOrder ? unlisted : [];
  job.listedOrder = listedOrder;
  job.postSermonTitle = postSermonSong?.title ?? null;

  // Cover-listed songs on the administrator exclusion list never become cards.
  const excludedSongs = next.filter((song) => song.title.trim() && isExcludedTitle(song.title, shared.excludedTitles));
  const kept = next.filter((song) => !excludedSongs.includes(song));
  if (excludedSongs.length > 0) notify(`${excludedSongs.map((song) => `'${song.title}'`).join(', ')}은(는) 제외 목록에 있어 찬양 편집에서 제외했습니다.`);
  job.info = detected;
  job.songs = kept;
  for (const song of kept) if (songHasLyrics(song) && !job.standIns.has(song.id)) job.outcomes.set(song.id, { status: 'done', engine: 'library' });

  if (!listedOrder && next.length > 0) {
    notify(`표지를 찾지 못해 악보 순서대로 ${next.length}곡을 정리했습니다.${confessionSong ? ` '${confessionSong.title}'은 공동체 고백송으로 제외했어요.` : ''} 제목과 가사를 확인해 주세요.`);
  } else if (confessionSong) {
    notify(`'${confessionSong.title}'은 공동체 고백송으로 찬양 슬라이드에서 제외했습니다 (백 슬라이드에 포함).`);
  }
  if (job.spares.length > 0) {
    notify(`콘티 순서에 없는 악보 ${job.spares.length}장(${job.spares.map((page) => `p.${page}`).join(', ')})도 모두 읽습니다. 같은 제목이거나 앞 곡에서 이어지는 페이지는 그 곡에 합치고, 다른 곡의 악보는 넣지 않습니다.`);
  }
  const postSermonKept = kept.find((song) => song.postSermon);
  if (postSermonKept) notify(`'${postSermonKept.title}'은 설교 후 찬양으로 두었습니다 (설교 뒤 기도 슬라이드 다음).`);
  if (next.length === 0) notify('콘티에서 곡을 찾지 못했습니다. 곡을 직접 추가해 주세요.');
  return job;
}
