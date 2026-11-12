// Insert › SmartArt: the engine lays the diagram out (DeckCraft's layouts); its shapes become a
// group of ordinary objects. The first member keeps the diagram (`smartArt`) so it can be laid out
// again with new text, layout, style or colours.
import type { SlideElement } from './types';
import { layoutSmartArt, smartArtNodesFromLines, type SmartArtNode } from '../engine';
import { uid } from './lyrics';

export type SmartArtSpec = NonNullable<SlideElement['smartArt']>;

/** Text pane lines (a leading tab or two spaces per level) → nodes. */
export function nodesFromText(text: string): SmartArtNode[] {
  const lines = text.split('\n').map((l) => l.replace(/^( {2})+/, (m) => '\t'.repeat(m.length / 2))).filter((l) => l.trim());
  return smartArtNodesFromLines(lines);
}

export const textFromNodes = (nodes: SmartArtNode[]) => nodes.map((n) => '\t'.repeat(n.level) + n.text).join('\n');

/** The engine's layout, mirrored about the diagram's box for Right to Left (text stays readable). */
function laidOut(spec: SmartArtSpec, scheme?: string) {
  const shapes = layoutSmartArt(spec.kind, spec.nodes, spec.box, spec.style, spec.colors, scheme);
  if (!shapes || !spec.rtl) return shapes;
  const { x, w } = spec.box;
  return shapes.map((s) => ({ ...s, x: 2 * x + w - s.x - s.w, rot: s.rot ? -s.rot : 0, flipH: s.text ? s.flipH : !s.flipH }));
}

// ── SmartArt Design › Create Graphic: outline edits (DeckCraft smartart/nodes.rs) ──────────────
const MAX_LEVEL = 8;
type Node = SmartArtNode;

/** Index one past the last sub-point of node `i`. */
function subtreeEnd(nodes: Node[], i: number): number {
  const lv = nodes[i]?.level ?? 0;
  let j = i + 1;
  while (j < nodes.length && nodes[j].level > lv) j++;
  return j;
}

/** Levels made consistent: the first node top level, none more than one deeper than the one before. */
export function normalizeNodes(nodes: Node[]): Node[] {
  let prev: number | null = null;
  return nodes.map((n) => {
    const level = prev === null ? 0 : Math.min(n.level, prev + 1, MAX_LEVEL);
    prev = level;
    return level === n.level ? n : { ...n, level };
  });
}

/**
 * Add Shape After / Before / Below / Above / Add Assistant next to node `i` (DeckCraft `add`).
 * Returns the nodes and the new node's index.
 */
export function addNode(nodes: Node[], i: number | null, position: 'after' | 'before' | 'below' | 'above' | 'assistant', text = ''): { nodes: Node[]; index: number } {
  const out = nodes.map((n) => ({ ...n }));
  if (i === null || i < 0 || i >= out.length) return { nodes: [...out, { text, level: 0 }], index: out.length };
  const lv = out[i].level;
  let at: number, level: number;
  if (position === 'before') [at, level] = [i, lv];
  else if (position === 'below') [at, level] = [subtreeEnd(out, i), Math.min(lv + 1, MAX_LEVEL)];
  else if (position === 'above') {
    // The new node takes the place of node i, which moves under it with its sub-points.
    const end = subtreeEnd(out, i);
    for (let k = i; k < end; k++) out[k].level = Math.min(out[k].level + 1, MAX_LEVEL);
    [at, level] = [i, lv];
  } else if (position === 'assistant') [at, level] = [i + 1, Math.min(lv + 1, MAX_LEVEL)];
  else [at, level] = [subtreeEnd(out, i), lv];
  out.splice(at, 0, { text, level });
  return { nodes: out, index: at };
}

/** Promote: node `i` and its sub-points one level up; null when it is already top level. */
export function promoteNode(nodes: Node[], i: number): Node[] | null {
  if (!nodes[i] || nodes[i].level === 0) return null;
  const end = subtreeEnd(nodes, i);
  return nodes.map((n, k) => (k >= i && k < end ? { ...n, level: n.level - 1 } : n));
}

/** Demote: node `i` and its sub-points one level down, under the node before it; null when it cannot. */
export function demoteNode(nodes: Node[], i: number): Node[] | null {
  const prev = nodes[i - 1], cur = nodes[i];
  if (!prev || !cur || cur.level > prev.level || cur.level >= MAX_LEVEL) return null;
  const end = subtreeEnd(nodes, i);
  if (nodes.slice(i, end).some((n) => n.level >= MAX_LEVEL)) return null;
  return nodes.map((n, k) => (k >= i && k < end ? { ...n, level: n.level + 1 } : n));
}

/**
 * Move Up / Move Down: node `i` with its sub-points swaps places with the sibling before (after)
 * it. Returns the nodes and the node's new index, or null when there is no such sibling.
 */
export function moveNode(nodes: Node[], i: number, dir: -1 | 1): { nodes: Node[]; index: number } | null {
  const cur = nodes[i];
  if (!cur) return null;
  const end = subtreeEnd(nodes, i);
  if (dir === 1) {
    const next = nodes[end];
    if (!next || next.level !== cur.level) return null;
    const nextEnd = subtreeEnd(nodes, end);
    const out = [...nodes.slice(0, i), ...nodes.slice(end, nextEnd), ...nodes.slice(i, end), ...nodes.slice(nextEnd)];
    return { nodes: out, index: i + (nextEnd - end) };
  }
  let j = i - 1;
  while (j >= 0 && nodes[j].level > cur.level) j--;
  if (j < 0 || nodes[j].level !== cur.level) return null;
  const out = [...nodes.slice(0, j), ...nodes.slice(i, end), ...nodes.slice(j, i), ...nodes.slice(end)];
  return { nodes: out, index: j };
}

/** The diagram's members in drawing order (the shapes the engine laid out, one each). */
const membersOf = (els: SlideElement[], owner: SlideElement) => (owner.groupId ? els.filter((e) => e.groupId === owner.groupId) : [owner]);

/** The node a selected member shows (its first), or null for an arrow, a line or no member. */
export function nodeOfMember(els: SlideElement[], owner: SlideElement, memberId: string, scheme?: string): number | null {
  if (!owner.smartArt) return null;
  const k = membersOf(els, owner).findIndex((e) => e.id === memberId);
  const shapes = laidOut(owner.smartArt, scheme);
  return k >= 0 ? shapes?.[k]?.nodes?.[0] ?? null : null;
}

/** The members of the diagram that show node `i` (to select it again after an edit). */
export function membersShowing(spec: SmartArtSpec, members: SlideElement[], i: number, scheme?: string): string[] {
  const shapes = laidOut(spec, scheme) ?? [];
  return members.filter((_, k) => shapes[k]?.nodes?.includes(i)).map((e) => e.id);
}

/**
 * Text typed straight into the diagram's shapes, read back into its outline (DeckCraft
 * `sync_text`) so an edit of the outline does not lose it.
 */
export function syncTypedText(els: SlideElement[], owner: SlideElement, scheme?: string): SmartArtSpec | null {
  const spec = owner.smartArt;
  if (!spec) return null;
  const shapes = laidOut(spec, scheme);
  const members = membersOf(els, owner);
  if (!shapes || shapes.length !== members.length) return spec;
  const nodes = spec.nodes.map((n) => ({ ...n }));
  members.forEach((m, k) => {
    const idx = shapes[k].nodes ?? [];
    const lines = (m.text ?? '').split('\n');
    if (!idx.length || lines.length !== idx.length) return;
    idx.forEach((ni, j) => { if (nodes[ni]) nodes[ni].text = lines[j].trim(); });
  });
  return { ...spec, nodes };
}

/** The diagram's objects, or null when the engine cannot lay it out. */
export function smartArtElements(spec: SmartArtSpec, scheme?: string): SlideElement[] | null {
  const shapes = laidOut(spec, scheme);
  if (!shapes) return null;
  const groupId = uid('g');
  return shapes.map((s, i) => ({
    id: uid('el'), kind: 'shape' as const, groupId, name: `SmartArt ${i + 1}`,
    ...(s.custom ? { shape: undefined, path: s.custom.d, pathW: s.custom.w, pathH: s.custom.h } : { shape: s.shape ?? 'rect', adj: s.adj.length ? s.adj : undefined }),
    x: s.x, y: s.y, w: Math.max(1, s.w), h: Math.max(s.shape?.includes('onnector') || s.shape === 'line' ? 0 : 1, s.h),
    rotation: s.rot || undefined, flipH: s.flipH || undefined, flipV: s.flipV || undefined,
    fill: s.fill ?? 'transparent', gradient: s.gradient ?? undefined, gradientAngle: s.gradient ? 90 : undefined,
    stroke: s.stroke ?? undefined, strokeWidth: s.stroke ? Math.max(1, s.strokeWidth) : undefined,
    text: s.text || undefined, color: s.color ?? undefined, fontSize: s.fontSize ? Math.round(s.fontSize) : s.text ? 36 : undefined,
    bold: s.bold ?? undefined, align: (s.align as SlideElement['align']) ?? 'center', vAlign: 'middle' as const, dropShadow: s.shadow || undefined,
    ...(i === 0 ? { smartArt: spec } : {}),
  }));
}

/** Replace a diagram's objects (found by the owner's group) with a new layout. */
export function relayoutSmartArt(els: SlideElement[], ownerId: string, patch: Partial<SmartArtSpec>, scheme?: string): { elements: SlideElement[]; ids: string[] } | null {
  const owner = els.find((e) => e.id === ownerId && e.smartArt);
  if (!owner?.smartArt) return null;
  const spec = { ...owner.smartArt, ...patch };
  const next = smartArtElements(spec, scheme);
  if (!next) return null;
  const at = els.findIndex((e) => e.groupId === owner.groupId);
  const rest = els.filter((e) => !(owner.groupId ? e.groupId === owner.groupId : e.id === owner.id));
  rest.splice(Math.max(0, Math.min(at, rest.length)), 0, ...next);
  return { elements: rest, ids: next.map((e) => e.id) };
}

/** The diagram owner among the selection, if a SmartArt graphic is selected. */
export const smartArtOwner = (els: SlideElement[], selected: SlideElement[]) => {
  const g = selected.find((e) => e.groupId)?.groupId;
  return selected.find((e) => e.smartArt) ?? (g ? els.find((e) => e.groupId === g && e.smartArt) : undefined);
};

export type OutlineOp =
  | { kind: 'add'; position: 'after' | 'before' | 'below' | 'above' | 'assistant' }
  | { kind: 'promote' } | { kind: 'demote' } | { kind: 'up' } | { kind: 'down' } | { kind: 'rtl' } | { kind: 'reset' };

/**
 * SmartArt Design › Create Graphic / Reset: one outline edit on the node the selected shape shows
 * (the last node when none), laid out again. Text typed into the shapes is kept. Null when the
 * edit does not apply (a top-level node cannot be promoted…).
 */
export function editSmartArt(els: SlideElement[], owner: SlideElement, selectedId: string | undefined, op: OutlineOp, scheme?: string): { elements: SlideElement[]; ids: string[] } | null {
  const synced = syncTypedText(els, owner, scheme);
  if (!synced) return null;
  const at = selectedId ? nodeOfMember(els, owner, selectedId, scheme) : null;
  const i = at ?? (synced.nodes.length ? synced.nodes.length - 1 : null);
  let spec: SmartArtSpec = synced;
  let focus: number | null = at;
  switch (op.kind) {
    case 'add': { const r = addNode(synced.nodes, i, op.position); spec = { ...synced, nodes: r.nodes }; focus = r.index; break; }
    case 'promote': { const n = i === null ? null : promoteNode(synced.nodes, i); if (!n) return null; spec = { ...synced, nodes: n }; break; }
    case 'demote': { const n = i === null ? null : demoteNode(synced.nodes, i); if (!n) return null; spec = { ...synced, nodes: n }; break; }
    case 'up': case 'down': { const r = i === null ? null : moveNode(synced.nodes, i, op.kind === 'up' ? -1 : 1); if (!r) return null; spec = { ...synced, nodes: r.nodes }; focus = r.index; break; }
    case 'rtl': spec = { ...synced, rtl: synced.rtl ? undefined : true }; break;
    // Reset Graphic: the layout drawn again from the outline alone.
    case 'reset': spec = { ...synced, rtl: undefined, style: 'flat', colors: 'colorful' }; break;
  }
  spec = { ...spec, nodes: normalizeNodes(spec.nodes) };
  const r = relayoutSmartArt(els, owner.id, spec, scheme);
  if (!r) return null;
  const members = r.elements.filter((e) => r.ids.includes(e.id));
  const owner2 = members.find((e) => e.smartArt);
  const showing = focus !== null && owner2?.smartArt ? membersShowing(owner2.smartArt, members, focus, scheme) : [];
  return { elements: r.elements, ids: showing.length ? showing : r.ids };
}
