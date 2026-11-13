import { commandId, commandLabel, dedupeCommands, normalizeQuery, type CommandEntry } from '../../domain/commandSearch';

/** Buttons that are not commands of their own: a split button's arrow, a group's dialog launcher. */
const SKIP = '.rb-launcher, .rb-caret, .rb-split-caret, .ppt-caret-btn, [data-tellme-skip]';

const groupOf = (el: Element) => {
  const g = el.closest('.rb-group')?.querySelector(':scope > .rb-group-label');
  const first = [...(g?.childNodes ?? [])].find((n) => n.nodeType === Node.TEXT_NODE);
  return first?.textContent?.trim() || undefined;
};

/** The label of a ribbon button as the index knows it (its text, else its tool tip). */
export function buttonLabel(b: HTMLElement): string {
  const own = b.querySelector('.rb-label')?.textContent ?? [...b.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('');
  return commandLabel(own, b.getAttribute('title') ?? b.getAttribute('aria-label'));
}

/** Every command button in a ribbon body, as index entries of `tab`: built from what the ribbon really draws. */
export function scanRibbon(root: ParentNode, tab: string): CommandEntry[] {
  const out: CommandEntry[] = [];
  root.querySelectorAll<HTMLElement>('button').forEach((b) => {
    if (b.matches(SKIP)) return;
    const label = buttonLabel(b);
    if (!label || label.length > 40) return;
    const group = groupOf(b);
    out.push({ id: commandId(tab, group, label), label, tab, group, disabled: b.hasAttribute('disabled') });
  });
  return dedupeCommands(out);
}

/** The button of an entry in the ribbon body that is showing now. */
export function findButton(root: ParentNode, entry: CommandEntry): HTMLElement | null {
  const want = normalizeQuery(entry.via ?? entry.label);
  const all = [...root.querySelectorAll<HTMLElement>('button')].filter((b) => !b.matches(SKIP) && normalizeQuery(buttonLabel(b)) === want);
  return all.find((b) => groupOf(b) === entry.group) ?? all[0] ?? null;
}
