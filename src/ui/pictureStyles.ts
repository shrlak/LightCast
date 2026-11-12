// Picture Format › Picture Styles drawn with CSS: the frame, shape, shadow, soft edge, reflection
// and bevel of DeckCraft's 24 styles (domain/pictureFormat), in canvas pixels (2 per point).
import type { CSSProperties } from 'react';
import { pictureLook, type PictureLook } from '../domain/pictureFormat';

const SHADOW: Record<NonNullable<PictureLook['shadow']>, string> = {
  // DeckCraft: 40 % black; soft 3 pt at 45° blurred 4 pt, drop 6 pt down blurred 12 pt, centre 0 pt blurred 16 pt.
  soft: '4px 4px 8px rgba(0,0,0,.4)',
  drop: '0 12px 24px rgba(0,0,0,.4)',
  center: '0 0 32px rgba(0,0,0,.4)',
  // Cast back onto the floor: low, wide and to the side.
  perspective: '-18px 22px 14px -8px rgba(0,0,0,.4)',
};

const BEVEL: Record<NonNullable<PictureLook['bevel']>, string> = {
  circle: 'inset 5px 5px 8px rgba(255,255,255,.55), inset -5px -5px 8px rgba(0,0,0,.4)',
  angle: 'inset 3px 3px 0 rgba(255,255,255,.6), inset -3px -3px 0 rgba(0,0,0,.45)',
  relaxedInset: 'inset 2px 2px 10px rgba(255,255,255,.45), inset -2px -2px 10px rgba(0,0,0,.35)',
};

/** CSS for a look, on a `w`×`h` box. */
export function lookCss(look: PictureLook, w = 400, h = 300): CSSProperties {
  const css: CSSProperties = {};
  const shadows: string[] = [];
  if (look.frame) {
    const [color, pt] = look.frame;
    css.border = `${Math.max(1, Math.round(pt * 2))}px ${look.double ? 'double' : 'solid'} ${color}`;
    css.boxSizing = 'border-box';
  }
  if (look.shape === 'ellipse') css.borderRadius = '50%';
  else if (look.shape === 'roundRect') css.borderRadius = Math.round(Math.min(w, h) * 0.12);
  else if (look.shape === 'round2DiagRect') css.borderRadius = `${Math.round(Math.min(w, h) * 0.18)}px 0`;
  else if (look.shape === 'snip2DiagRect') {
    const k = Math.round(Math.min(w, h) * 0.16);
    css.clipPath = `polygon(${k}px 0, 100% 0, 100% calc(100% - ${k}px), calc(100% - ${k}px) 100%, 0 100%, 0 ${k}px)`;
  }
  if (look.shadow) shadows.push(SHADOW[look.shadow]);
  if (look.bevel) shadows.push(BEVEL[look.bevel]);
  if (shadows.length) css.boxShadow = shadows.join(', ');
  if (look.softEdge) {
    const r = Math.round(look.softEdge * 2);
    const mask = look.shape === 'ellipse'
      ? `radial-gradient(closest-side, #000 calc(100% - ${r * 2}px), transparent)`
      : `linear-gradient(to right, transparent, #000 ${r}px, #000 calc(100% - ${r}px), transparent), linear-gradient(to bottom, transparent, #000 ${r}px, #000 calc(100% - ${r}px), transparent)`;
    Object.assign(css, { maskImage: mask, WebkitMaskImage: mask, maskComposite: 'intersect', WebkitMaskComposite: 'source-in' });
  }
  // DeckCraft's reflection: half opacity at the picture's foot, gone after 35 % of its height.
  if (look.reflection) css.WebkitBoxReflect = 'below 2px linear-gradient(transparent 65%, rgba(255,255,255,.5))';
  return css;
}

/** CSS for Picture Style `id` (undefined when it is not one of the 24). */
export function pictureLookCss(id: string | undefined, w?: number, h?: number): CSSProperties | undefined {
  const look = pictureLook(id);
  return look ? lookCss(look, w, h) : undefined;
}
