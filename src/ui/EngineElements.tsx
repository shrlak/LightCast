// Slide objects whose drawing comes from the Rust engine: PowerPoint preset shapes (with text inside
// them), tables, charts, icons and ink.
import { useId, useSyncExternalStore, type CSSProperties } from 'react';
import type { DashStyle, SlideElement } from '../domain/types';
import { lineRuns } from '../domain/richText';

import { runStyle as runCss } from './runStyle';
import { chartSvg, engineReady, iconCatalog, layoutTable, onEngineReady, shapeCatalog, shapeGeometry, type FillMode, type ShapeGeometry } from '../engine';

let epoch = 0;
onEngineReady(() => { epoch++; });
/** Re-render when the engine becomes available (a window that drew before it finished loading). */
export const useEngineEpoch = () => useSyncExternalStore(onEngineReady, () => epoch, () => 0);

export const DEFAULT_STROKE_WIDTH = 4;
const SHADE: Record<FillMode, [string, number] | null> = {
  norm: null, none: null, lighten: ['#fff', 0.4], lightenLess: ['#fff', 0.2], darken: ['#000', 0.4], darkenLess: ['#000', 0.2],
};
const DASH: Record<DashStyle, (w: number) => string | undefined> = {
  solid: () => undefined, dash: (w) => `${w * 4} ${w * 3}`, dot: (w) => `${w} ${w * 2}`, dashDot: (w) => `${w * 4} ${w * 2} ${w} ${w * 2}`,
};

/** The preset a shape object draws: its own, or the plain box / circle of slides made before presets. */
export const presetOf = (el: SlideElement): string => el.shape ?? (el.ellipse ? 'ellipse' : el.radius ? 'roundRect' : 'rect');
export const isLineShape = (el: SlideElement) => el.kind === 'shape' && !!el.shape && !!shapeCatalog().find((p) => p.name === el.shape)?.line;

/** Adjust values for the engine: the object's own, or for a legacy rounded box its corner radius. */
export function adjOf(el: SlideElement): number[] | undefined {
  if (el.adj) return el.adj;
  if (!el.shape && el.radius && !el.ellipse) return [Math.round(Math.min(50000, (el.radius / Math.max(1, Math.min(el.w, el.h))) * 100000))];
  return undefined;
}

export function geometryOf(el: SlideElement): ShapeGeometry | null {
  return shapeGeometry(presetOf(el), el.w, el.h, adjOf(el));
}

export function effects(el: SlideElement): string | undefined {
  const shadow = !el.dropShadow ? null
    : el.shadowKind === 'perspective' ? 'drop-shadow(18px 22px 10px rgba(0,0,0,.35))'
      : el.shadowKind === 'inner' ? 'drop-shadow(0 0 2px rgba(0,0,0,.6))'
        : 'drop-shadow(0 8px 14px rgba(0,0,0,.45))';
  const g = el.glowSize ?? 18;
  const f = [shadow, el.glow && `drop-shadow(0 0 ${g}px ${el.glow}) drop-shadow(0 0 ${g / 2}px ${el.glow})`].filter(Boolean);
  return f.length ? f.join(' ') : undefined;
}

/**
 * Shape Effects beyond shadow and glow, as CSS: reflection (below the object), soft edges (a
 * feathered mask), 3-D rotation (perspective) and bevel (a lit inner edge).
 */
export function effectCss(el: SlideElement): CSSProperties {
  const css: CSSProperties = {};
  if (el.reflection) css.WebkitBoxReflect = 'below 4px linear-gradient(transparent 55%, rgba(255,255,255,.4))';
  if (el.softEdge) {
    const e = `${el.softEdge}px`;
    css.WebkitMaskImage = `linear-gradient(to right, transparent, #000 ${e}, #000 calc(100% - ${e}), transparent), linear-gradient(to bottom, transparent, #000 ${e}, #000 calc(100% - ${e}), transparent)`;
    css.WebkitMaskComposite = 'source-in';
    css.maskComposite = 'intersect';
  }
  if (el.bevel) css.boxShadow = 'inset 3px 3px 6px rgba(255,255,255,.45), inset -3px -3px 6px rgba(0,0,0,.35)';
  return css;
}

export const elementTransform = (el: SlideElement) =>
  [el.rotate3d ? `perspective(1200px) rotateX(${el.rotate3d.x}deg) rotateY(${el.rotate3d.y}deg)` : '', el.rotation ? `rotate(${el.rotation}deg)` : '', el.flipH ? 'scaleX(-1)' : '', el.flipV ? 'scaleY(-1)' : ''].filter(Boolean).join(' ') || undefined;


/** A preset shape as SVG, with its text laid in the shape's text area. */
export function ShapeElement({ el }: { el: SlideElement }) {
  useEngineEpoch();
  const gid = useId().replace(/:/g, '');
  const g = el.path
    ? { paths: [{ d: el.path, fill: 'norm' as const, stroke: true, evenOdd: false }], textRect: [0, 0, el.w, el.h] as [number, number, number, number], handles: [], open: false, sites: [] }
    : geometryOf(el);
  const custom = el.path ? `scale(${el.w / Math.max(0.01, el.pathW ?? el.w)}, ${el.h / Math.max(0.01, el.pathH ?? el.h)})` : undefined;
  const box: CSSProperties = { position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, opacity: el.opacity ?? 1, transform: elementTransform(el), filter: effects(el), ...effectCss(el) };
  const line = isLineShape(el);
  const sw = el.strokeWidth ?? (el.stroke || line ? DEFAULT_STROKE_WIDTH : 0);
  const stroke = el.stroke ?? (line ? el.fill ?? '#ffffff' : undefined);
  const fill = el.gradient ? `url(#g${gid})` : el.fill ?? '#ffffff';
  if (!g) {
    // Engine not loaded: the plain box or circle FreeCast always drew.
    return <div style={{ ...box, background: el.gradient ? `linear-gradient(${(el.gradientAngle ?? 90) + 90}deg, ${el.gradient[0]}, ${el.gradient[1]})` : el.fill ?? '#ffffff', borderRadius: el.ellipse || el.shape === 'ellipse' ? '50%' : el.radius ?? 0, border: el.stroke ? `${sw}px solid ${el.stroke}` : undefined }} />;
  }
  const a = ((el.gradientAngle ?? 90) * Math.PI) / 180;
  const [tx, ty, tw, th] = g.textRect;
  return (
    <div style={box} data-shape={presetOf(el)}>
      <svg width={el.w} height={el.h} viewBox={`0 0 ${Math.max(1, el.w)} ${Math.max(1, el.h)}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-label={el.alt}>
        <defs>
          {el.gradient && (
            <linearGradient id={`g${gid}`} x1={0.5 - Math.cos(a) / 2} y1={0.5 - Math.sin(a) / 2} x2={0.5 + Math.cos(a) / 2} y2={0.5 + Math.sin(a) / 2}>
              <stop offset="0" stopColor={el.gradient[0]} /><stop offset="1" stopColor={el.gradient[1]} />
            </linearGradient>
          )}
          {(el.arrowStart || el.arrowEnd) && (
            <marker id={`a${gid}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 Z" fill={stroke ?? '#fff'} />
            </marker>
          )}
        </defs>
        <g transform={custom}>
        {g.paths.map((p, i) => {
          const shade = SHADE[p.fill];
          const common = {
            vectorEffect: custom ? 'non-scaling-stroke' as const : undefined,
            d: p.d, fillRule: p.evenOdd ? 'evenodd' as const : undefined,
            stroke: p.stroke && sw > 0 ? stroke : undefined, strokeWidth: p.stroke && sw > 0 ? sw : undefined,
            strokeDasharray: DASH[el.dash ?? 'solid'](sw || 1), strokeLinejoin: 'round' as const, strokeLinecap: line ? 'round' as const : undefined,
          };
          return (
            <g key={i}>
              <path {...common} fill={p.fill === 'none' || g.open ? 'none' : fill}
                markerStart={el.arrowStart ? `url(#a${gid})` : undefined} markerEnd={el.arrowEnd ? `url(#a${gid})` : undefined} />
              {shade && <path d={p.d} fill={shade[0]} fillOpacity={shade[1]} fillRule={common.fillRule} />}
            </g>
          );
        })}
        </g>
      </svg>
      {el.text ? (
        <div style={{
          position: 'absolute', left: tx, top: ty, width: tw, height: th, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          justifyContent: el.vAlign === 'top' ? 'flex-start' : el.vAlign === 'bottom' ? 'flex-end' : 'center', textAlign: el.align ?? 'center',
          fontSize: el.fontSize ?? 40, fontFamily: el.fontFamily, color: el.color ?? '#ffffff', fontWeight: el.bold ? 800 : 500, fontStyle: el.italic ? 'italic' : undefined,
          lineHeight: el.lineHeight ?? 1.2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textDecoration: [el.underline && 'underline', el.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
          textShadow: el.shadow ? '0 3px 12px rgba(0,0,0,.8)' : undefined, transform: [el.flipH ? 'scaleX(-1)' : '', el.flipV ? 'scaleY(-1)' : ''].join(' ') || undefined,
        }}>{(() => {
          const runs = lineRuns(el);
          return el.text.split('\n').map((line, i) => <div key={i}>{runs[i] ? runs[i]!.map((r, j) => <span key={j} style={runCss(r)}>{r.text}</span>) : line || '\u00a0'}</div>);
        })()}</div>
      ) : null}
    </div>
  );
}

export function TableElement({ el }: { el: SlideElement }) {
  useEngineEpoch();
  const t = el.table;
  if (!t) return null;
  const cells = layoutTable(t, el.w, el.h, undefined);
  const fs = el.fontSize ?? 32;
  return (
    <div data-table style={{ position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, opacity: el.opacity ?? 1, transform: elementTransform(el), fontFamily: el.fontFamily, fontSize: fs, filter: effects(el), ...effectCss(el) }}>
      {!engineReady() && <div style={{ position: 'absolute', inset: 0, outline: '2px solid #888' }} />}
      {cells.map((c) => (
        <div key={`${c.r}:${c.c}`} style={{
          position: 'absolute', left: c.x, top: c.y, width: c.w, height: c.h, boxSizing: 'border-box', background: c.fill ?? undefined,
          border: c.border ? `${c.borderWidth}px solid ${c.border}` : undefined, color: c.color ?? el.color ?? '#ffffff', fontWeight: c.bold ? 700 : 400,
          display: 'flex', alignItems: 'center', justifyContent: c.align === 'center' ? 'center' : c.align === 'right' ? 'flex-end' : 'flex-start',
          textAlign: (c.align as CSSProperties['textAlign']) ?? 'left', padding: `${fs * 0.15}px ${fs * 0.35}px`, overflow: 'hidden', whiteSpace: 'pre-wrap', lineHeight: 1.2,
        }}>{c.text}</div>
      ))}
    </div>
  );
}

export function ChartElement({ el }: { el: SlideElement }) {
  useEngineEpoch();
  if (!el.chart) return null;
  const svg = chartSvg({ ...el.chart, textColor: el.chart.textColor ?? el.color ?? '#ffffff' }, Math.round(el.w), Math.round(el.h), undefined, el.fontFamily);
  const box: CSSProperties = { position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, opacity: el.opacity ?? 1, transform: elementTransform(el), background: el.fill, filter: effects(el), ...effectCss(el) };
  // The SVG is built by the engine, which escapes every label.
  return svg ? <div data-chart style={box} dangerouslySetInnerHTML={{ __html: svg }} /> : <div style={{ ...box, outline: '2px dashed #888' }} />;
}

export function IconElement({ el }: { el: SlideElement }) {
  useEngineEpoch();
  const icon = iconCatalog().find((i) => i.name === el.icon);
  const box: CSSProperties = { position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, opacity: el.opacity ?? 1, transform: elementTransform(el), filter: effects(el), ...effectCss(el) };
  if (!icon) return <div style={box} />;
  return (
    <svg data-icon={icon.name} style={box} viewBox="0 0 24 24" fill="none" stroke={el.stroke ?? el.color ?? '#ffffff'} strokeWidth={el.strokeWidth ?? icon.stroke} strokeLinecap="round" strokeLinejoin="round" aria-label={el.alt ?? icon.label}>
      {icon.d.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

export function InkElement({ el }: { el: SlideElement }) {
  const box: CSSProperties = { position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, opacity: el.opacity ?? 1, transform: elementTransform(el), overflow: 'visible' };
  return (
    <svg data-ink style={box} viewBox={`0 0 ${Math.max(1, el.pathW ?? el.w)} ${Math.max(1, el.pathH ?? el.h)}`} preserveAspectRatio="none">
      <path d={el.path ?? ''} fill="none" stroke={el.stroke ?? '#ff3b30'} strokeWidth={el.strokeWidth ?? 6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
