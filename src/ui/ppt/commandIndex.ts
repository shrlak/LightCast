import { commandId, commandLabel, dedupeCommands, menuCommands, menuItemLabel, normalizeQuery, type CommandEntry, type MenuItemInfo } from '../../domain/commandSearch';

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
  // A gallery thumbnail's name is often only the text in a span beside its picture.
  return commandLabel(own, b.getAttribute('title') ?? b.getAttribute('aria-label')) || commandLabel(b.textContent, '');
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

/** The button of a plain ribbon entry in the ribbon body that is showing now. */
export function findButton(root: ParentNode, entry: CommandEntry): HTMLElement | null {
  const want = normalizeQuery(entry.label);
  const all = [...root.querySelectorAll<HTMLElement>('button')].filter((b) => !b.matches(SKIP) && normalizeQuery(buttonLabel(b)) === want);
  return all.find((b) => groupOf(b) === entry.group) ?? all[0] ?? null;
}

// ── Drop-downs ─────────────────────────────────────────────────────────────────────────────────
// Their items are drawn only while the menu is open, so the index opens each one (out of sight), reads
// what the menu really holds, and closes it. Choosing such an entry later opens the same menu in the ribbon.

/** What opens a menu: a drop-down button, a split button's arrow, the arrow of the font / size boxes. */
const OPENER = '.rb-split-caret, .ppt-caret-btn, button:has(.rb-caret), .ppt-drop:not(.split) > .ppt-btn';
/** An open menu. */
export const MENU = '.rb-menu, .ppt-menu';

/** The name of a menu button: a split button's arrow is named "<button> 옵션", the font box's "글꼴 목록". */
function openerLabel(b: HTMLElement): string {
  if (b.matches('.rb-split-caret, .ppt-caret-btn')) return commandLabel('', (b.getAttribute('aria-label') ?? b.getAttribute('title') ?? '').replace(/\s*(옵션|목록)$/, ''));
  return buttonLabel(b);
}

/** The buttons of a ribbon body that open a menu. */
export function menuOpeners(root: ParentNode): HTMLElement[] {
  return [...new Set(root.querySelectorAll<HTMLElement>(OPENER))].filter((b) => openerLabel(b));
}

/** The menu button an entry's `via` names (in its group when there are several of that name). */
export function findOpener(root: ParentNode, entry: CommandEntry): HTMLElement | null {
  const want = normalizeQuery(entry.via ?? '');
  const all = menuOpeners(root).filter((b) => normalizeQuery(openerLabel(b)) === want);
  return all.find((b) => groupOf(b) === entry.group) ?? all[0] ?? null;
}

/** A menu item's text: its label span, else its own text, else its tool tip (a thumbnail button has only that). */
function itemLabel(b: HTMLElement): string {
  const label = b.querySelector('.rb-mi-label')?.textContent ?? [...b.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('');
  return menuItemLabel(label) || menuItemLabel(b.getAttribute('title') ?? b.getAttribute('aria-label')) || menuItemLabel(b.textContent);
}

/** The items of an open menu. */
export function menuItems(menu: ParentNode): { el: HTMLElement; info: MenuItemInfo }[] {
  return [...menu.querySelectorAll<HTMLElement>('button')]
    .map((el) => ({ el, info: { label: itemLabel(el), disabled: el.hasAttribute('disabled') || undefined } }))
    .filter((x) => x.info.label);
}

/** The item of an entry in an open menu. */
export function findMenuItem(menu: ParentNode, entry: CommandEntry): HTMLElement | null {
  const want = normalizeQuery(entry.pick ?? entry.label);
  return menuItems(menu).find((x) => normalizeQuery(x.info.label) === want)?.el ?? null;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Opens every menu of a ribbon body in turn and returns the commands inside them. `stop()` ends it early. */
export async function scanMenus(root: ParentNode, tab: string, stop: () => boolean = () => false): Promise<CommandEntry[]> {
  const out: CommandEntry[] = [];
  for (const opener of menuOpeners(root)) {
    if (stop()) break;
    if (opener.hasAttribute('disabled')) continue;
    try {
      opener.click();
      await tick();
      const menu = root.querySelector(MENU);
      if (menu) out.push(...menuCommands(tab, { label: openerLabel(opener), group: groupOf(opener) }, menuItems(menu).map((x) => x.info)));
      // The arrow toggles: a second click closes the menu.
      if (root.querySelector(MENU)) opener.click();
      await tick();
    } catch { /* a menu that cannot be read is left out */ }
  }
  return dedupeCommands(out);
}
