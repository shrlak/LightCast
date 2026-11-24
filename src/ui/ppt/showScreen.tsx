// The slide show screen as PowerPoint draws it, shared by the audience window and the presenter view:
// the faint toolbar at the bottom left (이전 · 다음 · 펜 및 레이저 포인터 도구 · 모든 슬라이드 보기 · 슬라이드 확대 ·
// 기타 슬라이드 쇼 옵션), the right-click menu, writing on the slide (펜 · 형광펜 · 지우개 · 레이저 포인터),
// 모든 슬라이드 보기, 슬라이드 확대 and 슬라이드 쇼 도움말 (F1).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Presentation, Theme } from '../../domain/types';
import { CANVAS_H, CANVAS_W } from '../../domain/canvas';
import { sequence } from '../../domain/arrangement';
import { resolveBackground } from '../../domain/autoBackground';
import { HIGHLIGHTER_WIDTH, INK_COLORS, PEN_WIDTH, SHOW_KEYS, framePoint, strokePath, type ShowPointer, type ShowStroke, type ShowZoom } from '../../domain/showScreen';
import { SlideCanvas } from '../SlideCanvas';

/** What the show's controls ask of the show (whoever runs it: the console, or an audience window posting to it). */
export interface ShowControl {
  next: () => void;
  prev: () => void;
  go: (seq: number) => void;
  lastViewed?: () => void;
  black: () => void;
  white: () => void;
  end: () => void;
  ink: (s: ShowStroke) => void;
  erase: (x: number, y: number) => void;
  clearInk: () => void;
  zoom: (z: ShowZoom | null) => void;
  /** 발표자 보기 표시 (an audience window brings the console forward). */
  presenter?: () => void;
  /** 사용자 지정 쇼. */
  customShows?: { id: string; name: string }[];
  customShow?: (id: string) => void;
}

/** The pointer state of one show screen (each window has its own, as each has its own mouse). */
export interface PointerState {
  pointer: ShowPointer;
  setPointer: (p: ShowPointer) => void;
  color: string;
  setColor: (c: string) => void;
  /** 화살표 옵션: 자동 (hides when still), 표시, 숨기기. */
  arrow: 'auto' | 'visible' | 'hidden';
  setArrow: (a: 'auto' | 'visible' | 'hidden') => void;
  /** 슬라이드 확대 is waiting for a click on the slide. */
  zoomArm: boolean;
  setZoomArm: (on: boolean) => void;
}

export function usePointerState(): PointerState {
  const [pointer, setPointer] = useState<ShowPointer>('arrow');
  const [color, setColor] = useState('#ff0000');
  const [arrow, setArrow] = useState<'auto' | 'visible' | 'hidden'>('auto');
  const [zoomArm, setZoomArm] = useState(false);
  return { pointer, setPointer, color, setColor, arrow, setArrow, zoomArm, setZoomArm };
}

/** Ctrl+L / P / I / E / A / H, as PowerPoint's slide show. Returns true when the key was a pointer key. */
export function pointerKey(e: KeyboardEvent, ps: PointerState): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const k = e.key.toLowerCase();
  const set: Partial<Record<string, () => void>> = {
    l: () => ps.setPointer(ps.pointer === 'laser' ? 'arrow' : 'laser'),
    p: () => ps.setPointer(ps.pointer === 'pen' ? 'arrow' : 'pen'),
    i: () => ps.setPointer(ps.pointer === 'highlighter' ? 'arrow' : 'highlighter'),
    e: () => ps.setPointer(ps.pointer === 'eraser' ? 'arrow' : 'eraser'),
    a: () => { ps.setPointer('arrow'); ps.setArrow('visible'); },
    h: () => { ps.setPointer('arrow'); ps.setArrow('hidden'); },
  };
  const f = set[k];
  if (!f) return false;
  e.preventDefault();
  f();
  return true;
}

/** Shows its children while the mouse moves, and hides them (and the arrow, with 화살표 옵션 › 자동) after 3 s still. */
export function useAwake(ms = 3000): [boolean, () => void] {
  const [awake, setAwake] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poke = () => {
    setAwake(true);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setAwake(false), ms);
  };
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return [awake, poke];
}

// ── Icons (PowerPoint's round slide show buttons) ──────────────────────────────────────────────────
const I = {
  prev: <svg viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>,
  next: <svg viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>,
  pen: <svg viewBox="0 0 24 24"><path d="M5 19l1-4L16 5l3 3L9 18z M14 7l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>,
  all: <svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="5" width="7" height="6" /><rect x="13" y="5" width="7" height="6" /><rect x="4" y="13" width="7" height="6" /><rect x="13" y="13" width="7" height="6" /></g></svg>,
  zoom: <svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="5.5" /><path d="M14.5 14.5L19 19M8 10.5h5M10.5 8v5" /></g></svg>,
  more: <svg viewBox="0 0 24 24"><g fill="currentColor"><circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" /></g></svg>,
  black: <svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" fill="currentColor" /><path d="M4 18L20 6" stroke="#888" strokeWidth="1.4" /></svg>,
  subtitles: <svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3.5" y="6" width="17" height="12" rx="1" /><path d="M7 14h4M13 14h4M7 11h10" /></g></svg>,
};

export const ShowIcon = I;

/** A menu of the slide show (dark, as PowerPoint's show menus), placed at a point and kept on screen. */
function ShowMenu({ at, onClose, children, up }: { at: { x: number; y: number }; onClose: () => void; children: ReactNode; up?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.max(4, Math.min(at.x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(up ? at.y - r.height : at.y, window.innerHeight - r.height - 4)) });
  }, [at.x, at.y, up]);
  useEffect(() => {
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', off, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', off, true); window.removeEventListener('keydown', key, true); };
  }, [onClose]);
  return <div ref={ref} className="show-menu" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>{children}</div>;
}

const Item = ({ label, onClick, on, disabled, hint }: { label: string; onClick?: () => void; on?: boolean; disabled?: boolean; hint?: string }) => (
  <button type="button" role="menuitem" className="show-item" disabled={disabled} onClick={onClick}><span className="show-check">{on ? '✓' : ''}</span>{label}{hint && <span className="show-hint">{hint}</span>}</button>
);
const Sub = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="show-sub" role="none"><button type="button" role="menuitem" className="show-item" aria-haspopup="menu"><span className="show-check" />{label}<span className="show-hint">▸</span></button><div className="show-menu show-submenu" role="menu">{children}</div></div>
);
const Sep = () => <div className="show-sep" role="separator" />;

/** 펜 및 레이저 포인터 도구: 레이저 포인터, 펜, 형광펜, 지우개, 슬라이드의 잉크 모두 지우기, and the ink colours. */
export function PenItems({ ps, c, close }: { ps: PointerState; c: ShowControl; close: () => void }) {
  const pick = (p: ShowPointer) => { ps.setPointer(ps.pointer === p ? 'arrow' : p); close(); };
  return (
    <>
      <Item label="레이저 포인터" hint="Ctrl+L" on={ps.pointer === 'laser'} onClick={() => pick('laser')} />
      <Item label="펜" hint="Ctrl+P" on={ps.pointer === 'pen'} onClick={() => pick('pen')} />
      <Item label="형광펜" hint="Ctrl+I" on={ps.pointer === 'highlighter'} onClick={() => pick('highlighter')} />
      <Item label="지우개" hint="Ctrl+E" on={ps.pointer === 'eraser'} onClick={() => pick('eraser')} />
      <Item label="슬라이드의 잉크 모두 지우기" hint="E" onClick={() => { c.clearInk(); close(); }} />
      <Sep />
      <div className="show-colors" role="group" aria-label="잉크 색">
        {INK_COLORS.map((col) => <button key={col} type="button" className={`show-color ${ps.color === col ? 'on' : ''}`} style={{ background: col }} title={col} aria-label={`잉크 색 ${col}`} onClick={() => { ps.setColor(col); if (ps.pointer !== 'pen' && ps.pointer !== 'highlighter') ps.setPointer('pen'); close(); }} />)}
      </div>
    </>
  );
}

/** The right-click menu of the slide show (PowerPoint's, in its order). */
export function ShowContextMenu({ at, c, ps, onAll, onHelp, onClose, black, white, zoomed }: {
  at: { x: number; y: number }; c: ShowControl; ps: PointerState; onAll: () => void; onHelp: () => void; onClose: () => void; black: boolean; white: boolean; zoomed: boolean;
}) {
  const run = (f: () => void) => () => { f(); onClose(); };
  return (
    <ShowMenu at={at} onClose={onClose}>
      <Item label="다음" onClick={run(c.next)} />
      <Item label="이전" onClick={run(c.prev)} />
      <Item label="마지막으로 본 슬라이드" disabled={!c.lastViewed} onClick={run(() => c.lastViewed?.())} />
      <Item label="모든 슬라이드 보기" onClick={run(onAll)} />
      <Item label={zoomed ? '축소' : '확대'} onClick={run(() => (zoomed ? c.zoom(null) : ps.setZoomArm(true)))} />
      {!!c.customShows?.length && <Sub label="사용자 지정 쇼">{c.customShows.map((s) => <Item key={s.id} label={s.name} onClick={run(() => c.customShow?.(s.id))} />)}</Sub>}
      {c.presenter && <Item label="발표자 보기 표시" onClick={run(c.presenter)} />}
      <Sep />
      <Sub label="화면">
        <Item label="검정 화면" hint="B" on={black} onClick={run(c.black)} />
        <Item label="흰색 화면" hint="W" on={white} onClick={run(c.white)} />
      </Sub>
      <Sub label="포인터 옵션">
        <PenItems ps={ps} c={c} close={onClose} />
        <Sep />
        <Sub label="화살표 옵션">
          <Item label="자동" on={ps.arrow === 'auto'} onClick={run(() => ps.setArrow('auto'))} />
          <Item label="표시" on={ps.arrow === 'visible'} onClick={run(() => ps.setArrow('visible'))} />
          <Item label="숨기기" on={ps.arrow === 'hidden'} onClick={run(() => ps.setArrow('hidden'))} />
        </Sub>
      </Sub>
      <Sep />
      <Item label="도움말" hint="F1" onClick={run(onHelp)} />
      <Item label="쇼 마침" hint="Esc" onClick={run(c.end)} />
    </ShowMenu>
  );
}

/** 기타 슬라이드 쇼 옵션 (⋯). */
function MoreItems({ c, onHelp, close, black, white }: { c: ShowControl; onHelp: () => void; close: () => void; black: boolean; white: boolean }) {
  const run = (f: () => void) => () => { f(); close(); };
  return (
    <>
      {c.presenter && <Item label="발표자 보기 표시" onClick={run(c.presenter)} />}
      <Sub label="화면">
        <Item label="검정 화면" hint="B" on={black} onClick={run(c.black)} />
        <Item label="흰색 화면" hint="W" on={white} onClick={run(c.white)} />
      </Sub>
      {!!c.customShows?.length && <Sub label="사용자 지정 쇼">{c.customShows.map((s) => <Item key={s.id} label={s.name} onClick={run(() => c.customShow?.(s.id))} />)}</Sub>}
      <Item label="도움말" hint="F1" onClick={run(onHelp)} />
      <Sep />
      <Item label="쇼 마침" hint="Esc" onClick={run(c.end)} />
    </>
  );
}

/**
 * PowerPoint's slide show toolbar at the bottom left: faint until pointed at, hidden while the mouse is still.
 * `extra` adds buttons after 슬라이드 확대 (the presenter view's 자막 and 검정 화면).
 */
export function ShowToolbar({ c, ps, onAll, onHelp, black, white, zoomed, visible = true, nav = true, extra, className, penOnly, penLabel }: {
  c: ShowControl; ps: PointerState; onAll: () => void; onHelp: () => void; black: boolean; white: boolean; zoomed: boolean;
  visible?: boolean; nav?: boolean; extra?: ReactNode; className?: string;
  /** Only the 펜 및 레이저 포인터 도구 button (the presenter view has its own buttons for the rest), with this text. */
  penOnly?: boolean; penLabel?: string;
}) {
  const [menu, setMenu] = useState<null | { kind: 'pen' | 'more'; x: number; y: number }>(null);
  const open = (kind: 'pen' | 'more') => (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu(menu?.kind === kind ? null : { kind, x: r.left, y: r.top - 6 });
  };
  const penOn = ps.pointer !== 'arrow';
  return (
    <div className={`show-toolbar ${visible || menu ? 'awake' : ''} ${className ?? ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      {nav && <button type="button" className="show-tool" title="이전" aria-label="이전" onClick={c.prev}>{I.prev}</button>}
      {nav && <button type="button" className="show-tool" title="다음" aria-label="다음" onClick={c.next}>{I.next}</button>}
      <button type="button" className={`${penLabel ? 'pv-btn' : 'show-tool'} ${penOn ? 'on' : ''}`} title="펜 및 레이저 포인터 도구" aria-label="펜 및 레이저 포인터 도구" aria-haspopup="menu" onClick={open('pen')}>{penLabel ?? I.pen}</button>
      {!penOnly && <>
      <button type="button" className="show-tool" title="모든 슬라이드 보기" aria-label="모든 슬라이드 보기" onClick={onAll}>{I.all}</button>
      <button type="button" className={`show-tool ${ps.zoomArm || zoomed ? 'on' : ''}`} title={zoomed ? '축소' : '슬라이드 확대'} aria-label="슬라이드 확대" onClick={() => (zoomed ? c.zoom(null) : ps.setZoomArm(!ps.zoomArm))}>{I.zoom}</button>
      {extra}
      <button type="button" className="show-tool" title="기타 슬라이드 쇼 옵션" aria-label="기타 슬라이드 쇼 옵션" aria-haspopup="menu" onClick={open('more')}>{I.more}</button>
      </>}
      {menu && (
        <ShowMenu at={{ x: menu.x, y: menu.y }} up onClose={() => setMenu(null)}>
          {menu.kind === 'pen' ? <PenItems ps={ps} c={c} close={() => setMenu(null)} /> : <MoreItems c={c} onHelp={onHelp} close={() => setMenu(null)} black={black} white={white} />}
        </ShowMenu>
      )}
    </div>
  );
}

/**
 * The layer over a shown slide that the pointer works on: 펜 and 형광펜 write (the stroke is handed over when the
 * button is let go), 지우개 takes off the strokes it touches, 레이저 포인터 shows a red dot, and an armed
 * 슬라이드 확대 zooms in where it is clicked. With the arrow it lets clicks through to the slide.
 */
export function PointerSurface({ ps, c, zoom, onLaser, children }: { ps: PointerState; c: ShowControl; zoom: ShowZoom | null; onLaser?: (p: { x: number; y: number } | null) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null);
  const active = ps.pointer !== 'arrow' || ps.zoomArm;
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height };
  };
  const toCanvas = (e: React.PointerEvent) => { const { fx, fy } = at(e); return framePoint(fx, fy, zoom, CANVAS_W, CANVAS_H); };
  const width = ps.pointer === 'highlighter' ? HIGHLIGHTER_WIDTH : PEN_WIDTH;
  const writing = ps.pointer === 'pen' || ps.pointer === 'highlighter';
  return (
    <div ref={ref} className={`pointer-surface ${active ? 'active' : ''} p-${ps.pointer} ${ps.zoomArm ? 'zoom-arm' : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || !active) return;
        e.stopPropagation();
        if (ps.zoomArm) { const [x, y] = toCanvas(e); c.zoom({ x, y, scale: 2 }); ps.setZoomArm(false); return; }
        if (ps.pointer === 'eraser') { const [x, y] = toCanvas(e); c.erase(x, y); }
        if (writing) { (e.target as Element).setPointerCapture?.(e.pointerId); setDraft([toCanvas(e)]); }
      }}
      onPointerMove={(e) => {
        // 레이저 포인터, or Ctrl held down while the arrow moves (as PowerPoint's slide show).
        if (ps.pointer === 'laser' || (ps.pointer === 'arrow' && e.ctrlKey)) { const { fx, fy } = at(e); setLaser({ x: fx, y: fy }); onLaser?.({ x: fx, y: fy }); }
        else if (laser) { setLaser(null); onLaser?.(null); }
        if (ps.pointer === 'eraser' && e.buttons === 1) { const [x, y] = toCanvas(e); c.erase(x, y); }
        if (draft && writing) setDraft([...draft, toCanvas(e)]);
      }}
      onPointerUp={() => {
        if (draft && draft.length > 1) c.ink({ points: draft.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]), color: ps.color, width, ...(ps.pointer === 'highlighter' ? { highlighter: true } : {}) });
        setDraft(null);
      }}
      onPointerLeave={() => { if (laser) { setLaser(null); onLaser?.(null); } }}
      onClick={(e) => { if (active) e.stopPropagation(); }}>
      {children}
      {draft && (
        <svg className="pointer-draft" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} preserveAspectRatio="none" aria-hidden>
          <path d={strokePath(draft)} fill="none" stroke={ps.color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" opacity={ps.pointer === 'highlighter' ? 0.45 : 1}
            transform={zoom && zoom.scale > 1 ? zoomSvg(zoom) : undefined} />
        </svg>
      )}
      {laser && <span className="show-laser" style={{ left: `${laser.x * 100}%`, top: `${laser.y * 100}%` }} />}
    </div>
  );
}

/** The SVG transform that draws canvas points where the zoomed slide shows them. */
function zoomSvg(z: ShowZoom): string {
  const hw = CANVAS_W / (2 * z.scale), hh = CANVAS_H / (2 * z.scale);
  const cx = Math.max(hw, Math.min(CANVAS_W - hw, z.x)), cy = Math.max(hh, Math.min(CANVAS_H - hh, z.y));
  return `translate(${CANVAS_W / 2} ${CANVAS_H / 2}) scale(${z.scale}) translate(${-cx} ${-cy})`;
}

/** 모든 슬라이드 보기: every slide of the presentation as a thumbnail; a click shows that slide. */
export function AllSlidesGrid({ p, theme, current, onPick, onClose }: { p: Presentation; theme: Theme; current: number | null; onPick: (seq: number) => void; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  const pages = sequence(p);
  return (
    <div className="show-all" role="dialog" aria-label="모든 슬라이드" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      <div className="show-all-head">
        <button type="button" className="show-back" aria-label="뒤로" title="뒤로 (Esc)" onClick={onClose}>←</button>
        <b>모든 슬라이드</b>
        <span className="show-all-count">슬라이드 {current !== null ? current + 1 : '—'}/{pages.length}</span>
      </div>
      <div className="show-all-grid">
        {pages.map(({ slide }, i) => (
          <button key={`${slide.id}-${i}`} type="button" className={`show-all-thumb ${i === current ? 'on' : ''} ${slide.disabled ? 'hidden-slide' : ''}`} onClick={() => { onPick(i); onClose(); }}>
            <SlideCanvas slide={slide} theme={theme} background={resolveBackground(slide, p)} bgEffect={p.bgEffect} />
            <span className="show-all-num">{i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 슬라이드 쇼 도움말 (F1): the keys of the slide show. */
export function ShowHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'F1') { e.stopPropagation(); e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return (
    <div className="show-help-back" onClick={onClose}>
      <div className="show-help" role="dialog" aria-label="슬라이드 쇼 도움말" onClick={(e) => e.stopPropagation()}>
        <div className="show-help-head"><b>슬라이드 쇼 도움말</b><button type="button" aria-label="닫기" onClick={onClose}>✕</button></div>
        <table><tbody>{SHOW_KEYS.map(([k, d]) => <tr key={k}><td>{k}</td><td>{d}</td></tr>)}</tbody></table>
        <div className="show-help-foot"><button type="button" onClick={onClose}>확인</button></div>
      </div>
    </div>
  );
}
