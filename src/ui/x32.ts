import { useEffect, useState } from 'react';
import type { X32Values } from '../domain/x32';

export interface X32State {
  status: 'off' | 'connecting' | 'connected' | 'lost' | 'unavailable';
  ip: string | null;
  name: string | null;
  model: string | null;
  error?: string;
  /** What the mixer reported: strip names, mutes, faders, scene names (OSC address → value). */
  values: X32Values;
}

type Event =
  | { type: 'status'; status: X32State['status']; ip: string | null; name: string | null; model: string | null }
  | { type: 'snapshot'; values: X32Values }
  | { type: 'value'; address: string; value: number | string };

/**
 * The console's view of the X32. Browsers cannot speak OSC, so the LightCast server on this computer
 * talks to the mixer and streams what it hears here (desktop app and `npm start` only).
 */
class X32Hub {
  state: X32State = { status: 'off', ip: null, name: null, model: null, values: {} };
  private listeners = new Set<(s: X32State) => void>();
  private events: EventSource | null = null;

  private patch(patch: Partial<X32State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  subscribe(fn: (s: X32State) => void) {
    this.listeners.add(fn);
    fn(this.state);
    return () => { this.listeners.delete(fn); };
  }

  listen() {
    if (this.events || typeof EventSource === 'undefined') return;
    const events = new EventSource('/api/x32/events');
    this.events = events;
    events.onmessage = (e) => {
      let msg: Event;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'status') this.patch({ status: msg.status, ip: msg.ip, name: msg.name, model: msg.model, error: undefined, ...(msg.status === 'off' ? { values: {} } : {}) });
      else if (msg.type === 'snapshot') this.patch({ values: msg.values ?? {} });
      else if (msg.type === 'value') this.patch({ values: { ...this.state.values, [msg.address]: msg.value } });
    };
    events.onerror = () => { if (events.readyState === EventSource.CLOSED) this.patch({ status: 'unavailable' }); };
  }

  private async post<T>(route: string, body?: unknown): Promise<T> {
    const res = await fetch(`/api/x32/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 || res.status === 405) throw Object.assign(new Error('X32 연결은 LightCast 데스크톱 앱에서 됩니다.'), { unavailable: true });
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data as T;
  }

  async connect(ip: string | null) {
    this.listen();
    try {
      await this.post(ip ? 'connect' : 'disconnect', { ip });
    } catch (e) {
      // No X32 link here (a browser on a plain web host), or the server could not reach that address.
      this.patch({ error: (e as Error).message, ...((e as { unavailable?: boolean }).unavailable || e instanceof TypeError ? { status: 'unavailable' as const } : {}) });
    }
  }

  scan() {
    return this.post<{ found: { ip: string; name: string | null; model: string | null }[] }>('scan').then((r) => r.found ?? []);
  }

  /** Ask the mixer for values (a strip's processing when its editor opens); answers arrive as events. */
  read(addresses: string[]) {
    if (this.state.status !== 'connected' || !addresses.length) return Promise.resolve();
    return this.post('read', { addresses }).then(() => undefined, (e: Error) => { this.patch({ error: e.message }); });
  }

  private pending: Record<string, { value: number; timer: ReturnType<typeof setTimeout> | null }> = {};
  /** For knobs and faders being dragged: sends at most every 50 ms, and always the last position. */
  setSoon(address: string, value: number) {
    const p = this.pending[address] ?? (this.pending[address] = { value, timer: null });
    p.value = value;
    if (p.timer) { this.patch({ values: { ...this.state.values, [address]: value } }); return; }
    this.set(address, value);
    p.timer = setTimeout(() => { p.timer = null; if (this.sent[address] !== p.value) this.set(address, p.value); }, 50);
  }
  private sent: Record<string, number> = {};

  /** Change a mute, fader or scene on the mixer; shown at once, then confirmed by the server. */
  set(address: string, value: number) {
    if (this.state.status !== 'connected') return Promise.resolve(false);
    this.patch({ values: { ...this.state.values, [address]: value } });
    this.sent[address] = value;
    return this.post('set', { address, value }).then(() => true, (e: Error) => { this.patch({ error: e.message }); return false; });
  }
}

export const x32 = new X32Hub();

export function useX32(): X32State {
  const [s, setS] = useState(x32.state);
  useEffect(() => { x32.listen(); return x32.subscribe(setS); }, []);
  return s;
}
