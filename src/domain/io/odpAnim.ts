// .odp animations: LibreOffice's anim:par timing tree (presentation:preset-id / preset-sub-type / node-type, with the
// anim:set / animate / animateTransform / animateColor / animateMotion / transitionFilter children it writes), read into
// and written from LightCast's animation list (src/domain/animations.ts, motionPath.ts).
// Every structure here was checked against what LibreOffice 24.2 writes from PowerPoint's own timing XML
// (tests/fixtures/real/odp/build_animations2.py), and what LibreOffice reads back from what is written here.
import type { SlideAnimation } from '../types';
import { elementsOf, type XNode } from './miniXml';
import { uid } from '../lyrics';

/** Timing › Repeat › Until Next Click (animations.ts REPEAT_UNTIL_CLICK; not imported to keep the engine out of this file). */
const UNTIL_CLICK = 4294967295;

export const beginMs = (v: string | undefined): number => { const m = /^([\d.]+)(ms|s)$/.exec((v ?? '').trim()); return m ? Math.round(Number(m[1]) * (m[2] === 's' ? 1000 : 1)) : 0; };
const secs = (ms: number) => `${Math.round(ms) / 1000}s`;

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────
const SUB_DIR: Record<string, string> = {
  'from-left': 'l', 'from-right': 'r', 'from-top': 't', 'from-bottom': 'b',
  'from-top-left': 'lt', 'from-top-right': 'rt', 'from-bottom-left': 'lb', 'from-bottom-right': 'rb',
  'from-upper-left': 'lt', 'from-upper-right': 'rt', 'from-lower-left': 'lb', 'from-lower-right': 'rb',
};
const DIR_SUB: Record<string, string> = { l: 'from-left', r: 'from-right', t: 'from-top', b: 'from-bottom', lt: 'from-top-left', rt: 'from-top-right', lb: 'from-bottom-left', rb: 'from-bottom-right' };

/** LibreOffice's preset name (after `ooo-entrance-` / `ooo-exit-` / `ooo-emphasis-`) → LightCast entrance effect (+ option). */
const BASE: Record<string, [string, string?]> = {
  appear: ['appear'], 'fade-in': ['fade'], fade: ['fade'], 'fly-in': ['fly'], 'fly-out': ['fly'], wipe: ['wipe'], zoom: ['zoom'], 'fade-in-and-zoom': ['zoom'], 'fade-out-and-zoom': ['zoom'],
  ascend: ['float', 'u'], descend: ['float', 'd'], split: ['split'], 'venetian-blinds': ['blinds'], blinds: ['blinds'], checkerboard: ['checkerboard'],
  box: ['box'], circle: ['circle'], diamond: ['diamond'], plus: ['shape', 'plusIn'], 'dissolve-in': ['dissolve'], dissolve: ['dissolve'], 'peek-in': ['peek'], peek: ['peek'],
  'random-bars': ['randomBars'], wheel: ['wheel'], strips: ['strips'], 'fade-in-and-swivel': ['swivel'], swivel: ['swivel'], bounce: ['bounce'], spinner: ['spinner'],
  expand: ['expand'], 'fade-in-and-zoom-in': ['zoom'],
};
const EXIT_OF: Record<string, string> = { appear: 'disappear', fade: 'fadeOut', grow: 'shrinkTurn', rise: 'sinkDown', expand: 'contract', float: 'floatOut', split: 'splitOut', wipe: 'wipeOut', fly: 'flyOut', zoom: 'zoomOut', shape: 'shapeOut' };
const EXIT_IDS = new Set(['disappear', 'fadeOut', 'flyOut', 'floatOut', 'splitOut', 'wipeOut', 'shapeOut', 'wheelOut', 'randomBarsOut', 'shrinkTurn', 'zoomOut', 'swivelOut', 'bounceOut', 'dissolveOut', 'blindsOut', 'boxOut', 'checkerboardOut', 'diamondOut', 'peekOut', 'stripsOut', 'sinkDown', 'spinnerOut', 'contract']);
const ENTRANCE_IDS = new Set(['appear', 'fade', 'fly', 'float', 'split', 'wipe', 'shape', 'wheel', 'randomBars', 'grow', 'zoom', 'swivel', 'bounce', 'blinds', 'box', 'checkerboard', 'circle', 'diamond', 'dissolve', 'peek', 'strips', 'expand', 'rise', 'spinner']);
const EMPHASIS_IDS = new Set(['pulse', 'colorPulse', 'teeter', 'spin', 'growShrink', 'desaturate', 'darken', 'lighten', 'transparency', 'objectColor', 'complementaryColor', 'lineColor', 'fillColor', 'fontColor', 'underline', 'boldFlash', 'wave']);
const EMPHASIS_NAME: Record<string, string> = {
  spin: 'spin', 'grow-and-shrink': 'growShrink', pulse: 'pulse', teeter: 'teeter', 'bold-flash': 'boldFlash', blink: 'boldFlash', 'fill-color': 'fillColor', 'line-color': 'lineColor',
  'font-color': 'fontColor', 'color-blend': 'objectColor', 'color-over-by-word': 'fontColor', transparency: 'transparency', desaturate: 'desaturate', darken: 'darken', lighten: 'lighten',
  'complementary-color': 'complementaryColor', 'flash-bulb': 'pulse', underline: 'underline', wave: 'wave',
};

/** Every descendant element, in document order. */
const descend = (n: XNode): XNode[] => elementsOf(n).flatMap((c) => [c, ...descend(c)]);

const durOf = (eff: XNode): number => {
  let best = 0;
  for (const c of descend(eff)) {
    if (!/^anim:(animate|animateTransform|animateColor|animateMotion|transitionFilter|set)$/.test(c.name)) continue;
    const d = beginMs(c.attrs['smil:dur']);
    if (c.name === 'anim:set' && d < 50) continue;
    best = Math.max(best, d);
  }
  return best || 500;
};

/** The effect an animation node means: LightCast's own `lc:effect`, the preset id LibreOffice names, or what its children do. */
function effectOf(eff: XNode): { effect: string; cls: SlideAnimation['class']; option?: string; path?: string } | undefined {
  const pc = eff.attrs['presentation:preset-class'] ?? '';
  const cls: SlideAnimation['class'] = pc === 'exit' ? 'exit' : pc === 'emphasis' ? 'emphasis' : pc === 'motion-path' ? 'path' : 'entrance';
  const own = eff.attrs['lc:effect'];
  const ownOpt = eff.attrs['lc:option'];
  const all = descend(eff);
  const motion = all.find((c) => c.name === 'anim:animateMotion');
  if (cls === 'path' || motion) {
    const d = motion?.attrs['svg:path']?.trim();
    if (!d) return undefined;
    return { effect: 'lines', cls: 'path', path: /\bE\s*$/.test(d) ? d : `${d.replace(/\s*Z\s*$/i, ' Z')} E`.replace(/\s+/g, ' ') };
  }
  if (own && (cls === 'entrance' ? ENTRANCE_IDS.has(own) : cls === 'exit' ? EXIT_IDS.has(own) : EMPHASIS_IDS.has(own))) return { effect: own, cls, ...(ownOpt ? { option: ownOpt } : {}) };
  const sub = eff.attrs['presentation:preset-sub-type'] ?? '';
  const name = (eff.attrs['presentation:preset-id'] ?? '').replace(/^ooo-(entrance|exit|emphasis)-/, '');
  const filter = all.find((c) => c.name === 'anim:transitionFilter');
  const dir = SUB_DIR[sub];
  if (cls === 'emphasis') {
    let effect = EMPHASIS_NAME[name];
    const tf = all.find((c) => c.name === 'anim:animateTransform');
    const col = all.find((c) => c.name === 'anim:animateColor');
    if (!effect && tf?.attrs['svg:type'] === 'rotate') effect = tf.attrs['smil:autoReverse'] === 'true' ? 'teeter' : 'spin';
    else if (!effect && tf?.attrs['svg:type'] === 'scale') effect = tf.attrs['smil:autoReverse'] === 'true' ? 'pulse' : 'growShrink';
    else if (!effect && col) effect = col.attrs['smil:attributeName'] === 'stroke-color' ? 'lineColor' : col.attrs['smil:attributeName'] === 'color' ? 'fontColor' : 'fillColor';
    if (!effect) return undefined;
    // The structure decides where the name is a loose match (PowerPoint's preset 26 is named flash-bulb by LibreOffice but scales).
    if (tf?.attrs['svg:type'] === 'scale' && effect === 'pulse' && tf.attrs['smil:autoReverse'] !== 'true') effect = 'growShrink';
    let option: string | undefined;
    if (effect === 'spin' && Number(tf?.attrs['smil:by'] ?? tf?.attrs['smil:to'] ?? 360) < 0) option = 'counterClockwise';
    if (effect === 'growShrink') {
      const [bx, by] = (tf?.attrs['smil:by'] ?? '').split(',').map(Number);
      if (Number.isFinite(bx) && Number.isFinite(by) && bx !== by) option = by === 0 || !by ? 'horz' : bx === 0 || !bx ? 'vert' : undefined;
    }
    if (effect === 'objectColor' && col?.attrs['smil:autoReverse'] === 'true') effect = 'colorPulse';
    return { effect, cls, ...(option ? { option } : {}) };
  }
  // Entrance and exit: the preset's name first, then what the children do.
  let base = BASE[name];
  if (!base) {
    const attrs = all.filter((c) => c.name === 'anim:animate').map((c) => c.attrs['smil:attributeName']);
    if (filter?.attrs['smil:type'] === 'barWipe') base = ['wipe'];
    else if (filter && attrs.includes('width')) base = ['zoom'];
    else if (filter?.attrs['smil:type'] === 'fade') base = ['fade'];
    else if (attrs.includes('x') || attrs.includes('y')) base = ['fly'];
    else if (attrs.includes('width') || attrs.includes('height')) base = ['zoom'];
    else if (all.some((c) => c.name === 'anim:set')) base = ['appear'];
  }
  if (!base) return undefined;
  let [effect, option] = base;
  if (effect === 'fly' || effect === 'peek') option = dir ?? (effect === 'fly' ? 'b' : undefined);
  else if (effect === 'wipe') {
    // The wipe's own direction: LibreOffice's sub-type names where it starts; the filter says the same (reversed = from the far side).
    const st = filter?.attrs['smil:subtype'];
    const rev = filter?.attrs['smil:direction'] === 'reverse';
    option = dir && dir.length === 1 ? dir : st === 'topToBottom' ? (rev ? 'b' : 't') : st === 'leftToRight' ? (rev ? 'r' : 'l') : 'l';
  } else if (effect === 'zoom' && sub === 'out') option = 'out';
  if (cls === 'exit') effect = EXIT_OF[effect] ?? `${effect}Out`;
  if (cls === 'exit' ? !EXIT_IDS.has(effect) : !ENTRANCE_IDS.has(effect)) return undefined;
  return { effect, cls, ...(option ? { option } : {}) };
}

/**
 * The slide's animation timing tree: the main sequence (click steps; with / after previous) and the interactive
 * sequences (a click on an object plays its effects), on objects that were read (`ids`: xml:id → element id).
 */
export function readAnimations(pg: XNode, ids: Map<string, string>): SlideAnimation[] {
  const out: SlideAnimation[] = [];
  const seqs = descend(pg).filter((c) => c.name === 'anim:seq');
  const targetOf = (n: XNode): string | undefined => descend(n).map((c) => c.attrs['smil:targetElement']).find((t) => !!t);
  for (const seq of seqs) {
    const type = seq.attrs['presentation:node-type'];
    if (type !== 'main-sequence' && type !== 'interactive-sequence') continue;
    const interactive = type === 'interactive-sequence';
    // An interactive sequence's trigger: its steps begin at "<object id>.click".
    const triggerRef = interactive ? /^([^.\s]+)\.click/.exec(descend(seq).map((c) => c.attrs['smil:begin']).find((b) => b && /\.click/.test(b)) ?? '')?.[1] : undefined;
    const trigger = triggerRef ? ids.get(triggerRef) : undefined;
    if (interactive && !trigger) continue;
    for (const eff of descend(seq).filter((c) => c.name === 'anim:par' && c.attrs['presentation:preset-class'] !== undefined)) {
      const e = effectOf(eff);
      const target = ids.get(targetOf(eff) ?? '');
      if (!e || !target) continue;
      const node = eff.attrs['presentation:node-type'];
      const rep = eff.attrs['smil:repeatCount'];
      const repeat = rep === 'indefinite' ? UNTIL_CLICK : rep && Number(rep) > 1 ? Math.min(1000, Math.round(Number(rep))) : undefined;
      out.push({
        id: uid('an'), elementId: target, effect: e.effect, class: e.cls, ...(e.option ? { option: e.option } : {}),
        start: node === 'with-previous' ? 'with' : node === 'after-previous' ? 'after' : 'click',
        durationMs: durOf(eff), delayMs: beginMs(eff.attrs['smil:begin']),
        ...(repeat ? { repeat } : {}), ...(e.path ? { path: e.path } : {}), ...(trigger ? { trigger } : {}),
      });
    }
  }
  return out;
}

// ── Writing ─────────────────────────────────────────────────────────────────────────────────────
const set = (id: string, to: 'visible' | 'hidden', begin = 0) => `<anim:set smil:begin="${secs(begin)}" smil:dur="0.001s" smil:fill="hold" smil:targetElement="${id}" smil:attributeName="visibility" smil:to="${to}"/>`;
const animate = (id: string, attr: string, values: string, dur: string) => `<anim:animate smil:dur="${dur}" smil:fill="hold" smil:targetElement="${id}" smil:attributeName="${attr}" smil:values="${values}" smil:keyTimes="0;1"/>`;
const fade = (id: string, dur: string, out: boolean) => `<anim:transitionFilter smil:dur="${dur}" smil:targetElement="${id}" smil:type="fade" smil:subtype="crossfade"${out ? ' smil:mode="out"' : ''}/>`;
const FLY_EDGE: Record<string, [string, string, string]> = { l: ['x', '0-width/2', 'x'], r: ['x', '1+width/2', 'x'], t: ['y', '0-height/2', 'y'], b: ['y', '1+height/2', 'y'] };
const WIPE: Record<string, [string, boolean]> = { l: ['leftToRight', false], r: ['leftToRight', true], t: ['topToBottom', false], b: ['topToBottom', true] };
const DEFAULT_COLOR = '#c00000';

interface Built { cls: string; preset: string; sub?: string; body: string; repeat?: number; hold?: boolean }

/** The ODF of one effect (LibreOffice's preset id, class and children), or undefined when ODF here cannot carry it. */
function build(a: SlideAnimation, id: string, dur: string, motionPath?: string): Built | undefined {
  const o = a.option ?? '';
  const ms = Math.max(1, a.durationMs);
  if (a.class === 'path' || a.path) {
    const d = (a.path ?? motionPath ?? '').replace(/\s*\bE\s*$/, '').trim();
    if (!d) return undefined;
    return { cls: 'motion-path', preset: '', body: `<anim:animateMotion smil:dur="${dur}" smil:fill="hold" smil:targetElement="${id}" svg:path="${d}"/>` };
  }
  if (a.class === 'entrance') {
    switch (a.effect) {
      case 'appear': return { cls: 'entrance', preset: 'ooo-entrance-appear', body: set(id, 'visible') };
      case 'fly': {
        const dir = DIR_SUB[o] ? o : 'b';
        const parts = [...dir].map((ch) => FLY_EDGE[ch]);
        return { cls: 'entrance', preset: 'ooo-entrance-fly-in', sub: DIR_SUB[dir], body: set(id, 'visible') + parts.map(([attr, from, to]) => animate(id, attr, `${from};${to}`, dur)).join('') };
      }
      case 'wipe': {
        const [sub, rev] = WIPE[o] ?? WIPE.l;
        const d = WIPE[o] ? o : 'l';
        return { cls: 'entrance', preset: 'ooo-entrance-wipe', sub: DIR_SUB[d], body: set(id, 'visible') + `<anim:transitionFilter smil:dur="${dur}" smil:targetElement="${id}" smil:type="barWipe" smil:subtype="${sub}"${rev ? ' smil:direction="reverse"' : ''}/>` };
      }
      case 'zoom': return { cls: 'entrance', preset: 'ooo-entrance-fade-in-and-zoom', sub: o === 'out' ? 'out' : 'in', body: set(id, 'visible') + animate(id, 'width', `${o === 'out' ? '3*width' : '0'};width`, dur) + animate(id, 'height', `${o === 'out' ? '3*height' : '0'};height`, dur) + fade(id, dur, false) };
      case 'fade': return { cls: 'entrance', preset: 'ooo-entrance-fade-in', body: set(id, 'visible') + fade(id, dur, false) };
      default: return { cls: 'entrance', preset: 'ooo-entrance-fade-in', body: set(id, 'visible') + fade(id, dur, false) };
    }
  }
  if (a.class === 'exit') {
    switch (a.effect) {
      case 'disappear': return { cls: 'exit', preset: 'ooo-exit-disappear', body: set(id, 'hidden') };
      case 'flyOut': {
        const dir = DIR_SUB[o] ? o : 'b';
        const parts = [...dir].map((ch) => FLY_EDGE[ch]);
        return { cls: 'exit', preset: 'ooo-exit-fly-out', sub: DIR_SUB[dir], body: parts.map(([attr, to, from]) => animate(id, attr, `${from};${to}`, dur)).join('') + set(id, 'hidden', ms) };
      }
      case 'wipeOut': {
        const [sub, rev] = WIPE[o] ?? WIPE.l;
        const d = WIPE[o] ? o : 'l';
        return { cls: 'exit', preset: 'ooo-exit-wipe', sub: DIR_SUB[d], body: `<anim:transitionFilter smil:dur="${dur}" smil:targetElement="${id}" smil:type="barWipe" smil:subtype="${sub}" smil:mode="out"${rev ? ' smil:direction="reverse"' : ''}/>` + set(id, 'hidden', ms) };
      }
      case 'zoomOut': return { cls: 'exit', preset: 'ooo-exit-fade-out-and-zoom', sub: 'in', body: set(id, 'hidden') + animate(id, 'width', 'width;0', dur) + animate(id, 'height', 'height;0', dur) + fade(id, dur, true) };
      default: return { cls: 'exit', preset: 'ooo-exit-fade-out', body: set(id, 'hidden') + fade(id, dur, true) };
    }
  }
  if (a.class === 'emphasis') {
    const tf = (by: string, type: string, rev = false) => `<anim:animateTransform smil:dur="${dur}" smil:fill="hold"${rev ? ' smil:autoReverse="true"' : ''} smil:targetElement="${id}" smil:by="${by}" smil:attributeName="transform" svg:type="${type}"/>`;
    const color = (attr: string, rev = false) => `<anim:animateColor smil:dur="${dur}" smil:fill="hold"${rev ? ' smil:autoReverse="true"' : ''} smil:targetElement="${id}" smil:attributeName="${attr}" smil:to="${DEFAULT_COLOR}" anim:color-interpolation="rgb" anim:color-interpolation-direction="clockwise"/>`;
    switch (a.effect) {
      case 'spin': return { cls: 'emphasis', preset: 'ooo-emphasis-spin', body: tf(o === 'counterClockwise' ? '-360' : '360', 'rotate') };
      case 'growShrink': return { cls: 'emphasis', preset: 'ooo-emphasis-grow-and-shrink', body: tf(o === 'horz' ? '0.5,0' : o === 'vert' ? '0,0.5' : '0.5,0.5', 'scale') };
      case 'pulse': return { cls: 'emphasis', preset: 'ooo-emphasis-pulse', body: tf('0.1,0.1', 'scale', true) };
      case 'teeter': return { cls: 'emphasis', preset: 'ooo-emphasis-teeter', body: tf('5', 'rotate', true) };
      case 'boldFlash': return { cls: 'emphasis', preset: 'ooo-emphasis-bold-flash', body: `<anim:set smil:dur="${dur}" smil:fill="hold" smil:targetElement="${id}" smil:attributeName="font-weight" smil:to="bold"/>` };
      case 'colorPulse': return { cls: 'emphasis', preset: 'ooo-emphasis-color-blend', body: color('fill-color', true) };
      case 'objectColor': return { cls: 'emphasis', preset: 'ooo-emphasis-color-blend', body: color('fill-color') };
      case 'fillColor': return { cls: 'emphasis', preset: 'ooo-emphasis-fill-color', body: color('fill-color') };
      case 'lineColor': return { cls: 'emphasis', preset: 'ooo-emphasis-line-color', body: color('stroke-color') };
      case 'fontColor': return { cls: 'emphasis', preset: 'ooo-emphasis-font-color', body: color('color') };
      default: return undefined;
    }
  }
  return undefined;
}

/** Can the effect go into ODF (some other effects are written as the nearest effect LibreOffice has: fade)? */
const EXACT = new Set(['appear', 'fade', 'fly', 'wipe', 'zoom', 'disappear', 'fadeOut', 'flyOut', 'wipeOut', 'zoomOut', 'spin', 'growShrink', 'pulse', 'teeter', 'boldFlash', 'colorPulse', 'objectColor', 'fillColor', 'lineColor', 'fontColor']);

/**
 * A slide's animations as LibreOffice's anim:par timing tree: clicks are steps, with / after effects share the step,
 * and an object's own click (Animations › Trigger) is an interactive sequence. `pathOf` gives a preset motion path's
 * points as `M 0 0 L …` when it is known (the engine traces them).
 */
export function animationsXml(list: SlideAnimation[] | undefined, ids: Map<string, string>, pathOf?: (a: SlideAnimation) => string | undefined): string {
  const usable = (list ?? []).filter((a) => ids.has(a.elementId));
  const made = usable.flatMap((a) => {
    const id = ids.get(a.elementId)!;
    const b = build(a, id, secs(Math.max(1, a.durationMs)), a.path ? undefined : pathOf?.(a));
    return b ? [{ a, id, b }] : [];
  });
  if (!made.length) return '';
  type Made = (typeof made)[number];
  const effectXml = (m: Made, node: string) => {
    const { a, b } = m;
    const rep = a.repeat === UNTIL_CLICK ? 'indefinite' : a.repeat && a.repeat > 1 ? String(a.repeat) : undefined;
    const lc = EXACT.has(a.effect) && a.class !== 'path' ? '' : ` lc:effect="${a.effect}"`;
    const lcOpt = a.option && lc ? ` lc:option="${a.option}"` : '';
    return `<anim:par smil:begin="${secs(a.delayMs)}" smil:fill="hold"${rep ? ` smil:repeatCount="${rep}"` : ''} presentation:node-type="${node}" presentation:preset-class="${b.cls}" presentation:preset-id="${b.preset}"${b.sub ? ` presentation:preset-sub-type="${b.sub}"` : ''}${lc}${lcOpt}>${b.body}</anim:par>`;
  };
  /** Steps of effects: a click starts a step; with / after effects go into it ("after" begins when the effects before end). */
  const stepsOf = (items: Made[], begin: (step: string) => string) => {
    const steps: Made[][] = [];
    for (const m of items) { if (m.a.start === 'click' || !steps.length) steps.push([m]); else steps[steps.length - 1].push(m); }
    return steps.map((step) => {
      const groups: { begin: number; effects: Made[] }[] = [];
      for (const m of step) {
        const last = groups[groups.length - 1];
        if (m.a.start === 'after' && last) groups.push({ begin: last.begin + Math.max(...last.effects.map((e) => e.a.delayMs + e.a.durationMs)), effects: [m] });
        else if (last) last.effects.push(m);
        else groups.push({ begin: 0, effects: [m] });
      }
      const inner = groups.map((g) => `<anim:par smil:begin="${secs(g.begin)}" smil:fill="hold">${g.effects.map((m) => effectXml(m, m === step[0] ? 'on-click' : m.a.start === 'after' ? 'after-previous' : 'with-previous')).join('')}</anim:par>`).join('');
      return `<anim:par smil:begin="${begin(inner)}" smil:fill="hold">${inner}</anim:par>`;
    }).join('');
  };
  const main = made.filter((m) => !(m.a.trigger && ids.has(m.a.trigger)));
  const main_ = stepsOf(main, () => 'next');
  // Interactive sequences: one per object that is clicked, its steps beginning at "<object>.click".
  const byTrigger = new Map<string, Made[]>();
  for (const m of made.filter((m) => m.a.trigger && ids.has(m.a.trigger))) { const k = m.a.trigger!; byTrigger.set(k, [...(byTrigger.get(k) ?? []), m]); }
  const interactive = [...byTrigger.entries()].map(([trig, items]) => `<anim:seq smil:fill="hold" smil:restart="whenNotActive" smil:endsync="all" presentation:node-type="interactive-sequence">${stepsOf(items, () => `${ids.get(trig)}.click+0s`)}</anim:seq>`).join('');
  return `<anim:par smil:dur="indefinite" smil:restart="never" presentation:node-type="timing-root"><anim:seq smil:dur="indefinite" presentation:node-type="main-sequence">${main_}</anim:seq>${interactive}</anim:par>`;
}
