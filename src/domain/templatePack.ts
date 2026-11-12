import type { Background, Library, Presentation, Slide, SlideElement, Theme } from './types';
import { uid } from './lyrics';

export const PACK_KIND = 'freecast-template-pack';
export const PACK_FOLDER = '가져온 템플릿';

export interface TemplatePack {
  kind: typeof PACK_KIND;
  version: 1;
  name: string;
  exportedAt: number;
  presentations: Presentation[];
  themes: Theme[];
  /** Pictures/videos stored on the exporting computer cannot travel in a pack; this many were replaced. */
  mediaDropped: number;
}

const PLAIN: Background = { kind: 'color', value: '#111111' };

/** A copy of the presentation with files that only exist on this computer taken out. */
function portable(p: Presentation): { presentation: Presentation; dropped: number } {
  let dropped = 0;
  const bg = (b: Background | undefined): Background | undefined => {
    if (b?.kind === 'media' || b?.kind === 'camera') { dropped++; return PLAIN; }
    return b;
  };
  const slide = (s: Slide): Slide => {
    const elements = s.elements?.filter((e: SlideElement) => { const local = !!e.mediaId; if (local) dropped++; return !local; });
    const { actions: _actions, ...rest } = s;
    return { ...rest, background: bg(s.background), ...(elements ? { elements } : {}) };
  };
  const { online: _online, protected: _protected, protectionChangedAt: _at, cleanupOnPlaylistRemoval: _c, ...rest } = p;
  return { presentation: { ...rest, background: bg(p.background), slides: p.slides.map(slide) }, dropped };
}

export function buildTemplatePack(lib: Library, presentationIds: string[], name: string, now: number): TemplatePack {
  const chosen = lib.presentations.filter((p) => presentationIds.includes(p.id));
  const parts = chosen.map(portable);
  const themeIds = new Set(chosen.map((p) => p.themeId));
  return {
    kind: PACK_KIND, version: 1, name: name.trim() || '템플릿 모음', exportedAt: now,
    presentations: parts.map((x) => x.presentation),
    themes: lib.themes.filter((t) => themeIds.has(t.id)),
    mediaDropped: parts.reduce((n, x) => n + x.dropped, 0),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Validate a file someone else made; null when it is not a LightCast template pack. */
export function parseTemplatePack(value: unknown): TemplatePack | null {
  if (!isObj(value) || value.kind !== PACK_KIND || value.version !== 1) return null;
  const { presentations, themes } = value;
  if (!Array.isArray(presentations) || !Array.isArray(themes) || presentations.length === 0 || presentations.length > 200) return null;
  if (!presentations.every((p) => isObj(p) && typeof p.id === 'string' && typeof p.title === 'string' && typeof p.themeId === 'string' && Array.isArray(p.slides) && p.slides.every((s) => isObj(s) && typeof s.id === 'string' && typeof s.text === 'string'))) return null;
  if (!themes.every((t) => isObj(t) && typeof t.id === 'string' && typeof t.name === 'string')) return null;
  return {
    kind: PACK_KIND, version: 1,
    name: typeof value.name === 'string' ? value.name.slice(0, 80) : '템플릿 모음',
    exportedAt: typeof value.exportedAt === 'number' ? value.exportedAt : 0,
    presentations: presentations as Presentation[], themes: themes as Theme[],
    mediaDropped: typeof value.mediaDropped === 'number' ? value.mediaDropped : 0,
  };
}

/**
 * New presentations (fresh ids, so nothing already in the library is touched) and the themes they need.
 * A theme with the same id is reused only when it is identical; otherwise the pack's copy gets a new id.
 */
export function importTemplatePack(lib: Library, pack: TemplatePack): { presentations: Presentation[]; themes: Theme[] } {
  const themes: Theme[] = [];
  const themeMap = new Map<string, string>();
  for (const t of pack.themes) {
    const existing = lib.themes.find((x) => x.id === t.id);
    if (existing && JSON.stringify(existing) === JSON.stringify(t)) { themeMap.set(t.id, t.id); continue; }
    const id = existing ? uid('theme') : t.id;
    themeMap.set(t.id, id);
    themes.push({ ...t, id, generated: undefined });
  }
  const fallback = lib.themes[0]?.id ?? '';
  const presentations = pack.presentations.map((p): Presentation => {
    const { templateKey: _key, ...rest } = p;
    return {
      ...rest, id: uid('p'), folder: `Templates/${PACK_FOLDER}`, themeId: themeMap.get(p.themeId) ?? fallback,
      slides: p.slides.map((s) => ({ ...s, id: uid('s') })), arrangements: undefined, arrangementId: undefined, updatedAt: undefined,
    };
  });
  return { presentations, themes };
}
