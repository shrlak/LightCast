import { execFile } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createSeedLibrary } from '../src/domain/defaults';
import type { Library, Presentation } from '../src/domain/types';

const deck = (id: string, folder: string, media: string[]): Presentation => ({ id, title: id, folder, themeId: 'theme_classic', slides: [{ id: id + 's', group: 'x', text: '', elements: media.map((mediaId) => ({ id: mediaId + id, type: 'image', mediaId, x: 0, y: 0, w: 1, h: 1 })) }] } as never);

describe('scripts/cloud-cleanup.mjs against a fake church server', () => {
  it('removes a finished service and its own files, keeps the songs, and writes the library back', async () => {
    const lib: Library = { ...createSeedLibrary(),
      presentations: [deck('sermon', '1018 주일예배', ['only']), deck('song', 'Songs', ['kept'])],
      media: ['only', 'kept'].map((id) => ({ id, name: id, type: 'image' })),
      playlists: [{ id: 'svc', name: '1018 주일예배', items: [{ id: 'i', presentationId: 'sermon' }] }, { id: 'songs', name: '찬양 목록', items: [{ id: 's', presentationId: 'song' }] }],
    };
    let saved: Library | null = null; const deleted: string[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        const send = (status: number, json: unknown = {}) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
        if (req.url === '/freecast/login') return send(200, { token: 't', username: 'u' });
        if (req.url === '/freecast/library' && req.method === 'GET') return send(200, { version: 3, data: lib });
        if (req.url === '/freecast/library' && req.method === 'PUT') { saved = JSON.parse(body).data; return send(200, { version: 4 }); }
        if (req.url?.startsWith('/freecast/media/') && req.method === 'DELETE') { deleted.push(decodeURIComponent(req.url.split('/').pop()!)); return send(200); }
        return send(200);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const out = await new Promise<string>((resolve, reject) => execFile('node', ['scripts/cloud-cleanup.mjs'], {
        env: { ...process.env, TZ: 'Asia/Seoul', FREECAST_CLOUD_URL: url, LIGHTCAST_CLOUD_USER: 'u', LIGHTCAST_CLOUD_PASSWORD: 'p' },
      }, (err, stdout, stderr) => (err ? reject(new Error(stderr || String(err))) : resolve(stdout))));
      expect(out).toContain('Removed 1 service(s), 1 deck(s), 1 file(s).');
      const ids = saved!.presentations.map((p) => p.id);
      expect(ids).toContain('song');
      expect(ids).not.toContain('sermon');
      expect(saved!.playlists.map((p) => p.name)).toContain('찬양 목록');
      expect(saved!.playlists.map((p) => p.name)).not.toContain('1018 주일예배');
      expect(deleted).toEqual(['only']);
    } finally { server.close(); }
  }, 60_000);
});
