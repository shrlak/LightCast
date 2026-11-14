import type { Library, LiveState, MediaMeta, Playlist, DeviceRegistration } from './types';
import { isActivityEntry, isDeviceIdentity } from './activity';
import { createSeedLibrary, DEFAULT_THEMES } from './defaults';
import { CANVAS_W, LEGACY_CANVAS_W } from './canvas';
import { centerSongLyrics } from './songCentering';
import { prepareAnnouncementSizing } from './announcementSizing';
import { normalizeRetreatLook } from './motion';

const LIBRARY_KEY = 'freecast.library.v1';
const LIVE_KEY = 'freecast.live.v2';

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

/**
 * Validate data from storage or an imported file and fill in anything an older
 * version did not have. Returns null when it is not a LightCast library.
 */
/** The presentations without their own transitions (nor their slides'). */
export function clearTransitions(list: Library['presentations']): Library['presentations'] {
  return list.map((p) => {
    const { transition: _p, ...rest } = p;
    return { ...rest, slides: p.slides.map((s) => { const { transition: _s, ...r } = s; return r; }) };
  });
}

/** Step types older versions saved that LightCast no longer runs (OBS scenes, stream, recording). */
const RETIRED_STEPS = new Set(['obs']);
const keepStep = (s: unknown) => !(isObj(s) && RETIRED_STEPS.has(s.type as string));
/** The OBS lyrics overlay screen older versions created (kept if it was renamed, i.e. set up on purpose). */
const isRetiredScreen = (s: unknown) => isObj(s) && s.id === 'screen_stream' && s.name === 'OBS lyrics overlay (lower third)';

/** Macros and slide actions without retired step types. */
function withoutRetiredSteps<T extends { steps: unknown[] }>(macros: T[]): T[] {
  return macros.map((m) => (Array.isArray(m?.steps) && !m.steps.every(keepStep) ? { ...m, steps: m.steps.filter(keepStep) } : m));
}
function withoutRetiredActions(list: Library['presentations']): Library['presentations'] {
  return list.map((p) => (p.slides.some((s) => s.actions && !s.actions.every(keepStep))
    ? { ...p, slides: p.slides.map((s) => {
      if (!s.actions || s.actions.every(keepStep)) return s;
      const actions = s.actions.filter(keepStep);
      const { actions: _a, ...rest } = s;
      return actions.length ? { ...rest, actions } : rest;
    }) }
    : p));
}

export function normalizeLibrary(value: unknown): Library | null {
  if (!isObj(value) || value.version !== 1) return null;
  const { presentations, themes } = value;
  if (!Array.isArray(presentations) || !Array.isArray(themes) || !themes.length) return null;
  if (!presentations.every((p) => isObj(p) && typeof p.id === 'string' && Array.isArray(p.slides))) return null;
  const seed = createSeedLibrary();
  const arr = <T>(v: unknown, fallback: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fallback);
  let playlists = arr<Playlist>(value.playlists, []);
  if (!playlists.length && Array.isArray(value.playlist)) {
    playlists = [{ id: 'pl_main', name: 'Playlist', items: value.playlist as Playlist['items'] }];
  }
  if (!playlists.length) playlists = [{ id: 'pl_main', name: 'Playlist', items: [] }];
  // Libraries from before the 주일예배 builder get its Front / 기도 / Back templates.
  const ids = new Set(presentations.map((p) => (p as { id: string }).id));
  const saved = isObj(value.sunday) ? value.sunday : null;
  const wanted = (id: string) => !saved || [saved.frontId, saved.prayerId, saved.backId].includes(id);
  const templates = seed.presentations.filter((p) => p.folder === 'Templates' && !ids.has(p.id) && wanted(p.id));
  const laidOut = value.aspect === '4:3' ? (presentations as Library['presentations']) : toFourThree(presentations as Library['presentations']);
  // Once: every transition the library had is cleared, so all of them are the default (없음, 1 ms).
  const screens = arr<Library['screens'][number]>(value.screens, seed.screens);
  const own = withoutRetiredActions(value.transitionsReset === true ? laidOut : clearTransitions(laidOut));
  return {
    version: 1,
    cloudResetId: typeof value.cloudResetId === 'string' ? value.cloudResetId : undefined,
    aspect: '4:3',
    transitionsReset: true,
    trash: arr<import('./types').TrashEntry>(value.trash, []).filter((e) => !!e && typeof e.id === 'string' && typeof e.presentation?.title === 'string' && (e.slides == null || (Array.isArray(e.slides) && e.slides.every((s) => !!s?.slide && typeof s.slide.id === 'string' && Number.isInteger(s.seq) && s.seq >= 0))) && (e.placements == null || Array.isArray(e.placements)) && Number.isFinite(e.deletedAt) && Number.isFinite(e.expiresAt) && !!e.presentation?.id && Array.isArray(e.presentation.slides) && ['presentation', 'slides'].includes(e.kind)),
    devices: arr<DeviceRegistration>(value.devices, []).filter((d) => isDeviceIdentity(d) && Number.isFinite(d.lastSeen) && (d.account === null || typeof d.account === 'string')),
    activity: arr<unknown>(value.activity, []).filter(isActivityEntry).slice(-2000),
    lastModified: isActivityEntry(value.lastModified) ? value.lastModified : undefined,
    presentations: [...own.map((p) => prepareAnnouncementSizing(centerSongLyrics(p))), ...templates],
    // Themes added in later versions (광고, scripture) are appended if missing.
    themes: [...(themes as Library['themes']), ...DEFAULT_THEMES.filter((t) => !themes.some((x) => isObj(x) && x.id === t.id))],
    playlists,
    backgroundLibraryReset: true,
    protectionChanges: arr<NonNullable<Library['protectionChanges']>[number]>(value.protectionChanges, []).filter((c) => c && typeof c.id === 'string' && typeof c.on === 'boolean' && Number.isFinite(c.at)),
    media: arr<MediaMeta>(value.media, []).map((m) =>
      value.backgroundLibraryReset === true || m.type === 'audio' ? m : { ...m, backgroundHidden: true }),
    timers: arr(value.timers, seed.timers),
    props: arr(value.props, seed.props),
    messageTemplates: arr(value.messageTemplates, seed.messageTemplates),
    macros: withoutRetiredSteps(arr(value.macros, seed.macros)),
    screens: screens.some((x) => !isRetiredScreen(x)) ? screens.filter((x) => !isRetiredScreen(x)) : screens,
    usage: arr(value.usage, []),
    schedules: arr(value.schedules, []),
    looks: arr(value.looks, []),
    stageLayouts: arr(value.stageLayouts, seed.stageLayouts),
    ...(arr<import('./fontSync').CloudFont>(value.fonts, []).filter((f) => f && typeof f.id === 'string' && f.id.startsWith('font-') && typeof f.family === 'string' && Number.isSafeInteger(f.bytes)).length
      ? { fonts: arr<import('./fontSync').CloudFont>(value.fonts, []).filter((f) => f && typeof f.id === 'string' && f.id.startsWith('font-') && typeof f.family === 'string' && Number.isSafeInteger(f.bytes)) } : {}),
    logoMediaId: typeof value.logoMediaId === 'string' ? value.logoMediaId : null,
    ...(normalizeRetreatLook(value.retreat) ? { retreat: normalizeRetreatLook(value.retreat) } : {}),
    sunday: churchStyle({ ...seed.sunday, ...(isObj(value.sunday) ? value.sunday : {}) }, isObj(value.sunday) ? value.sunday.styleVersion : undefined),
  };
}

/**
 * Slides made when LightCast was 16:9 (1920 wide) → the 4:3 canvas: objects keep their place
 * relative to the centre, the way the wider background is trimmed at both sides. An object that
 * would end up off the slide is pulled back so at least part of it stays visible.
 */
export function toFourThree(presentations: Library['presentations']): Library['presentations'] {
  const dx = (LEGACY_CANVAS_W - CANVAS_W) / 2;
  return presentations.map((p) => ({
    ...p,
    slides: p.slides.map((s) =>
      s.elements?.length
        ? { ...s, elements: s.elements.map((e) => ({ ...e, x: Math.min(CANVAS_W - 40, Math.max(40 - e.w, Math.round(e.x - dx))) })) }
        : s,
    ),
  }));
}

/**
 * Once each: defaults matched to the church's own PPT (changeable afterwards) —
 * v1 one Bible verse per slide, v2 up to four lyric lines per slide.
 */
function churchStyle(sunday: Library['sunday'], saved: unknown): Library['sunday'] {
  const done = typeof saved === 'number' ? saved : 0;
  let next = sunday;
  if (done < 1) next = { ...next, versesPerSlide: 1 };
  if (done < 2) next = { ...next, linesPerSlide: 4 };
  return { ...next, styleVersion: 2 };
}

export const isLibrary = (value: unknown): boolean => normalizeLibrary(value) !== null;

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Storage full or blocked; the app keeps working in memory.
    return false;
  }
}

export function loadLibrary(): Library {
  return normalizeLibrary(read(LIBRARY_KEY)) ?? createSeedLibrary();
}

/** Online songs are never written to this computer — only the user's own presentations. */
/** False when the library could not be written (storage full or blocked). */
export const saveLibrary = (lib: Library): boolean => write(LIBRARY_KEY, { ...lib, presentations: lib.presentations.filter((p) => !p.online) });
export const saveLive = (live: LiveState) => write(LIVE_KEY, live);
export const loadLive = (): LiveState | null => {
  const v = read(LIVE_KEY);
  return isObj(v) && 'theme' in v ? (v as unknown as LiveState) : null;
};
