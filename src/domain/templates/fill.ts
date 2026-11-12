// Puts this week's content into the church template slides — the same substitutions the
// shrlak/ppt program makes in its .pptx files: the date on the welcome slide, 기도제목 on the
// 기도 준비 slide, song titles, Bible verses ({{TITLE}} {{CHAP}}장 {{PARA}}절 …), the sermon
// title and one 광고 slide per announcement.
import type { Presentation, Slide, SlideElement, Theme } from '../types';
import { uid } from '../lyrics';
import { formatRefs, type BibleRef } from '../bible/refs';
import type { ScriptureChunk } from '../bible/slides';
import { announcementPages, type Announcement } from '../sunday/announcements';
import { qrElements } from '../qrElements';
import { withStableIds } from '../stableIds';
import type { PrayerTopic } from '../sunday/prayer';
import { planPrayerSlides } from '../sunday/prayer';
import { mdy } from '../sunday/notice';
import { splitEvenly } from '../sunday/songs';
import { fillSlide, fillTokens } from './convert';
import { CANVAS_W } from '../canvas';
import { keepFrontLayout } from '../frontLayout';
import type { ServiceTemplates } from './serviceTemplates';
import { centerSongLyrics } from '../songCentering';
import { prepareAnnouncementSlide } from '../announcementSizing';

export const TEMPLATE_LYRICS_THEME = 'theme_tpl_lyrics';

/** A line that is only a date — "07/12/2026", "7/9/23" — or a date placeholder like "mm/dd/202y". */
const DATE_LINE = /^\s*(?:\d{1,2}|m{1,2})\s*\/\s*(?:\d{1,2}|d{1,2})\s*\/\s*[\dy]{2,4}\s*$/i;
const area = (e: SlideElement) => e.w * e.h;
const texts = (s: Slide) => (s.elements ?? []).filter((e) => e.kind === 'text');

/** Update date text without changing the original text box or paragraph styling. */
const withDate = (s: Slide, date: Date): Slide => {
  const replace = (text: string) => text.replace(/\{date\}/g, mdy(date)).split('\n').map((line) => DATE_LINE.test(line) ? mdy(date) : line).join('\n');
  return keepFrontLayout({ ...s, text: replace(s.text), ...(s.title ? { title: replace(s.title) } : {}), ...(s.subtext ? { subtext: replace(s.subtext) } : {}),
    elements: s.elements?.map((e) => e.kind === 'text' && e.text && replace(e.text) !== e.text
      ? { ...e, text: replace(e.text), paragraphs: e.paragraphs?.map((p) => ({ ...p, text: replace(p.text) })) } : e) });
};

/** The 기도 준비 page's 기도제목 box ("기도제목 1\n기도제목 2" in the church file). */
const PRAYER_MARK = /기도\s*제목\s*\d/;
const isPrayerBox = (e: SlideElement) => e.kind === 'text' && (e.role === 'prayer' || PRAYER_MARK.test(e.text ?? ''));
const isPrayerPage = (s: Slide) => !!s.elements?.some(isPrayerBox);

interface PrayerLine { text: string; bold?: boolean }

/** About how many lines the box holds at its own font size (CJK characters are about 1 em wide). */
function boxCapacity(el: SlideElement): { lines: number; chars: number } {
  const size = el.paragraphs?.find((p) => p.text.trim())?.fontSize ?? el.fontSize ?? 48;
  const lineHeight = size * (el.lineHeight ?? 1.2);
  return { lines: Math.max(3, Math.floor((el.h - 24) / lineHeight)), chars: Math.max(8, Math.floor((el.w - 24) / size)) };
}

/**
 * The box's lines for each page: one topic per page — "n. 제목" in bold with its points as "● …"
 * lines (a plain list prints "● 제목") — and a topic too long for the box continues on the next page.
 */
function prayerPages(el: SlideElement, topics: PrayerTopic[]): PrayerLine[][] {
  const structured = topics.some((t) => t.points.length);
  const { lines: capacity, chars } = boxCapacity(el);
  const height = (l: PrayerLine) => Math.max(1, Math.ceil([...l.text].length / chars));
  const pages: PrayerLine[][] = [];
  planPrayerSlides(topics).forEach(([topic], i) => {
    if (!structured) return pages.push([{ text: `● ${topic.title}` }]);
    const head: PrayerLine = { text: `${i + 1}. ${topic.title}`, bold: true };
    let page = [head], used = height(head);
    for (const point of topic.points.map((p) => ({ text: `● ${p}` }))) {
      if (used + height(point) > capacity && page.length > 1) {
        pages.push(page);
        page = [head];
        used = height(head);
      }
      page.push(point);
      used += height(point);
    }
    pages.push(page);
  });
  return pages;
}

/** The 기도제목 box printing `lines` in the box's own font, size and colour (bold for topic titles). */
function withPrayerLines(el: SlideElement, lines: PrayerLine[]): SlideElement {
  const style = el.paragraphs?.find((p) => p.text.trim()) ?? el.paragraphs?.[0];
  return {
    ...el, role: 'prayer', text: lines.map((l) => l.text).join('\n'),
    paragraphs: style ? lines.map((l) => ({ ...style, text: l.text, bold: l.bold || undefined })) : undefined,
  };
}

const freshCopy = (s: Slide): Slide => ({ ...s, id: uid('s'), elements: s.elements?.map((e) => ({ ...e, id: uid('e') })) });

/**
 * Front from the church file with this Sunday's date, and this week's 기도제목 in the 기도 준비 page's
 * box (one page per topic, the template's fonts and layout kept). With no topics the page keeps the
 * template's own text.
 */
export function fillFront(tpl: ServiceTemplates, date: Date, topics: PrayerTopic[] = []): Slide[] {
  return tpl.front.flatMap((s) => {
    const box = s.elements?.find(isPrayerBox);
    if (!box) return [withDate(freshCopy(s), date)];
    const pages = topics.length ? prayerPages(box, topics) : [null];
    return pages.map((lines) => {
      const page = freshCopy(s);
      const at = s.elements!.indexOf(box);
      page.elements = page.elements!.map((e, i) => (i === at ? (lines ? withPrayerLines(e, lines) : { ...e, role: 'prayer' as const }) : e));
      return withDate(page, date);
    });
  });
}

/**
 * Restore the source Front design with this Sunday's date, keeping the page and object ids of the
 * deck it replaces. With `topics` the 기도 준비 pages are made anew for them; without (the topics
 * have not changed since, or an earlier service's copy) the deck keeps its 기도 pages as they are,
 * edits included.
 */
export function refreshFront(slides: Slide[], tpl: ServiceTemplates, date: Date, topics?: PrayerTopic[]): Slide[] {
  let fresh = fillFront(tpl, date, topics ?? []);
  const kept = topics ? [] : slides.filter(isPrayerPage);
  if (kept.length) {
    const at = fresh.findIndex(isPrayerPage);
    fresh = [...fresh.slice(0, at), ...kept.map(keepFrontLayout), ...fresh.slice(at).filter((s) => !isPrayerPage(s))];
  }
  // Pages are matched in order among prayer pages and among the other pages, so a change in the
  // number of 기도제목 pages does not hand the welcome page's id to a prayer page.
  const oldPrayer = slides.filter(isPrayerPage), oldOther = slides.filter((s) => !isPrayerPage(s));
  let p = 0, o = 0;
  return fresh.map((s) => {
    const old = isPrayerPage(s) ? oldPrayer[p++] : oldOther[o++];
    if (!old) return s;
    return { ...s, id: old.id, elements: s.elements?.map((e, n) => ({ ...e, id: old.elements?.[n]?.kind === e.kind ? old.elements[n].id : e.id })) };
  });
}

/** Date-only fallback when the church source file is unavailable. */
export const updateFrontDate = (slides: Slide[], date: Date): Slide[] => slides.map((s) => withDate(s, date));

export const prayerSlide = (tpl: ServiceTemplates): Slide => fillSlide(tpl.prayer, (t) => t);

/** The church's closing deck, as it is (fresh copies). */
export const backSlides = (tpl: ServiceTemplates): Slide[] => (tpl.back ?? []).map((s) => fillSlide(s, (t) => t));

/** LightCast's built-in placeholder Back deck, which the church deck replaces in the library. */
export const isPlaceholderBack = (p: Presentation | undefined) => !!p && p.slides.some((s) => s.id === 'back_confession');

/**
 * 광고: the title slide, then each announcement ("1. <제목>", then its lines) — one slide per part
 * of it (an empty line in the text starts the next part, under the same title). Links are QR code
 * objects on the slide, which can be moved, resized or deleted.
 */
export function announcementSlides(tpl: ServiceTemplates, items: Announcement[]): Slide[] {
  if (!items.length) return [];
  const [, titleBox, bodyBox] = [...texts(tpl.announceItem)].sort((a, b) => a.y - b.y);
  return [
    fillSlide(tpl.announceTitle, (t) => t),
    ...items.flatMap((a, i) => announcementPages(a).map((page) => {
      const slide = fillSlide(tpl.announceItem, (t, el) => (el.id === titleBox?.id ? `${i + 1}. <${a.title}>` : el.id === bodyBox?.id ? page.body.join('\n') : t));
      return prepareAnnouncementSlide({ ...slide, elements: [...(slide.elements ?? []), ...qrElements(page.links)] });
    })),
  ];
}

/** The lyric text box of the template's lyric slide, as a LightCast theme (lyrics stay plain slide text). */
export function templateLyricsTheme(tpl: ServiceTemplates): Theme {
  const [lyrics] = [...texts(tpl.songLyrics)].sort((a, b) => area(b) - area(a));
  const p = lyrics?.paragraphs?.find((x) => x.text.trim());
  return {
    id: TEMPLATE_LYRICS_THEME, name: '주일 템플릿 (가사)',
    fontFamily: lyrics?.fontFamily ?? '"Arial", Arimo, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
    fontSize: p?.fontSize ?? lyrics?.fontSize ?? 82, fontWeight: p?.bold ? 700 : 400,
    color: p?.color ?? lyrics?.color ?? '#000000', align: 'center', vAlign: 'middle',
    // The ppt program sets lyric lines to 125% spacing; PowerPoint's single spacing for Arial is ~1.15 em.
    lineHeight: 1.44, padding: Math.round(lyrics ? Math.max(lyrics.x, CANVAS_W - lyrics.x - lyrics.w, 120) : 260),
    shadow: false, uppercase: false, subColor: '#555555', subScale: 0.62,
  };
}

/**
 * A song in the church template's design (as the ppt program builds it from template.pptx): a title
 * slide (watercolor), then each part split as evenly as possible into slides of at most `maxLines`
 * lines, on the white lyric background with the song title in the corner and the logo. The lyrics
 * stay slide text drawn by the lyrics theme (font, size, colour), so arrangements and the stage display
 * keep working. Keeps the song's id, folder and arrangements; per-slide font /
 * colour / background overrides are cleared so every song looks the same.
 */
export function restyleSong(song: Presentation, tpl: ServiceTemplates, maxLines: number): Presentation {
  const [lyricBox, titleBox] = [...texts(tpl.songLyrics)].sort((a, b) => area(b) - area(a));
  const title = song.title;
  // Everything on the template's lyric slide except its lyrics box: the logo, any boxes, and the
  // song title in the corner.
  const corner = fillSlide(
    { ...tpl.songLyrics, elements: (tpl.songLyrics.elements ?? []).filter((e) => e !== lyricBox) },
    (t, el) => (el === titleBox ? title : t),
  ).elements!;
  const lyricSlide = (base: Partial<Slide> & Pick<Slide, 'group' | 'text'>): Slide => ({
    ...base, id: uid('s'), caption: undefined, background: undefined, style: undefined, elements: corner.map((e) => ({ ...e, id: uid('e') })),
  });

  // A song already laid out the church's way at this size keeps its slide breaks (blank-line breaks
  // included). Otherwise consecutive slides of one part are re-split together; a part with
  // second-language lines (subtext) keeps its slides as they are, since its lines are paired.
  const lyrics: Slide[] = [];
  const body = song.slides.filter((s) => s.group !== 'Title');
  const laidOut = song.lyricsLayout?.linesPerSlide === maxLines;
  for (let i = 0; i < body.length; ) {
    if (laidOut) {
      lyrics.push(lyricSlide({ ...body[i] }));
      i++;
      continue;
    }
    let j = i;
    while (j < body.length && body[j].group === body[i].group) j++;
    const run = body.slice(i, j);
    if (run.some((s) => s.subtext)) lyrics.push(...run.map((s) => lyricSlide({ ...s })));
    else {
      const lines = run.flatMap((s) => s.text.split('\n')).map((l) => l.trim()).filter(Boolean);
      const { notes, label } = run[0];
      for (const chunk of splitEvenly(lines, maxLines)) lyrics.push(lyricSlide({ group: run[0].group, text: chunk.join('\n'), notes, label }));
    }
    i = j;
  }
  return centerSongLyrics({
    ...song, lyricsCentered: undefined,
    themeId: TEMPLATE_LYRICS_THEME,
    background: tpl.songLyrics.background,
    slides: [{ ...fillSlide(tpl.songTitle, () => title), group: 'Title' }, ...lyrics],
    // The song plays its 진행 (repeats included), opening on the title slide.
    arrangements: song.arrangements?.map((a) => ({ ...a, groups: ['Title', ...a.groups.filter((g) => g !== 'Title')] })),
    arrangementId: song.arrangementId ?? song.arrangements?.[0]?.id,
    lyricsLayout: { linesPerSlide: maxLines },
    templateKey: songKey(tpl, maxLines),
  });
}

/** Marks a song restyled to this template at this many lines (v2: plays its 진행). */
const songKey = (tpl: ServiceTemplates, maxLines: number) => `song:${tpl.keys.song}|${maxLines}|seq`;

/** A copy of a song in the template's design for this week's service (new id, the service's folder). */
export function songInTemplate(song: Presentation, tpl: ServiceTemplates, folder: string, maxLines = 4): Presentation {
  const styled = song.slidesEdited ? { ...song, slides: song.slides.map((s) => ({ ...s, id: uid('s'), elements: s.elements?.map((e) => ({ ...e, id: uid('e') })) })) } : restyleSong(song, tpl, maxLines);
  return centerSongLyrics({ ...styled, id: uid('p'), online: undefined, folder });
}

/** Is this presentation a song (lyrics by part), as opposed to an announcement or a scripture deck? */
export function isSong(p: Presentation): boolean {
  // A song laid out by LightCast (lyricsLayout) counts wherever it sits — a copy made for a service in an
  // earlier version, in the old look, is brought into the template design (and gets its title slide) too.
  const looksLikeSong = p.online || p.folder === 'Songs' || p.themeId === TEMPLATE_LYRICS_THEME || !!p.lyricsLayout;
  // Retreat songs come pre-laid-out as "Slide 1, 2…" in the retreat design and are left as they are.
  const parts = p.slides.filter((s) => s.group !== 'Title');
  return !!looksLikeSong && parts.length > 0 && parts.some((s) => !/^Slide( \d+)?$/.test(s.group));
}

/** Songs that are not yet in the current template design (with this many lines per slide), restyled. */
export function songStyleUpdates(presentations: Presentation[], tpl: ServiceTemplates, maxLines: number): Presentation[] {
  const key = songKey(tpl, maxLines);
  // (A song in the template design whose 진행 skips its title slide is redone too: the title must open the song.)
  const skipsTitle = (p: Presentation) => !!p.arrangements?.some((a) => !a.groups.includes('Title')) && p.slides.some((s) => s.group === 'Title');
  // Every computer restyles the same songs the same way: with ids from the song, the results match
  // and cloud sync sees one change, not a conflict.
  return presentations.filter((p) => !p.protected && !p.slidesEdited && (p.templateKey !== key || skipsTitle(p)) && isSong(p)).map((p) => {
    const styled = restyleSong(p, tpl, maxLines);
    return { ...styled, slides: withStableIds(p.id, styled.slides) };
  });
}

export interface ScriptureFill {
  refs: BibleRef[];
  chunks: ScriptureChunk[];
  sermonTitle?: string;
  preacher?: string;
}

const ranges = (refs: BibleRef[], lang: 'ko' | 'en') => formatRefs(refs, lang);

/** 성경 말씀 title slide + one slide per verse chunk, from the Bible template. */
export function scriptureSlides(tpl: ServiceTemplates, f: ScriptureFill): Slide[] {
  if (!f.chunks.length) return [];
  const RANGE_KO = ranges(f.refs, 'ko');
  const RANGE_EN = ranges(f.refs, 'en');
  return [
    fillSlide(tpl.bibleTitle, (t) => fillTokens(t, { RANGE_KO, RANGE_EN })),
    ...f.chunks.map((c) => {
      // The template prints the Korean verse (under the Korean book name) first and the English one
      // below, whichever translation was picked first.
      const swap = c.langs[0] === 'en' && c.langs[1] === 'ko';
      const [ko, en] = swap ? [c.texts2, c.texts] : [c.texts, c.texts2];
      return fillSlide(tpl.bibleVerse, (t) => {
        if (t.includes('{{BODY2}}') && !en.length) return null;
        // Verse texts run on without verse numbers, as the ppt program prints them.
        return fillTokens(t, {
          RANGE_KO, RANGE_EN, TITLE: c.nameKo, ETITLE: c.nameEn, CHAP: String(c.chapter), PARA: c.verses,
          BODY: ko.join(' '), BODY2: en.join(' '),
        });
      }, { group: c.label });
    }),
  ];
}

/** 설교 title slide: sermon title, the reading, and the preacher (template text when none is given). */
export function sermonTitleSlide(tpl: ServiceTemplates, f: Pick<ScriptureFill, 'refs' | 'sermonTitle' | 'preacher'>): Slide {
  const RANGE_KO = ranges(f.refs, 'ko');
  return fillSlide(tpl.sermon, (t, el) => {
    if (t.includes('{{')) return fillTokens(t, { SERMON_TITLE: f.sermonTitle?.trim(), RANGE_KO });
    if (f.preacher?.trim() && /목사|전도사|선교사/.test(t) && el.y > 700) return f.preacher.trim();
    return t;
  });
}
