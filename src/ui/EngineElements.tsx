// Slide objects whose drawing comes from the Rust engine: PowerPoint preset shapes (with text inside
// them), tables, charts, icons and ink.
import { useId, useSyncExternalStore, type CSSProperties } from 'react';
import type { SlideElement } from '../domain/types';
import { ARROW_SCALE, arrowPath, capOf, compoundLayers, dashPattern, effectFilter, effectStyle, fillOpacityOf, gradientStopsOf, joinOf, transformOf } from '../domain/shapeEffects';
import { extrusionOf, faceShading } from '../domain/shape3d';
import { lineRuns } from '../domain/richText';

import { runStyle as runCss } from './runStyle';
import { useMediaUrl } from './hooks';
import { patternPath } from '../domain/patterns';
import { chartSvg, engineReady, iconCatalog, layoutTable, onEngineReady, shapeCatalog, shapeGeometry, type CellBorder, type FillMode, type ShapeGeometry, type TableData } from '../engine';
import { penCss, penDash, sideOf } from '../domain/tableBorders';

let epoch = 0;
onEngineReady(() => { epoch++; });
/** Re-render when the engine becomes available (a window that drew before it finished loading). */
export const useEngineEpoch = () => useSyncExternalStore(onEngineReady, () => epoch, () => 0);

export const DEFAULT_STROKE_WIDTH = 4;
const SHADE: Record<FillMode, [string, number] | null> = {
  norm: null, none: null, lighten: ['#fff', 0.4], lightenLess: ['#fff', 0.2], darken: ['#000', 0.4], darkenLess: ['#000', 0.2],
};

/** The preset a shape object draws: its own, or the plain box / circle of slides made before presets. */
export const presetOf = (el: SlideElement): string => el.shape ?? (el.ellipse ? 'ellipse' : el.radius ? 'roundRect' : 'rect');
export const isLinePreset = (name: string) => !!shapeCatalog().find((p) => p.name === name)?.line;
export const isLineShape = (el: SlideElement) => el.kind === 'shape' && !!el.shape && !el.path && isLinePreset(el.shape);

/** Adjust values for the engine: the object's own, or for a legacy rounded box its corner radius. */
export function adjOf(el: SlideElement): number[] | undefined {
  if (el.adj) return el.adj;
  if (!el.shape && el.radius && !el.ellipse) return [Math.round(Math.min(50000, (el.radius / Math.max(1, Math.min(el.w, el.h))) * 100000))];
  return undefined;
}

export function geometryOf(el: SlideElement): ShapeGeometry | null {
  return shapeGeometry(presetOf(el), el.w, el.h, adjOf(el));
}

/** Shadow and glow as a CSS filter (presets and options in src/domain/shapeEffects). */
export const effects = (el: SlideElement): string | undefined => effectFilter(el);

/** Reflection, soft edges and bevel as CSS. */
export const effectCss = (el: SlideElement): CSSProperties => effectStyle(el);

export const elementTransform = (el: SlideElement) => transformOf(el);


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
  const imageUrl = useMediaUrl(el.fillImage);
  const fill = el.fillImage && imageUrl ? `url(#i${gid})` : el.pattern ? `url(#p${gid})` : el.gradient || el.gradientStops ? `url(#g${gid})` : el.fill ?? '#ffffff';
  if (!g) {
    // Engine not loaded: the plain box or circle LightCast always drew.
    return <div style={{ ...box, background: el.gradient ? `linear-gradient(${(el.gradientAngle ?? 90) + 90}deg, ${el.gradient[0]}, ${el.gradient[1]})` : el.fill ?? '#ffffff', borderRadius: el.ellipse || el.shape === 'ellipse' ? '50%' : el.radius ?? 0, border: el.stroke ? `${sw}px solid ${el.stroke}` : undefined }} />;
  }
  const a = ((el.gradientAngle ?? 90) * Math.PI) / 180;
  const [tx, ty, tw, th] = g.textRect;
  const stops = gradientStopsOf(el);
  const stopEls = stops?.map((st, i) => <stop key={i} offset={st.pos / 100} stopColor={st.color} stopOpacity={1 - (st.transparency ?? 0)} />);
  const fillAlpha = fillOpacityOf(el);
  const cap = capOf(el, line), join = joinOf(el);
  const linecap = cap === 'flat' ? 'butt' as const : cap;
  const closedShape = !g.open;
  // 3-D Format: depth / contour are drawn behind the face, lighting and material over it.
  const ext = closedShape ? extrusionOf(el) : null;
  const shading = closedShape ? faceShading(el) : null;
  const sideSvg = (key: string, z: number, color: string, width: number) => (
    <svg key={key} width={el.w} height={el.h} viewBox={`0 0 ${Math.max(1, el.w)} ${Math.max(1, el.h)}`} aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none', transform: `translateZ(${z}px)` }}>
      <g transform={custom}>{g.paths.map((p, i) => p.fill === 'none' ? null : <path key={i} d={p.d} fillRule={p.evenOdd ? 'evenodd' : undefined} fill={color} stroke={color} strokeWidth={width} strokeLinejoin="round" vectorEffect={custom ? 'non-scaling-stroke' : undefined} />)}</g>
    </svg>
  );
  const face = (
    <>
      <svg width={el.w} height={el.h} viewBox={`0 0 ${Math.max(1, el.w)} ${Math.max(1, el.h)}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-label={el.alt}>
        <defs>
          {el.fillImage && imageUrl && (
            <pattern id={`i${gid}`} patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width="1" height="1">
              <image href={imageUrl} width="1" height="1" preserveAspectRatio="xMidYMid slice" />
            </pattern>
          )}
          {el.pattern && (
            <pattern id={`p${gid}`} patternUnits="userSpaceOnUse" width="16" height="16">
              <rect width="16" height="16" fill={el.pattern.bg} />
              <path d={patternPath(el.pattern.kind, 2)} fill={el.pattern.fg} />
            </pattern>
          )}
          {stops && el.gradientType === 'radial' && (
            <radialGradient id={`g${gid}`} cx="0.5" cy="0.5" r="0.7">{stopEls}</radialGradient>
          )}
          {stops && el.gradientType !== 'radial' && (
            <linearGradient id={`g${gid}`} x1={0.5 - Math.cos(a) / 2} y1={0.5 - Math.sin(a) / 2} x2={0.5 + Math.cos(a) / 2} y2={0.5 + Math.sin(a) / 2}>{stopEls}</linearGradient>
          )}
          {shading && (shading.radial
            ? <radialGradient id={`l${gid}`} cx={shading.x1} cy={shading.y1} r="0.75">{shading.stops.map((st, i) => <stop key={i} offset={st.offset} stopColor={st.color} stopOpacity={st.opacity} />)}</radialGradient>
            : <linearGradient id={`l${gid}`} x1={shading.x1} y1={shading.y1} x2={shading.x2} y2={shading.y2}>{shading.stops.map((st, i) => <stop key={i} offset={st.offset} stopColor={st.color} stopOpacity={st.opacity} />)}</linearGradient>)}
          {([['s', el.arrowStart, el.arrowStartKind], ['e', el.arrowEnd, el.arrowEndKind]] as const).map(([end, on, kind]) => {
            if (!on) return null;
            const a = arrowPath(kind), m = ARROW_SCALE[el.arrowSize ?? 'med'];
            return (
              <marker key={end} id={`a${end}${gid}`} viewBox="-1 -1 12 12" refX={kind === 'oval' || kind === 'diamond' ? 5 : 8.5} refY="5" markerWidth={m} markerHeight={m} orient="auto-start-reverse">
                <path d={a.d} fill={a.filled ? stroke ?? '#fff' : 'none'} stroke={a.filled ? undefined : stroke ?? '#fff'} strokeWidth={a.filled ? undefined : 1.6} />
              </marker>
            );
          })}
        </defs>
        <g transform={custom}>
        {g.paths.map((p, i) => {
          const shade = SHADE[p.fill];
          const stroked = p.stroke && sw > 0;
          const layers = stroked ? compoundLayers(el.compound, sw, closedShape && p.fill !== 'none') : null;
          const evenOdd = p.evenOdd ? 'evenodd' as const : undefined;
          const ve = custom ? 'non-scaling-stroke' as const : undefined;
          const lineProps = { strokeLinejoin: join, strokeMiterlimit: join === 'miter' ? 10 : undefined, strokeLinecap: linecap } as const;
          const common = {
            vectorEffect: ve,
            d: p.d, fillRule: evenOdd,
            // A compound line paints through masks below; this path then only carries the fill and the arrowheads.
            stroke: stroked ? (layers ? 'none' : stroke) : undefined, strokeWidth: stroked ? sw : undefined,
            strokeDasharray: layers ? undefined : dashPattern(el.dash, sw || 1), ...lineProps,
          };
          const filled = !(p.fill === 'none' || g.open);
          return (
            <g key={i}>
              {layers && <defs>{layers.map((L, li) => (
                <mask key={li} id={`m${gid}_${i}_${li}`} maskUnits="userSpaceOnUse" x={-100000} y={-100000} width={200000} height={200000}>
                  {L.ops.map((o, k) => {
                    const c = o.white ? '#fff' : '#000';
                    if (o.op === 'stroke') return <path key={k} d={p.d} fill="none" stroke={c} strokeWidth={o.width} vectorEffect={ve} {...lineProps} />;
                    if (o.op === 'fill') return <path key={k} d={p.d} fill={c} fillRule={evenOdd} />;
                    return <path key={k} d={`M-100000 -100000H100000V100000H-100000Z ${p.d}`} fill={c} fillRule="evenodd" />;
                  })}
                </mask>
              ))}</defs>}
              <path {...common} fill={filled ? fill : 'none'} fillOpacity={filled && fillAlpha < 1 ? fillAlpha : undefined}
                markerStart={el.arrowStart ? `url(#as${gid})` : undefined} markerEnd={el.arrowEnd ? `url(#ae${gid})` : undefined} />
              {layers?.map((_, li) => <path key={li} d={p.d} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={dashPattern(el.dash, sw || 1)} vectorEffect={ve} mask={`url(#m${gid}_${i}_${li})`} {...lineProps} />)}
              {shade && <path d={p.d} fill={shade[0]} fillOpacity={shade[1]} fillRule={common.fillRule} />}
              {shading && filled && <path d={p.d} fill={`url(#l${gid})`} fillRule={common.fillRule} />}
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
          return el.text.split('\n').map((line, i) => <div key={i} data-para={i}>{runs[i] ? runs[i]!.map((r, j) => <span key={j} style={runCss(r)}>{r.text}</span>) : line || '\u00a0'}</div>);
        })()}</div>
      ) : null}
    </>
  );
  if (!ext) return <div style={box} data-shape={presetOf(el)}>{face}</div>;
  // Copies pushed back along z make the extruded side once the shape is tilted (CSS cannot extrude); the face keeps the filter and opacity.
  return (
    <div style={{ position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, transform: elementTransform(el), transformStyle: 'preserve-3d' }} data-shape={presetOf(el)} data-depth>
      {ext.zs.map((z, i) => sideSvg(`z${i}`, z, i === ext.zs.length - 1 && ext.contour ? ext.contourColor : ext.color, ext.gap + (i === ext.zs.length - 1 ? ext.contour * 2 : 0)))}
      {ext.contour > 0 && sideSvg('ring', -0.5, ext.contourColor, sw + ext.contour * 2)}
      <div style={{ ...box, left: 0, top: 0, transform: undefined }}>{face}</div>
    </div>
  );
}

/** Table Design › Borders drawn on a cell, over the table style's own lines (a shared line is drawn by either cell). */
function ownBorders(t: TableData, r: number, c: number): CSSProperties {
  const css: CSSProperties = {};
  const side = (k: 't' | 'r' | 'b' | 'l', prop: 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft') => {
    const b = sideOf(t, r, c, k);
    if (b === null) css[prop] = 'none';
    else if (b) css[prop] = penCss(b);
  };
  side('t', 'borderTop'); side('r', 'borderRight'); side('b', 'borderBottom'); side('l', 'borderLeft');
  return css;
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
      {cells.map((c) => {
        const own = t.rows[c.r]?.[c.c];
        // Table Layout › Text Direction: the box's main axis turns with the text.
        const dir = own?.dir;
        const vertical = dir === 'vert' || dir === 'vert270';
        const anchor = own?.anchor === 'top' ? 'flex-start' : own?.anchor === 'bottom' ? 'flex-end' : 'center';
        const across = c.align === 'center' ? 'center' : c.align === 'right' ? 'flex-end' : 'flex-start';
        const diag = (['dd', 'du'] as const).map((k) => own?.borders?.[k] && { k, b: own.borders[k]! }).filter((x): x is { k: 'dd' | 'du'; b: CellBorder } => !!x);
        return (
          <div key={`${c.r}:${c.c}`} style={{
            position: 'absolute', left: c.x, top: c.y, width: c.w, height: c.h, boxSizing: 'border-box', background: c.fill ?? undefined,
            border: c.border ? `${c.borderWidth}px solid ${c.border}` : undefined, ...ownBorders(t, c.r, c.c), color: c.color ?? el.color ?? '#ffffff', fontWeight: c.bold ? 700 : 400,
            display: 'flex', flexDirection: vertical ? 'row' : 'column', justifyContent: vertical ? across : anchor, alignItems: vertical ? anchor : 'stretch',
            textAlign: (c.align as CSSProperties['textAlign']) ?? 'left', padding: t.margins ? `${t.margins[1]}px ${t.margins[2]}px ${t.margins[3]}px ${t.margins[0]}px` : `${fs * 0.15}px ${fs * 0.35}px`, overflow: 'hidden', whiteSpace: 'pre-wrap', lineHeight: 1.2,
            ...(t.cellBevel ? { boxShadow: 'inset 3px 3px 5px rgba(255,255,255,.45), inset -3px -3px 5px rgba(0,0,0,.35)' } : {}),
          }}>
            {diag.length > 0 && (
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox={`0 0 ${c.w} ${c.h}`} preserveAspectRatio="none">
                {diag.map(({ k, b }) => <line key={k} x1={0} y1={k === 'dd' ? 0 : c.h} x2={c.w} y2={k === 'dd' ? c.h : 0} stroke={b.color} strokeWidth={b.width} strokeDasharray={penDash(b)} />)}
              </svg>
            )}
            <span style={{
              position: 'relative',
              ...(vertical ? { writingMode: 'vertical-rl', transform: dir === 'vert270' ? 'rotate(180deg)' : undefined } : {}),
              ...(dir === 'stacked' ? { wordBreak: 'break-all', width: '1.05em', alignSelf: across === 'center' ? 'center' : across } : {}),
            }}>{c.text}</span>
          </div>
        );
      })}
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
