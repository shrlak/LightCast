// Format Background (배경 서식) fills after DeckCraft's design.background (crates/engine/src/cmd/
// design/slide_background.rs, MIT OR Apache-2.0): solid with transparency, gradient (linear or
// radial, angle, two stops) and pattern. Backgrounds draw as CSS or SVG.

/** `#rrggbb` with 0–1 transparency as a CSS colour. */
export function withTransparency(hex: string, transparency: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const t = Math.max(0, Math.min(1, transparency));
  if (!m) return hex;
  if (!t) return `#${m[1].toLowerCase()}`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round((1 - t) * 100) / 100})`;
}

/** The transparency (0–1) of a colour made by {@link withTransparency}; 0 for a plain colour. */
export function transparencyOf(css: string): number {
  const m = /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)$/.exec(css.trim());
  return m ? Math.round((1 - Number(m[1])) * 100) / 100 : 0;
}

/** `#rrggbb` of a colour made by {@link withTransparency} (black when it cannot be read). */
export function hexOf(css: string): string {
  const m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(css.trim());
  if (m) return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  return /^#[0-9a-f]{6}$/i.test(css.trim()) ? css.trim().toLowerCase() : '#000000';
}

export interface GradientSpec { type: 'linear' | 'radial'; angle: number; from: string; to: string }

const STOP = '(#[0-9a-f]{6})';

/** A two-stop gradient as a CSS background image (PowerPoint's angle 0 points right, turning clockwise). */
export function gradientCss(g: GradientSpec): string {
  const angle = ((Math.round(g.angle) % 360) + 360) % 360;
  return g.type === 'radial' ? `radial-gradient(circle at 50% 50%, ${g.from} 0%, ${g.to} 100%)` : `linear-gradient(${(angle + 90) % 360}deg, ${g.from} 0%, ${g.to} 100%)`;
}

/** Read a gradient made by {@link gradientCss} back into its fields (null for any other CSS). */
export function parseGradient(css: string): GradientSpec | null {
  const lin = new RegExp(`^linear-gradient\\((\\d+)deg, ${STOP} 0%, ${STOP} 100%\\)$`, 'i').exec(css.trim());
  if (lin) return { type: 'linear', angle: (Number(lin[1]) + 270) % 360, from: lin[2], to: lin[3] };
  const rad = new RegExp(`^radial-gradient\\(circle at 50% 50%, ${STOP} 0%, ${STOP} 100%\\)$`, 'i').exec(css.trim());
  return rad ? { type: 'radial', angle: 0, from: rad[1], to: rad[2] } : null;
}
