import type { ShowAction } from '../domain/showActions';
import { connectionQuality } from '../domain/connectionQuality';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LiveState } from '../domain/types';
import { mediaUrl, peekMediaUrl } from '../domain/media';
import { openLiveChannel } from '../domain/sync';
import { loadLive, saveLive } from '../domain/persistence';
import { laserDue, parseLaserMessage } from '../domain/laserPointer';

/**
 * Object URL for a stored picture/video. When the id changes (the next slide has another background)
 * the previous URL stays until the new one is ready, so the screen never flashes empty between slides.
 */
export function useMediaUrl(id: string | null | undefined): string | null {
  const [, refresh] = useState(0);
  const shown = useRef<string | null>(null);
  const known = id ? peekMediaUrl(id) : null;
  if (!id) shown.current = null;
  else if (known) shown.current = known;
  useEffect(() => {
    if (!id || known) return;
    let alive = true;
    mediaUrl(id).then((u) => {
      if (!alive) return;
      shown.current = u;
      refresh((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [id, known]);
  return id ? shown.current : null;
}

const decoded = new Set<string>();
export const isDecoded = (url: string) => decoded.has(url);

/** Load and decode a picture ahead of showing it. Never rejects. */
export function preloadImage(url: string): Promise<void> {
  if (decoded.has(url)) return Promise.resolve();
  const img = new Image();
  img.src = url;
  const done = () => void decoded.add(url);
  return img.decode().then(done, done);
}

/**
 * The URL once the browser has decoded the picture. A new picture loads off-screen first and the
 * previous one stays up meanwhile, so swapping backgrounds never shows an empty frame.
 */
export function useReadyImage(url: string | null): string | null {
  const [, refresh] = useState(0);
  const shown = useRef<string | null>(null);
  if (!url) shown.current = null;
  else if (decoded.has(url)) shown.current = url;
  useEffect(() => {
    if (!url || decoded.has(url)) return;
    let alive = true;
    const img = new Image();
    img.src = url;
    const done = () => {
      decoded.add(url);
      if (!alive) return;
      shown.current = url;
      refresh((n) => n + 1);
    };
    img.decode().then(done, done);
    return () => {
      alive = false;
    };
  }, [url]);
  return url ? shown.current : null;
}

export function relayUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/${document.body?.dataset.view === 'team' ? 'freecast-team-ws' : 'freecast-ws'}`;
}

/**
 * A WebSocket to the LightCast relay that reconnects on its own.
 * Returns a send function; `onMessage` receives parsed JSON.
 * `address` connects to another computer's relay instead of this one's (a standby watching the main computer).
 */
export function useRelay(hello: Record<string, unknown> | null, onMessage: (m: Record<string, unknown>) => void, address?: string) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const socket = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'offline'>('connecting');
  const [quality, setQuality] = useState(() => connectionQuality([], false, Date.now()));
  const helloKey = JSON.stringify(hello);
  useEffect(() => {
    if (!hello) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    let heartbeat: ReturnType<typeof setInterval>;
    let deadline: ReturnType<typeof setTimeout>;
    let attempted = false;
    let failures = 0;
    const connect = () => {
      if (closed) return;
      clearTimeout(retry);
      if (!navigator.onLine) { setConnected(false); setStatus('offline'); return; }
      setConnected(false);
      setStatus(navigator.onLine ? (attempted ? 'reconnecting' : 'connecting') : 'offline');
      attempted = true;
      const ws = new WebSocket(address ?? relayUrl());
      let lastReply = Date.now(), serial = 0;
      let probe: { id: number; start: number } | null = null;
      let samples: (number | null)[] = [];
      const measure = (sample: number | null) => {
        samples = [...samples, sample].slice(-8);
        const value = connectionQuality(samples, true, Date.now()); setQuality(value);
        if (['remote', 'team'].includes(String(hello.role)) && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'connection-quality', quality: value }));
      };
      const ping = () => {
        if (probe) measure(null);
        probe = { id: ++serial, start: performance.now() };
        ws.send(JSON.stringify({ type: 'ping', id: probe.id }));
      };
      const resume = () => {
        if (closed || document.hidden || !navigator.onLine || socket.current !== ws) return;
        if (ws.readyState === WebSocket.CLOSED) { clearTimeout(retry); connect(); return; }
        if (ws.readyState !== WebSocket.OPEN) return;
        // Mobile browsers can suspend a tab while keeping a dead WebSocket marked OPEN.
        // Replace that socket immediately on return rather than waiting for a 30-second timeout.
        if (Date.now() - lastReply > 12000) { ws.close(); return; }
        samples = []; probe = null; setQuality(connectionQuality([], true, Date.now())); ping();
      };
      document.addEventListener('visibilitychange', resume);
      setQuality(connectionQuality([], false, Date.now()));
      deadline = setTimeout(() => ws.close(), 8000);
      socket.current = ws;
      ws.onopen = () => {
        if (closed || socket.current !== ws) return;
        ws.send(helloKey);
      };
      ws.onmessage = (e) => {
        if (closed || socket.current !== ws) return;
        try {
          const message = JSON.parse(String(e.data));
          lastReply = Date.now();
          if (message.type === 'welcome') {
            clearTimeout(deadline); failures = 0; setConnected(true); setStatus('connected');
            setQuality(connectionQuality([], true, Date.now())); ping();
            clearInterval(heartbeat);
            heartbeat = setInterval(() => { if (document.hidden) return; if (Date.now() - lastReply > 16000) ws.close(); else if (ws.readyState === WebSocket.OPEN) ping(); }, 4000);
          }
          if (message.type === 'pong' && probe && (message.id == null || message.id === probe.id)) { measure(performance.now() - probe.start); probe = null; }
          if (message.type !== 'pong') handler.current(message);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        document.removeEventListener('visibilitychange', resume);
        clearTimeout(deadline); clearInterval(heartbeat);
        if (closed || socket.current !== ws) return;
        socket.current = null;
        setConnected(false);
        setQuality(connectionQuality([], false, Date.now()));
        setStatus(navigator.onLine ? 'reconnecting' : 'offline');
        // Retry quickly on a brief drop, then back off to avoid busy-looping on a prolonged outage.
        if (navigator.onLine) retry = setTimeout(connect, Math.min(4000, 500 * 2 ** Math.min(failures++, 3)));
      };
    };
    const offline = () => { setConnected(false); setStatus('offline'); setQuality(connectionQuality([], false, Date.now())); socket.current?.close(); };
    const online = () => {
      if (closed) return;
      // Network switching (Wi-Fi / mobile data) may leave the old socket in a stale state.
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.close();
      else if (!socket.current || socket.current.readyState === WebSocket.CLOSED) { clearTimeout(retry); connect(); }
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    connect();
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      closed = true;
      clearTimeout(retry); clearTimeout(deadline); clearInterval(heartbeat);
      socket.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helloKey, address]);
  const send = (m: unknown) => {
    if (navigator.onLine && socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(m));
  };
  return { send, connected, status, quality };
}

/** Operator side: publish live state to output/stage windows (same computer) and the relay (other devices). */
export function useLiveBroadcast(live: LiveState, relaySend: (m: unknown) => void, onShowAction?: (a: ShowAction) => void) {
  const latest = useRef(live);
  const onShow = useRef(onShowAction);
  onShow.current = onShowAction;
  const channel = useRef<ReturnType<typeof openLiveChannel> | null>(null);
  const relayRef = useRef(relaySend);
  relayRef.current = relaySend;
  const laserSentAt = useRef(0);
  useEffect(() => {
    channel.current = openLiveChannel((m) => {
      // The presenter's laser dot also goes to audience devices on the relay (a few dozen a second at most).
      if (m.type === 'laser') {
        const msg = parseLaserMessage(m);
        const on = msg && !('off' in msg);
        if (msg && laserDue(laserSentAt.current, Date.now(), on ? { x: 0, y: 0 } : null)) { laserSentAt.current = Date.now(); relayRef.current(msg); }
      }
      if (m.type === 'hello') channel.current?.post({ type: 'state', state: latest.current });
      // A slide show covering this very screen still answers to the arrow keys, Space and Esc.
      if (m.type === 'key') window.dispatchEvent(new KeyboardEvent('keydown', { key: m.key, shiftKey: m.shiftKey, cancelable: true }));
      if (m.type === 'show') onShow.current?.(m.action);
    });
    return () => channel.current?.close();
  }, []);
  useEffect(() => {
    latest.current = live;
    saveLive(live);
    channel.current?.post({ type: 'state', state: live });
    relaySend({ type: 'state', state: live });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);
}

/** Output side: receive live state locally (BroadcastChannel) or over the network (relay). */
export function useLiveFeed(): LiveState | null {
  const [live, setLive] = useState<LiveState | null>(() => loadLive());
  // The computer sends every change twice (same-computer channel and network relay): the repeat is ignored.
  const lastJson = useRef('');
  const apply = (state: LiveState) => {
    const json = JSON.stringify(state);
    if (json === lastJson.current) return;
    lastJson.current = json;
    setLive(state);
  };
  useEffect(() => {
    const ch = openLiveChannel((m) => m.type === 'state' && apply(m.state));
    ch.post({ type: 'hello' });
    return () => ch.close();
  }, []);
  useRelay({ type: 'hello', role: 'viewer' }, (m) => {
    if (m.type === 'state' && m.state) apply(m.state as LiveState);
    // The presenter's laser dot, for the audience view to draw (see useLaserDot).
    if (m.type === 'laser') window.dispatchEvent(new CustomEvent('lightcast:laser', { detail: m }));
  });
  return live;
}

export function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Width of an element, tracked with ResizeObserver. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Saves `value` a moment after it stops changing, and right away when the editor closes (unmounts)
 * with a save still pending — edits never need a 저장 button. The value it starts with is not saved.
 * Returns `flush`, to save a pending change now.
 */
export function useAutosave<T>(value: T, save: (v: T) => void, { delay = 700, enabled = true } = {}): () => void {
  const key = JSON.stringify(value);
  const saved = useRef(key);
  const pending = useRef<{ v: T; key: string } | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const flush = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    if (!p || p.key === saved.current) return;
    saved.current = p.key;
    saveRef.current(p.v);
  }, []);
  useEffect(() => {
    if (!enabled || key === saved.current) return;
    pending.current = { v: value, key };
    const t = setTimeout(flush, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, delay, flush]);
  useEffect(() => flush, [flush]);
  return flush;
}
