// Insert › Screenshot: choosing what to capture (screens and windows, with thumbnails from the desktop app)
// and cropping the captured frame before it goes on the slide. Pure logic only.

export interface CaptureSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** A small picture (data URL) of the screen or window; '' when the system gave none. */
  thumbnail: string;
}

/** What the desktop app's main process sends for desktopCapturer sources (anything may be missing or odd). */
export interface RawCaptureSource { id?: unknown; name?: unknown; thumbnail?: unknown }

/** Electron source ids look like `screen:1:0` and `window:1234:0`. */
export const sourceKind = (id: string): 'screen' | 'window' => (id.startsWith('screen:') ? 'screen' : 'window');

/** Clean list from raw sources: drops entries without an id, names empty ones, screens first, otherwise original order. */
export function normalizeSources(raw: readonly RawCaptureSource[]): CaptureSource[] {
  const out: CaptureSource[] = [];
  const seen = new Set<string>();
  let screens = 0;
  for (const r of raw) {
    if (typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    const kind = sourceKind(r.id);
    if (kind === 'screen') screens++;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const thumbnail = typeof r.thumbnail === 'string' && r.thumbnail.startsWith('data:image/') ? r.thumbnail : '';
    out.push({ id: r.id, name: name || (kind === 'screen' ? `화면 ${screens}` : '이름 없는 창'), kind, thumbnail });
  }
  return [...out.filter((s) => s.kind === 'screen'), ...out.filter((s) => s.kind === 'window')];
}

export const SOURCE_KIND_LABEL: Record<CaptureSource['kind'], string> = { screen: '화면', window: '창' };

/** Which tab (or both) is shown. */
export type SourceFilter = 'all' | CaptureSource['kind'];
export function filterSources(list: readonly CaptureSource[], filter: SourceFilter): CaptureSource[] {
  return filter === 'all' ? [...list] : list.filter((s) => s.kind === filter);
}

/** The picked source if it is still in the list, else the first one (so a vanished window never stays selected). */
export function keepSelection(list: readonly CaptureSource[], selected: string | null): string | null {
  return selected && list.some((s) => s.id === selected) ? selected : list[0]?.id ?? null;
}

// ── Crop ────────────────────────────────────────────────────────────────────────────────────────
export interface CropRect { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

/** The smallest crop worth making, in picture pixels; a tiny drag is a stray click, not a crop. */
export const MIN_CROP = 8;

/**
 * A drag between two points inside the shown picture (shown at `shown` px, the picture itself `natural` px)
 * as a rectangle in picture pixels, clamped to the picture. Null when the drag is too small.
 */
export function cropFromDrag(a: Pt, b: Pt, shown: { w: number; h: number }, natural: { w: number; h: number }): CropRect | null {
  if (!(shown.w > 0) || !(shown.h > 0) || !(natural.w > 0) || !(natural.h > 0)) return null;
  const kx = natural.w / shown.w, ky = natural.h / shown.h;
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const x1 = clamp(Math.min(a.x, b.x) * kx, natural.w), x2 = clamp(Math.max(a.x, b.x) * kx, natural.w);
  const y1 = clamp(Math.min(a.y, b.y) * ky, natural.h), y2 = clamp(Math.max(a.y, b.y) * ky, natural.h);
  const r = { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
  return r.w < MIN_CROP || r.h < MIN_CROP ? null : r;
}

/** A crop rectangle in shown pixels (for the overlay). */
export function cropToShown(r: CropRect, shown: { w: number; h: number }, natural: { w: number; h: number }): CropRect {
  const kx = shown.w / natural.w, ky = shown.h / natural.h;
  return { x: r.x * kx, y: r.y * ky, w: r.w * kx, h: r.h * ky };
}

/** Whether the crop is the whole picture (nothing to cut). */
export const isWholePicture = (r: CropRect, natural: { w: number; h: number }) => r.x <= 0 && r.y <= 0 && r.w >= natural.w && r.h >= natural.h;

/** "1280 × 720 픽셀" */
export const cropSizeLabel = (r: { w: number; h: number }) => `${r.w} × ${r.h} 픽셀`;
