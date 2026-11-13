import { useCallback, useEffect, useRef, useState } from 'react';
import { speechErrorMessage } from '../domain/speech/settings';
import { speechAvailable, speechService, useCloudInfo, useSpeechSettings, useSpeechStatus } from './speechService';

/** True when some speech recognizer (browser or cloud) can run here. */
export const speechSupported = (): boolean => speechAvailable();

/**
 * Listens through the app-wide speech service (see speechService.ts): one microphone and one recognizer shared by
 * captions, the Bible listener, PastorStage and FollowDock. start()/stop() subscribe/unsubscribe this component.
 * `onText` gets the recent transcript every time words arrive, final or not; `onPiece` gets each raw piece.
 * (The language comes from the 자막 설정 card, not from the caller.)
 */
export function useSpeechRefs(onText: (recent: string, final: boolean) => void, _lang?: string, onPiece?: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  // Errors are shown only to a component that asked to listen (not one left over from another screen).
  const [asked, setAsked] = useState(false);
  const handler = useRef(onText);
  handler.current = onText;
  const pieceHandler = useRef(onPiece);
  pieceHandler.current = onPiece;
  const history = useRef('');
  const unsub = useRef<(() => void) | null>(null);
  const status = useSpeechStatus();
  useSpeechSettings();
  useCloudInfo();
  const supported = speechAvailable();

  const release = useCallback(() => {
    unsub.current?.();
    unsub.current = null;
    setListening(false);
    setInterim('');
  }, []);
  const stop = useCallback(() => { release(); setAsked(false); }, [release]);

  const start = useCallback(() => {
    if (unsub.current) return;
    setListening(true);
    setAsked(true);
    unsub.current = speechService.subscribe({
      onPiece: (piece, final) => {
        pieceHandler.current?.(piece, final);
        if (final) {
          history.current = `${history.current} ${piece}`.slice(-400);
          setInterim('');
          handler.current(history.current, true);
        } else {
          setInterim(piece);
          handler.current(`${history.current} ${piece}`, false);
        }
      },
    });
  }, []);

  useEffect(() => () => { unsub.current?.(); unsub.current = null; }, []);
  // A fatal error ends listening for this component, as the old recognizer did.
  const fatal = status.state === 'error' && !!status.error && !status.error.retryable;
  useEffect(() => { if (fatal && unsub.current) release(); }, [fatal, release]);
  const error = asked && status.state === 'error' && status.error ? speechErrorMessage(status.error) : null;
  return { supported, listening, error, interim, start, stop, clear: () => { history.current = ''; setInterim(''); } };
}
