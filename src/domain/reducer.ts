import { trashPresentation, trashSlides, restoreTrash, purgeTrash } from './trash';
import { exclusivePresentationMedia } from './mediaCleanup';
import { deletedServices, isServicePlaylist } from './sunday/cleanup';
import { isSaturdayDawnName, saturdayDawnImageCleanup } from './saturdayDawn';
import type {
  Arrangement, Background, Library, MacroStep, MediaMeta, MessageTemplate, Macro, Playlist, PlaylistItem,
  Presentation, Prop, RetreatLook, Schedule, Screen, Slide, SlideAction, SundaySettings, Theme, Timer, DeviceIdentity, DeviceRegistration, ActivityEntry,
} from './types';
import { retreatBackground } from './motion';
import { attributeChange, mergeActivity } from './activity';
import { sequence } from './arrangement';
import { deleteSlides, deleteSlidesAt, editSlide, editSlideAt } from './slideEditing';
import { centerAddedLyricSlides, centerSongLyrics } from './songCentering';
import { preservePdfPages } from './importedSlides';
import { refreshZooms } from './zoomRefresh';
import { prepareAnnouncementSizing } from './announcementSizing';
import { blockedProtectedAction, isProtected, keepProtectedMaterials, protectionWinners, mergeProtectionChanges } from './materialProtection';
import { uid } from './lyrics';
import { extraReducer, isExtra, type ExtraAction } from './reducerExtra';
import { CHURCH_BACKGROUNDS, createEmptyLive } from './defaults';
import { advanceBuild, rewindBuild } from './animations';
import { activePlaylist, findPres, goLive, nextCursor, playlistIndexFor, prevCursor, themeFor, type Cursor, type NavState } from './live';
import { dedupeSongs } from './sunday/dedupe';
import { resetTimer, startTimer, stopTimer } from './timers';

export type { Cursor } from './live';
interface HistoryPosition { before: Cursor | null; after: Cursor | null }

export interface AppState extends NavState {
  selectedId: string | null;
  /** `loop`: Transitions › Sound › Loop Until Next Sound. */
  audio: { mediaId: string | null; nonce: number; loop?: boolean };
  /** Position in the looping announcements layer. */
  announce: { presentationId: string; seq: number } | null;
  past: Library[];
  future: Library[];
  pastPositions: HistoryPosition[];
  futurePositions: HistoryPosition[];
  lastKey: string | null;
}

type DomainAction =
  | { type: 'device/register'; device: DeviceRegistration }
  | { type: 'activity/record'; entry: ActivityEntry }
  | { type: 'trash/restore'; id: string; seq?: number }
  | { type: 'trash/purge'; ids: string[] }
  | { type: 'trash/expire'; now: number }
  | { type: 'select'; id: string | null }
  | { type: 'presentation/create'; presentation: Presentation }
  | { type: 'presentation/createMany'; presentations: Presentation[]; playlist?: Playlist }
  | { type: 'presentation/update'; id: string; patch: Partial<Omit<Presentation, 'id'>> }
  | { type: 'presentation/delete'; id: string }
  | { type: 'presentation/protect'; id: string; on: boolean }
  | { type: 'services/finish'; playlistIds: string[]; presentationIds: string[]; mediaIds: string[] }
  | { type: 'slide/update'; presentationId: string; slideId: string; seq?: number; sequenceLength?: number; patch: Partial<Omit<Slide, 'id'>> }
  | { type: 'slide/delete'; presentationId: string; slideIds: string[]; seqs?: number[] }
  | { type: 'arrangement/upsert'; presentationId: string; arrangement: Arrangement }
  | { type: 'arrangement/delete'; presentationId: string; id: string }
  | { type: 'arrangement/select'; presentationId: string; id: string | null }
  | { type: 'theme/upsert'; theme: Theme }
  | { type: 'theme/delete'; id: string }
  | { type: 'playlist/create'; playlist: Playlist }
  | { type: 'playlist/delete'; id: string }
  | { type: 'playlist/retention'; id: string; until?: number }
  | { type: 'playlist/rename'; id: string; name: string }
  | { type: 'playlist/activate'; id: string }
  /** Add to the active playlist, or to `playlistId`; at the end, or at `index`. */
  | { type: 'playlist/addItem'; item: PlaylistItem; playlistId?: string; index?: number }
  | { type: 'playlist/removeItem'; index: number }
  | { type: 'playlist/move'; from: number; to: number }
  | { type: 'playlist/select'; index: number }
  | { type: 'media/add'; media: MediaMeta }
  | { type: 'media/remove'; id: string }
  | { type: 'timer/upsert'; timer: Timer }
  | { type: 'timer/delete'; id: string }
  | { type: 'timer/op'; id: string; op: 'start' | 'stop' | 'reset'; now: number }
  | { type: 'prop/upsert'; prop: Prop }
  | { type: 'prop/delete'; id: string }
  | { type: 'prop/toggle'; id: string; on?: boolean }
  | { type: 'prop/clearAll' }
  | { type: 'template/upsert'; template: MessageTemplate }
  | { type: 'template/delete'; id: string }
  | { type: 'macro/upsert'; macro: Macro }
  | { type: 'macro/delete'; id: string }
  | { type: 'macro/run'; id: string; now: number }
  | { type: 'screen/upsert'; screen: Screen }
  | { type: 'screen/delete'; id: string }
  | { type: 'sunday/settings'; patch: Partial<SundaySettings> }
  /** Save the 수련회 moving background; `apply` (default) puts it on every deck that follows it. */
  | { type: 'retreat/look'; look: RetreatLook; apply?: boolean }
  | { type: 'library/replace'; library: Library }
  | { type: 'library/cloudReset'; library: Library }
  | { type: 'usage/clear' }
  | { type: 'live/go'; presentationId: string; seq: number; playlistIndex?: number | null; now?: number }
  | { type: 'live/next'; now?: number }
  | { type: 'live/prev' }
  | { type: 'live/clearAll' }
  | { type: 'live/clearText' }
  | { type: 'live/clearBackground' }
  | { type: 'live/toggleBlack' }
  | { type: 'live/black'; on: boolean }
  | { type: 'live/background'; background: Background | null }
  | { type: 'live/message'; message: string | null }
  | { type: 'live/outputTimer'; id: string | null }
  | { type: 'live/video'; playing?: boolean; restart?: boolean }
  | { type: 'audio/play'; mediaId: string | null }
  | { type: 'live/logo'; on?: boolean }
  | { type: 'library/logo'; mediaId: string | null }
  | { type: 'live/stageMessage'; message: string | null }
  | { type: 'live/messageScroll'; on: boolean }
  | { type: 'live/chords'; shift?: number; capo?: number }
  | { type: 'live/videoSeek'; t: number }
  | { type: 'live/videoLoop'; on: boolean }
  | { type: 'announce/start'; presentationId: string }
  | { type: 'announce/next' }
  | { type: 'announce/stop' }
  | { type: 'schedule/upsert'; schedule: Schedule }
  | { type: 'schedule/delete'; id: string }
  | { type: 'schedule/ran'; id: string; slot: string; now: number }
  | { type: 'slide/runActions'; actions: SlideAction[]; now: number }
  | { type: 'online/songs'; presentations: Presentation[] }
  | { type: 'songs/dedupe' }
  | { type: 'noop' }
  | ExtraAction
  | { type: 'undo' }
  | { type: 'redo' };

export type Action = DomainAction & { actor?: DeviceIdentity; account?: string | null; eventId?: string; occurredAt?: number };

export function createInitialState(library: Library): AppState {
  const prepared = library.presentations.map(prepareAnnouncementSizing);
  if (prepared.some((p, i) => p !== library.presentations[i])) library = { ...library, presentations: prepared };
  const pl = library.playlists[0];
  const first = pl?.items.find((i): i is Extract<PlaylistItem, { presentationId: string }> => i.kind !== 'header');
  return {
    library,
    selectedId: first?.presentationId ?? library.presentations[0]?.id ?? null,
    activePlaylistId: pl?.id ?? '',
    playlistIndex: null,
    cursor: null,
    live: createEmptyLive(library),
    audio: { mediaId: null, nonce: 0 },
    announce: null,
    past: [],
    future: [],
    pastPositions: [],
    futurePositions: [],
    lastKey: null,
  };
}

const setLib = (s: AppState, patch: Partial<Library>): AppState => ({ ...s, library: { ...s.library, ...patch } });
const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
const mapPres = (s: AppState, id: string, fn: (p: Presentation) => Presentation) =>
  setLib(s, { presentations: s.library.presentations.map((p) => (p.id === id ? fn(p) : p)) });
const mapPlaylist = (s: AppState, fn: (p: Playlist) => Playlist) => {
  const active = activePlaylist(s);
  return active ? setLib(s, { playlists: s.library.playlists.map((p) => (p.id === active.id ? fn(p) : p)) }) : s;
};
/** Songs sharing a title become one (the newest); playlists and the selection follow the survivor. */
function dedupeLibrarySongs(s: AppState): AppState {
  const { presentations, replaced } = dedupeSongs(s.library.presentations);
  if (!replaced.size) return s;
  const playlists = s.library.playlists.map((pl) => ({
    ...pl,
    items: pl.items.map((item) => (item.kind === 'header' || !replaced.has(item.presentationId) ? item : { ...item, presentationId: replaced.get(item.presentationId)! })),
  }));
  return { ...setLib(s, { presentations, playlists }), selectedId: (s.selectedId && replaced.get(s.selectedId)) || s.selectedId };
}
const usesMedia = (b: Background | null | undefined, id: string) => b?.kind === 'media' && b.mediaId === id;

function live(s: AppState, c: Cursor, now?: number): AppState {
  const prevPres = s.cursor?.presentationId;
  let next = goLive(s, c, now ?? Date.now());
  if (next === s) return s;
  if (next.playlistIndex !== s.playlistIndex && next.cursor) next = { ...next, selectedId: next.cursor.presentationId };
  // Transitions › Sound, or an audio object set to play by itself: the operator's player starts it.
  const shown = next.live.slide;
  const sound = shown?.transition?.sound ?? shown?.elements?.find((e) => e.kind === 'audio' && e.mediaId && e.playback?.autoplay && !e.hidden)?.mediaId;
  if (sound) next = { ...next, audio: { mediaId: sound, nonce: next.audio.nonce + 1, ...(shown?.transition?.sound === sound && shown.transition.soundLoop ? { loop: true } : {}) } };
  // [Stop Previous Sound]: the slide silences a sound still playing.
  else if (shown?.transition?.stopSound && next.audio.mediaId) next = { ...next, audio: { mediaId: null, nonce: next.audio.nonce + 1 } };
  const actions = next.live.slide?.actions;
  if (actions?.length) next = runActions(next, actions, now ?? 0);
  if (now != null && next.cursor && next.cursor.presentationId !== prevPres) {
    const p = findPres(next.library, next.cursor.presentationId)!;
    const entry = { at: now, presentationId: p.id, title: p.title, ccli: p.meta?.ccli };
    next = setLib(next, { usage: [...next.library.usage, entry].slice(-5000) });
  }
  return next;
}

function runActions(s: AppState, actions: SlideAction[], now: number, depth = 0): AppState {
  return actions.reduce((acc, a) => {
    if (a.type === 'runMacro') {
      const m = acc.library.macros.find((x) => x.id === a.macroId);
      // Macros may not start another presentation from a slide action, to avoid loops.
      return m && depth < 1 ? runActions(acc, m.steps.filter((st) => st.type !== 'go'), now, depth + 1) : acc;
    }
    if (a.type === 'go') return acc;
    return core(acc, stepToAction(a, now));
  }, s);
}

function announceAt(s: AppState, presentationId: string, seq: number): AppState {
  const p = findPres(s.library, presentationId);
  const items = p ? sequence(p).filter((x) => !x.slide.disabled) : [];
  if (!p || !items.length) return { ...s, announce: null, live: { ...s.live, announcement: null } };
  const i = ((seq % items.length) + items.length) % items.length;
  return {
    ...s,
    announce: { presentationId, seq: i },
    live: { ...s.live, announcement: { slide: items[i].slide, theme: themeFor(s.library, p), title: p.title } },
  };
}

/** Live editing: when the presentation on screen changes, redraw the live slide in place. */
function refreshLive(s: AppState, presentationId: string): AppState {
  if (s.cursor?.presentationId !== presentationId) return s;
  const next = goLive(s, s.cursor);
  if (next === s) return s;
  // An edit to the slide on screen must not restart animations that have already played.
  const build = next.live.build && s.live.build && next.live.slide?.id === s.live.slide?.id ? s.live.build : next.live.build;
  return { ...next, live: { ...next.live, build, black: s.live.black, logo: s.live.logo, copyright: s.live.copyright } };
}

/** Keep the same played occurrence when pages before it are removed or restored. */
function reconcileLive(before: AppState, after: AppState): AppState {
  const c = before.cursor;
  if (!c) return after;
  const old = findPres(before.library, c.presentationId);
  const p = findPres(after.library, c.presentationId);
  if (!old || !p) return after;
  const previous = sequence(old);
  const next = sequence(p);
  const current = previous[c.seq]?.slide;
  const identity = (slide: Slide) => slide.sourceSlideId ?? slide.id;
  const root = current && identity(current);
  const exact = !!current?.sourceSlideId && next.some((x) => x.slide.id === current.id);
  const same = (slide: Slide) => exact ? slide.id === current?.id : identity(slide) === root;
  const occurrence = previous.slice(0, c.seq).filter((x) => same(x.slide)).length;
  const matches = next.flatMap((x, i) => same(x.slide) ? [i] : []);
  let seq = matches[Math.min(occurrence, matches.length - 1)];
  if (seq == null) {
    const surviving = new Set(next.map((x) => x.slide.id));
    const through = previous.slice(0, c.seq).filter((x) => surviving.has(x.slide.id)).length;
    seq = Math.min(through, next.length - 1);
    // A disabled page must not become live as a side effect of deletion.
    if (next[seq]?.slide.disabled) {
      const forward = next.findIndex((x, i) => i >= seq && !x.slide.disabled);
      seq = forward;
      if (seq < 0) for (let i = next.length - 1; i >= 0; i--) if (!next[i].slide.disabled) { seq = i; break; }
    }
  }
  if (seq < 0) return { ...after, cursor: null, live: { ...after.live, slide: null, title: null, nextText: null, background: null, copyright: null, bgEffect: null } };
  return refreshLive({ ...after, cursor: { ...c, seq } }, c.presentationId);
}

function stepToAction(step: MacroStep, now: number): Action {
  switch (step.type) {
    case 'logo': return { type: 'live/logo', on: step.on };
    case 'dmx': return { type: 'noop' };
    case 'x32': return { type: 'noop' };
    case 'stageMessage': return { type: 'live/stageMessage', message: step.text };
    case 'announce': return step.presentationId ? { type: 'announce/start', presentationId: step.presentationId } : { type: 'announce/stop' };
    case 'clearAll': return { type: 'live/clearAll' };
    case 'clearText': return { type: 'live/clearText' };
    case 'clearBackground': return { type: 'live/clearBackground' };
    case 'clearProps': return { type: 'prop/clearAll' };
    case 'black': return { type: 'live/black', on: step.on };
    case 'background': return { type: 'live/background', background: step.background };
    case 'go': return { type: 'live/go', presentationId: step.presentationId, seq: step.index, now };
    case 'timer': return { type: 'timer/op', id: step.timerId, op: step.op, now };
    case 'prop': return { type: 'prop/toggle', id: step.propId, on: step.on };
    case 'message': return { type: 'live/message', message: step.text };
    case 'audio': return { type: 'audio/play', mediaId: step.mediaId };
    // Step types from older versions (e.g. the removed OBS steps) do nothing.
    default: return { type: 'noop' };
  }
}

function core(s: AppState, a: Action): AppState {
  if (blockedProtectedAction(s.library, a)) return s;
  if (isExtra(a)) return extraReducer(s, a);
  const lib = s.library;
  switch (a.type) {
    case 'select':
      return { ...s, selectedId: a.id, playlistIndex: null };
    case 'presentation/create':
      return { ...setLib(s, { presentations: [...lib.presentations, prepareAnnouncementSizing(centerSongLyrics(a.presentation))] }), selectedId: a.presentation.id, playlistIndex: null };
    case 'presentation/createMany': {
      const next = setLib(s, {
        presentations: [...lib.presentations, ...a.presentations.map((p) => prepareAnnouncementSizing(centerSongLyrics(p)))],
        playlists: a.playlist ? [...lib.playlists, a.playlist] : lib.playlists,
      });
      return a.playlist ? { ...next, activePlaylistId: a.playlist.id, playlistIndex: null } : next;
    }
    case 'presentation/update':
      // Editing an online song makes it this computer's own copy (saved locally from then on).
      return refreshLive(mapPres(s, a.id, (p) => {
        const next = { ...p, ...a.patch, protected: p.protected, protectionChangedAt: p.protectionChangedAt, ...(a.patch.slides ? { slides: preservePdfPages(p.slides, a.patch.slides) } : {}), online: undefined };
        return refreshZooms(a.patch.slides ? centerAddedLyricSlides(p, next) : next);
      }), a.id);
    case 'presentation/protect': {
      const p = findPres(lib, a.id);
      if (!p || isProtected(p) === a.on) return s;
      const at = Math.max(a.occurredAt ?? Date.now(), (p.protectionChangedAt ?? 0) + 1);
      return setLib(s, { protectionChanges: [...mergeProtectionChanges(lib).filter((c) => c.id !== a.id), { id: a.id, on: a.on, at }],
        presentations: lib.presentations.map((p) => p.id === a.id ? { ...p, protected: a.on,
        protectionChangedAt: at,
        online: undefined, folder: p.online ? 'Songs' : p.folder, updatedAt: a.occurredAt ?? Date.now() } : p) });
    }
    case 'trash/restore':
      return reconcileLive(s, { ...s, library: restoreTrash(lib, a.id, a.occurredAt ?? Date.now(), a.seq) });
    case 'trash/purge':
      return { ...s, library: purgeTrash(lib, a.ids) };
    case 'trash/expire':
      return { ...s, library: purgeTrash(lib, (lib.trash ?? []).filter((e) => e.expiresAt <= a.now).map((e) => e.id)) };
    case 'presentation/delete': {
      const p = findPres(lib, a.id);
      if (!p) return s;
      const trash = [...(lib.trash ?? []), trashPresentation(lib, p, a.occurredAt ?? Date.now())];
      const removedMedia = new Set(exclusivePresentationMedia({ ...lib, trash }, [a.id]));
      const playlists = lib.playlists.map((pl) => ({ ...pl, items: pl.items.filter((i) => i.kind === 'header' || i.presentationId !== a.id) }));
      return {
        ...setLib(s, { presentations: lib.presentations.filter((p) => p.id !== a.id), playlists, trash, media: lib.media.filter((m) => !removedMedia.has(m.id)) }),
        selectedId: s.selectedId === a.id ? null : s.selectedId,
        playlistIndex: null,
        cursor: s.cursor?.presentationId === a.id ? null : s.cursor,
      };
    }
    case 'services/finish': {
      const gone = new Set(a.presentationIds.filter((id) => !isProtected(findPres(lib, id))));
      const drop = new Set(a.playlistIds);
      const trash = [...(lib.trash ?? []), ...lib.presentations.filter((p) => gone.has(p.id)).map((p) => trashPresentation(lib, p, a.occurredAt ?? Date.now()))];
      const removedMedia = new Set(exclusivePresentationMedia({ ...lib, trash }, [...gone]));
      let playlists = lib.playlists.filter((p) => !drop.has(p.id)).map((pl) => ({ ...pl, items: pl.items.filter((i) => i.kind === 'header' || !gone.has(i.presentationId)) }));
      if (!playlists.length) playlists = [{ id: uid('pl'), name: '재생목록', items: [] }];
      return {
        ...setLib(s, { presentations: lib.presentations.filter((p) => !gone.has(p.id)), playlists, trash, media: lib.media.filter((m) => !removedMedia.has(m.id)) }),
        activePlaylistId: playlists.some((p) => p.id === s.activePlaylistId) ? s.activePlaylistId : playlists[0].id,
        selectedId: s.selectedId && gone.has(s.selectedId) ? null : s.selectedId,
        playlistIndex: null,
        cursor: s.cursor && gone.has(s.cursor.presentationId) ? null : s.cursor,
      };
    }
    case 'slide/update': {
      if (a.seq != null) {
        const p = findPres(lib, a.presentationId);
        const pages = p ? sequence(p) : [];
        const target = pages[a.seq]?.slide;
        // A delayed canvas save must not overwrite the page that moved into a deleted row.
        if (!target || (a.sequenceLength != null && a.sequenceLength !== pages.length) || (target.id !== a.slideId && target.sourceSlideId !== a.slideId)) return s;
      }
      return refreshLive(mapPres(s, a.presentationId, (p) => refreshZooms(a.seq == null ? editSlide(p, a.slideId, a.patch, a.occurredAt ?? Date.now()) : editSlideAt(p, a.seq, a.patch, a.occurredAt ?? Date.now()))), a.presentationId);
    }
    case 'slide/delete': {
      let next = mapPres(s, a.presentationId, (p) => a.seqs ? deleteSlidesAt(p, a.seqs, a.occurredAt ?? Date.now()) : deleteSlides(p, a.slideIds, a.occurredAt ?? Date.now()));
      const original = findPres(lib, a.presentationId), changed = findPres(next.library, a.presentationId);
      if (original && changed) {
        const seqs = a.seqs ?? sequence(original).flatMap((x, i) => a.slideIds.includes(x.slide.id) ? [i] : []);
        const entry = trashSlides(original, changed, seqs, a.occurredAt ?? Date.now());
        if (entry) next = setLib(next, { trash: [...(lib.trash ?? []), entry] });
      }
      if (!a.seqs || s.cursor?.presentationId !== a.presentationId) return reconcileLive(s, next);
      const before = findPres(lib, a.presentationId);
      const length = before ? sequence(before).length : 0;
      const removed = [...new Set(a.seqs)].filter((i) => Number.isInteger(i) && i >= 0 && i < length);
      const p = findPres(next.library, a.presentationId)!;
      const items = sequence(p);
      let seq = Math.min(s.cursor.seq - removed.filter((i) => i < s.cursor!.seq).length, items.length - 1);
      if (removed.includes(s.cursor.seq) && items[seq]?.slide.disabled) {
        const forward = items.findIndex((x, i) => i >= seq && !x.slide.disabled);
        if (forward >= 0) seq = forward;
        else while (seq >= 0 && items[seq].slide.disabled) seq--;
      }
      if (seq < 0) return { ...next, cursor: null, live: { ...next.live, slide: null, title: null, nextText: null, background: null, copyright: null, bgEffect: null } };
      return refreshLive({ ...next, cursor: { ...s.cursor, seq } }, a.presentationId);
    }
    case 'online/songs': {
      const local = lib.presentations.filter((p) => !p.online);
      const localIds = new Set([...local.map((p) => p.id), ...(lib.trash ?? []).filter((e) => e.kind === 'presentation').map((e) => e.presentation.id)]);
      return dedupeLibrarySongs(setLib(s, { presentations: [...local, ...a.presentations.filter((p) => !localIds.has(p.id)).map(centerSongLyrics)] }));
    }
    case 'songs/dedupe':
      return dedupeLibrarySongs(s);
    case 'arrangement/upsert':
      return mapPres(s, a.presentationId, (p) => ({ ...p, arrangements: upsert(p.arrangements ?? [], a.arrangement), arrangementId: a.arrangement.id }));
    case 'arrangement/delete':
      return mapPres(s, a.presentationId, (p) => ({
        ...p, arrangements: (p.arrangements ?? []).filter((x) => x.id !== a.id), arrangementId: p.arrangementId === a.id ? null : p.arrangementId,
      }));
    case 'arrangement/select':
      return { ...mapPres(s, a.presentationId, (p) => ({ ...p, arrangementId: a.id })), cursor: s.cursor?.presentationId === a.presentationId ? null : s.cursor };
    case 'theme/upsert': {
      const next = setLib(s, { themes: upsert(lib.themes, a.theme) });
      return s.live.theme.id === a.theme.id ? { ...next, live: { ...next.live, theme: a.theme } } : next;
    }
    case 'theme/delete': {
      if (lib.themes.length <= 1) return s;
      const themes = lib.themes.filter((t) => t.id !== a.id);
      return setLib(s, { themes, presentations: lib.presentations.map((p) => (p.themeId === a.id ? { ...p, themeId: themes[0].id } : p)) });
    }
    case 'playlist/create':
      return { ...setLib(s, { playlists: [...lib.playlists, a.playlist] }), activePlaylistId: a.playlist.id, playlistIndex: null };
    case 'playlist/delete': {
      const target = lib.playlists.find((p) => p.id === a.id);
      if (target && isServicePlaylist(target.name)) return core(s, { type: 'services/finish', ...deletedServices(lib, [a.id]) });
      if (lib.playlists.length <= 1 && !isSaturdayDawnName(target?.name ?? '')) return s;
      const playlists = lib.playlists.filter((p) => p.id !== a.id);
      if (!playlists.length) playlists.push({ id: uid('pl'), name: '재생목록', items: [] });
      return { ...setLib(s, { playlists }), activePlaylistId: s.activePlaylistId === a.id ? playlists[0].id : s.activePlaylistId, playlistIndex: null };
    }
    case 'playlist/retention':
      return setLib(s, { playlists: lib.playlists.map((p) => p.id === a.id ? { ...p, autoDeleteAfter: a.until } : p) });
    case 'playlist/rename':
      return setLib(s, { playlists: lib.playlists.map((p) => (p.id === a.id ? { ...p, name: a.name } : p)) });
    case 'playlist/activate':
      return { ...s, activePlaylistId: a.id, playlistIndex: null };
    case 'playlist/addItem': {
      const id = a.playlistId ?? activePlaylist(s)?.id;
      const target = lib.playlists.find((p) => p.id === id);
      if (!target) return s;
      const at = a.index == null ? target.items.length : Math.max(0, Math.min(target.items.length, a.index));
      const items = [...target.items];
      items.splice(at, 0, a.item);
      const next = setLib(s, { playlists: lib.playlists.map((p) => (p.id === target.id ? { ...p, items } : p)) });
      if (target.id !== activePlaylist(s)?.id) return next;
      // The selected and the live item stay the same items when the new one goes in before them.
      const moved = (i: number | null | undefined) => (i != null && at <= i ? i + 1 : i);
      return { ...next, playlistIndex: moved(s.playlistIndex) ?? null, cursor: s.cursor && { ...s.cursor, playlistIndex: moved(s.cursor.playlistIndex) } };
    }
    case 'playlist/removeItem':
      return { ...mapPlaylist(s, (p) => ({ ...p, items: p.items.filter((_, i) => i !== a.index) })), playlistIndex: null };
    case 'playlist/move': {
      const items = activePlaylist(s)?.items ?? [];
      if (a.to < 0 || a.to >= items.length) return s;
      const moved = mapPlaylist(s, (p) => {
        const next = [...p.items];
        const [item] = next.splice(a.from, 1);
        next.splice(a.to, 0, item);
        return { ...p, items: next };
      });
      return { ...moved, playlistIndex: s.playlistIndex === a.from ? a.to : s.playlistIndex };
    }
    case 'playlist/select': {
      const item = activePlaylist(s)?.items[a.index];
      if (!item || item.kind === 'header') return s;
      return { ...s, playlistIndex: a.index, selectedId: item.presentationId };
    }
    case 'media/add':
      return setLib(s, { media: [...lib.media, a.media] });
    case 'media/remove': {
      const next = setLib(s, {
        media: lib.media.filter((m) => m.id !== a.id),
        presentations: lib.presentations.map((p) => ({
          ...p,
          background: usesMedia(p.background, a.id) ? undefined : p.background,
          slides: p.slides.map((sl) => (usesMedia(sl.background, a.id) ? { ...sl, background: undefined } : sl)),
        })),
        props: lib.props.filter((p) => p.mediaId !== a.id),
      });
      return {
        ...next,
        live: usesMedia(s.live.background, a.id) ? { ...next.live, background: null } : next.live,
        audio: s.audio.mediaId === a.id ? { mediaId: null, nonce: s.audio.nonce + 1 } : s.audio,
      };
    }
    case 'timer/upsert':
      return setLib(s, { timers: upsert(lib.timers, a.timer) });
    case 'timer/delete':
      return setLib(s, { timers: lib.timers.filter((t) => t.id !== a.id) });
    case 'timer/op': {
      const op = a.op === 'start' ? (t: Timer) => startTimer(t, a.now) : a.op === 'stop' ? (t: Timer) => stopTimer(t, a.now) : resetTimer;
      return setLib(s, { timers: lib.timers.map((t) => (t.id === a.id ? op(t) : t)) });
    }
    case 'prop/upsert':
      return setLib(s, { props: upsert(lib.props, a.prop) });
    case 'prop/delete':
      return { ...setLib(s, { props: lib.props.filter((p) => p.id !== a.id) }), live: { ...s.live, activeProps: s.live.activeProps.filter((id) => id !== a.id) } };
    case 'prop/toggle': {
      const isOn = s.live.activeProps.includes(a.id);
      const on = a.on ?? !isOn;
      if (on === isOn) return s;
      return { ...s, live: { ...s.live, activeProps: on ? [...s.live.activeProps, a.id] : s.live.activeProps.filter((id) => id !== a.id) } };
    }
    case 'prop/clearAll':
      return { ...s, live: { ...s.live, activeProps: [] } };
    case 'template/upsert':
      return setLib(s, { messageTemplates: upsert(lib.messageTemplates, a.template) });
    case 'template/delete':
      return setLib(s, { messageTemplates: lib.messageTemplates.filter((t) => t.id !== a.id) });
    case 'macro/upsert':
      return setLib(s, { macros: upsert(lib.macros, a.macro) });
    case 'macro/delete':
      return setLib(s, { macros: lib.macros.filter((m) => m.id !== a.id) });
    case 'macro/run': {
      const macro = lib.macros.find((m) => m.id === a.id);
      return macro ? macro.steps.reduce((acc, step) => core(acc, stepToAction(step, a.now)), s) : s;
    }
    case 'screen/upsert':
      return setLib(s, { screens: upsert(lib.screens, a.screen) });
    case 'screen/delete':
      return lib.screens.length > 1 ? setLib(s, { screens: lib.screens.filter((x) => x.id !== a.id) }) : s;
    case 'sunday/settings':
      return setLib(s, { sunday: { ...lib.sunday, ...a.patch } });
    case 'library/replace':
      return { ...createInitialState(keepProtectedMaterials({ ...a.library, cloudResetId: lib.cloudResetId ?? a.library.cloudResetId, protectionChanges: mergeProtectionChanges(lib, a.library) }, protectionWinners(lib), [lib])), past: [...s.past, s.library].slice(-60), pastPositions: [...s.pastPositions, { before: s.cursor, after: null }].slice(-60) };
    case 'device/register':
      return setLib(s, { devices: [...(lib.devices ?? []).filter((d) => d.id !== a.device.id), a.device] });
    case 'activity/record':
      return setLib(s, { activity: mergeActivity(lib.activity, [a.entry]) });
    case 'usage/clear':
      return setLib(s, { usage: [] });
    case 'live/go':
      return live(s, { presentationId: a.presentationId, seq: a.seq, playlistIndex: a.playlistIndex !== undefined ? a.playlistIndex : playlistIndexFor(s, a.presentationId) }, a.now);
    case 'live/next': {
      if (!s.cursor) return s.selectedId ? live(s, { presentationId: s.selectedId, seq: 0, playlistIndex: playlistIndexFor(s, s.selectedId) }, a.now) : s;
      // A slide with animations left plays its next click step first, as PowerPoint does.
      const build = s.live.slide && !s.live.black && !s.live.logo ? advanceBuild(s.live.slide, s.live.build, a.now ?? Date.now()) : null;
      if (build) return { ...s, live: { ...s.live, build } };
      const n = nextCursor(s, s.cursor);
      return n ? live(s, n, a.now) : s;
    }
    case 'live/prev': {
      const build = s.live.slide ? rewindBuild(s.live.slide, s.live.build, Date.now()) : null;
      if (build) return { ...s, live: { ...s.live, build } };
      const n = s.cursor && prevCursor(s, s.cursor);
      return n ? live(s, n) : s;
    }
    case 'live/clearAll':
      return {
        ...s, cursor: null, announce: null,
        live: { ...s.live, slide: null, nextText: null, background: null, message: null, black: false, logo: false, copyright: null, announcement: null },
      };
    case 'live/clearText':
      return { ...s, cursor: null, live: { ...s.live, slide: null, nextText: null, copyright: null } };
    case 'live/clearBackground':
      return { ...s, live: { ...s.live, background: null } };
    case 'live/toggleBlack':
      return { ...s, live: { ...s.live, black: !s.live.black } };
    case 'live/black':
      return { ...s, live: { ...s.live, black: a.on } };
    case 'live/background':
      return { ...s, live: { ...s.live, background: a.background, video: { playing: true, restart: s.live.video.restart } } };
    case 'live/message':
      return { ...s, live: { ...s.live, message: a.message?.trim() ? a.message.trim() : null } };
    case 'live/outputTimer':
      return { ...s, live: { ...s.live, outputTimerId: a.id } };
    case 'live/video':
      return {
        ...s,
        live: { ...s.live, video: { playing: a.playing ?? s.live.video.playing, restart: s.live.video.restart + (a.restart ? 1 : 0) } },
      };
    case 'audio/play':
      return { ...s, audio: { mediaId: a.mediaId, nonce: s.audio.nonce + 1 } };
    case 'live/logo':
      return { ...s, live: { ...s.live, logo: a.on ?? !s.live.logo, logoMediaId: lib.logoMediaId } };
    case 'library/logo':
      return { ...setLib(s, { logoMediaId: a.mediaId }), live: { ...s.live, logoMediaId: a.mediaId } };
    case 'live/stageMessage':
      return { ...s, live: { ...s.live, stageMessage: a.message?.trim() ? a.message.trim() : null } };
    case 'live/chords':
      return { ...s, live: { ...s.live, chordShift: Math.min(11, Math.max(-11, Math.round(a.shift ?? s.live.chordShift ?? 0))), capo: Math.min(11, Math.max(0, a.capo ?? s.live.capo ?? 0)) } };
    case 'live/messageScroll':
      return { ...s, live: { ...s.live, messageScroll: a.on } };
    case 'live/videoSeek':
      return { ...s, live: { ...s.live, video: { ...s.live.video, seek: { t: Math.max(0, a.t), n: (s.live.video.seek?.n ?? 0) + 1 } } } };
    case 'live/videoLoop':
      return { ...s, live: { ...s.live, video: { ...s.live.video, loop: a.on } } };
    case 'announce/start':
      return announceAt(s, a.presentationId, 0);
    case 'announce/next':
      return s.announce ? announceAt(s, s.announce.presentationId, s.announce.seq + 1) : s;
    case 'announce/stop':
      return { ...s, announce: null, live: { ...s.live, announcement: null } };
    case 'schedule/upsert':
      return setLib(s, { schedules: upsert(lib.schedules, a.schedule) });
    case 'schedule/delete':
      return setLib(s, { schedules: lib.schedules.filter((x) => x.id !== a.id) });
    case 'schedule/ran': {
      const sched = lib.schedules.find((x) => x.id === a.id);
      if (!sched) return s;
      const marked = setLib(s, { schedules: lib.schedules.map((x) => (x.id === a.id ? { ...x, lastRun: a.slot } : x)) });
      return core(marked, { type: 'macro/run', id: sched.macroId, now: a.now });
    }
    case 'slide/runActions':
      return runActions(s, a.actions, a.now);
    case 'retreat/look': {
      const saved = setLib(s, { retreat: a.look });
      const follows = (p: Presentation) => p.retreatBg === true && !isProtected(p);
      if (a.apply === false || !lib.presentations.some(follows)) return saved;
      const moving = retreatBackground(a.look);
      const applied = setLib(saved, { presentations: lib.presentations.map((p) => !follows(p) ? p : {
        ...p, background: moving ?? CHURCH_BACKGROUNDS.nightSky, bgEffect: moving ? { dim: a.look.dim, blur: 0 } : undefined,
      }) });
      return applied.cursor ? refreshLive(applied, applied.cursor.presentationId) : applied;
    }
    default:
      return s;
  }
}

/** Actions that change the library but should not be undoable. */
const NO_HISTORY = new Set<Action['type']>(['trash/expire', 'trash/purge', 'device/register', 'activity/record', 'timer/op', 'macro/run', 'usage/clear', 'library/replace', 'schedule/ran', 'slide/runActions', 'online/songs', 'songs/dedupe', 'live/videoClock', 'library/merge']);

function historyKey(a: Action): string {
  const id = (a as { id?: string }).id ?? (a as { theme?: Theme }).theme?.id ?? (a as { slideId?: string }).slideId ?? '';
  return `${a.type}:${id}:${'seq' in a ? a.seq ?? '' : ''}`;
}

/** Keeps output-facing copies of library data (themes, props, timers, screens) in sync with the library. */
function syncLive(s: AppState): AppState {
  const { live: l, library: lib } = s;
  if (l.props === lib.props && l.timers === lib.timers && l.screens === lib.screens && l.themes === lib.themes && l.stageLayouts === lib.stageLayouts) return s;
  return { ...s, live: { ...l, props: lib.props, timers: lib.timers, screens: lib.screens, themes: lib.themes, stageLayouts: lib.stageLayouts } };
}

function reduceState(s: AppState, a: Action): AppState {
  // A server reset was explicitly password-authorized. It includes protected content and clears Undo.
  if (a.type === 'library/cloudReset' && a.library.cloudResetId) return createInitialState(a.library);
  if (a.type === 'undo' || a.type === 'redo') {
    const from = a.type === 'undo' ? s.past : s.future;
    if (!from.length) return s;
    const library = from[from.length - 1];
    const rest = from.slice(0, -1);
    const other = [...(a.type === 'undo' ? s.future : s.past), s.library].slice(-60);
    const positions = a.type === 'undo' ? s.pastPositions : s.futurePositions;
    const position = positions.at(-1);
    const otherPositions = [...(a.type === 'undo' ? s.futurePositions : s.pastPositions), position ?? { before: s.cursor, after: s.cursor }].slice(-60);
    const next = { ...s, library, lastKey: null, ...(a.type === 'undo'
      ? { past: rest, future: other, pastPositions: positions.slice(0, -1), futurePositions: otherPositions }
      : { past: other, future: rest, pastPositions: otherPositions, futurePositions: positions.slice(0, -1) }) };
    const expected = a.type === 'undo' ? position?.after : position?.before;
    const restore = a.type === 'undo' ? position?.before : position?.after;
    // Restore the recorded occurrence only while still at the edit's resulting position.
    // If the operator has navigated elsewhere, keep following the slide they are showing.
    const same = (a: Cursor | null | undefined, b: Cursor | null) => a === b || (!!a && !!b && a.presentationId === b.presentationId && a.seq === b.seq && a.playlistIndex === b.playlistIndex);
    if (!position || !same(expected, s.cursor)) return syncLive(reconcileLive(s, next));
    return syncLive(restore ? refreshLive({ ...next, cursor: restore }, restore.presentationId) : {
      ...next, cursor: null, live: { ...next.live, slide: null, title: null, nextText: null, background: null, copyright: null, bgEffect: null },
    });
  }
  let next = core(s, a);
  if (next === s) return s;
  if (a.type === 'playlist/removeItem' || a.type === 'playlist/delete' || a.type === 'playlist/set' || a.type === 'services/finish') {
    const cleanup = saturdayDawnImageCleanup(s.library, next.library);
    const keep = new Set(cleanup.keep);
    if (next.library.presentations.some((p) => keep.has(p.id) && !p.cleanupOnPlaylistRemoval)) next = { ...next, library: { ...next.library,
      presentations: next.library.presentations.map((p) => keep.has(p.id) && !p.cleanupOnPlaylistRemoval ? { ...p, cleanupOnPlaylistRemoval: 'saturday-dawn' } : p) } };
    const gone = new Set(cleanup.remove);
    if (gone.size) {
      const trash = [...(next.library.trash ?? []), ...s.library.presentations.filter((p) => gone.has(p.id))
        .map((p) => trashPresentation(s.library, p, a.occurredAt ?? Date.now()))];
      next = { ...next, library: { ...next.library, trash, presentations: next.library.presentations.filter((p) => !gone.has(p.id)) },
        selectedId: next.selectedId && gone.has(next.selectedId) ? null : next.selectedId,
        cursor: next.cursor && gone.has(next.cursor.presentationId) ? null : next.cursor };
    }
  }
  // Lock changes form a history boundary: Undo cannot silently unlock or restore an older protected deck.
  const protectionState = (lib: Library) => JSON.stringify(mergeProtectionChanges(lib).sort((a, b) => a.id.localeCompare(b.id)));
  if (a.type === 'presentation/protect' || (next.library !== s.library && protectionState(next.library) !== protectionState(s.library))) return syncLive({ ...next, past: [], future: [], pastPositions: [], futurePositions: [], lastKey: null });
  if ((a.type === 'trash/purge' || a.type === 'trash/expire') && next.library !== s.library) return syncLive({ ...next, past: [], future: [], pastPositions: [], futurePositions: [], lastKey: null });
  if (next.library === s.library || a.type.startsWith('live/') || NO_HISTORY.has(a.type)) return syncLive(next);
  const key = historyKey(a);
  const slideList = a.type === 'presentation/update' && 'slides' in a.patch;
  const coalesce = !slideList && key === s.lastKey && (a.type === 'theme/upsert' || a.type.endsWith('/update') || a.type.endsWith('/upsert'));
  return syncLive({
    ...next,
    past: coalesce ? s.past : [...s.past, s.library].slice(-60),
    pastPositions: coalesce ? s.pastPositions.map((p, i, all) => i === all.length - 1 ? { ...p, after: next.cursor } : p) : [...s.pastPositions, { before: s.cursor, after: next.cursor }].slice(-60),
    future: [],
    futurePositions: [],
    lastKey: key,
  });
}

export function reducer(s: AppState, a: Action): AppState {
  return attributeChange(s, reduceState(s, a), a);
}
