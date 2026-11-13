// Insert › Audio › Record Audio (오디오 녹음) and Insert › Screenshot (화면 캡처).
import { useEffect, useRef, useState } from 'react';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import {
  canCaptureScreen, canRecordAudio, captureErrorMessage, formatClock, pickRecorderMime, recordedAudioElement, recordingFileName,
  screenshotElement, screenshotFileName, unsupportedMessage,
} from '../../domain/captureMedia';
import { Dialog, Field } from './dialogs';
import type { Ed } from './editor';

const ERR_STYLE = { color: '#a4262c', margin: 0 } as const;
const HINT_STYLE = { color: '#605e5c', margin: 0 } as const;

export function RecordAudioDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const supported = canRecordAudio({ mediaDevices: navigator.mediaDevices, MediaRecorder: (globalThis as { MediaRecorder?: unknown }).MediaRecorder });
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [secs, setSecs] = useState(0);
  const [clip, setClip] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef(0);
  const stopStream = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; window.clearInterval(timer.current); };
  useEffect(() => () => {
    stopStream();
    const r = rec.current;
    if (r && r.state !== 'inactive') { r.ondataavailable = null; r.onstop = null; r.stop(); }
  }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const start = async () => {
    setError('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
      const r = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        stopStream();
        const blob = new Blob(chunks, { type: r.mimeType || mime || 'audio/webm' });
        if (!blob.size) { setError('녹음된 소리가 없습니다. 다시 녹음하세요.'); setState('idle'); return; }
        setClip(blob);
        setUrl(URL.createObjectURL(blob));
        setState('done');
      };
      r.onerror = () => { setError('녹음 중 오류가 발생했습니다.'); stopStream(); setState('idle'); };
      rec.current = r;
      setSecs(0);
      r.start();
      setState('recording');
      const t0 = Date.now();
      timer.current = window.setInterval(() => setSecs((Date.now() - t0) / 1000), 250);
    } catch (e) {
      stopStream();
      setError(captureErrorMessage(e, 'microphone'));
    }
  };
  const stop = () => { if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); };
  const again = () => { setClip(null); setUrl(''); setState('idle'); setSecs(0); };
  const insert = async () => {
    if (!clip) return;
    const file = recordingFileName(name, clip.type, new Date());
    const id = uid('m');
    await putMedia(id, clip);
    ed.dispatch({ type: 'media/add', media: { id, name: file, type: 'audio' } });
    ed.addElement(recordedAudioElement(uid('el'), id, file));
    onClose();
  };
  return (
    <Dialog title="오디오 녹음" onClose={onClose} onOk={() => void insert()} okLabel="삽입" okDisabled={state !== 'done'}>
      {!supported ? <p style={ERR_STYLE}>{unsupportedMessage('microphone')}</p> : (
        <>
          <Field label="이름"><input type="text" value={name} placeholder="녹음" disabled={state === 'recording'} onChange={(e) => setName(e.target.value)} /></Field>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {state === 'idle' && <button type="button" className="primary" onClick={() => void start()}>● 녹음</button>}
            {state === 'recording' && <button type="button" className="primary" onClick={stop}>■ 중지</button>}
            {state === 'done' && <button type="button" onClick={again}>다시 녹음</button>}
            <span aria-live="polite" style={{ fontVariantNumeric: 'tabular-nums' }}>{state === 'recording' ? `● 녹음 중 ${formatClock(secs)}` : state === 'done' ? `길이 ${formatClock(secs)}` : '0:00'}</span>
          </div>
          {state === 'done' && url && <audio controls src={url} style={{ width: '100%' }} aria-label="녹음 미리 듣기" />}
          {state === 'idle' && !error && <p style={HINT_STYLE}>녹음 버튼을 누르면 마이크 사용 권한을 묻습니다.</p>}
          {error && <p role="alert" style={ERR_STYLE}>{error}</p>}
        </>
      )}
    </Dialog>
  );
}

/** Grab one frame of the chosen screen or window. */
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

export function ScreenCaptureDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const supported = canCaptureScreen({ mediaDevices: navigator.mediaDevices });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setError(''); setBusy(true);
    try {
      const blob = await grabFrame();
      const bmp = await createImageBitmap(blob);
      const size = { w: bmp.width, h: bmp.height }; bmp.close();
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
  return (
    <Dialog title="화면 캡처" onClose={onClose} onOk={() => void go()} okLabel={busy ? '캡처 중…' : '캡처'} okDisabled={!supported || busy}>
      {!supported ? <p style={ERR_STYLE}>{unsupportedMessage('screen')}</p> : <p style={HINT_STYLE}>캡처할 화면이나 창을 고르면 현재 슬라이드에 그림으로 삽입합니다.</p>}
      {error && <p role="alert" style={ERR_STYLE}>{error}</p>}
    </Dialog>
  );
}
