// A slide's transition (p:transition, with PowerPoint 2010/2013 transitions inside mc:AlternateContent)
// and its animations (p:timing main sequence and triggered sequences) → LightCast's transition and
// SlideAnimation list, by PowerPoint's preset ids. Effects without a LightCast counterpart become the
// nearest one and are counted for the import report.
import type { MediaPlayback, SlideAnimation, Transition } from '../types';
import { uid } from '../lyrics';
import { child, find, kids, local, path, type MNode } from './markup';

const SPD: Record<string, number> = { fast: 500, med: 750, slow: 1000 };
const P15: Record<string, string> = { fallOver: 'fallOver', drape: 'drape', curtains: 'curtains', wind: 'wind', prestige: 'prestige', fracture: 'fracture', crush: 'crush', peelOff: 'peelOff', pageCurlDouble: 'pageCurlDouble', pageCurlSingle: 'pageCurlDouble', airplane: 'airplane', origami: 'origami' };
/** Transition element name → engine transition id (the same names PowerPoint uses). */
const SAME = new Set(['fade', 'push', 'wipe', 'split', 'cut', 'randomBar', 'uncover', 'cover', 'flash', 'dissolve', 'checker', 'blinds', 'ripple', 'honeycomb', 'glitter', 'vortex', 'shred', 'switch', 'flip', 'gallery', 'cube', 'doors', 'box', 'comb', 'zoom', 'random', 'pan', 'ferris', 'conveyor', 'rotate', 'window', 'orbit', 'flythrough', 'reveal', 'morph']);

export interface TransitionResult { transition?: Transition; autoAdvance?: number; approximated: string[]; dropped: string[] }

/** The slide's p:transition (the newest one PowerPoint wrote) → transition and automatic advance. */
export function readTransition(slide: MNode): TransitionResult {
  const out: TransitionResult = { approximated: [], dropped: [] };
  const choices = find(slide, 'AlternateContent').flatMap((ac) => [child(ac, 'Choice'), child(ac, 'Fallback')]).filter((n): n is MNode => !!n);
  const t = [...choices.map((c) => child(c, 'transition')), child(slide, 'transition')].find(Boolean);
  if (!t) return out;
  const fx = t.children.find((c) => c.name !== '#text' && !['sndAc', 'extLst'].includes(local(c)));
  const dur = Number(t.attrs['p14:dur']) || SPD[t.attrs.spd ?? 'fast'] || 500;
  let id: string | undefined, option: string | undefined;
  if (fx) {
    const n = local(fx), a = fx.attrs;
    if (n === 'prstTrans') { id = P15[a.prst ?? ''] ?? 'fade'; if (a.invX === '1') option = 'r'; }
    else if (n === 'pull') { id = 'uncover'; option = a.dir; }
    else if (n === 'split') { id = 'split'; option = `${a.orient === 'horz' ? 'horz' : 'vert'}${a.dir === 'in' ? 'In' : 'Out'}`; }
    else if (n === 'circle' || n === 'diamond' || n === 'plus') { id = 'shape'; option = n; }
    else if (n === 'wheel' || n === 'wheelReverse') { id = 'clock'; option = n === 'wheelReverse' ? 'counterClockwise' : 'clockwise'; }
    else if (n === 'wedge') { id = 'clock'; option = 'wedge'; }
    else if (n === 'strips' || n === 'newsflash' || n === 'warp' || n === 'prism') { id = n === 'prism' ? 'cube' : n === 'warp' ? 'zoom' : 'wipe'; out.approximated.push(`화면 전환 '${n}'`); }
    else if (n === 'fade' || n === 'cut') { id = n; if (a.thruBlk === '1' || a.thruBlk === 'true') option = 'throughBlack'; else if (n === 'fade') option = 'smoothly'; }
    else if (SAME.has(n)) { id = n; option = a.dir ?? (a.orient ? a.orient : undefined); }
    else { id = 'fade'; out.approximated.push(`화면 전환 '${n}'`); }
  }
  if (id && id !== 'cut' || option === 'throughBlack') out.transition = { kind: `fx:${id ?? 'cut'}`, duration: dur, ...(option ? { option } : {}) };
  if (t.attrs.advClick === '0' || t.attrs.advClick === 'false') out.transition = { ...(out.transition ?? { kind: 'cut', duration: 1 }), advanceOnClick: false };
  if (t.attrs.advTm && Number(t.attrs.advTm) >= 0) out.autoAdvance = Math.round(Number(t.attrs.advTm) / 100) / 10;
  if (child(t, 'sndAc')) out.dropped.push('화면 전환 소리');
  return out;
}

const DIR: Record<number, string> = { 1: 't', 2: 'r', 4: 'b', 8: 'l', 3: 'rt', 6: 'rb', 12: 'lb', 9: 'lt' };
type Preset = [effect: string, option?: (sub: number) => string | undefined];
const dir4 = (sub: number) => ({ 1: 't', 2: 'r', 4: 'b', 8: 'l' } as Record<number, string>)[sub];
const hv = (sub: number) => (sub === 5 ? 'vert' : 'horz');
const inOut = (sub: number) => (sub === 32 ? 'out' : 'in');
const ENTR: Record<number, Preset> = {
  1: ['appear'], 2: ['fly', (s) => DIR[s] ?? 'b'], 3: ['blinds', hv], 4: ['box', inOut], 5: ['checkerboard', (s) => (s === 5 ? 'down' : 'across')], 6: ['circle', inOut],
  8: ['diamond', inOut], 9: ['dissolve'], 10: ['fade'], 12: ['peek', dir4], 13: ['shape', (s) => (s === 32 ? 'plusOut' : 'plusIn')], 14: ['randomBars', hv],
  16: ['split', (s) => ({ 21: 'horzIn', 26: 'vertIn', 37: 'horzOut', 42: 'vertOut' } as Record<number, string>)[s] ?? 'vertOut'], 18: ['strips', (s) => DIR[s]], 19: ['swivel', (s) => (s === 5 ? 'vert' : 'horz')],
  21: ['wheel', (s) => String([1, 2, 3, 4, 8].includes(s) ? s : 1)], 22: ['wipe', dir4], 23: ['zoom', inOut], 26: ['bounce'], 31: ['grow'], 37: ['rise'], 42: ['float', () => 'u'],
  47: ['float', () => 'd'], 49: ['spinner'], 53: ['grow'], 55: ['expand'], 45: ['swivel', () => 'horz'],
};
const EXIT: Record<number, Preset> = {
  1: ['disappear'], 2: ['flyOut', (s) => DIR[s] ?? 'b'], 3: ['blindsOut', hv], 4: ['boxOut', inOut], 5: ['checkerboardOut', (s) => (s === 5 ? 'down' : 'across')], 6: ['shapeOut', (s) => (s === 32 ? 'circleOut' : 'circleIn')],
  8: ['diamondOut', inOut], 9: ['dissolveOut'], 10: ['fadeOut'], 12: ['peekOut', dir4], 14: ['randomBarsOut', hv],
  16: ['splitOut', (s) => ({ 21: 'horzIn', 26: 'vertIn', 37: 'horzOut', 42: 'vertOut' } as Record<number, string>)[s] ?? 'vertOut'], 18: ['stripsOut', (s) => DIR[s]], 19: ['swivelOut', (s) => (s === 5 ? 'vert' : 'horz')],
  21: ['wheelOut', (s) => String([1, 2, 3, 4, 8].includes(s) ? s : 1)], 22: ['wipeOut', dir4], 23: ['zoomOut', inOut], 26: ['bounceOut'], 31: ['shrinkTurn'], 37: ['sinkDown'], 42: ['floatOut', () => 'u'], 47: ['floatOut', () => 'd'], 49: ['spinnerOut'], 53: ['contract'], 55: ['contract'],
};
const EMPH: Record<number, Preset> = {
  1: ['fillColor'], 3: ['fontColor'], 6: ['growShrink', () => 'both'], 7: ['lineColor'], 8: ['spin', () => 'clockwise'], 9: ['transparency'], 19: ['objectColor'],
  26: ['pulse'], 27: ['colorPulse'], 32: ['teeter'], 34: ['wave'], 35: ['boldFlash'], 36: ['darken'], 37: ['lighten'], 38: ['desaturate'], 39: ['complementaryColor'], 18: ['underline'],
};

export interface AnimationResult { animations: SlideAnimation[]; approximated: string[]; dropped: string[] }

const attrNum = (v: string | undefined) => (v === undefined || v === 'indefinite' || !Number.isFinite(Number(v)) ? undefined : Number(v));

/** p:timing → animations of the objects `targets` maps (shape id → element ids). */
export function readAnimations(slide: MNode, targets: Map<string, string[]>): AnimationResult {
  const out: AnimationResult = { animations: [], approximated: [], dropped: [] };
  const timing = child(slide, 'timing');
  if (!timing) return out;
  const byPara = new Set(find(timing, 'bldP').filter((b) => b.attrs.build && b.attrs.build !== 'whole').map((b) => b.attrs.spid));
  for (const seq of find(timing, 'seq')) {
    const root = child(seq, 'cTn');
    const kind = root?.attrs.nodeType;
    if (kind !== 'mainSeq' && kind !== 'interactiveSeq') continue;
    const triggerSp = kind === 'interactiveSeq' ? find(child(root, 'stCondLst') ?? { name: '', attrs: {}, children: [] }, 'spTgt')[0]?.attrs.spid : undefined;
    const effects = find(root!, 'cTn').filter((c) => c.attrs.presetClass);
    for (const e of effects) {
      const tgt = find(e, 'spTgt')[0];
      const els = tgt ? targets.get(tgt.attrs.spid) : undefined;
      if (!els?.length) { out.dropped.push('대상이 없는 애니메이션'); continue; }
      const cls = e.attrs.presetClass;
      const pid = Number(e.attrs.presetID ?? 0), sub = Number(e.attrs.presetSubtype ?? 0);
      const durs = find(e, 'cTn').map((c) => attrNum(c.attrs.dur)).filter((v): v is number => v !== undefined && v > 1);
      const delay = attrNum(find(child(e, 'stCondLst') ?? { name: '', attrs: {}, children: [] }, 'cond')[0]?.attrs.delay) ?? 0;
      const start: SlideAnimation['start'] = e.attrs.nodeType === 'withEffect' ? 'with' : e.attrs.nodeType === 'afterEffect' ? 'after' : 'click';
      let a: Omit<SlideAnimation, 'id' | 'elementId' | 'start'> | null = null;
      if (cls === 'path') {
        const motion = find(e, 'animMotion')[0];
        const p = motion?.attrs.path?.replace(/\s*E\s*$/i, '').trim();
        a = { effect: 'customPath', class: 'path', durationMs: Math.max(...durs, 500), delayMs: delay, ...(p ? { path: p } : {}) };
      } else {
        const table = cls === 'entr' ? ENTR : cls === 'exit' ? EXIT : cls === 'emph' ? EMPH : null;
        // A Play effect on a clip is the clip's own playback (automatic or on click: readMediaTiming); Pause and Stop are dropped.
        if (!table && cls === 'mediacall' && pid !== 2 && pid !== 3) continue;
        if (!table) { out.dropped.push('미디어 재생 효과'); continue; }
        const preset = table[pid];
        if (!preset) out.approximated.push(`애니메이션 효과 (${cls === 'entr' ? '나타내기' : cls === 'exit' ? '끝내기' : '강조'} ${pid})`);
        const [effect, opt] = preset ?? (cls === 'entr' ? ['fade'] : cls === 'exit' ? ['fadeOut'] : ['pulse']);
        const option = opt?.(sub);
        a = { effect, class: cls === 'entr' ? 'entrance' : cls === 'exit' ? 'exit' : 'emphasis', durationMs: Math.max(...durs, cls === 'entr' && effect === 'appear' ? 0 : 500), delayMs: delay, ...(option ? { option } : {}) };
      }
      const repeat = attrNum(e.attrs.repeatCount);
      const triggerIds = triggerSp ? targets.get(triggerSp) : undefined;
      els.forEach((elementId, i) => out.animations.push({
        id: uid('an'), elementId, start: i === 0 ? start : 'with', ...a!,
        ...(repeat && repeat > 1000 ? { repeat: Math.round(repeat / 1000) } : {}),
        ...(byPara.has(tgt!.attrs.spid) && a!.class !== 'path' ? { sequence: 'paragraph' as const } : {}),
        ...(triggerIds?.[0] ? { trigger: triggerIds[0] } : {}),
      }));
    }
  }
  out.approximated = [...new Set(out.approximated)];
  return out;
}

// ── Audio and video playback (p:video / p:audio > p:cMediaNode), after DeckCraft's read/timing.rs media_settings ──

const delayOf = (c: MNode) => c.attrs.delay?.trim();
const condsOf = (st: MNode) => kids(st, 'cond');

/** Whether a start condition list (p:stCondLst) holds its node back (a click, another event, a targeted onBegin, a delay) instead of starting it with its parent. */
export function defersStart(st: MNode): boolean {
  const autoBegin = (c: MNode) => c.attrs.evt === 'onBegin' && delayOf(c) === '0' && !child(c, 'tgtEl') && !child(c, 'tn') && !child(c, 'rtn');
  const conds = condsOf(st);
  const hasOnBegin = conds.some(autoBegin);
  return conds.some((c) => (!!c.attrs.evt && !autoBegin(c)) || (!hasOnBegin && delayOf(c) !== '0'));
}

/** PowerPoint's wrapper of an automatic main-sequence step: `delay="indefinite"` with only an `onBegin` of the enclosing mainSeq (`p:tn val` = its id). */
function isMainSeqAuto(st: MNode, mainSeqId: string | undefined): boolean {
  if (!mainSeqId) return false;
  const bare = (c: MNode) => !child(c, 'tgtEl') && !child(c, 'rtn');
  const indefinite = (c: MNode) => !c.attrs.evt && delayOf(c) === 'indefinite' && bare(c) && !child(c, 'tn');
  const onMainSeq = (c: MNode) => c.attrs.evt === 'onBegin' && delayOf(c) === '0' && bare(c) && child(c, 'tn')?.attrs.val?.trim() === mainSeqId;
  const conds = condsOf(st);
  return conds.some(indefinite) && conds.some(onMainSeq) && conds.every((c) => indefinite(c) || onMainSeq(c));
}

interface Effect { ctn: MNode; triggered: boolean; offset: number; deferred: boolean }

/** The effects of a time tree in document order, with what holds each back (DeckCraft's `collect`). */
function effectsOf(n: MNode, at: { triggered: boolean; mainSeqId?: string; offset: number; deferred: boolean }, out: Effect[], depth = 0): Effect[] {
  if (depth > 64 || out.length > 10_000) return out;
  for (const c of n.children) {
    if (c.name === '#text') continue;
    const name = local(c);
    if (name === 'cTn' && c.attrs.presetClass) {
      const st = child(c, 'stCondLst');
      out.push({ ctn: c, triggered: at.triggered, offset: at.offset, deferred: at.deferred || (!!st && defersStart(st)) });
      continue;
    }
    const next = { ...at };
    if (name === 'seq' && child(c, 'cTn')?.attrs.nodeType === 'interactiveSeq') { next.triggered = true; next.mainSeqId = undefined; }
    if (name === 'cTn') {
      const isMainSeq = c.attrs.nodeType === 'mainSeq';
      const st = child(c, 'stCondLst');
      if (st) {
        if (!(!isMainSeq && !next.deferred && isMainSeqAuto(st, next.mainSeqId)) && defersStart(st)) next.deferred = true;
        const first = condsOf(st)[0];
        if (first) next.offset = delayOf(first) === 'indefinite' ? 0 : next.offset + (attrNum(first.attrs.delay) ?? 0);
      }
      next.mainSeqId = isMainSeq && !next.deferred ? c.attrs.id?.trim() : undefined;
    }
    effectsOf(c, next, out, depth + 1);
  }
  return out;
}

/**
 * Playback settings of the slide's clips, by element id: volume and mute, 슬라이드 쇼 동안 숨기기
 * (showWhenStopped="0"), 반복 재생 (repeatCount="indefinite"), 재생 후 되감기 (fill="remove"),
 * 여러 슬라이드에서 재생 (numSld > 1), 전체 화면 재생 (fullScrn, video only), and 자동 실행: the media
 * node's own start is immediate and nothing above it waits, or a Play effect leads the main sequence
 * with no click, delay or event before it.
 */
export function readMediaTiming(slide: MNode, targets: Map<string, string[]>): Map<string, MediaPlayback> {
  const out = new Map<string, MediaPlayback>();
  const timing = child(slide, 'timing');
  if (!timing) return out;
  const set = (spid: string | undefined, patch: MediaPlayback) => {
    for (const id of (spid && targets.get(spid)) || []) out.set(id, { ...out.get(id), ...patch });
  };
  const nodes: { node: MNode; deferred: boolean }[] = [];
  const walk = (n: MNode, deferred: boolean, depth: number) => {
    if (depth > 64 || nodes.length >= 10_000) return;
    const st = local(n) === 'cTn' ? child(n, 'stCondLst') : null;
    if (st && defersStart(st)) deferred = true;
    if (local(n) === 'video' || local(n) === 'audio') { nodes.push({ node: n, deferred }); return; }
    for (const c of n.children) if (c.name !== '#text') walk(c, deferred, depth + 1);
  };
  walk(timing, false, 0);
  for (const { node, deferred } of nodes) {
    const cm = child(node, 'cMediaNode');
    const spid = find(child(cm, 'tgtEl') ?? { name: '', attrs: {}, children: [] }, 'spTgt')[0]?.attrs.spid;
    if (!cm || !spid) continue;
    const ctn = child(cm, 'cTn');
    const pb: MediaPlayback = {};
    const vol = attrNum(cm.attrs.vol);
    if (vol !== undefined && vol < 100000) pb.volume = Math.max(0, vol / 100000);
    if (cm.attrs.mute === '1' || cm.attrs.mute === 'true') pb.muted = true;
    if (cm.attrs.showWhenStopped === '0' || cm.attrs.showWhenStopped === 'false') pb.hideDuringShow = true;
    if (ctn?.attrs.repeatCount === 'indefinite') pb.loop = true;
    if (ctn?.attrs.fill === 'remove') pb.rewind = true;
    if ((attrNum(cm.attrs.numSld) ?? 0) > 1) pb.acrossSlides = true;
    const own = condsOf(child(ctn, 'stCondLst') ?? { name: '', attrs: {}, children: [] })[0];
    if (!deferred && own && !own.attrs.evt && delayOf(own) === '0') pb.autoplay = true;
    if (local(node) === 'video' && (node.attrs.fullScrn === '1' || node.attrs.fullScrn === 'true')) pb.fullScreen = true;
    set(spid, pb);
  }
  // A Play effect at the head of the main sequence (Start: With / After Previous, no delay) starts the clip with the slide.
  const root = path(timing, 'tnLst', 'par', 'cTn', 'stCondLst');
  const tn = child(timing, 'tnLst');
  if (tn && !(root && defersStart(root))) {
    for (const e of effectsOf(tn, { triggered: false, offset: 0, deferred: false }, []).filter((f) => !f.triggered)) {
      if (e.ctn.attrs.nodeType === 'clickEffect' || e.deferred) break;
      const pid = Number(e.ctn.attrs.presetID ?? 0);
      const delay = attrNum(condsOf(child(e.ctn, 'stCondLst') ?? { name: '', attrs: {}, children: [] })[0]?.attrs.delay) ?? 0;
      if (e.ctn.attrs.presetClass === 'mediacall' && pid !== 2 && pid !== 3 && e.offset === 0 && delay === 0) set(find(e.ctn, 'spTgt')[0]?.attrs.spid, { autoplay: true });
    }
  }
  return out;
}
