// Object animations of legacy .ppt slides (MS-PPT 2.8 "PowerPoint 2002 animation"): the slide's ProgTags → ProgBinaryTag
// ("___PPT10") → BinaryTagData → ExtTimeNodeContainer tree, as PowerPoint 2002+ and LibreOffice write it. Read: the main
// sequence's effect nodes (TL_TPID_EffectNodeType click / with / after, EffectID = PowerPoint's preset id, EffectDir = its
// subtype, EffectType = its class), each node's begin delay, the longest behaviour as its duration, and the shape it targets
// (ClientVisualElement → VisualShapeAtom). PowerPoint 97's AnimationInfoAtom builds are not read. Never throws; capped.
import { each, isContainer, type Ctx, type Rec } from './pptRecords';

export interface PptAnimation {
  /** The Escher shape id (SpAtom spid) of the animated shape. */
  spid: number;
  /** PowerPoint preset id and subtype (direction) and class (1 entrance, 2 exit, 3 emphasis, 4 motion path). */
  presetId: number;
  subtype: number;
  presetClass: number;
  start: 'click' | 'with' | 'after';
  durationMs: number;
  delayMs: number;
}

const R = { ExtTimeNode: 0xf144, TimeNodeAtom: 0xf127, PropertyList: 0xf13d, Variant: 0xf142, CondContainer: 0xf125, CondAtom: 0xf128, VisualShape: 0x2afb };
const ATTR = { effectId: 0x9, effectDir: 0xa, effectType: 0xb, nodeType: 0x14 };
const MAX_DEPTH = 16;
const MAX_ANIMS = 500;

/** The int TimeVariant attributes of a TimePropertyList, by attribute id. */
function props(c: Ctx, r: Rec): Map<number, number> {
  const out = new Map<number, number>();
  each(c, r.pos, r.end, (v) => {
    if (v.type === R.Variant && v.end - v.pos >= 5 && c.b[v.pos] === 1) out.set(v.inst, c.v.getInt32(v.pos + 1, true));
  });
  return out;
}

interface Node { attrs: Map<number, number>; delay: number; duration: number; spid?: number; children: Node[] }

function readNode(c: Ctx, r: Rec, depth: number): Node {
  const node: Node = { attrs: new Map(), delay: 0, duration: -1, children: [] };
  each(c, r.pos, r.end, (k) => {
    if (k.type === R.TimeNodeAtom && k.end - k.pos >= 28) node.duration = c.v.getInt32(k.pos + 24, true);
    else if (k.type === R.PropertyList && isContainer(k)) node.attrs = props(c, k);
    else if (k.type === R.CondContainer && isContainer(k) && k.inst === 1) {
      each(c, k.pos, k.end, (a) => { if (a.type === R.CondAtom && a.end - a.pos >= 16) node.delay = c.v.getInt32(a.pos + 12, true); return a.type !== R.CondAtom; });
    } else if (k.type === R.ExtTimeNode && isContainer(k)) {
      if (depth < MAX_DEPTH) node.children.push(readNode(c, k, depth + 1));
    } else if (isContainer(k) && depth < MAX_DEPTH) {
      // Behaviour containers: the shape they act on.
      node.spid ??= targetOf(c, k, depth + 1);
    }
  });
  return node;
}

/** The shape id of the first VisualShapeAtom (type 0 shape, refType 1 shape) inside a container. */
function targetOf(c: Ctx, r: Rec, depth: number): number | undefined {
  let out: number | undefined;
  each(c, r.pos, r.end, (k) => {
    if (out !== undefined) return false;
    if (k.type === R.VisualShape && k.end - k.pos >= 12) {
      const refType = c.v.getUint32(k.pos + 4, true);
      if (refType === 1 || refType === 2) out = c.v.getUint32(k.pos + 8, true);
    } else if (isContainer(k) && depth < MAX_DEPTH) out = targetOf(c, k, depth + 1);
  });
  return out;
}

/** The longest behaviour under a node (its own duration when it is a behaviour). */
function longest(n: Node): number {
  let best = n.children.length ? 0 : Math.max(0, n.duration);
  for (const ch of n.children) best = Math.max(best, longest(ch) + Math.max(0, ch.delay));
  return best;
}
const spidOf = (n: Node): number | undefined => n.spid ?? n.children.map(spidOf).find((v) => v !== undefined);

/** The effects of one slide's time tree, in the order they play. */
export function readAnimations(c: Ctx, tags: Rec): PptAnimation[] {
  const out: PptAnimation[] = [];
  const roots: Node[] = [];
  const find = (r: Rec, depth: number) => {
    each(c, r.pos, r.end, (k) => {
      if (k.type === R.ExtTimeNode && isContainer(k)) roots.push(readNode(c, k, 0));
      else if (depth < 4 && isContainer(k)) find(k, depth + 1);
      else if (depth < 4 && k.type === 0x138b) find(k, depth + 1); // BinaryTagData holds records although its version is 0
    });
  };
  find(tags, 0);
  const visit = (n: Node) => {
    if (out.length >= MAX_ANIMS) return;
    const type = n.attrs.get(ATTR.nodeType);
    const presetId = n.attrs.get(ATTR.effectId);
    if ((type === 1 || type === 2 || type === 3) && presetId !== undefined) {
      const spid = spidOf(n);
      if (spid !== undefined) {
        const dur = longest(n);
        out.push({
          spid, presetId, subtype: n.attrs.get(ATTR.effectDir) ?? 0, presetClass: n.attrs.get(ATTR.effectType) ?? 1,
          start: type === 1 ? 'click' : type === 2 ? 'with' : 'after',
          // A "set" behaviour lasts 1 ms: an effect made only of it (Appear) has no duration.
          durationMs: dur <= 1 ? 0 : Math.min(dur, 600_000), delayMs: Math.max(0, Math.min(n.delay, 600_000)),
        });
      }
      return;
    }
    for (const ch of n.children) visit(ch);
  };
  for (const r of roots) visit(r);
  return out;
}

/** PowerPoint subtype (direction bits: 1 top, 2 right, 4 bottom, 8 left) → the engine's from-side option. */
const FLY: Record<number, string> = { 1: 't', 2: 'r', 3: 'rt', 4: 'b', 6: 'rb', 8: 'l', 9: 'lt', 12: 'lb' };
const WIPE: Record<number, string> = { 1: 't', 2: 'r', 4: 'b', 8: 'l' };
/** Entrance preset ids (PowerPoint's presetID) → the engine's effect ids. */
const ENTRANCE: Record<number, string> = { 1: 'appear', 2: 'fly', 3: 'blinds', 4: 'box', 5: 'checkerboard', 6: 'circle', 8: 'diamond', 9: 'dissolve', 10: 'fade', 12: 'peek', 14: 'randomBars', 16: 'split', 21: 'wheel', 22: 'wipe', 26: 'bounce', 31: 'grow', 42: 'float', 45: 'swivel', 53: 'zoom' };

/** LightCast's effect and option for an entrance effect; null for effects it does not read (exit, emphasis, paths, unknown). */
export function effectOf(a: Pick<PptAnimation, 'presetId' | 'subtype' | 'presetClass'>): { effect: string; option?: string } | null {
  if (a.presetClass !== 1) return null;
  const effect = ENTRANCE[a.presetId];
  if (!effect) return null;
  const option = effect === 'fly' ? FLY[a.subtype] : effect === 'wipe' ? WIPE[a.subtype] : undefined;
  return option ? { effect, option } : { effect };
}
