// Behringer X32 / M32 mixer control: which strips LightCast can operate, their OSC addresses, every
// processing parameter (gain, low cut, gate, compressor, EQ, pan, sends) with the console's own units,
// and the X32 steps of macros and slide actions. The LightCast server (server/x32.mjs) talks to the
// mixer; this file is the shared vocabulary.
import type { MacroStep } from './types';

export type X32Step = Extract<MacroStep, { type: 'x32' }>;
export type X32Values = Record<string, number | string>;

export interface X32Strip {
  /** 'ch/05', 'auxin/02', 'fxrtn/01', 'bus/03', 'mtx/02', 'dca/2', 'main/st' or 'main/m'. */
  id: string;
  kind: 'ch' | 'auxin' | 'fxrtn' | 'bus' | 'mtx' | 'dca' | 'main';
  label: string;
}

const two = (n: number) => String(n).padStart(2, '0');
const strips = (count: number, kind: X32Strip['kind'], label: string, pad = true) =>
  Array.from({ length: count }, (_, i): X32Strip => ({ id: `${kind}/${pad ? two(i + 1) : i + 1}`, kind, label: `${label} ${pad ? two(i + 1) : i + 1}` }));
/** Every fader of the X32, in console order. */
export const X32_STRIPS: X32Strip[] = [
  ...strips(32, 'ch', 'Ch'),
  ...strips(8, 'auxin', 'Aux'),
  ...strips(8, 'fxrtn', 'FX'),
  ...strips(16, 'bus', 'Bus'),
  ...strips(6, 'mtx', 'Mtx'),
  ...strips(8, 'dca', 'DCA', false),
  { id: 'main/m', kind: 'main', label: 'M/C' },
  { id: 'main/st', kind: 'main', label: 'Main LR' },
];
export const isStrip = (id: unknown): id is string => typeof id === 'string' && X32_STRIPS.some((s) => s.id === id);

/** OSC address of a strip's mute switch (1 = on, 0 = muted) and fader (0–1). */
export function stripAddress(id: string, what: 'on' | 'fader' | 'name'): string {
  if (what === 'name') return id === 'main/st' ? '' : `/${id}/config/name`;
  return id.startsWith('dca/') ? `/${id}/${what}` : `/${id}/mix/${what}`;
}
export const SCENE_ADDRESS = '/-action/goscene';
export const CURRENT_SCENE = '/-show/prepos/current';
export const sceneNameAddress = (n: number) => `/-show/showfile/scene/${String(n).padStart(3, '0')}/name`;

/** “Ch 05 · 설교자” — the scribble-strip name read from the mixer when it has one. */
export function stripName(id: string, values: X32Values): string {
  const strip = X32_STRIPS.find((s) => s.id === id);
  const label = strip?.label ?? id;
  const name = strip && strip.kind !== 'main' ? values[stripAddress(id, 'name')] : undefined;
  return typeof name === 'string' && name.trim() ? `${label} · ${name.trim()}` : label;
}

/** The scribble-strip name alone (“Pastor”), or the strip's label when it has none (“Ch 05”). */
export function shortName(id: string, values: X32Values): string {
  const strip = X32_STRIPS.find((s) => s.id === id);
  const name = strip && strip.kind !== 'main' ? values[stripAddress(id, 'name')] : undefined;
  return typeof name === 'string' && name.trim() ? name.trim() : strip?.label ?? id;
}

/**
 * Scribble-strip colour as the console shows it (config/color 0–15: off, red, green, yellow, blue,
 * magenta, cyan, white; 8–15 the same, inverted).
 */
const SCRIBBLE = ['#1b1d22', '#e5484d', '#3dbb6b', '#f2c94c', '#3b82f6', '#d946ef', '#22d3ee', '#f1f5f9'];
export function scribbleColor(id: string, values: X32Values): { background: string; color: string; inverted: boolean } {
  const raw = values[`/${id}/config/color`];
  const n = typeof raw === 'number' && raw >= 0 && raw <= 15 ? raw : 0;
  const hue = SCRIBBLE[n % 8];
  const inverted = n >= 8;
  const dark = n % 8 === 0;
  if (inverted) return { background: '#0b0c0f', color: dark ? '#9aa0aa' : hue, inverted };
  return { background: hue, color: dark || n % 8 === 4 || n % 8 === 5 || n % 8 === 1 ? '#f8fafc' : '#0b0c0f', inverted };
}

/** Move a fader by whole dB, as the arrow keys do (always at least one fader step, never past +10 / −∞). */
export function nudgeFader(f: number, deltaDb: number): number {
  const db = faderToDb(f);
  const from = Number.isFinite(db) ? db : -90;
  const next = dbToFader(Math.max(-90, Math.min(10, from + deltaDb)));
  const step = 1 / 1023;
  if (deltaDb > 0) return Math.min(1, Math.max(next, f + step));
  return Math.max(0, Math.min(next, f - step));
}

/** The dB marks printed beside an X32 fader, at their fader positions. */
export const FADER_MARKS: { label: string; at: number }[] = [10, 5, 0, -5, -10, -20, -30, -40, -50].map((db) => ({ label: db > 0 ? `+${db}` : String(db), at: dbToFader(db) }))
  .concat([{ label: '−∞', at: 0 }]);

/** Monitor mix names for the sends: “Bus 03 · 드럼 모니터”. */
export const busName = (n: number, values: X32Values) => stripName(`bus/${two(n)}`, values);

/* ---------- Processing parameters, as the console shows them ---------- */

export type X32ParamKind =
  | { type: 'lin'; min: number; max: number; unit: string; digits?: number }
  | { type: 'log'; min: number; max: number; unit: string }
  | { type: 'enum'; options: string[] }
  | { type: 'bool' }
  | { type: 'level' }
  | { type: 'pan' };

export interface X32Param {
  /** Path under the strip, e.g. 'dyn/thr' → /ch/05/dyn/thr. */
  key: string;
  label: string;
  kind: X32ParamKind;
}

export interface X32Section {
  id: 'preamp' | 'gate' | 'dyn' | 'eq' | 'sends';
  title: string;
  /** The section's on switch, when it has one. */
  on?: string;
  params: X32Param[];
  /** EQ bands are shown side by side. */
  bands?: { label: string; params: X32Param[] }[];
}

const bool = (key: string, label: string): X32Param => ({ key, label, kind: { type: 'bool' } });
const lin = (key: string, label: string, min: number, max: number, unit: string, digits?: number): X32Param => ({ key, label, kind: { type: 'lin', min, max, unit, digits } });
const log = (key: string, label: string, min: number, max: number, unit: string): X32Param => ({ key, label, kind: { type: 'log', min, max, unit } });
const choice = (key: string, label: string, options: string[]): X32Param => ({ key, label, kind: { type: 'enum', options } });

export const EQ_TYPES = ['로우 컷', '로우 셸프', 'PEQ', 'VEQ', '하이 셸프', '하이 컷'];
export const RATIOS = ['1.1', '1.3', '1.5', '2.0', '2.5', '3.0', '4.0', '5.0', '7.0', '10', '20', '100'];

const eqBands = (count: number) => Array.from({ length: count }, (_, i) => ({
  label: `${i + 1}밴드`,
  params: [
    choice(`eq/${i + 1}/type`, '종류', EQ_TYPES),
    log(`eq/${i + 1}/f`, '주파수', 20, 20000, 'Hz'),
    lin(`eq/${i + 1}/g`, '게인', -15, 15, 'dB', 1),
    log(`eq/${i + 1}/q`, 'Q', 10, 0.3, ''),
  ],
}));

const PREAMP: X32Section = {
  id: 'preamp', title: '게인 · 로우 컷',
  params: [lin('preamp/trim', '트림', -18, 18, 'dB', 1), bool('preamp/invert', '위상 반전'), bool('preamp/hpon', '로우 컷'), log('preamp/hpf', '로우 컷 주파수', 20, 400, 'Hz'), choice('preamp/hpslope', '기울기', ['12 dB/oct', '18 dB/oct', '24 dB/oct'])],
};
const GATE: X32Section = {
  id: 'gate', title: '게이트', on: 'gate/on',
  params: [choice('gate/mode', '모드', ['EXP 2:1', 'EXP 3:1', 'EXP 4:1', 'GATE', 'DUCK']), lin('gate/thr', '스레숄드', -80, 0, 'dB', 1), lin('gate/range', '레인지', 3, 60, 'dB', 1), lin('gate/attack', '어택', 0, 120, 'ms'), log('gate/hold', '홀드', 0.02, 2000, 'ms'), log('gate/release', '릴리즈', 5, 4000, 'ms')],
};
const DYN: X32Section = {
  id: 'dyn', title: '컴프레서', on: 'dyn/on',
  params: [
    choice('dyn/mode', '모드', ['컴프레서', '익스팬더']), lin('dyn/thr', '스레숄드', -60, 0, 'dB', 1), choice('dyn/ratio', '비율', RATIOS.map((r) => `${r}:1`)),
    lin('dyn/knee', '니', 0, 5, ''), lin('dyn/attack', '어택', 0, 120, 'ms'), log('dyn/hold', '홀드', 0.02, 2000, 'ms'), log('dyn/release', '릴리즈', 5, 4000, 'ms'),
    lin('dyn/mgain', '메이크업 게인', 0, 24, 'dB', 1), lin('dyn/mix', '믹스', 0, 100, '%'), bool('dyn/auto', '자동 타임'),
    choice('dyn/det', '감지', ['PEAK', 'RMS']), choice('dyn/env', '엔벨로프', ['LIN', 'LOG']),
  ],
};
const eq = (count: number): X32Section => ({ id: 'eq', title: `EQ (${count}밴드)`, on: 'eq/on', params: [], bands: eqBands(count) });
const SENDS: X32Section = {
  id: 'sends', title: '모니터 센드 (Bus 1–16)',
  params: Array.from({ length: 16 }, (_, i) => ({ key: `mix/${two(i + 1)}/level`, label: `Bus ${two(i + 1)}`, kind: { type: 'level' } as const })),
};

/** The console's processing for each kind of strip (DCAs only have a fader and mute). */
export function stripSections(kind: X32Strip['kind']): X32Section[] {
  if (kind === 'ch') return [PREAMP, GATE, DYN, eq(4), SENDS];
  if (kind === 'auxin') return [{ ...PREAMP, title: '게인', params: PREAMP.params.filter((p) => p.key === 'preamp/trim' || p.key === 'preamp/invert') }, eq(4), SENDS];
  if (kind === 'fxrtn') return [eq(4), SENDS];
  if (kind === 'bus' || kind === 'mtx' || kind === 'main') return [DYN, eq(6)];
  return [];
}

/** Every OSC address an editor shows, to read when it opens. */
export function stripAddresses(id: string): string[] {
  const strip = X32_STRIPS.find((s) => s.id === id);
  if (!strip || strip.kind === 'dca') return [];
  const out = id === 'main/m' ? [] : [`/${id}/mix/pan`];
  for (const sec of stripSections(strip.kind)) {
    if (sec.on) out.push(`/${id}/${sec.on}`);
    for (const p of [...sec.params, ...(sec.bands ?? []).flatMap((b) => b.params)]) out.push(`/${id}/${p.key}`);
    if (sec.id === 'sends') for (let n = 1; n <= 16; n++) out.push(`/${id}/mix/${two(n)}/on`, `/bus/${two(n)}/config/name`);
  }
  return [...new Set(out)];
}

/** The mixer's 0–1 value → the number the console shows (dB, Hz, ms…). */
export function paramValue(kind: X32ParamKind, raw: number): number {
  if (kind.type === 'lin') return kind.min + raw * (kind.max - kind.min);
  if (kind.type === 'log') return kind.min * Math.pow(kind.max / kind.min, raw);
  if (kind.type === 'level') return faderToDb(raw);
  if (kind.type === 'pan') return Math.round((raw - 0.5) * 200);
  return raw;
}

export function formatParam(kind: X32ParamKind, raw: number | string | undefined): string {
  if (typeof raw !== 'number') return '…';
  if (kind.type === 'bool') return raw ? '켜짐' : '꺼짐';
  if (kind.type === 'enum') return kind.options[raw] ?? String(raw);
  if (kind.type === 'level') return formatDb(raw);
  if (kind.type === 'pan') { const p = paramValue(kind, raw); return p === 0 ? 'C' : p < 0 ? `L${-p}` : `R${p}`; }
  const v = paramValue(kind, raw);
  if (kind.unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`;
  if (kind.unit === 'ms') return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
  if (kind.type === 'log') return v.toFixed(v < 1 ? 2 : 1);
  const digits = kind.digits ?? (Math.abs(kind.max - kind.min) <= 10 ? 1 : 0);
  const text = v.toFixed(digits);
  return `${kind.unit === 'dB' && v > 0 ? '+' : ''}${text}${kind.unit ? ` ${kind.unit}` : ''}`;
}

export const PAN: X32ParamKind = { type: 'pan' };

export function sceneName(n: number, values: X32Values): string {
  const name = values[sceneNameAddress(n)];
  return typeof name === 'string' && name.trim() ? `${two(n)} · ${name.trim()}` : two(n);
}

/** X32 fader position (0–1) → dB, as the console shows it (−∞ at the bottom, +10 at the top). */
export function faderToDb(f: number): number {
  if (f <= 0) return -Infinity;
  if (f >= 0.5) return f * 40 - 30;
  if (f >= 0.25) return f * 80 - 50;
  if (f >= 0.0625) return f * 160 - 70;
  return f * 480 - 90;
}

/** dB → X32 fader position, on the console's 1024 steps. */
export function dbToFader(db: number): number {
  const f = db <= -90 ? 0 : db < -60 ? (db + 90) / 480 : db < -30 ? (db + 70) / 160 : db < -10 ? (db + 50) / 80 : (db + 30) / 40;
  return Math.round(Math.min(1, Math.max(0, f)) * 1023) / 1023;
}

export function formatDb(f: number): string {
  const db = faderToDb(f);
  if (!Number.isFinite(db) || db <= -89.5) return '−∞ dB';
  const r = Math.round(db * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)} dB`;
}

/** The OSC change a step makes, or null when the step is incomplete. */
export function x32Message(step: X32Step): { address: string; value: number } | null {
  if (step.action === 'scene') return Number.isInteger(step.scene) && step.scene >= 0 && step.scene <= 99 ? { address: SCENE_ADDRESS, value: step.scene } : null;
  if (!isStrip(step.strip)) return null;
  if (step.action === 'fader') return typeof step.value === 'number' && step.value >= 0 && step.value <= 1 ? { address: stripAddress(step.strip, 'fader'), value: step.value } : null;
  return { address: stripAddress(step.strip, 'on'), value: step.action === 'mute' ? 0 : 1 };
}

export function describeX32Step(step: X32Step, values: X32Values = {}): string {
  if (step.action === 'scene') return `X32 장면 불러오기 ${sceneName(step.scene, values)}`;
  const name = stripName(step.strip, values);
  if (step.action === 'fader') return `X32 ${name} 페이더 ${formatDb(step.value ?? 0)}`;
  return `X32 ${name} ${step.action === 'mute' ? '뮤트' : '뮤트 해제'}`;
}

export interface X32Settings {
  on: boolean;
  /** The mixer's address (X32 SETUP → network). */
  ip: string;
}

const KEY = 'freecast.x32';
/** 0.7.3 kept the X32 address with the (now removed) MIDI settings. */
const OLD_KEY = 'freecast.midi.v2';

export function normalizeX32Settings(value: unknown): X32Settings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<X32Settings>;
  return { on: v.on === true, ip: typeof v.ip === 'string' ? v.ip.trim().slice(0, 15) : '' };
}

/** Saved per computer: the mixer is on this church's network, not part of the shared library. */
export function loadX32Settings(): X32Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeX32Settings(JSON.parse(raw));
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null') as { enabled?: boolean; network?: X32Settings } | null;
    return normalizeX32Settings(old?.network ? { ...old.network, on: old.network.on === true && old.enabled === true } : null);
  } catch {
    return normalizeX32Settings(null);
  }
}

export function saveX32Settings(s: X32Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the setting lasts until LightCast is closed */
  }
}
