// Insert › Audio › Record Audio (오디오 녹음) and Insert › Screenshot (화면 캡처).
import { useEffect, useRef, useState } from 'react';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import {
  canRecordAudio, captureErrorMessage, formatClock, pickRecorderMime, recordedAudioElement, recordingFileName, unsupportedMessage,
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

// Insert › Screenshot has its own file: source picker and crop.
export { ScreenCaptureDialog } from './screenCaptureDialog';
