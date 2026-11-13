// Laser pointer driven from a phone remote: the relay lets only the phone that holds the controls send it, rate-limits it,
// passes it to the computer (not to audience viewers directly), and shows the presenter's dot on phones' previews.
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
// @ts-expect-error plain ESM server module
import { attachRelay } from '../server/relay.mjs';
import { isRemoteLaser, laserPointClamped, parseLaserMessage } from '../src/domain/laserPointer';

type Packet = Record<string, unknown>;
async function fixture() {
  const server = http.createServer(), relay = attachRelay(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  const sockets: WebSocket[] = [];
  async function connect(role: string, token = '') {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/freecast-ws`);
    sockets.push(ws);
    const packets: Packet[] = [];
    ws.on('message', (raw) => packets.push(JSON.parse(String(raw))));
    await once(ws, 'open');
    const send = (packet: unknown) => ws.send(JSON.stringify(packet));
    const flush = async () => {
      const pong = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Missing pong')), 2000);
        const receive = (raw: WebSocket.RawData) => { if (JSON.parse(String(raw)).type === 'pong') { clearTimeout(timeout); ws.off('message', receive); resolve(); } };
        ws.on('message', receive);
      });
      send({ type: 'ping' }); await pong;
    };
    send({ type: 'hello', role, clientToken: token }); await flush();
    return { send, flush, lasers: () => packets.filter((p) => p.type === 'laser') };
  }
  return { connect, async close() { sockets.forEach((s) => s.terminate()); for (const s of relay.clients) s.terminate(); await new Promise<void>((r) => relay.close(r)); await new Promise<void>((r) => server.close(() => r())); } };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('phone laser over the relay', () => {
  it('goes from the controlling phone to the computer only, marked as from a remote', async () => {
    const f = await fixture();
    try {
      const host = await f.connect('host');
      const viewer = await f.connect('viewer');
      const phone = await f.connect('remote', 'private-token-for-phone-A');
      phone.send({ type: 'laser', x: 0.25, y: 0.75 });
      await phone.flush(); await host.flush();
      expect(host.lasers()).toEqual([{ type: 'laser', x: 0.25, y: 0.75, remote: true }]);
      expect(viewer.lasers()).toEqual([]); // the computer re-sends it as its own dot
      phone.send({ type: 'laser', off: true });
      await phone.flush(); await host.flush();
      expect(host.lasers().at(-1)).toEqual({ type: 'laser', off: true, remote: true });
    } finally { await f.close(); }
  });

  it('ignores a phone without the controls, and malformed or out-of-range dots', async () => {
    const f = await fixture();
    try {
      const host = await f.connect('host');
      const first = await f.connect('remote', 'private-token-for-phone-A'); // takes the controls
      const second = await f.connect('remote', 'private-token-for-phone-B');
      second.send({ type: 'laser', x: 0.5, y: 0.5 });
      await second.flush();
      first.send({ type: 'laser', x: 2, y: 0.5 });
      first.send({ type: 'laser', x: 'a', y: 0.5 });
      first.send({ type: 'laser', x: Number.NaN, y: 0.5 });
      first.send({ type: 'laser', off: true }); // nothing was on: nothing to turn off
      await first.flush(); await host.flush();
      expect(host.lasers()).toEqual([]);
    } finally { await f.close(); }
  });

  it('rate-limits a flood of dots from one phone', async () => {
    const f = await fixture();
    try {
      const host = await f.connect('host');
      const phone = await f.connect('remote', 'private-token-for-phone-A');
      for (let i = 0; i < 100; i++) phone.send({ type: 'laser', x: i / 100, y: 0.5 });
      await phone.flush(); await host.flush();
      const n = host.lasers().length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThan(20);
      await sleep(40);
      phone.send({ type: 'laser', x: 0.9, y: 0.5 });
      await phone.flush(); await host.flush();
      expect(host.lasers().length).toBe(n + 1);
    } finally { await f.close(); }
  });

  it("shows the presenter's dot to audience viewers and on phones' previews; a viewer cannot send one", async () => {
    const f = await fixture();
    try {
      const host = await f.connect('host');
      const viewer = await f.connect('viewer');
      const phone = await f.connect('remote', 'private-token-for-phone-A');
      host.send({ type: 'laser', x: 0.1, y: 0.2 });
      await host.flush(); await phone.flush(); await viewer.flush();
      expect(viewer.lasers()).toEqual([{ type: 'laser', x: 0.1, y: 0.2 }]);
      expect(phone.lasers()).toEqual([{ type: 'laser', x: 0.1, y: 0.2 }]);
      viewer.send({ type: 'laser', x: 0.5, y: 0.5 });
      await viewer.flush(); await host.flush();
      expect(host.lasers()).toEqual([]);
    } finally { await f.close(); }
  });
});

describe('laser message helpers', () => {
  it('keeps a dragging finger inside the slide', () => {
    const r = { left: 10, top: 20, width: 200, height: 100 };
    expect(laserPointClamped(r, 110, 70)).toEqual({ x: 0.5, y: 0.5 });
    expect(laserPointClamped(r, -50, 500)).toEqual({ x: 0, y: 1 });
    expect(laserPointClamped({ ...r, width: 0 }, 5, 5)).toBeNull();
  });
  it('recognises a dot that came from a phone and still parses it as a laser message', () => {
    const m = { type: 'laser', x: 0.3, y: 0.4, remote: true };
    expect(isRemoteLaser(m)).toBe(true);
    expect(isRemoteLaser({ type: 'laser', x: 0.3, y: 0.4 })).toBe(false);
    expect(isRemoteLaser(null)).toBe(false);
    expect(parseLaserMessage(m)).toEqual({ type: 'laser', x: 0.3, y: 0.4 });
  });
});
