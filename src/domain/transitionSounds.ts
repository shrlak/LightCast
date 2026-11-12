// Transitions › Sound's built-in sounds, synthesised on demand (DeckCraft sounds.rs) so LightCast
// ships no sound files: short mono 16-bit WAVs named like PowerPoint's.

/** (id, Korean label) in menu order. */
export const BUILTIN_SOUNDS: [string, string][] = [['chime', '차임'], ['click', '클릭'], ['camera', '카메라'], ['whoosh', '휙'], ['drumRoll', '드럼 롤'], ['laser', '레이저']];

const RATE = 22050;
const TAU = Math.PI * 2;

/** A small deterministic noise source (-1..1), as DeckCraft's. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 8) / (1 << 23) - 1;
  };
}

const attack = (t: number, len: number) => Math.min(1, t / len);
function tone(secs: number, f: (t: number) => number): number[] {
  const n = Math.floor(secs * RATE);
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = f(i / RATE);
  return out;
}

/** The samples (-1..1) of built-in sound `id`, or null for an unknown id. */
export function soundSamples(id: string): number[] | null {
  const noise = lcg(0x9e3779b9);
  switch (id) {
    case 'chime': return tone(1.2, (t) => Math.exp(-t * 3) * attack(t, 0.005) * (0.6 * Math.sin(TAU * 880 * t) + 0.3 * Math.sin(TAU * 1318.5 * t) + 0.15 * Math.sin(TAU * 1760 * t)));
    case 'click': return tone(0.03, (t) => Math.exp(-t * 300) * noise());
    case 'camera': return tone(0.35, (t) => (Math.exp(-t * 250) + 0.8 * (t > 0.18 ? Math.exp(-(t - 0.18) * 180) : 0)) * noise());
    case 'whoosh': {
      // Noise through a low-pass filter that opens and closes.
      let lp = 0;
      return tone(0.7, (t) => { const k = 0.02 + 0.25 * Math.sin((Math.PI * t) / 0.7); lp += k * (noise() - lp); return 3 * lp * Math.sin((Math.PI * t) / 0.7); });
    }
    case 'drumRoll': return tone(1.4, (t) => {
      const beat = ((t * 24) % 1) / 24;
      return (0.4 + 0.6 * (t / 1.4)) * Math.exp(-beat * 90) * (0.7 * noise() + 0.5 * Math.sin(TAU * 110 * t));
    });
    case 'laser': {
      let phase = 0;
      return tone(0.5, (t) => { phase += (TAU * (2400 * Math.exp(-t * 5) + 200)) / RATE; return Math.exp(-t * 4) * attack(t, 0.003) * Math.sign(Math.sin(phase)) * 0.35; });
    }
    default: return null;
  }
}

/** A mono 16-bit PCM WAV of `samples`. */
export function wavBytes(samples: number[]): Uint8Array<ArrayBuffer> {
  const data = samples.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, data, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.trunc(Math.max(-1, Math.min(1, s)) * 0.8 * 32767), true));
  return new Uint8Array(buf);
}

/** The WAV file of built-in sound `id` (named like PowerPoint's), or null. */
export function builtinSound(id: string): File | null {
  const s = soundSamples(id);
  const label = BUILTIN_SOUNDS.find((b) => b[0] === id)?.[1];
  return s && label ? new File([wavBytes(s)], `${label}.wav`, { type: 'audio/wav' }) : null;
}
