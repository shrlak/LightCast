// Insert › Zoom: a zoom object shows its target slide. The object keeps a snapshot (so the output
// window, which has only the live slide, can draw it); after every edit the snapshots are brought
// up to date with their target slides, so a zoom always shows the slide as it is now.
import type { Presentation, Slide } from './types';
import { resolveBackground } from './autoBackground';

// The same target slide object always gives the same snapshot object, so unchanged zooms are left
// as they are (no needless re-render, no feedback between zooms that point at each other).
const snapshots = new WeakMap<Slide, Slide>();
function snapshot(target: Slide): Slide {
  let s = snapshots.get(target);
  if (!s) {
    // A zoom inside the target draws as a plain frame: no zooms of zooms of zooms.
    s = { ...target, elements: target.elements?.map((e) => (e.kind === 'zoom' && e.zoomOf ? { ...e, zoomOf: undefined } : e)) };
    snapshots.set(target, s);
  }
  return s;
}

export function refreshZooms(p: Presentation): Presentation {
  if (!p.slides.some((s) => s.elements?.some((e) => e.kind === 'zoom' && e.targetSlideId))) return p;
  const byId = new Map(p.slides.map((s) => [s.id, s]));
  let changed = false;
  const slides = p.slides.map((s) => {
    if (!s.elements?.some((e) => e.kind === 'zoom' && e.targetSlideId)) return s;
    let mine = false;
    const elements = s.elements.map((e) => {
      if (e.kind !== 'zoom' || !e.targetSlideId || !e.zoomOf) return e;
      const target = byId.get(e.targetSlideId);
      if (!target) return e;
      const snap = snapshot(target);
      if (e.zoomOf.slide === snap) return e;
      mine = true;
      return { ...e, zoomOf: { ...e.zoomOf, slide: snap, background: resolveBackground(target, p) } };
    });
    if (!mine) return s;
    changed = true;
    return { ...s, elements };
  });
  return changed ? { ...p, slides } : p;
}
