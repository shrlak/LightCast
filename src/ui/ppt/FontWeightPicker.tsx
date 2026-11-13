// Home › Font › 굵기: the weights (가늘게 Light … 가장 굵게 Black) the chosen font really has, each
// drawn in its own weight. Bold stays the 굵게 button (700); picking a weight replaces it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { availableWeights, nearestWeight, weightLabel, weightOf, weightPatch, type DeclaredFace } from '../../domain/fontWeight';
import { Icon } from './pptIcons';
import { useMenuPlacement } from './TextFormatPanel';

/** The @font-face rules the page has (the bundled fonts): exact answers about which weights exist. */
export function declaredFaces(): DeclaredFace[] {
  if (typeof document === 'undefined' || !document.fonts) return [];
  const out: DeclaredFace[] = [];
  try { document.fonts.forEach((f) => out.push({ family: f.family, weight: f.weight })); } catch { /* not readable */ }
  return out;
}

/**
 * Weights for the font box: `family` is the CSS stack, `bold` / `weight` the text's own, and
 * `onChange` receives the patch to store (`weight`, plus `bold` for the nearest bold / regular).
 */
export function FontWeightPicker({ family, bold, weight, mixed, onChange }: {
  family?: string;
  bold: boolean;
  weight?: number;
  mixed?: boolean;
  onChange: (patch: { weight: number | undefined; bold: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const place = useMenuPlacement(open, ref, menu);
  const now = weightOf({ bold, weight });
  const faces = useMemo(() => (open ? declaredFaces() : []), [open]);
  const list = useMemo(() => availableWeights(family, faces, now), [family, faces, now]);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', off);
    return () => window.removeEventListener('pointerdown', off);
  }, [open]);
  const label = mixed ? '' : weightLabel(now).replace(/ \(.*\)$/, '');
  return (
    <span ref={ref} className="ppt-drop ppt-weight-picker" title="글꼴 굵기">
      <button type="button" className={`ppt-btn ppt-weight-btn ${now !== 400 && now !== 700 ? 'on' : ''}`} aria-label="글꼴 굵기" aria-haspopup="listbox" aria-expanded={open}
        style={{ minWidth: 76, display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'space-between' }} onClick={() => setOpen(!open)}>
        <span style={{ fontFamily: family, fontWeight: now }}>{label || '굵기'}</span>{Icon.caret}
      </button>
      {open && (
        <div ref={menu} className="ppt-menu weight-menu" role="listbox" style={place}>
          <div className="ppt-menu-head">굵기</div>
          {list.map((w) => (
            <button key={w} type="button" role="option" aria-selected={w === now} className={`ppt-item font-item ${w === now ? 'on' : ''}`} style={{ fontFamily: family, fontWeight: w }}
              onClick={() => { onChange(weightPatch(nearestWeight(w))); setOpen(false); }}>
              {weightLabel(w)}<span className="font-role">{w}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
