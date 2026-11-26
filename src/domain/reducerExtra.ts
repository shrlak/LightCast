import { mergeActivity, mergeDevices, newestModification } from './activity';
import { mergeLibrary, syncable } from './cloudMerge';
import { isProtected, keepProtectedMaterials, protectionWinners, mergeProtectionChanges } from './materialProtection';
// Actions for looks, stage layouts, playback markers, timelines and playlist templates.
// Kept apart from reducer.ts so each file stays small.
import type { Library, Look, PlaybackMarker, Playlist, Presentation, StageLayout, Timeline } from './types';
import type { AppState } from './reducer';

export type ExtraAction =
  | { type: 'look/save'; look: Look }
  | { type: 'look/delete'; id: string }
  | { type: 'look/apply'; id: string }
  | { type: 'stageLayout/upsert'; layout: StageLayout }
  | { type: 'stageLayout/delete'; id: string }
  | { type: 'media/markers'; id: string; markers: PlaybackMarker[] }
  | { type: 'timeline/set'; presentationId: string; timeline: Timeline | undefined }
  | { type: 'playlist/duplicate'; id: string; newId: string; name: string }
  | { type: 'live/videoClock'; endsAt: number | null }
  /** `from`: the library the merge was worked out from; edits made here since then are merged in too, never dropped. */
  | { type: 'library/merge'; library: Library; from?: Library }
  /** Replace (or add) a playlist; the selected item stays selected when items move. */
  | { type: 'playlist/set'; playlist: Playlist; activate?: boolean }
  /** Replace several presentations at once (one undo step); online songs stay online (not saved). */
  | { type: 'presentation/replaceMany'; presentations: Presentation[] };

const EXTRA = new Set<string>(['library/merge', 'playlist/set', 'presentation/replaceMany', 'look/save', 'look/delete', 'look/apply', 'stageLayout/upsert', 'stageLayout/delete', 'media/markers', 'timeline/set', 'playlist/duplicate', 'live/videoClock']);
export const isExtra = (a: { type: string }): a is ExtraAction => EXTRA.has(a.type);

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

export function extraReducer(s: AppState, a: ExtraAction): AppState {
  const lib = s.library;
  const setLib = (patch: Partial<Library>): AppState => ({ ...s, library: { ...lib, ...patch } });
  switch (a.type) {
    case 'look/save':
      return setLib({ looks: upsert(lib.looks, a.look) });
    case 'look/delete':
      return setLib({ looks: lib.looks.filter((l) => l.id !== a.id) });
    case 'look/apply': {
      const look = lib.looks.find((l) => l.id === a.id);
      if (!look) return s;
      return setLib({ screens: lib.screens.map((sc) => (look.screens[sc.id] ? { ...sc, layers: { ...look.screens[sc.id] } } : sc)) });
    }
    case 'stageLayout/upsert':
      return setLib({ stageLayouts: upsert(lib.stageLayouts, a.layout) });
    case 'stageLayout/delete':
      return setLib({ stageLayouts: lib.stageLayouts.filter((l) => l.id !== a.id) });
    case 'media/markers':
      return setLib({ media: lib.media.map((m) => (m.id === a.id ? { ...m, markers: [...a.markers].sort((x, y) => x.t - y.t) } : m)) });
    case 'timeline/set':
      return setLib({ presentations: lib.presentations.map((p) => (p.id === a.presentationId ? { ...p, timeline: a.timeline, online: undefined } : p)) });
    case 'playlist/duplicate': {
      const src = lib.playlists.find((p) => p.id === a.id);
      if (!src) return s;
      const copy = { id: a.newId, name: a.name, items: src.items.map((i, n) => ({ ...i, id: `${a.newId}_${n}` })) };
      return { ...setLib({ playlists: [...lib.playlists, copy] }), activePlaylistId: copy.id, playlistIndex: null };
    }
    case 'presentation/replaceMany': {
      const next = new Map(a.presentations.map((p) => [p.id, p]));
      return setLib({ presentations: lib.presentations.map((p) => isProtected(p) ? p : next.get(p.id) ?? p) });
    }
    case 'playlist/set': {
      const old = lib.playlists.find((p) => p.id === a.playlist.id);
      const playlists = old ? lib.playlists.map((p) => (p.id === a.playlist.id ? a.playlist : p)) : [...lib.playlists, a.playlist];
      const next = setLib({ playlists });
      if (a.activate && s.activePlaylistId !== a.playlist.id) return { ...next, activePlaylistId: a.playlist.id, playlistIndex: null };
      if (s.activePlaylistId !== a.playlist.id || s.playlistIndex == null || !old) return next;
      const selected = old.items[s.playlistIndex]?.id;
      const index = a.playlist.items.findIndex((i) => i.id === selected);
      return { ...next, playlistIndex: index >= 0 ? index : null };
    }
    case 'library/merge': {
      // Cloud sync: take the merged library but keep online songs, selection and what's live. When this window was
      // edited while the merge was being worked out (typing during a sync round), those edits are merged in as well.
      const merged = a.from && a.from !== lib ? mergeLibrary(syncable(a.from), syncable(lib), a.library).library : a.library;
      const incoming = new Set(merged.presentations.map((p) => p.id));
      const online = lib.presentations.filter((p) => p.online && !incoming.has(p.id));
      const incomingLibrary = { ...merged, protectionChanges: mergeProtectionChanges(lib, merged), activity: mergeActivity(lib.activity, merged.activity), devices: mergeDevices(lib.devices, merged.devices), lastModified: newestModification(lib.lastModified, merged.lastModified), presentations: [...merged.presentations, ...online] };
      return { ...s, library: keepProtectedMaterials(incomingLibrary, protectionWinners(lib, merged), [lib, merged]) };
    }
    case 'live/videoClock':
      return { ...s, live: { ...s.live, video: { ...s.live.video, endsAt: a.endsAt } } };
  }
}
