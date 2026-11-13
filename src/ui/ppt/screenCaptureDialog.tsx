// Insert › Screenshot (화면 캡처): pick a screen or window (with thumbnails in the desktop app, the browser's own
// picker otherwise), then optionally crop the captured frame before it goes on the slide.
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { canCaptureScreen, captureErrorMessage, screenshotElement, screenshotFileName, unsupportedMessage } from '../../domain/captureMedia';
import {
  SOURCE_KIND_LABEL, cropFromDrag, cropSizeLabel, cropToShown, filterSources, isWholePicture, keepSelection, normalizeSources,
  type CaptureSource, type CropRect, type Pt, type SourceFilter,
} from '../../domain/captureSources';
import { desktop } from '../../domain/desktop';
import { Dialog } from './dialogs';
import type { Ed } from './editor';

const ERR_STYLE = { color: '#a4262c', margin: 0 } as const;
const HINT_STYLE = { color: '#605e5c', margin: 0 } as const;

/** Grab one frame of what getDisplayMedia was given (the desktop app answers with the source chosen before). */
async function grabFrame(): Promise<Blob> {
  const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video');
    video.srcObject = s;
    video.muted = true;
    await video.play();
    // The first frame can be blank right after the picker closes.
    await new Promise((r) => setTimeout(r, 300));
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    if (!c.width || !c.height) throw new Error('캡처한 화면이 비어 있습니다.');
    c.getContext('2d')!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (!blob) throw new Error('그림으로 저장하지 못했습니다.');
    return blob;
  } finally {
    s.getTracks().forEach((t) => t.stop());
  }
}

async function cropBlob(src: Blob, r: CropRect): Promise<Blob> {
  const bmp = await createImageBitmap(src);
  try {
    const c = document.createElement('canvas');
    c.width = r.w; c.height = r.h;
    c.getContext('2d')!.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const out = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (!out) throw new Error('그림으로 저장하지 못했습니다.');
    return out;
  } finally { bmp.close(); }
}

/** The captured frame with a rectangle to drag; no rectangle means the whole picture. */
function CropStep({ url, natural, crop, onCrop }: { url: string; natural: { w: number; h: number }; crop: CropRect | null; onCrop: (r: CropRect | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<Pt | null>(null);
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null);
  const local = (e: PointerEvent): { p: Pt; shown: { w: number; h: number } } | null => {
    const r = box.current?.getBoundingClientRect();
    return r?.width ? { p: { x: e.clientX - r.left, y: e.clientY - r.top }, shown: { w: r.width, h: r.height } } : null;
  };
  const down = (e: PointerEvent) => {
    const l = local(e);
    if (!l) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = l.p;
    setDrag({ a: l.p, b: l.p });
  };
  const move = (e: PointerEvent) => {
    const l = local(e);
    if (start.current && l) setDrag({ a: start.current, b: l.p });
  };
  const up = (e: PointerEvent) => {
    const l = local(e);
    if (start.current && l) onCrop(cropFromDrag(start.current, l.p, l.shown, natural));
    start.current = null; setDrag(null);
  };
  const r = box.current?.getBoundingClientRect();
  const shown = r?.width ? { w: r.width, h: r.height } : { w: 1, h: 1 };
  const live: CropRect | null = drag
    ? { x: Math.min(drag.a.x, drag.b.x), y: Math.min(drag.a.y, drag.b.y), w: Math.abs(drag.a.x - drag.b.x), h: Math.abs(drag.a.y - drag.b.y) }
    : crop ? cropToShown(crop, shown, natural) : null;
  return (
    <div ref={box} className="capture-crop" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="자를 영역을 끌어서 고르세요">
      <img src={url} alt="캡처한 화면" draggable={false} />
      {live && (
        <>
          <div className="capture-crop-shade" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${live.x}px ${live.y}px, ${live.x}px ${live.y + live.h}px, ${live.x + live.w}px ${live.y + live.h}px, ${live.x + live.w}px ${live.y}px, ${live.x}px ${live.y}px)` }} />
          <div className="capture-crop-box" style={{ left: live.x, top: live.y, width: live.w, height: live.h }} />
        </>
      )}
    </div>
  );
}

export function ScreenCaptureDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const supported = canCaptureScreen({ mediaDevices: navigator.mediaDevices });
  const canList = typeof desktop?.captureSources === 'function' && typeof desktop?.selectCaptureSource === 'function';
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shot, setShot] = useState<{ blob: Blob; url: string; size: { w: number; h: number } } | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);

  const refresh = async () => {
    if (!canList) return;
    setError('');
    try {
      const list = normalizeSources((await desktop!.captureSources!()) ?? []);
      setSources(list);
      setPicked((p) => keepSelection(list, p));
    } catch (e) { setSources([]); setError(captureErrorMessage(e, 'screen')); }
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  const capture = async () => {
    setError(''); setBusy(true);
    try {
      if (canList) await desktop!.selectCaptureSource!(picked);
      const blob = await grabFrame();
      const bmp = await createImageBitmap(blob);
      const size = { w: bmp.width, h: bmp.height }; bmp.close();
      setShot({ blob, url: URL.createObjectURL(blob), size });
      setCrop(null);
    } catch (e) {
      setError(captureErrorMessage(e, 'screen'));
    } finally { setBusy(false); }
  };

  const insert = async () => {
    if (!shot) return;
    setBusy(true);
    try {
      const cut = crop && !isWholePicture(crop, shot.size) ? crop : null;
      const blob = cut ? await cropBlob(shot.blob, cut) : shot.blob;
      const size = cut ? { w: cut.w, h: cut.h } : shot.size;
      const file = screenshotFileName(new Date());
      const id = uid('m');
      await putMedia(id, blob);
      ed.dispatch({ type: 'media/add', media: { id, name: file, type: 'image' } });
      ed.addElement(screenshotElement(uid('el'), id, file, size.w, size.h));
      onClose();
    } catch (e) {
      setError(captureErrorMessage(e, 'screen'));
      setBusy(false);
    }
  };

  if (shot) {
    return (
      <Dialog title="화면 캡처 — 자르기" wide onClose={onClose} onOk={() => void insert()} okLabel={busy ? '삽입 중…' : crop ? '자른 부분 삽입' : '그대로 삽입'} okDisabled={busy}>
        <p style={HINT_STYLE}>자를 영역을 끌어서 고르세요. 자르지 않으려면 그대로 삽입하세요.</p>
        <CropStep url={shot.url} natural={shot.size} crop={crop} onCrop={setCrop} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-live="polite" style={{ fontVariantNumeric: 'tabular-nums' }}>{crop ? `선택 영역 ${cropSizeLabel(crop)}` : `전체 ${cropSizeLabel(shot.size)}`}</span>
          <button type="button" disabled={!crop} onClick={() => setCrop(null)}>선택 해제</button>
          <button type="button" disabled={busy} onClick={() => { setShot(null); setCrop(null); void refresh(); }}>다시 캡처</button>
        </div>
        {error && <p role="alert" style={ERR_STYLE}>{error}</p>}
      </Dialog>
    );
  }

  const shownSources = sources ? filterSources(sources, filter) : [];
  return (
    <Dialog title="화면 캡처" wide={canList} onClose={onClose} onOk={() => void capture()} okLabel={busy ? '캡처 중…' : canList ? '캡처' : '화면 선택…'} okDisabled={!supported || busy || (canList && !picked)}>
      {!supported ? <p style={ERR_STYLE}>{unsupportedMessage('screen')}</p> : canList ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className="seg" role="tablist" aria-label="캡처할 대상">
              {(['all', 'screen', 'window'] as const).map((f) => (
                <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? '전체' : `${SOURCE_KIND_LABEL[f]}`}</button>
              ))}
            </div>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => void refresh()}>새로 고침</button>
          </div>
          <div className="capture-sources" role="listbox" aria-label="화면과 창">
            {sources === null && <p style={HINT_STYLE}>화면과 창을 찾는 중…</p>}
            {sources && !shownSources.length && <p style={HINT_STYLE}>캡처할 수 있는 {filter === 'window' ? '창' : filter === 'screen' ? '화면' : '화면이나 창'}이 없습니다.</p>}
            {shownSources.map((s) => (
              <button key={s.id} type="button" role="option" aria-selected={picked === s.id} className={`capture-source ${picked === s.id ? 'on' : ''}`}
                onClick={() => setPicked(s.id)} onDoubleClick={() => { setPicked(s.id); void capture(); }}>
                {s.thumbnail ? <img src={s.thumbnail} alt="" draggable={false} /> : <span className="capture-nothumb">미리 보기 없음</span>}
                <span className="capture-source-name"><em>{SOURCE_KIND_LABEL[s.kind]}</em> {s.name}</span>
              </button>
            ))}
          </div>
          <p style={HINT_STYLE}>캡처한 뒤 필요한 부분만 잘라서 삽입할 수 있습니다.</p>
        </>
      ) : <p style={HINT_STYLE}>캡처할 화면이나 창을 고른 뒤, 필요한 부분만 잘라서 현재 슬라이드에 그림으로 삽입합니다.</p>}
      {error && <p role="alert" style={ERR_STYLE}>{error}</p>}
    </Dialog>
  );
}
