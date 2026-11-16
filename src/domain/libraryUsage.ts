// What the library data on the server is made of. The % next to the account is the church server's storage used
// (library database + shared data) against its free limit; the media files are listed apart (서버 파일), and this
// splits the rest, so the operator can see which parts are big and clear them.
import type { Library, Presentation } from './types';

export const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength;

export interface PresentationUsage { id: string; title: string; bytes: number; slides: number; protectedDeck: boolean }
export interface LibraryBreakdown {
  total: number;
  presentations: PresentationUsage[];
  presentationsBytes: number;
  trashCount: number;
  trashBytes: number;
  trashIds: string[];
  usageCount: number;
  usageBytes: number;
  activityCount: number;
  activityBytes: number;
  /** Everything else: playlists, themes, settings, devices, fonts list, media names. */
  otherBytes: number;
}

const usageOf = (p: Presentation): PresentationUsage => ({ id: p.id, title: p.title || '제목 없는 자료', bytes: jsonBytes(p), slides: p.slides.length, protectedDeck: p.protected === true });

export function libraryBreakdown(lib: Library): LibraryBreakdown {
  const presentations = lib.presentations.map(usageOf).sort((a, b) => b.bytes - a.bytes || a.title.localeCompare(b.title, 'ko'));
  const presentationsBytes = presentations.reduce((n, p) => n + p.bytes, 0);
  const trash = lib.trash ?? [];
  const trashBytes = jsonBytes(trash);
  const usageBytes = jsonBytes(lib.usage ?? []);
  const activityBytes = jsonBytes(lib.activity ?? []);
  const total = jsonBytes(lib);
  return {
    total, presentations, presentationsBytes,
    trashCount: trash.length, trashBytes, trashIds: trash.map((e) => e.id),
    usageCount: (lib.usage ?? []).length, usageBytes,
    activityCount: (lib.activity ?? []).length, activityBytes,
    otherBytes: Math.max(0, total - presentationsBytes - trashBytes - usageBytes - activityBytes),
  };
}
