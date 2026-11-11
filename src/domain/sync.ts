import type { LiveState } from './types';

export type LiveMessage =
  | { type: 'state'; state: LiveState }
  | { type: 'hello' }
  /** A key pressed on a fullscreen output window — the console handles it as if pressed there. */
  | { type: 'key'; key: string; shiftKey: boolean }
  /** An object with an action (Action Settings, slide zoom) was clicked on an output window. */
  | { type: 'show'; action: import('./showActions').ShowAction };

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
