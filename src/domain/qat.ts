/**
 * The Quick Access Toolbar (빠른 실행 도구 모음) at the left of the title bar, after DeckCraft's ribbon/qat.rs:
 * the buttons there can be chosen from the Customize menu, any ribbon button can be added with a right-click,
 * and the toolbar can be reset. Kept on this computer.
 */

/** A command the Customize menu offers as a checkbox (PowerPoint's order). */
export type QatCommand = 'home' | 'new' | 'open' | 'save' | 'print' | 'undo' | 'redo' | 'fromStart' | 'find' | 'spelling' | 'export';

export type QatItem =
  | { kind: 'command'; id: QatCommand }
  /** A ribbon button: pressed on its tab, found by its group and label (as 어떤 작업을 원하시나요? does). */
  | { kind: 'ribbon'; tab: string; group?: string; label: string };

export const QAT_COMMANDS: { id: QatCommand; label: string; icon: string }[] = [
  { id: 'home', label: '홈', icon: '⌂' },
  { id: 'new', label: '새로 만들기', icon: '📄' },
  { id: 'open', label: '열기', icon: '📂' },
  { id: 'save', label: '저장', icon: '💾' },
  { id: 'print', label: '인쇄', icon: '🖨' },
  { id: 'undo', label: '실행 취소', icon: '↶' },
  { id: 'redo', label: '다시 실행', icon: '↷' },
  { id: 'fromStart', label: '처음부터 시작', icon: '▣' },
  { id: 'find', label: '찾기', icon: '🔍' },
  { id: 'spelling', label: '맞춤법 검사', icon: 'abc' },
  { id: 'export', label: '내보내기', icon: '⇪' },
];

/** What a new install starts with: the title bar's buttons before it could be customized. */
export const QAT_DEFAULTS: QatItem[] = [
  { kind: 'command', id: 'save' }, { kind: 'command', id: 'undo' }, { kind: 'command', id: 'redo' }, { kind: 'command', id: 'fromStart' },
];

const KEY = 'lightcast.qat';

export const qatKey = (i: QatItem) => (i.kind === 'command' ? `cmd:${i.id}` : `rb:${i.tab}›${i.group ?? ''}›${i.label}`);
export const sameItem = (a: QatItem, b: QatItem) => qatKey(a) === qatKey(b);
export const qatLabel = (i: QatItem) => (i.kind === 'command' ? QAT_COMMANDS.find((c) => c.id === i.id)?.label ?? i.id : i.label);

function valid(x: unknown): x is QatItem {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (o.kind === 'command') return QAT_COMMANDS.some((c) => c.id === o.id);
  return o.kind === 'ribbon' && typeof o.tab === 'string' && typeof o.label === 'string' && !!o.label && (o.group === undefined || typeof o.group === 'string');
}

/** The saved toolbar (the defaults when none was saved or it cannot be read). */
export function loadQat(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): QatItem[] {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return QAT_DEFAULTS;
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return QAT_DEFAULTS;
    const out: QatItem[] = [];
    for (const x of v) if (valid(x) && !out.some((y) => sameItem(x, y))) out.push(x.kind === 'command' ? { kind: 'command', id: x.id } : { kind: 'ribbon', tab: x.tab, label: x.label, ...(x.group ? { group: x.group } : {}) });
    return out;
  } catch {
    return QAT_DEFAULTS;
  }
}

export function saveQat(items: QatItem[], storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try { storage?.setItem(KEY, JSON.stringify(items)); } catch { /* storage blocked: the toolbar stays for this session */ }
}

/** Adds an item at the end (nothing when it is already there). */
export const addQat = (items: QatItem[], item: QatItem): QatItem[] => (items.some((x) => sameItem(x, item)) ? items : [...items, item]);
export const removeQat = (items: QatItem[], item: QatItem): QatItem[] => items.filter((x) => !sameItem(x, item));
/** A Customize-menu checkbox: on adds the command, off removes it. A command added back goes in PowerPoint's order among the commands. */
export function toggleQat(items: QatItem[], id: QatCommand): QatItem[] {
  const item: QatItem = { kind: 'command', id };
  if (items.some((x) => sameItem(x, item))) return removeQat(items, item);
  const rank = (i: QatItem) => (i.kind === 'command' ? QAT_COMMANDS.findIndex((c) => c.id === i.id) : Infinity);
  const at = items.findIndex((x) => rank(x) > rank(item));
  return at < 0 ? [...items, item] : [...items.slice(0, at), item, ...items.slice(at)];
}
/** Moves an item one place left (−1) or right (+1). */
export function moveQat(items: QatItem[], item: QatItem, dir: -1 | 1): QatItem[] {
  const i = items.findIndex((x) => sameItem(x, item));
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return items;
  const out = [...items];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function safeStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

/**
 * Alt+1 to Alt+9 on Windows and Linux: the toolbar's first to ninth button, as in PowerPoint (DeckCraft's
 * `menus::ui_shortcut`, claimed on the document canvas in 0d8d4b75). The key's position (`code`) counts,
 * so it works on any keyboard layout; on macOS Option+digit types a character and is left alone. Returns
 * the button's index, or null.
 */
export function qatShortcut(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code: string }, mac: boolean): number | null {
  if (mac || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const m = /^Digit([1-9])$/.exec(e.code);
  return m ? Number(m[1]) - 1 : null;
}

/** The shortcut a toolbar button's tooltip names (`Alt+3`), or nothing past the ninth or on macOS. */
export const qatShortcutLabel = (index: number, mac: boolean): string => (mac || index < 0 || index > 8 ? '' : `Alt+${index + 1}`);
