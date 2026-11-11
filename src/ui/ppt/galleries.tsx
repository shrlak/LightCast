// The Shapes and Icons menus: every preset shape (drawn by the engine) by category, Lucide icons.
import { useMemo, useState } from 'react';
import { iconCatalog, shapeCatalog, shapeGeometry, type ShapeCategory } from '../../engine';
import { SHAPE_CATEGORY, shapeLabel } from './ko';
import { MenuHead } from './ribbonParts';

/** A preset drawn small (gallery thumbnail). */
export function ShapeThumb({ name, size = 20 }: { name: string; size?: number }) {
  const line = /line|Connector|arc$|bracket|brace/i.test(name) && !/Arrow/.test(name);
  const g = shapeGeometry(name, size, size * (name === 'line' || name === 'straightConnector1' ? 0.0001 : 1));
  if (!g) return <span style={{ width: size, height: size, display: 'inline-block' }} />;
  return (
    <svg width={size} height={size} viewBox={`-1 -1 ${size + 2} ${size + 2}`} className="shape-thumb" aria-hidden>
      {g.paths.map((p, i) => <path key={i} d={name === 'line' ? `M0 ${size} L${size} 0` : p.d} fill={p.fill === 'none' || g.open || line ? 'none' : '#dbe7f6'} fillRule={p.evenOdd ? 'evenodd' : undefined} stroke="#3a5f8f" strokeWidth={1} />)}
    </svg>
  );
}

/** The Shapes gallery: `recent` first, then every category. */
export function ShapeGallery({ onPick, compact, onFreeform }: { onPick: (name: string) => void; compact?: boolean; /** Freeform: Shape / Scribble (Lines). */ onFreeform?: (scribble: boolean) => void }) {
  const cat = shapeCatalog();
  const groups = useMemo(() => {
    const m = new Map<ShapeCategory, typeof cat>();
    for (const p of cat) {
      if (p.category === 'actionButtons' && compact) continue;
      if (!m.has(p.category)) m.set(p.category, []);
      m.get(p.category)!.push(p);
    }
    return [...m.entries()];
  }, [cat, compact]);
  return (
    <div className="shape-gallery">
      {groups.map(([c, list]) => (
        <div key={c}>
          <MenuHead>{SHAPE_CATEGORY[c]}</MenuHead>
          <div className="shape-grid">
            {c === 'lines' && onFreeform && <>
              <button type="button" className="shape-cell" title="자유형: 도형 (클릭으로 점 찍기, 시작점을 누르면 닫힘, 두 번 클릭하면 끝)" onClick={() => onFreeform(false)}><svg width="20" height="20" viewBox="0 0 20 20"><path d="M2 16 L6 4 L11 12 L18 3 L16 17 Z" fill="#dbe7f6" stroke="#3a5f8f" /></svg></button>
              <button type="button" className="shape-cell" title="자유형: 자유 곡선 (끌어서 그리기)" onClick={() => onFreeform(true)}><svg width="20" height="20" viewBox="0 0 20 20"><path d="M2 14 C5 2 8 18 11 8 S17 4 18 12" fill="none" stroke="#3a5f8f" strokeWidth="1.5" /></svg></button>
            </>}
            {list.map((p) => (
              <button key={p.name} type="button" className="shape-cell" title={shapeLabel(p.name, p.label)} onClick={() => onPick(p.name)}><ShapeThumb name={p.name} /></button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The few shapes shown in Home › Drawing's own gallery. */
export const QUICK_SHAPES = ['textBox', 'line', 'straightConnector1', 'rect', 'ellipse', 'triangle', 'rtTriangle', 'roundRect', 'rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'pentagon', 'hexagon', 'star5', 'heart', 'cloud', 'wedgeRoundRectCallout', 'chevron', 'homePlate', 'flowChartDecision'];

export function IconGallery({ onPick }: { onPick: (name: string) => void }) {
  const [q, setQ] = useState('');
  const icons = iconCatalog().filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()) || i.name.includes(q.toLowerCase()) || i.category.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="icon-gallery">
      <input className="icon-search" placeholder="아이콘 검색 (영문)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="icon-grid">
        {icons.map((i) => (
          <button key={i.name} type="button" className="icon-cell" title={i.label} onClick={() => onPick(i.name)}>
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#333" strokeWidth={i.stroke} strokeLinecap="round" strokeLinejoin="round">{i.d.map((d, k) => <path key={k} d={d} />)}</svg>
          </button>
        ))}
      </div>
    </div>
  );
}
