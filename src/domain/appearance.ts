/**
 * 보기 › 어두운 모드 (DeckCraft's View › Dark Mode, 파일 › 정보 › 모양): the editor window in light or dark. Only the
 * window's own panes, ribbon and dialogs change; slides and the output screens look the same. Kept on this computer.
 */
export type Appearance = 'light' | 'dark';

const KEY = 'lightcast.appearance';
const listeners = new Set<() => void>();
let current: Appearance | null = null;

export function loadAppearance(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Appearance {
  try { return storage?.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

export function getAppearance(): Appearance {
  return (current ??= loadAppearance());
}

export function setAppearance(a: Appearance, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  current = a;
  try { storage?.setItem(KEY, a); } catch { /* storage blocked: this session only */ }
  listeners.forEach((fn) => fn());
}

export function onAppearance(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function safeStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}
