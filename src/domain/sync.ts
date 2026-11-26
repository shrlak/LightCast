import type { LiveState } from './types';

export type LiveMessage =
  /** `seq` counts the console's changes (in its run `epoch`): a copy that arrives after a newer one is ignored. */
  | { type: 'state'; state: LiveState; seq?: number; epoch?: string }
  | { type: 'hello' }
  /** A key pressed on a fullscreen output window — the console handles it as if pressed there. */
  | { type: 'key'; key: string; shiftKey: boolean }
  /** An object with an action (Action Settings, slide zoom) was clicked on an output window. */
  | { type: 'show'; action: import('./showActions').ShowAction }
  /** A slide show screen command from an audience window (검정/흰색 화면, ink, 확대). */
  | { type: 'screen'; action: import('./showScreen').ScreenAction }
  /** Laser pointer position on the presenter's slide (0–1), or off. */
  | import('./laserPointer').LaserMessage
  /** Live caption text for the audience view. */
  | import('./captions').CaptionMessage
  /** The presenter's sermon timer, for stage displays on this computer (and, via the relay, phones). */
  | import('./pacing').TimerMessage;

const CHANNEL = 'freecast-live';

/** Same-origin channel linking the operator console with output and stage windows. */
export function openLiveChannel(onMessage: (m: LiveMessage) => void) {
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent<LiveMessage>) => onMessage(e.data);
  return {
    post: (m: LiveMessage) => ch.postMessage(m),
    close: () => ch.close(),
  };
}

/** Which of the live states that arrive (by two ways, local channel and network relay) to show: never an older one after a newer one. */
export function liveOrder() {
  let epoch: string | undefined;
  let seq = -1;
  return (m: { seq?: unknown; epoch?: unknown }): boolean => {
    if (typeof m.seq !== 'number' || typeof m.epoch !== 'string') return true;
    if (m.epoch !== epoch) { epoch = m.epoch; seq = m.seq; return true; }
    if (m.seq <= seq) return false;
    seq = m.seq;
    return true;
  };
}
