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

/** The diagram's objects, or null when the engine cannot lay it out. */
export function smartArtElements(spec: SmartArtSpec, scheme?: string): SlideElement[] | null {
  const shapes = layoutSmartArt(spec.kind, spec.nodes, spec.box, spec.style, spec.colors, scheme);
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
