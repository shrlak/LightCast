// 그림 서식 › 배경 제거 › 영역 표시: paint "유지할 영역 표시" (green) and "제거할 영역 표시" (yellow) on the
// picture, move the tolerance, see the result on a checkerboard, then 변경 내용 유지 stores a PNG with
// transparency as the picture (the original stays for 그림 원래대로). The pixel work is in
// domain/backgroundMarks.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CutoutMarks, SlideElement } from '../../domain/types';
import { BG_MARK_LABEL, BG_TOLERANCE_DEFAULT, brushRadius, packMarks, removeBackgroundByMarks, toPicturePoint, unpackMarks, type Mark, type MarkKind } from '../../domain/backgroundMarks';
import { Dialog } from './dialogs';
import './backgroundRemoval.css';
import { originalPixels } from './pictureTools';

const PREVIEW_SIDE = 520;
const CHECKER = 'repeating-conic-gradient(#d9d9d9 0% 25%, #ffffff 0% 50%) 0 0 / 16px 16px';

/** The picture scaled so its long side is `side` (never enlarged). */
function scaled(src: { data: Uint8ClampedArray; w: number; h: number }, side: number) {
  const k = Math.min(1, side / Math.max(src.w, src.h));
  if (k === 1) return { ...src, k };
  const w = Math.max(1, Math.round(src.w * k)), h = Math.max(1, Math.round(src.h * k));
  const a = document.createElement('canvas'); a.width = src.w; a.height = src.h;
  a.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(src.data), src.w, src.h), 0, 0);
  const b = document.createElement('canvas'); b.width = w; b.height = h;
  const g = b.getContext('2d', { willReadFrequently: true });
  g?.drawImage(a, 0, 0, w, h);
  return { data: g ? g.getImageData(0, 0, w, h).data : new Uint8ClampedArray(w * h * 4), w, h, k };
}

export function BackgroundRemovalDialog({ picture, onApply, onClose }: { picture: SlideElement; onApply: (rgba: Uint8ClampedArray, w: number, h: number, marks: CutoutMarks) => Promise<void>; onClose: () => void }) {
  const [src, setSrc] = useState<{ data: Uint8ClampedArray; w: number; h: number } | null | undefined>(undefined);
  const [tolerance, setTolerance] = useState(BG_TOLERANCE_DEFAULT);
  const [brush, setBrush] = useState<MarkKind>('remove');
  const [size, setSize] = useState(12);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [busy, setBusy] = useState(false);
  /** How many marks came back from the last time the picture was cut out (0: none were saved). */
  const [restored, setRestored] = useState(0);
  const seeded = useRef(false);
  const stroke = useRef<Mark | null>(null);
  const view = useRef<HTMLCanvasElement>(null);

  useEffect(() => { let live = true; void originalPixels(picture).then((p) => { if (live) setSrc(p); }); return () => { live = false; }; }, [picture]);
  const small = useMemo(() => (src ? scaled(src, PREVIEW_SIDE) : null), [src]);
  // Reopening: the marks and tolerance saved with the picture come back, to look at and to change.
  useEffect(() => {
    if (!small || seeded.current) return;
    seeded.current = true;
    const saved = picture.picture?.cutoutMarks;
    if (!saved) return;
    const back = unpackMarks(saved, small.w, small.h);
    setMarks(back.marks);
    setTolerance(back.tolerance);
    setRestored(back.marks.length);
  }, [small, picture]);
  const result = useMemo(() => (small ? removeBackgroundByMarks(small.data, small.w, small.h, tolerance, marks) : null), [small, tolerance, marks]);

  // Preview: the result over the checkerboard (the canvas is transparent where the picture is removed), with the marks drawn over it.
  useEffect(() => {
    const c = view.current;
    if (!c || !small || !result) return;
    c.width = small.w; c.height = small.h;
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    g.putImageData(new ImageData(new Uint8ClampedArray(result.rgba), small.w, small.h), 0, 0);
    g.lineCap = g.lineJoin = 'round';
    for (const m of marks) {
      g.strokeStyle = g.fillStyle = m.kind === 'keep' ? 'rgba(46,158,102,.75)' : 'rgba(253,231,24,.8)';
      g.lineWidth = m.radius * 2;
      g.beginPath();
      m.points.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      if (m.points.length === 1) { g.beginPath(); g.arc(m.points[0][0], m.points[0][1], m.radius, 0, Math.PI * 2); g.fill(); } else g.stroke();
    }
  }, [small, result, marks]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] | null => {
    const c = view.current;
    if (!c || !small) return null;
    const r = c.getBoundingClientRect();
    return toPicturePoint(e.clientX - r.left, e.clientY - r.top, r.width, r.height, small.w, small.h);
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = point(e);
    if (!p || !small) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    stroke.current = { kind: brush, points: [p], radius: brushRadius(small.w, small.h, size) };
    setMarks((m) => [...m, stroke.current as Mark]);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = stroke.current, p = point(e);
    if (!s || !p) return;
    const next = { ...s, points: [...s.points, p] };
    stroke.current = next;
    setMarks((m) => [...m.slice(0, -1), next]);
  };
  const up = () => { stroke.current = null; };

  const apply = async () => {
    if (!src || !small) return;
    setBusy(true);
    try {
      // The marks were drawn on the preview; the final cut is made on the full picture.
      const up = (m: Mark): Mark => ({ ...m, radius: m.radius / small.k, points: m.points.map((p) => [p[0] / small.k, p[1] / small.k] as [number, number]) });
      const full = removeBackgroundByMarks(src.data, src.w, src.h, tolerance, marks.map(up));
      await onApply(full.rgba, src.w, src.h, packMarks(marks.map(up), src.w, src.h, tolerance));
    } finally { setBusy(false); }
  };

  const pct = result && small ? Math.round((result.count / (small.w * small.h)) * 100) : 0;
  return (
    <Dialog title="배경 제거" wide onClose={onClose} onOk={() => void apply()} okLabel={busy ? '처리 중…' : '변경 내용 유지'} okDisabled={busy || !small}>
      {src === undefined && <p>그림을 불러오는 중…</p>}
      {src === null && <p>그림을 읽지 못했습니다.</p>}
      {small && <>
        <div className="bgr-tools" role="group" aria-label="표시 도구">
          {(['keep', 'remove'] as const).map((k) => (
            <button key={k} type="button" className={`bgr-btn ${k} ${brush === k ? 'on' : ''}`} aria-pressed={brush === k} onClick={() => setBrush(k)}>
              <span className="bgr-dot" />{BG_MARK_LABEL[k]}
            </button>
          ))}
          <button type="button" className="bgr-btn" disabled={!marks.length} onClick={() => setMarks((m) => m.slice(0, -1))}>실행 취소</button>
          <button type="button" className="bgr-btn" disabled={!marks.length} onClick={() => { setMarks([]); setRestored(0); }}>모든 표시 삭제</button>
        </div>
        <div className="bgr-stage" style={{ background: CHECKER, aspectRatio: `${small.w} / ${small.h}` }}>
          <canvas ref={view} className="bgr-canvas" aria-label="배경 제거 미리 보기" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        </div>
        <label className="bgr-row"><span>허용 오차 {tolerance}%</span><input type="range" min={0} max={100} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} /></label>
        <label className="bgr-row"><span>브러시 크기 {size}</span><input type="range" min={2} max={40} value={size} onChange={(e) => setSize(Number(e.target.value))} /></label>
        {restored > 0 && <p className="bgr-restored" role="status">지난번에 표시한 {restored}개를 불러왔습니다. 그대로 두거나 고치고 지울 수 있습니다.</p>}
        <p className="bgr-help">{marks.length ? '표시를 더하거나 허용 오차를 조절해 결과를 다듬으세요.' : '가장자리에서 이어진 배경이 먼저 제거됩니다. 남길 부분은 초록, 지울 부분은 노랑으로 칠하세요.'} 제거된 영역 {pct}%</p>
      </>}
    </Dialog>
  );
}
