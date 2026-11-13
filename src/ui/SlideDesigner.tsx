import { isFrontSlide } from '../domain/frontLayout';
import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Background, MediaMeta, Slide, SlideElement, Theme } from '../domain/types';
import { uid } from '../domain/lyrics';
import { putMedia } from '../domain/media';
import { patchElement } from '../domain/templates/convert';
import { NO_GUIDES, snapMove, type SnapGuides } from '../domain/snap';
import { CANVAS_H, CANVAS_W, ElementView as SlideElementSlot, SlideCanvas } from './SlideCanvas';
import { useAutosave, useWidth } from './hooks';
import { AutoTextarea } from './AutoTextarea';
import { isPdfSlide, PDF_READ_ONLY } from '../domain/importedSlides';
import { useAutoTextBoxes } from './textBoxLayout';
import { PROTECTED_MESSAGE } from '../domain/materialProtection';
import { QR_SIZE } from '../domain/qrElements';

interface Props {
  readOnly?: boolean;
  slide: Slide;
  theme: Theme;
  background: Background | null;
  media: MediaMeta[];
  addMedia: (m: MediaMeta) => void;
  /** Called as the slide is edited (autosave). */
  onSave: (elements: SlideElement[], text: string) => void;
  onClose: () => void;
}

/** WYSIWYG slide editor: free-positioned text boxes, images and shapes on top of the slide. */
export function SlideDesigner({ slide, theme, background, media, addMedia, onSave, onClose, readOnly }: Props) {
  const [els, setEls] = useState<SlideElement[]>(slide.elements ?? []);
  useAutoTextBoxes(els, readOnly || isPdfSlide(slide) ? undefined : setEls, isFrontSlide(slide));
  const [text, setText] = useState(slide.text);
  const [sel, setSel] = useState<string | null>(null);
  const [guides, setGuides] = useState<SnapGuides>(NO_GUIDES);
  const [ref, width] = useWidth<HTMLDivElement>();
  const fileRef = useRef<HTMLInputElement>(null);
  const k = width / CANVAS_W || 1;
  const selected = els.find((e) => e.id === sel);
  useAutosave({ els, text }, (v) => onSave(v.els, v.text), { delay: 400, enabled: !readOnly && !isPdfSlide(slide) });
  const update = (id: string, patch: Partial<SlideElement>) => setEls((list) => list.map((e) => (e.id === id ? patchElement(e, patch) : e)));

  const add = (el: Omit<SlideElement, 'id' | 'x' | 'y' | 'w' | 'h'> & Partial<SlideElement>) => {
    const next = { id: uid('el'), x: (CANVAS_W - 600) / 2, y: 390, w: 600, h: 300, ...el } as SlideElement;
    setEls((l) => [...l, next]);
    setSel(next.id);
  };

  const drag = (e: RPointerEvent, el: SlideElement, mode: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    setSel(el.id);
    const start = { x: e.clientX, y: e.clientY, el: { ...el } };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / k;
      const dy = (ev.clientY - start.y) / k;
      if (mode === 'move') {
        const moved = { x: Math.round(start.el.x + dx), y: Math.round(start.el.y + dy), w: start.el.w, h: start.el.h };
        // Hold Alt to move freely, without snapping to the guides.
        const snapped = ev.altKey ? { box: moved, guides: NO_GUIDES } : snapMove(moved, els.filter((o) => o.id !== el.id));
        setGuides(snapped.guides);
        update(el.id, { x: snapped.box.x, y: snapped.box.y });
      } else {
        update(el.id, { w: Math.max(40, Math.round(start.el.w + dx)), h: Math.max(30, Math.round(start.el.h + dy)) });
      }
    };
    const up = () => {
      setGuides(NO_GUIDES);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const order = (dir: 1 | -1) => {
    if (!selected) return;
    const i = els.indexOf(selected);
    const j = i + dir;
    if (j < 0 || j >= els.length) return;
    const next = [...els];
    [next[i], next[j]] = [next[j], next[i]];
    setEls(next);
  };

  const uploadImage = async (file: File | undefined) => {
    if (!file) return;
    const id = uid('m');
    await putMedia(id, file);
    addMedia({ id, name: file.name, type: 'image' });
    add({ kind: 'image', mediaId: id, fit: 'contain' });
  };

  const preview: Slide = { ...slide, text, elements: [] };

  if (readOnly || isPdfSlide(slide)) return <div className="modal-backdrop"><div className="modal" role="dialog" aria-label={readOnly ? '보호된 자료' : 'PDF 읽기 전용'}>
    <p>{readOnly ? PROTECTED_MESSAGE : PDF_READ_ONLY}</p><button onClick={onClose}>닫기</button>
  </div></div>;

  return (
    <div className="modal-backdrop" onKeyDown={(e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !(e.target as HTMLElement).matches('input,textarea,select')) {
        setEls((l) => l.filter((x) => x.id !== sel));
        setSel(null);
      }
    }} tabIndex={-1}>
      <div className="modal wizard designer" role="dialog" aria-label="Slide editor">
        <header className="modal-head">
          <h2>Slide editor · {slide.group || 'Slide'}</h2>
          <div className="row gap-xs wrap">
            <button onClick={() => add({ kind: 'text', text: 'Text', fontSize: 80, color: '#ffffff', align: 'center', bold: true, shadow: true })}>＋ Text</button>
            <button onClick={() => fileRef.current?.click()}>＋ Image</button>
            <select value="" onChange={(e) => e.target.value && add({ kind: 'image', mediaId: e.target.value, fit: 'contain' })}>
              <option value="">Image from media bin…</option>
              {media.filter((m) => m.type === 'image').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select value="" onChange={(e) => e.target.value && add({ kind: 'video', mediaId: e.target.value, fit: 'cover', w: 800, h: 450 })}>
              <option value="">Video from media bin…</option>
              {media.filter((m) => m.type === 'video').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button onClick={() => add({ kind: 'camera', deviceId: '', w: 800, h: 450 })} title="Live camera / capture input as an object">＋ Camera</button>
            <button onClick={() => add({ kind: 'shape', fill: 'rgba(0,0,0,0.55)', radius: 24, w: 1240, h: 220, x: 100, y: 820 })}>＋ Box</button>
            <button onClick={() => add({ kind: 'shape', fill: '#4bc789', ellipse: true, w: 300, h: 300 })}>＋ Circle</button>
            <button title="링크 QR 코드 — 오른쪽에서 링크를 입력하세요" onClick={() => add({ kind: 'qr', w: QR_SIZE, h: QR_SIZE })}>＋ QR 코드</button>
            <input ref={fileRef} type="file" accept="image/*,.wmf,.emf,.svgz" hidden onChange={(e) => uploadImage(e.target.files?.[0])} />
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="designer-body">
          <div className="designer-stage" ref={ref} onPointerDown={() => setSel(null)}>
            <SlideCanvas slide={preview} theme={theme} background={slide.background ?? background} />
            <div className="designer-overlay" style={{ width: CANVAS_W * k, height: CANVAS_H * k }}>
              {els.map((el) => (
                <div key={el.id} className={`designer-el ${el.id === sel ? 'sel' : ''}`}
                  style={{ left: el.x * k, top: el.y * k, width: el.w * k, height: el.h * k }}
                  onPointerDown={(e) => drag(e, el, 'move')}>
                  <div className="designer-el-inner" style={{ transform: `scale(${k})`, width: el.w, height: el.h }}>
                    <ElementPreview el={el} />
                  </div>
                  {el.id === sel && <span className="designer-handle" onPointerDown={(e) => drag(e, el, 'resize')} />}
                </div>
              ))}
              {guides.v.map((x) => <div key={`v${x}`} className="guide-v" style={{ left: x * k }} />)}
              {guides.h.map((y) => <div key={`h${y}`} className="guide-h" style={{ top: y * k }} />)}
            </div>
          </div>
          <aside className="designer-side stack">
            <label className="stack">Slide text (theme-styled)
              <AutoTextarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            {selected ? (
              <div className="stack">
                <h3>{selected.kind}</h3>
                {selected.kind === 'text' && (
                  <>
                    <AutoTextarea rows={3} value={selected.text ?? ''} onChange={(e) => update(selected.id, { text: e.target.value })} />
                    <div className="form-grid">
                      <label>Size<input type="number" value={selected.fontSize ?? 64} onChange={(e) => update(selected.id, { fontSize: Number(e.target.value) })} /></label>
                      <label>Colour<input type="color" value={selected.color ?? '#ffffff'} onChange={(e) => update(selected.id, { color: e.target.value })} /></label>
                      <label>Align
                        <select value={selected.align ?? 'center'} onChange={(e) => update(selected.id, { align: e.target.value as SlideElement['align'] })}>
                          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                        </select>
                      </label>
                      <label>Vertical
                        <select value={selected.vAlign ?? 'middle'} onChange={(e) => update(selected.id, { vAlign: e.target.value as SlideElement['vAlign'] })}>
                          <option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option>
                        </select>
                      </label>
                    </div>
                    <div className="row gap-s">
                      <label className="check"><input type="checkbox" checked={!!selected.bold} onChange={(e) => update(selected.id, { bold: e.target.checked })} /> Bold</label>
                      <label className="check"><input type="checkbox" checked={!!selected.italic} onChange={(e) => update(selected.id, { italic: e.target.checked })} /> Italic</label>
                      <label className="check"><input type="checkbox" checked={!!selected.shadow} onChange={(e) => update(selected.id, { shadow: e.target.checked })} /> Shadow</label>
                    </div>
                  </>
                )}
                {selected.kind === 'qr' && (
                  <>
                    <label className="stack">QR 코드 링크
                      <input autoFocus={!selected.link} value={selected.link ?? ''} placeholder="https://forms.gle/…" onChange={(e) => update(selected.id, { link: e.target.value.trim() || undefined })} />
                    </label>
                    <p className="hint">휴대폰으로 찍으면 이 주소가 열립니다. 끌어서 옮기고, 모서리를 끌어 크기를 바꾸고, Delete 키로 지웁니다.</p>
                  </>
                )}
                {selected.kind === 'shape' && (
                  <div className="form-grid">
                    <label>Fill<input value={selected.fill ?? ''} onChange={(e) => update(selected.id, { fill: e.target.value })} /></label>
                    <label>Corner radius<input type="number" value={selected.radius ?? 0} onChange={(e) => update(selected.id, { radius: Number(e.target.value) })} /></label>
                    <label className="check span2"><input type="checkbox" checked={!!selected.ellipse} onChange={(e) => update(selected.id, { ellipse: e.target.checked })} /> Ellipse</label>
                  </div>
                )}
                {selected.kind === 'image' && (
                  <label>Fit
                    <select value={selected.fit ?? 'contain'} onChange={(e) => update(selected.id, { fit: e.target.value as SlideElement['fit'] })}>
                      <option value="contain">Fit</option><option value="cover">Fill (crop)</option>
                    </select>
                  </label>
                )}
                <div className="form-grid">
                  <label>X<input type="number" value={selected.x} onChange={(e) => update(selected.id, { x: Number(e.target.value) })} /></label>
                  <label>Y<input type="number" value={selected.y} onChange={(e) => update(selected.id, { y: Number(e.target.value) })} /></label>
                  <label>Width<input type="number" value={selected.w} onChange={(e) => update(selected.id, { w: Number(e.target.value) })} /></label>
                  <label>Height<input type="number" value={selected.h} onChange={(e) => update(selected.id, { h: Number(e.target.value) })} /></label>
                  <label>Rotation°<input type="number" value={selected.rotation ?? 0} onChange={(e) => update(selected.id, { rotation: Number(e.target.value) })} /></label>
                  <label>Opacity<input type="range" min={0} max={1} step={0.05} value={selected.opacity ?? 1} onChange={(e) => update(selected.id, { opacity: Number(e.target.value) })} /></label>
                </div>
                <div className="row gap-xs wrap">
                  <button onClick={() => update(selected.id, { x: Math.round((CANVAS_W - selected.w) / 2) })}>Center H</button>
                  <button onClick={() => update(selected.id, { y: Math.round((CANVAS_H - selected.h) / 2) })}>Center V</button>
                  <button onClick={() => order(1)}>Forward</button>
                  <button onClick={() => order(-1)}>Back</button>
                  <button onClick={() => add({ ...selected, x: selected.x + 40, y: selected.y + 40 })}>Duplicate</button>
                  <button className="danger" onClick={() => { setEls((l) => l.filter((x) => x.id !== selected.id)); setSel(null); }}>Delete</button>
                </div>
              </div>
            ) : (
              <p className="hint">Add text, images or shapes, then drag to move and pull the corner to resize. Objects snap to the centre lines. Delete removes the selected object.</p>
            )}
          </aside>
        </div>
        <footer className="modal-foot">
          <span className="muted small grow">{els.length} objects</span>
          <span className="muted small">자동 저장 (되돌리기: ⌘/Ctrl+Z)</span>
          <button className="primary" onClick={onClose}>닫기</button>
        </footer>
      </div>
    </div>
  );
}

/** Lightweight element render inside the editor overlay (the real canvas draws the rest). */
function ElementPreview({ el }: { el: SlideElement }) {
  return (
    <div style={{ position: 'relative', width: el.w, height: el.h }}>
      <SlideElementSlot el={{ ...el, x: 0, y: 0 }} />
    </div>
  );
}

