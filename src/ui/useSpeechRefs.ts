import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechResultLike { isFinal: boolean; 0: { transcript: string } }
interface SpeechEventLike { resultIndex: number; results: ArrayLike<SpeechResultLike> }
interface RecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: SpeechEventLike) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

const ctor = (): RecognitionCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** True when this browser can recognise speech at all (the desktop app's Electron usually cannot). */
export const speechSupported = (): boolean => typeof window !== 'undefined' && ctor() !== null;

const MESSAGES: Record<string, string> = {
  'not-allowed': '마이크 사용이 막혀 있습니다. 브라우저 설정에서 마이크를 허용해 주세요.',
  'service-not-allowed': '이 브라우저에서는 음성 인식을 쓸 수 없습니다.',
  network: '음성 인식 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.',
  'audio-capture': '마이크를 찾을 수 없습니다.',
};

/**
 * Listens through the browser's speech recognition (Korean) and keeps the most recent words.
 * It restarts by itself when the browser stops it (they stop after a pause), until stop() is called.
 * `onText` gets the recent transcript every time words arrive, final or not.
 */
export function useSpeechRefs(onText: (recent: string, final: boolean) => void, lang = 'ko-KR', onPiece?: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interim, setInterim] = useState('');
  const wanted = useRef(false);
  const recognition = useRef<RecognitionLike | null>(null);
  const handler = useRef(onText);
  handler.current = onText;
  const pieceHandler = useRef(onPiece);
  pieceHandler.current = onPiece;
  const history = useRef('');
  const supported = ctor() !== null;

  const begin = useCallback(() => {
    const Recognition = ctor();
    if (!Recognition || !wanted.current) return;
    const r = new Recognition();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript;
        pieceHandler.current?.(piece, e.results[i].isFinal);
        if (e.results[i].isFinal) {
          history.current = `${history.current} ${piece}`.slice(-400);
          live = '';
          handler.current(history.current, true);
        } else live += piece;
      }
      setInterim(live);
      if (live) handler.current(`${history.current} ${live}`, false);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(MESSAGES[e.error] ?? `음성 인식 오류: ${e.error}`);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') { wanted.current = false; setListening(false); }
    };
    r.onend = () => { if (wanted.current) setTimeout(begin, 250); else setListening(false); };
    recognition.current = r;
    try { r.start(); } catch { /* already started */ }
  }, [lang]);

  const start = useCallback(() => {
    if (!ctor()) { setError('이 브라우저는 음성 인식을 지원하지 않습니다. iPad는 Safari, 안드로이드 태블릿은 Chrome을 쓰세요.'); return; }
    setError(null);
    wanted.current = true;
    setListening(true);
    begin();
  }, [begin]);

  const stop = useCallback(() => {
    wanted.current = false;
    setListening(false);
    setInterim('');
    recognition.current?.stop();
  }, []);

  useEffect(() => () => { wanted.current = false; recognition.current?.abort(); }, []);
  return { supported, listening, error, interim, start, stop, clear: () => { history.current = ''; setInterim(''); } };
}
