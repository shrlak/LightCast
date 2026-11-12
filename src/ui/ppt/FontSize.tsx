import { useEffect, useRef, useState } from 'react';
import { FONT_SIZES } from '../../domain/textFormat';
import { Icon } from './pptIcons';
import { useMenuPlacement } from './TextFormatPanel';

/** Canvas pixels ↔ points (a 1440-wide slide is 10 in, 2 px per point — as exported to PowerPoint). */
const toPt = (px: number) => Math.round((px / 2) * 10) / 10;

/**
 * Font size, as PowerPoint's size box: shows points, type any size and press Enter, or pick one
 * of PowerPoint's sizes from the list.
 */
export function FontSize({ value, onChange, blank, min = 1, max = 4000 }: { value: number; onChange: (px: number) => void; /** Mixed sizes: an empty box (PowerPoint). */ blank?: boolean; min?: number; max?: number }) {
  const shown = blank ? '' : toPt(value);
  const [text, setText] = useState(String(shown));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const place = useMenuPlacement(open, ref, menu);
  useEffect(() => setText(String(shown)), [shown]);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', off);
    return () => window.removeEventListener('pointerdown', off);
  }, [open]);
  const set = (pt: number) => {
    if (!Number.isFinite(pt) || pt <= 0 || (blank && String(pt) === '')) return setText(String(shown));
    onChange(Math.min(max, Math.max(min, pt)) * 2);
  };
  return (
    <span ref={ref} className="font-size ppt-drop" title="글꼴 크기">
      <input className="fs-input" inputMode="decimal" value={text} aria-label="글꼴 크기"
        onChange={(e) => setText(e.target.value)} onBlur={() => { if (text !== String(shown)) set(Number(text)); }} onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) set(Number(text));
          if (e.key === 'Escape') setText(String(shown));
        }} />
      <button type="button" className="ppt-btn ppt-caret-btn" aria-label="글꼴 크기 목록" onClick={() => setOpen(!open)}>{Icon.caret}</button>
      {open && (
        <div ref={menu} className="ppt-menu fs-menu" role="listbox" style={place}>
          {FONT_SIZES.map((px) => toPt(px)).map((pt) => (
            <button key={pt} type="button" className={`ppt-item ${pt === shown ? 'on' : ''}`} onClick={() => { set(pt); setOpen(false); }}>{pt}</button>
          ))}
        </div>
      )}
    </span>
  );
}
