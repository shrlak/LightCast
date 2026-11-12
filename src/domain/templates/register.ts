// Keeps the library's 주일예배 Front and Back decks the same as the church's current
// templates (front-slides.pptx / back-slides.pptx): the Front shows this coming Sunday's date
// with the original fonts/layout and this week's 기도제목; the Back shows this season's 고백송.
// Front is restored from the source template with its date and 기도제목 filled in. Back refreshes its
// 고백송 block in place and preserves edits outside that block.
import type { Library, Presentation } from '../types';
import { DEFAULT_CONFESSION_SONG } from '../defaults';
import { fillSlide } from './convert';
import { refreshFront } from './fill';
import { isFrontPresentation } from '../frontLayout';
import { serviceEnd } from '../sunday/cleanup';
import { mdy, upcomingSunday } from '../sunday/notice';
import { parsePrayerTopics } from '../sunday/prayer';
import { applyConfessionSong, findConfessionSong, songChunks } from './confession';
import type { ServiceTemplates } from './serviceTemplates';
import { withStableIds } from '../stableIds';

const PLACEHOLDER_SLIDES = { front: 'front_prayer', back: 'back_confession' } as const;

const isPlaceholder = (p: Presentation, kind: 'front' | 'back') => p.slides.some((s) => s.id === PLACEHOLDER_SLIDES[kind]);
/** Built from the templates by LightCast (every slide sits on a baked template background). */
const fromTemplates = (p: Presentation, kind: 'front' | 'back') =>
  p.templateKey?.startsWith(`${kind}:`) || (p.slides.length > 0 && p.slides.every((s) => s.background?.kind === 'media' && s.background.mediaId.startsWith('tpl-')));

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export interface DeckUpdate {
  id: string;
  patch: Partial<Presentation>;
}

/** The updates that bring the library's Front/Back decks in line with the templates (empty when they already are). */
export function templateDeckUpdates(lib: Library, tpl: ServiceTemplates, now = new Date()): DeckUpdate[] {
  const out: DeckUpdate[] = [];
  const byId = (id: string | null) => (id ? lib.presentations.find((p) => p.id === id) : undefined);
  const base = { themeId: 'theme_classic', background: { kind: 'color', value: '#000000' } } as const;

  const sunday = upcomingSunday(now);
  for (const front of lib.presentations.filter((p) => p.id === lib.sunday.frontId || isFrontPresentation(p))) {
    if (front.protected) continue;
    const date = front.id === lib.sunday.frontId ? sunday : serviceEnd(front.folder ?? '', now) ?? serviceEnd(`${front.title.slice(0, 4)} 주일예배`, now) ?? sunday;
    // This Sunday's Front prints the 기도제목 setting; an earlier service's copy keeps its own.
    const current = mdy(date) === mdy(sunday);
    const prayer = (lib.sunday.prayerText ?? '').trim();
    const frontKey = `front:${tpl.keys.front}|${mdy(date)}|original-fonts-v1${current ? `|${hash(prayer)}` : ''}`;
    // The 기도 pages are made anew only when the 기도제목 (or the date or church file) changed: edits
    // made on them since stay.
    const remake = current && front.templateKey !== frontKey;
    // (Pages keep their ids; a Front remade the same way on two computers differs only in the new
    // pages' ids, which cloud sync treats as the same change — see mergeById.)
    const slides = refreshFront(front.slides, tpl, date, remake ? parsePrayerTopics(prayer) : undefined);
    if (front.templateKey === frontKey && JSON.stringify(front.slides) === JSON.stringify(slides)) continue;
    if (front.id !== lib.sunday.frontId || isPlaceholder(front, 'front') || fromTemplates(front, 'front'))
      out.push({ id: front.id, patch: { ...base, templateKey: frontKey, slides } });
  }

  const back = byId(lib.sunday.backId);
  if (back && !back.protected && tpl.back?.length && tpl.keys.back) {
    const title = lib.sunday.confessionSong.trim() || DEFAULT_CONFESSION_SONG;
    const song = findConfessionSong(lib.presentations, title);
    const lines = lib.sunday.linesPerSlide;
    const lyrics = song ? songChunks(song, lines) : [];
    const backKey = `back:${tpl.keys.back}|${song ? `${song.title}:${lines}:${hash(JSON.stringify(lyrics))}` : '-'}`;
    if (back.templateKey !== backKey) {
      if (back.templateKey?.startsWith(`back:${tpl.keys.back}|`)) {
        // Same church file: only the 공동체 고백송 block is rewritten, edits elsewhere stay.
        out.push({ id: back.id, patch: { templateKey: backKey, slides: withStableIds(back.id, (song && applyConfessionSong(back.slides, song, lines)) || back.slides) } });
      } else if (isPlaceholder(back, 'back') || fromTemplates(back, 'back')) {
        const slides = tpl.back.map((s) => fillSlide(s, (t) => t));
        out.push({ id: back.id, patch: { ...base, templateKey: backKey, slides: withStableIds(back.id, (song && applyConfessionSong(slides, song, lines)) || slides) } });
      }
    }
  }
  return out;
}
