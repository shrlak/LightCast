// View › Show › Ruler (DeckCraft's ruler): centimetres along the top and left of the slide. With a
// text box selected the top ruler counts from the box's text area and shows its indents and tab
// stops: click to add a left tab, drag a tab to move it (off the ruler to remove it), drag the
// indent triangles to set the first-line and hanging indents.
import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { SlideElement } from '../../domain/types';
import { CANVAS_H, CANVAS_W } from '../../domain/canvas';
import { dragIndent, editTabs, indentMarkers, rulerTicks, snapRuler, tabsPatch } from '../../domain/tabStops';

const H = 20;

export function Ruler({ k, el, onPatch }: { k: number; el: SlideElement | null; onPatch: (patch: Partial<SlideElement>) => void }) {
  const textLeft = el ? el.x + (el.margins?.[0] ?? 0) : null;
  const origin = textLeft ?? CANVAS_W / 2;
  const vOrigin = el ? el.y : CANVAS_H / 2;
  const bar = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ kind: 'tab'; from: number; at: number; off: boolean } | { kind: 'first' | 'hanging' | 'left'; at: number } | null>(null);
  const toCanvas = (e: { clientX: number }) => { const r = bar.current!.getBoundingClientRect(); return (e.clientX - r.left) / k; };
  const local = (e: { clientX: number }) => snapRuler(toCanvas(e) - origin);
  const ind = el ? indentMarkers(el) : null;
  const stops = el?.tabStops ?? [];
  const down = (e: RPointerEvent, d: NonNullable<typeof drag>) => { e.stopPropagation(); e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(d); };
  const move = (e: RPointerEvent) => {
    if (!drag) return;
    const r = bar.current!.getBoundingClientRect();
    setDrag({ ...drag, at: local(e), ...(drag.kind === 'tab' ? { off: e.clientY > r.bottom + 24 || e.clientY < r.top - 24 } : {}) } as typeof drag);
  };
  const up = () => {
    if (!drag || !el) return setDrag(null);
    if (drag.kind === 'tab') onPatch(tabsPatch(drag.off ? editTabs(stops, { remove: drag.from }) : editTabs(stops, { move: { from: drag.from, to: Math.max(0, drag.at) } })));
    else onPatch(dragIndent(el, drag.kind, drag.at));
    setDrag(null);
  };
  const x = (px: number) => (origin + px) * k;
  const showTabs = stops.map((t) => (drag?.kind === 'tab' && Math.abs(drag.from - t.pos) < 1 ? { ...t, pos: drag.at, off: drag.off } : { ...t, off: false }));
  const first = drag?.kind === 'first' ? drag.at : ind?.first;
  const left = drag?.kind === 'hanging' || drag?.kind === 'left' ? drag.at : ind?.left;
  return (
    <>
      <div ref={bar} className="ce-ruler h" style={{ height: H }} onPointerMove={move} onPointerUp={up}
        onPointerDown={(e) => { if (!el || e.button !== 0) return; e.stopPropagation(); const p = local(e); if (p >= 0 && p <= el.w) onPatch(tabsPatch(editTabs(stops, { add: { pos: p, align: 'left' } }))); }}>
        {el && <div className="ce-ruler-span" style={{ left: el.x * k, width: el.w * k }} />}
        {rulerTicks(0, CANVAS_W, origin).map((t) => <i key={t.px} className={`ce-tick ${t.kind}`} style={{ left: t.px * k }}>{t.label !== undefined && t.label > 0 ? t.label : null}</i>)}
        {el && first !== undefined && <b className="ce-indent first" title="첫 줄 들여쓰기" style={{ left: x(first) }} onPointerDown={(e) => down(e, { kind: 'first', at: first })} />}
        {el && left !== undefined && <b className="ce-indent hanging" title="내어쓰기" style={{ left: x(left) }} onPointerDown={(e) => down(e, { kind: 'hanging', at: left })} />}
        {el && left !== undefined && <b className="ce-indent left" title="왼쪽 들여쓰기" style={{ left: x(left) }} onPointerDown={(e) => down(e, { kind: 'left', at: left })} />}
        {showTabs.map((t) => <b key={t.pos} className={`ce-tab ${t.align} ${t.off ? 'off' : ''}`} title={`${t.align} 탭`} style={{ left: x(t.pos) }} onPointerDown={(e) => down(e, { kind: 'tab', from: t.pos, at: t.pos, off: false })} />)}
      </div>
      <div className="ce-ruler v" style={{ width: H }}>
        {el && <div className="ce-ruler-span" style={{ top: el.y * k, height: el.h * k }} />}
        {rulerTicks(0, CANVAS_H, vOrigin).map((t) => <i key={t.px} className={`ce-tick ${t.kind}`} style={{ top: t.px * k }}>{t.label !== undefined && t.label > 0 ? t.label : null}</i>)}
      </div>
    </>
  );
}
