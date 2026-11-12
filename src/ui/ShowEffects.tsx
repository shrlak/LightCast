// Slide-show effects whose frames come from the Rust engine: PowerPoint slide transitions (as
// layers of the old and new slide) and object animations (per-object state over time).
import { createContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Slide, SlideElement } from '../domain/types';
import { CANVAS_H, CANVAS_W } from '../domain/canvas';
import { buildStates, byParagraph, type LiveBuild } from '../domain/animations';
import { transitionFrame, type AnimState, type TransitionLayer } from '../engine';

type Pt = [number, number];

/** CSS matrix3d that maps the rectangle (0,0)–(w,h) onto the quad tl, tr, br, bl; null when the quad is degenerate. */
export function quadMatrix(w: number, h: number, q: [Pt, Pt, Pt, Pt]): string | null {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-9 || w <= 0 || h <= 0) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const hh = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3, f = y0;
  // Unit square → quad; scale the unit square up to w×h first.
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1];
  return m.every(Number.isFinite) ? `matrix3d(${m.map((v) => +v.toFixed(6)).join(',')})` : null;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** How one layer of a transition frame is drawn: a window onto a copy of the old or new slide. */
export function layerStyle(l: TransitionLayer): { outer: CSSProperties; inner: CSSProperties } | null {
  const [sl, st, sr, sb] = l.src;
  const opacity = l.alpha * (l.fade.reduce((a, b) => a + b, 0) / 4);
  const px = (p: Pt): Pt => [p[0] * CANVAS_W, p[1] * CANVAS_H];
  const rectUv = near(l.uv[0][0], sl) && near(l.uv[0][1], st) && near(l.uv[1][0], sr) && near(l.uv[1][1], st) && near(l.uv[2][0], sr) && near(l.uv[2][1], sb) && near(l.uv[3][0], sl) && near(l.uv[3][1], sb);
  if (rectUv) {
    const w = (sr - sl) * CANVAS_W, h = (sb - st) * CANVAS_H;
    const transform = quadMatrix(w, h, [px(l.quad[0]), px(l.quad[1]), px(l.quad[2]), px(l.quad[3])]);
    if (!transform) return null;
    return {
      outer: { position: 'absolute', left: 0, top: 0, width: w, height: h, overflow: 'hidden', transformOrigin: '0 0', transform, opacity, willChange: 'transform, opacity' },
      inner: { position: 'absolute', left: -sl * CANVAS_W, top: -st * CANVAS_H, width: CANVAS_W, height: CANVAS_H },
    };
  }
  // A wedge or other cut-out shown in place (Clock, Shape…): clip the slide to the polygon.
  const poly = l.quad.map((p) => `${(p[0] * 100).toFixed(3)}% ${(p[1] * 100).toFixed(3)}%`).join(',');
  return {
    outer: { position: 'absolute', inset: 0, clipPath: `polygon(${poly})`, opacity },
    inner: { position: 'absolute', inset: 0 },
  };
}

/** Plays one engine transition from `oldBody` to `newBody`, then calls `onDone`. */
export function FxTransition({ kind, option, duration, oldBody, newBody, onDone }: { kind: string; option: string; duration: number; oldBody: ReactNode; newBody: ReactNode; onDone: () => void }) {
  const [t, setT] = useState(0);
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / Math.max(1, duration));
      setT(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else done.current();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [kind, option, duration]);
  const layers = transitionFrame(kind, option, t) ?? [
    // Engine unavailable: a plain cross-fade.
    { source: 'Old', src: [0, 0, 1, 1], quad: [[0, 0], [1, 0], [1, 1], [0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], alpha: 1 - t, fade: [1, 1, 1, 1] } as TransitionLayer,
    { source: 'New', src: [0, 0, 1, 1], quad: [[0, 0], [1, 0], [1, 1], [0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], alpha: t, fade: [1, 1, 1, 1] } as TransitionLayer,
  ];
  return (
    <div className="layer fx-transition" style={{ overflow: 'hidden' }}>
      {layers.map((l, i) => {
        if (l.source === 'OldBack' || l.source === 'NewBack') return null;
        const s = layerStyle(l);
        if (!s) return null;
        if (l.source === 'Black' || l.source === 'White') return <div key={i} style={{ ...s.outer, background: l.source === 'Black' ? '#000' : '#fff' }} />;
        return <div key={i} style={s.outer}><div style={s.inner}>{l.source.startsWith('Old') ? oldBody : newBody}</div></div>;
      })}
    </div>
  );
}

function applyState(node: HTMLElement, el: SlideElement, s: AnimState | undefined) {
  if (!s) {
    node.style.cssText = 'position:absolute;inset:0';
    return;
  }
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const st = node.style;
  st.visibility = s.visible ? 'visible' : 'hidden';
  st.opacity = String(s.opacity);
  st.transformOrigin = `${cx}px ${cy}px`;
  st.transform = `translate(${s.dx}px, ${s.dy}px) rotate(${s.rotate}deg) scale(${s.sx}, ${s.sy})`;
  st.clipPath = s.clip
    ? `inset(${el.y + s.clip[1] * el.h}px ${CANVAS_W - (el.x + s.clip[2] * el.w)}px ${CANVAS_H - (el.y + s.clip[3] * el.h)}px ${el.x + s.clip[0] * el.w}px)`
    : '';
}

/**
 * Set around an object built paragraph by paragraph: its text draws each paragraph in its own
 * element marked `data-para`, so each one can take its own animation state.
 */
export const ParagraphBuild = createContext(false);

const pct = (v: number) => `${+(v * 100).toFixed(4)}%`;

/**
 * The style a paragraph of a by-paragraph build takes from its state (relative to its object, whose
 * wrapper carries the object's own state): it turns about its own centre, and a reveal clip is cut
 * in the paragraph's own box. No state: the paragraph is left as the text draws it.
 */
export function paragraphStyle(s: AnimState | undefined): { visibility: string; opacity: string; transform: string; clipPath: string } {
  if (!s) return { visibility: '', opacity: '', transform: '', clipPath: '' };
  return {
    visibility: s.visible ? 'visible' : 'hidden',
    opacity: String(s.opacity),
    transform: `translate(${s.dx}px, ${s.dy}px) rotate(${s.rotate}deg) scale(${s.sx}, ${s.sy})`,
    clipPath: s.clip ? `inset(${pct(s.clip[1])} ${pct(1 - s.clip[2])} ${pct(1 - s.clip[3])} ${pct(s.clip[0])})` : '',
  };
}

function applyParagraphs(node: HTMLElement, id: string, states: Record<string, AnimState> | undefined) {
  node.querySelectorAll<HTMLElement>('[data-para]').forEach((p) => {
    const css = paragraphStyle(states?.[`${id}#${p.dataset.para}`]);
    p.style.visibility = css.visibility;
    p.style.opacity = css.opacity;
    p.style.transform = css.transform;
    p.style.clipPath = css.clipPath;
  });
}

/**
 * A slide's objects with its animations playing: each object sits in a slide-sized wrapper whose
 * opacity, transform and clip follow the engine's timeline for the current click step; in an object
 * built by paragraph each paragraph (`data-para`) follows its own state inside it.
 */
export function AnimatedElements({ slide, elements, build, render }: { slide: Slide; elements: SlideElement[]; build: LiveBuild; render: (el: SlideElement) => ReactNode }) {
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const key = useMemo(() => JSON.stringify([slide.animations, elements.map((e) => [e.id, e.x, e.y, e.w, e.h, e.rotation, e.hidden])]), [slide.animations, elements]);
  const latest = useRef({ slide, elements }); latest.current = { slide, elements };
  const paraIds = new Set((slide.animations ?? []).filter((a) => byParagraph(a, elements.find((e) => e.id === a.elementId))).map((a) => a.elementId));
  useLayoutEffect(() => {
    let raf = 0;
    const tick = () => {
      const { slide, elements } = latest.current;
      const r = buildStates(slide, elements, build, Date.now());
      for (const el of elements) {
        const node = nodes.current.get(el.id);
        if (!node) continue;
        applyState(node, el, r?.states[el.id]);
        applyParagraphs(node, el.id, r?.states);
      }
      if (r && !r.settled) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [key, build.step, build.startedAt, build.all, JSON.stringify(build.triggers ?? null)]);
  return (
    <>
      {elements.map((el) => (
        <div key={el.id} data-anim={el.id} style={{ position: 'absolute', inset: 0 }} ref={(n) => { if (n) nodes.current.set(el.id, n); else nodes.current.delete(el.id); }}>
          <ParagraphBuild.Provider value={paraIds.has(el.id)}>{render(el)}</ParagraphBuild.Provider>
        </div>
      ))}
    </>
  );
}
