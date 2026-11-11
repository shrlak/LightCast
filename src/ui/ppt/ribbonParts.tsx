// Building blocks of the PowerPoint ribbon: big and small buttons, groups with their labels, split
// and drop-down buttons with menus, galleries, the theme colour picker (colours from the engine) and
// the ribbon's icons (drawn in the manner of Office's: outline in grey, accents in colour).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { colorPalette } from '../../engine';

const G = '#444', B = '#2b78c5', R = '#c43e1c', Y = '#e8a200', GR = '#2e8b57', P = '#7a4fb5';
const S = (p: { children: ReactNode; vb?: number }) => <svg className="rbi" viewBox={`0 0 ${p.vb ?? 32} ${p.vb ?? 32}`} aria-hidden>{p.children}</svg>;
const st = (c = G, w = 1.6) => ({ fill: 'none', stroke: c, strokeWidth: w, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const });

/** Ribbon icons (32 × 32, drawn at 32 px in big buttons and 16 px in small ones). */
export const RI = {
  paste: <S><rect x="7" y="6" width="16" height="21" rx="2" {...st()} /><rect x="11" y="3.5" width="8" height="5" rx="1.5" {...st()} fill="#fff" /><rect x="14" y="13" width="13" height="15" rx="1" {...st(B)} fill="#fff" /><path d="M17 18h7M17 21h7M17 24h5" {...st(B, 1.2)} /></S>,
  cut: <S><circle cx="9" cy="23" r="4" {...st()} /><circle cx="23" cy="23" r="4" {...st()} /><path d="M11.5 20L22 5M20.5 20L10 5" {...st()} /></S>,
  copy: <S><rect x="5" y="5" width="15" height="18" rx="1.5" {...st()} /><rect x="12" y="10" width="15" height="18" rx="1.5" {...st(B)} fill="#fff" /></S>,
  painter: <S><rect x="6" y="4" width="18" height="8" rx="1.5" {...st(G)} fill="#f6c343" /><path d="M24 8h3v7H15v4" {...st()} /><rect x="13" y="19" width="4" height="9" rx="1" fill={G} /></S>,
  newSlide: <S><rect x="3" y="7" width="22" height="17" rx="1" {...st()} fill="#fff" /><rect x="6" y="10" width="16" height="3" fill={R} /><path d="M7 16h14M7 19h10" {...st('#999', 1.2)} /><circle cx="25" cy="24" r="5.5" fill={GR} /><path d="M25 21v6M22 24h6" {...st('#fff', 1.8)} /></S>,
  layout: <S><rect x="4" y="6" width="24" height="20" rx="1" {...st()} /><rect x="7" y="9" width="18" height="4" fill="#cfd8e3" /><rect x="7" y="15" width="8" height="8" fill="#cfd8e3" /><rect x="17" y="15" width="8" height="8" fill="#cfd8e3" /></S>,
  reset: <S><rect x="4" y="7" width="20" height="16" rx="1" {...st()} /><path d="M27 17a7 7 0 1 1-3-6" {...st(B, 1.8)} /><path d="M24 7v5h5" {...st(B, 1.8)} /></S>,
  section: <S><rect x="4" y="5" width="11" height="9" rx="1" {...st()} /><rect x="17" y="5" width="11" height="9" rx="1" {...st()} /><rect x="4" y="18" width="11" height="9" rx="1" {...st(B)} /><rect x="17" y="18" width="11" height="9" rx="1" {...st(B)} /><path d="M2 16h28" {...st(R, 1.4)} /></S>,
  shapes: <S><rect x="4" y="15" width="12" height="12" {...st(B)} fill="#9cc3e6" /><circle cx="21" cy="11" r="7" {...st(R)} fill="#f4b183" /><path d="M18 27l5-8 5 8z" {...st(GR)} fill="#c5e0b4" /></S>,
  arrange: <S><rect x="4" y="4" width="14" height="14" {...st(B)} fill="#9cc3e6" /><rect x="13" y="13" width="15" height="15" {...st()} fill="#fff" /></S>,
  quickStyles: <S><rect x="4" y="5" width="11" height="9" rx="1" fill="#4472c4" /><rect x="17" y="5" width="11" height="9" rx="1" {...st(R, 2)} fill="#fff" /><rect x="4" y="18" width="11" height="9" rx="1" fill="#a9d18e" /><rect x="17" y="18" width="11" height="9" rx="1" fill="#ffd966" /></S>,
  fill: <S><path d="M7 15l9-9 9 9-9 9z" {...st()} fill="#fff" /><path d="M25 18s3 4 3 6a3 3 0 0 1-6 0c0-2 3-6 3-6z" fill={B} /><rect x="3" y="27" width="26" height="3" fill={Y} /></S>,
  outline: <S><path d="M5 23l14-14 4 4-14 14H5z" {...st()} /><rect x="3" y="27" width="26" height="3" fill={R} /></S>,
  effects: <S><rect x="5" y="5" width="16" height="16" rx="2" {...st(B)} fill="#bcd3ee" /><rect x="10" y="10" width="16" height="16" rx="2" fill="none" stroke="#999" strokeDasharray="2 2" /></S>,
  find: <S><circle cx="13" cy="13" r="8" {...st(G, 2)} /><path d="M19 19l8 8" {...st(G, 2.6)} /></S>,
  replace: <S><path d="M6 10h16M18 6l4 4-4 4M26 22H10M14 18l-4 4 4 4" {...st(B, 1.8)} /></S>,
  select: <S><path d="M8 4v20l5-5 4 9 3-1-4-9h7z" {...st()} fill="#fff" /></S>,
  table: <S><rect x="4" y="6" width="24" height="20" {...st()} /><rect x="4" y="6" width="24" height="5" fill={B} /><path d="M4 16h24M4 21h24M12 11v15M20 11v15" {...st()} /></S>,
  picture: <S><rect x="3" y="6" width="26" height="20" rx="1" {...st()} fill="#fff" /><circle cx="11" cy="12" r="2.5" fill={Y} /><path d="M5 24l7-8 5 5 4-4 7 7" {...st(GR)} fill="#a9d18e" /></S>,
  icons: <S><circle cx="16" cy="16" r="11" {...st()} /><circle cx="12" cy="13" r="1.5" fill={G} /><circle cx="20" cy="13" r="1.5" fill={G} /><path d="M11 19c3 3 7 3 10 0" {...st()} /></S>,
  chart: <S><path d="M4 27h25" {...st()} /><rect x="6" y="15" width="5" height="12" fill={B} /><rect x="13.5" y="8" width="5" height="19" fill={R} /><rect x="21" y="12" width="5" height="15" fill={Y} /></S>,
  smartart: <S><rect x="11" y="3" width="10" height="7" rx="1" fill="#a9d18e" /><rect x="3" y="21" width="10" height="7" rx="1" fill="#9cc3e6" /><rect x="19" y="21" width="10" height="7" rx="1" fill="#9cc3e6" /><path d="M16 10v6M8 21v-5h16v5" {...st()} /></S>,
  link: <S><path d="M14 18a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-2 2M18 14a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l2-2" {...st(B, 2)} /></S>,
  comment: <S><path d="M4 6h24v15H14l-6 5v-5H4z" {...st(Y, 1.8)} fill="#fff" /><path d="M9 11h14M9 15h10" {...st(G, 1.2)} /></S>,
  textBox: <S><rect x="4" y="6" width="24" height="20" {...st(G, 1.2)} strokeDasharray="3 2" /><path d="M10 11h12M16 11v12" {...st(G, 2.2)} /></S>,
  wordArt: <S><path d="M5 25L12 6h3l7 19M8 18h11" fill="none" stroke={B} strokeWidth="3" strokeLinejoin="round" /><path d="M5 25L12 6h3l7 19" fill="none" stroke="#9cc3e6" strokeWidth="1" /></S>,
  date: <S><rect x="4" y="6" width="24" height="21" rx="2" {...st()} fill="#fff" /><rect x="4" y="6" width="24" height="6" fill={R} /><path d="M10 4v5M22 4v5" {...st()} /><path d="M9 17h4M15 17h4M21 17h2M9 22h4M15 22h4" {...st(G, 1.4)} /></S>,
  symbol: <S><path d="M7 26h6v-3a9 9 0 1 1 6 0v3h6" {...st(G, 2)} /></S>,
  video: <S><rect x="3" y="8" width="18" height="16" rx="2" {...st()} fill="#fff" /><path d="M21 13l8-4v14l-8-4z" fill={B} /></S>,
  camera: <S><rect x="3" y="9" width="26" height="17" rx="2" {...st()} fill="#fff" /><circle cx="16" cy="17" r="5" {...st(B, 2)} /><rect x="11" y="5" width="10" height="4" rx="1" {...st()} /></S>,
  qr: <S><rect x="4" y="4" width="10" height="10" {...st(G, 2)} /><rect x="18" y="4" width="10" height="10" {...st(G, 2)} /><rect x="4" y="18" width="10" height="10" {...st(G, 2)} /><rect x="7" y="7" width="4" height="4" fill={G} /><rect x="21" y="7" width="4" height="4" fill={G} /><rect x="7" y="21" width="4" height="4" fill={G} /><path d="M18 18h4v4h-4zM24 24h4v4h-4zM24 18h4M18 26h3" {...st(G, 1.6)} /></S>,
  bible: <S><path d="M6 5h17a3 3 0 0 1 3 3v19H9a3 3 0 0 1-3-3z" {...st()} fill="#fff" /><path d="M16 9v10M12 13h8" {...st(R, 2)} /></S>,
  pen: (c = '#000') => <S><path d="M6 26l3-8L22 5l5 5-13 13z" {...st()} fill="#fff" /><path d="M6 26l3-8 5 5z" fill={c} /></S>,
  highlighter: (c = '#ffff00') => <S><path d="M8 24l2-7L21 6l5 5-11 11z" {...st()} fill="#fff" /><rect x="3" y="26" width="26" height="3" fill={c} /></S>,
  eraser: <S><path d="M5 21L17 9l8 8-8 8H9z" {...st()} fill="#f4b6c2" /><path d="M11 15l8 8" {...st()} /></S>,
  lasso: <S><path d="M5 5v18l5-4 3 7 3-1-3-7h6z" {...st()} fill="#fff" /></S>,
  inkShape: <S><path d="M5 18c3-8 8-12 12-6s6 6 10-2" {...st(B, 1.8)} /><rect x="9" y="20" width="14" height="8" {...st(G, 1.6)} /></S>,
  themes: <S><rect x="3" y="6" width="26" height="20" rx="1" {...st()} fill="#fff" /><rect x="3" y="6" width="26" height="6" fill={R} /><path d="M7 16h12M7 20h8" {...st(G, 1.4)} /></S>,
  slideSize: <S><rect x="3" y="7" width="20" height="15" {...st()} /><rect x="9" y="12" width="20" height="14" {...st(B)} fill="#fff" /></S>,
  background: <S><rect x="3" y="6" width="26" height="20" {...st(B)} fill="#bcd3ee" /><path d="M3 22l8-7 6 5 5-4 7 6" {...st(B)} fill="#9cc3e6" /></S>,
  preview: <S><circle cx="16" cy="16" r="12" {...st(GR)} fill="#e8f2e8" /><path d="M13 10v12l9-6z" fill={GR} /></S>,
  effectOptions: <S><rect x="4" y="4" width="11" height="11" fill="#9cc3e6" /><path d="M17 17l10 10M27 17v10H17" {...st(G, 2)} /></S>,
  addAnim: <S><path d="M16 4l3 8 8 1-6 5 2 8-7-5-7 5 2-8-6-5 8-1z" {...st('#a87500', 1)} fill={Y} /><circle cx="25" cy="25" r="5.5" fill={GR} /><path d="M25 22v6M22 25h6" {...st('#fff', 1.8)} /></S>,
  animPane: <S><rect x="4" y="4" width="24" height="24" rx="1" {...st()} fill="#fff" /><path d="M8 10h3M8 16h3M8 22h3" {...st(R, 2)} /><path d="M14 10h10M14 16h8M14 22h10" {...st(G, 1.4)} /></S>,
  fromStart: <S><rect x="3" y="6" width="26" height="18" rx="1" {...st()} fill="#fff" /><path d="M13 10v10l8-5z" fill={R} /><path d="M10 28h12" {...st()} /></S>,
  fromCurrent: <S><rect x="3" y="6" width="26" height="18" rx="1" {...st()} fill="#fff" /><path d="M15 10v10l8-5z" fill={B} /><path d="M10 10v10" {...st(B, 2)} /><path d="M10 28h12" {...st()} /></S>,
  hideSlide: <S><rect x="4" y="6" width="22" height="17" rx="1" {...st('#999')} fill="#eee" /><path d="M4 27L28 5" {...st(R, 2)} /></S>,
  rehearse: <S><circle cx="16" cy="18" r="10" {...st()} fill="#fff" /><path d="M16 12v6l4 3M13 4h6" {...st(G, 1.8)} /></S>,
  presenter: <S><rect x="3" y="5" width="17" height="13" {...st()} fill="#fff" /><rect x="22" y="5" width="7" height="6" {...st(B)} fill="#fff" /><path d="M3 22h26M3 26h18" {...st(G, 1.4)} /></S>,
  monitor: <S><rect x="3" y="5" width="26" height="17" rx="1" {...st()} fill="#fff" /><path d="M12 27h8M16 22v5" {...st()} /></S>,
  black: <S><rect x="3" y="6" width="26" height="20" rx="1" fill="#111" /></S>,
  spell: <S><path d="M4 18L9 5h2l5 13M6 13h8" {...st(G, 1.6)} /><path d="M14 22l4 4 10-10" {...st(GR, 2.4)} /></S>,
  access: <S><circle cx="16" cy="6" r="3" fill={B} /><path d="M6 11l10 2 10-2M16 13v6l-5 9M16 19l5 9" {...st(B, 2)} /></S>,
  normalView: <S><rect x="3" y="5" width="26" height="22" rx="1" {...st()} /><path d="M9 5v22" {...st()} /><rect x="12" y="8" width="14" height="11" fill="#bcd3ee" /></S>,
  outlineView: <S><path d="M5 7h3M5 13h3M5 19h3M5 25h3" {...st(R, 2)} /><path d="M11 7h16M13 13h12M13 19h14M11 25h16" {...st(G, 1.4)} /></S>,
  sorterView: <S><rect x="3" y="5" width="11" height="9" {...st()} /><rect x="18" y="5" width="11" height="9" {...st()} /><rect x="3" y="18" width="11" height="9" {...st()} /><rect x="18" y="18" width="11" height="9" {...st()} /></S>,
  readingView: <S><path d="M3 7c5-2 9-2 13 1 4-3 8-3 13-1v19c-5-2-9-2-13 1-4-3-8-3-13-1z" {...st()} fill="#fff" /><path d="M16 8v19" {...st()} /></S>,
  zoom: <S><circle cx="13" cy="13" r="8" {...st(G, 2)} /><path d="M19 19l8 8M10 13h6M13 10v6" {...st(G, 2)} /></S>,
  fit: <S><rect x="5" y="8" width="22" height="16" {...st()} /><path d="M3 4h6M3 4v5M29 4h-6M29 4v5M3 28h6M3 28v-5M29 28h-6M29 28v-5" {...st(B, 1.6)} /></S>,
  gridlines: <S><path d="M4 10h24M4 16h24M4 22h24M10 4v24M16 4v24M22 4v24" {...st('#999', 1)} /><rect x="4" y="4" width="24" height="24" {...st()} /></S>,
  selectionPane: <S><rect x="5" y="4" width="22" height="24" rx="1" {...st()} fill="#fff" /><path d="M9 10h10M9 16h10M9 22h10" {...st(G, 1.4)} /><circle cx="23" cy="10" r="1.6" fill={B} /><circle cx="23" cy="16" r="1.6" fill={B} /><circle cx="23" cy="22" r="1.6" fill="#ccc" /></S>,
  bringFront: <S><rect x="4" y="12" width="12" height="12" {...st('#888')} fill="#ddd" /><rect x="11" y="6" width="15" height="15" {...st(B)} fill="#9cc3e6" /></S>,
  sendBack: <S><rect x="11" y="6" width="15" height="15" {...st('#888')} fill="#ddd" /><rect x="4" y="12" width="12" height="12" {...st(B)} fill="#9cc3e6" /></S>,
  align: <S><path d="M5 4v24" {...st(G, 2)} /><rect x="8" y="7" width="18" height="6" {...st(B)} fill="#9cc3e6" /><rect x="8" y="18" width="11" height="6" {...st(B)} fill="#9cc3e6" /></S>,
  group: <S><rect x="3" y="3" width="26" height="26" {...st('#888', 1)} strokeDasharray="3 2" /><rect x="7" y="7" width="10" height="10" {...st(B)} fill="#9cc3e6" /><circle cx="20" cy="20" r="5" {...st(R)} fill="#f4b183" /></S>,
  rotate: <S><path d="M26 16a10 10 0 1 1-4-8" {...st(B, 2)} /><path d="M22 3v6h6" {...st(B, 2)} /></S>,
  editData: <S><rect x="4" y="5" width="24" height="22" {...st()} fill="#fff" /><path d="M4 11h24M4 17h24M4 22h24M12 5v22" {...st('#999', 1)} /><path d="M17 24l8-8 3 3-8 8h-3z" {...st(G, 1)} fill={Y} /></S>,
  deleteIcon: <S><path d="M7 9h18M12 9V5h8v4M9 9l1.5 18h11L23 9" {...st(G, 1.8)} /></S>,
  insertAbove: <S><rect x="4" y="15" width="24" height="12" {...st()} /><path d="M4 21h24M12 15v12M20 15v12" {...st('#999', 1)} /><path d="M16 3v9M12 8l4-5 4 5" {...st(GR, 2)} /></S>,
  insertBelow: <S><rect x="4" y="5" width="24" height="12" {...st()} /><path d="M4 11h24M12 5v12M20 5v12" {...st('#999', 1)} /><path d="M16 29v-9M12 24l4 5 4-5" {...st(GR, 2)} /></S>,
  insertLeft: <S><rect x="15" y="4" width="12" height="24" {...st()} /><path d="M21 4v24M15 12h12M15 20h12" {...st('#999', 1)} /><path d="M3 16h9M8 12l-5 4 5 4" {...st(GR, 2)} /></S>,
  insertRight: <S><rect x="5" y="4" width="12" height="24" {...st()} /><path d="M11 4v24M5 12h12M5 20h12" {...st('#999', 1)} /><path d="M29 16h-9M24 12l5 4-5 4" {...st(GR, 2)} /></S>,
  merge: <S><rect x="4" y="8" width="24" height="16" {...st()} /><path d="M9 16h14M12 13l-3 3 3 3M20 13l3 3-3 3" {...st(B, 1.8)} /></S>,
  split: <S><rect x="4" y="8" width="24" height="16" {...st()} /><path d="M16 8v16" {...st(R, 1.8)} /></S>,
  distributeRows: <S><rect x="4" y="4" width="24" height="24" {...st()} /><path d="M4 12h24M4 20h24" {...st(B, 1.6)} /></S>,
  distributeCols: <S><rect x="4" y="4" width="24" height="24" {...st()} /><path d="M12 4v24M20 4v24" {...st(B, 1.6)} /></S>,
  help: <S><circle cx="16" cy="16" r="12" {...st(B, 2)} /><path d="M12 12a4 4 0 1 1 5 4c-1 .5-1 1.5-1 3" {...st(B, 2)} /><circle cx="16" cy="23" r="1.4" fill={B} /></S>,
  ai: <S><path d="M16 3l2.5 8.5L27 14l-8.5 2.5L16 25l-2.5-8.5L5 14l8.5-2.5z" {...st(P, 1.2)} fill="#c9b6f0" /><path d="M25 22l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" fill={P} /></S>,
};

export function Big({ icon, label, onClick, disabled, active, title, menu }: { icon: ReactNode; label: string; onClick?: (e: MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; active?: boolean; title?: string; menu?: boolean }) {
  return (
    <button type="button" className={`rb-big ${active ? 'on' : ''}`} onClick={onClick} disabled={disabled} title={title ?? label}>
      <span className="rb-icon">{icon}</span>
      <span className="rb-label">{label}{menu && <span className="rb-caret">▾</span>}</span>
    </button>
  );
}

export function Small({ icon, label, onClick, disabled, active, title, menu }: { icon?: ReactNode; label?: string; onClick?: (e: MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; active?: boolean; title?: string; menu?: boolean }) {
  return (
    <button type="button" className={`rb-small ${active ? 'on' : ''} ${label ? '' : 'icon-only'}`} onClick={onClick} disabled={disabled} title={title ?? label}>
      {icon && <span className="rb-icon-s">{icon}</span>}{label}{menu && <span className="rb-caret">▾</span>}
    </button>
  );
}

export function Group({ label, children, launcher, className }: { label: string; children: ReactNode; launcher?: () => void; className?: string }) {
  return (
    <div className={`rb-group ${className ?? ''}`}>
      <div className="rb-items">{children}</div>
      <div className="rb-group-label">{label}{launcher && <button type="button" className="rb-launcher" title={`${label} 설정`} onClick={launcher}>⤡</button>}</div>
    </div>
  );
}

export const Col = ({ children }: { children: ReactNode }) => <div className="rb-col">{children}</div>;
export const Row = ({ children }: { children: ReactNode }) => <div className="rb-row">{children}</div>;

/** A menu that opens under its button and closes on a click elsewhere or Esc. */
export function Menu({ anchor, onClose, children, wide }: { anchor: DOMRect; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ left: anchor.left, top: anchor.bottom + 2, visibility: 'hidden' });
  useLayoutEffect(() => {
    const m = ref.current!.getBoundingClientRect();
    const left = Math.max(6, Math.min(anchor.left, window.innerWidth - m.width - 6));
    const below = anchor.bottom + 2 + m.height <= window.innerHeight - 6;
    setPos({ left, top: below ? anchor.bottom + 2 : Math.max(6, anchor.top - m.height - 2), maxHeight: window.innerHeight - 12 });
  }, [anchor]);
  useEffect(() => {
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => window.addEventListener('pointerdown', off), 0);
    window.addEventListener('keydown', esc);
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', off); window.removeEventListener('keydown', esc); };
  }, [onClose]);
  return <div ref={ref} className={`rb-menu ${wide ? 'wide' : ''}`} role="menu" style={{ position: 'fixed', ...pos }}>{children}</div>;
}

/** A button that opens a menu (`render` gets a close function). */
export function DropButton({ big, icon, label, title, disabled, active, render, wide }: { big?: boolean; icon?: ReactNode; label?: string; title?: string; disabled?: boolean; active?: boolean; render: (close: () => void) => ReactNode; wide?: boolean }) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const open = (e: MouseEvent<HTMLButtonElement>) => setAt(at ? null : e.currentTarget.getBoundingClientRect());
  const close = () => setAt(null);
  return (
    <>
      {big ? <Big icon={icon} label={label ?? ''} title={title} disabled={disabled} active={active} onClick={open} menu /> : <Small icon={icon} label={label} title={title} disabled={disabled} active={active} onClick={open} menu />}
      {at && <Menu anchor={at} onClose={close} wide={wide}>{render(close)}</Menu>}
    </>
  );
}

export const MenuItem = ({ icon, label, onClick, disabled, on, hint }: { icon?: ReactNode; label: ReactNode; onClick: () => void; disabled?: boolean; on?: boolean; hint?: string }) => (
  <button type="button" className={`rb-mi ${on ? 'on' : ''}`} disabled={disabled} onClick={onClick}>
    <span className="rb-mi-icon">{icon}</span><span className="rb-mi-label">{label}</span>{hint && <span className="rb-mi-hint">{hint}</span>}
  </button>
);
export const MenuHead = ({ children }: { children: ReactNode }) => <div className="rb-mh">{children}</div>;
export const MenuSep = () => <div className="rb-ms" />;

/** PowerPoint's colour picker: theme colours with their shades and the standard colours (from the engine). */
export function ColorGrid({ value, onPick, onNone, noneLabel = '없음', scheme }: { value?: string; onPick: (c: string) => void; onNone?: () => void; noneLabel?: string; scheme?: string }) {
  const pal = colorPalette(scheme);
  const input = useRef<HTMLInputElement>(null);
  const chip = (c: string, title: string) => (
    <button key={c + title} type="button" className={`rb-chip ${value?.toLowerCase() === c.toLowerCase() ? 'on' : ''}`} style={{ background: c }} title={`${title} ${c}`} onClick={() => onPick(c)} />
  );
  return (
    <div className="rb-colors">
      {onNone && <MenuItem label={noneLabel} onClick={onNone} />}
      <MenuHead>테마 색</MenuHead>
      {pal ? (
        <>
          <div className="rb-chip-row">{pal.theme.map((t) => chip(t.hex, t.slot))}</div>
          <div className="rb-chip-cols">{pal.theme.map((t) => <div key={t.slot} className="rb-chip-col">{t.shades.map((s) => chip(s.hex, s.label))}</div>)}</div>
          <MenuHead>표준 색</MenuHead>
          <div className="rb-chip-row">{pal.standard.map((s) => chip(s.hex, s.label))}</div>
        </>
      ) : <div className="rb-chip-row">{['#ffffff', '#000000', '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#0070c0', '#7030a0'].map((c) => chip(c, ''))}</div>}
      <MenuItem label="다른 색…" onClick={() => input.current?.click()} />
      <input ref={input} type="color" hidden value={(value ?? '#000000').slice(0, 7)} onChange={(e) => onPick(e.target.value)} />
    </div>
  );
}

/** A colour button with a bar under its icon showing the colour, and the picker on its arrow. */
export function ColorButton({ icon, label, value, onPick, onNone, noneLabel, disabled, title }: { icon: ReactNode; label?: string; value?: string; onPick: (c: string) => void; onNone?: () => void; noneLabel?: string; disabled?: boolean; title: string }) {
  return (
    <DropButton icon={<span className="rb-colored">{icon}<span className="rb-colorbar" style={{ background: value ?? 'transparent' }} /></span>} label={label} title={title} disabled={disabled}
      render={(close) => <ColorGrid value={value} onPick={(c) => { onPick(c); close(); }} onNone={onNone && (() => { onNone(); close(); })} noneLabel={noneLabel} />} />
  );
}

/** A scrolling gallery of choices (themes, shapes, transitions, animations). */
export function Gallery({ children, rows = 1, className }: { children: ReactNode; rows?: number; className?: string }) {
  return <div className={`rb-gallery ${className ?? ''}`} style={{ ['--rows' as string]: rows } as CSSProperties}>{children}</div>;
}
