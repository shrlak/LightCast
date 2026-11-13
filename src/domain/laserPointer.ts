// Slide Show › Laser Pointer: a red dot that follows the cursor on the audience view.
export interface LaserPoint { x: number; y: number }
/** Sent from the presenter's window to the audience window(s); coordinates are 0–1 across the slide. */
export type LaserMessage = ({ type: 'laser' } & LaserPoint) | { type: 'laser'; off: true };

export const LASER_COLOR = '#ff2a2a';
/** The dot disappears by itself when no update arrives (the presenter's window lost focus, say). */
export const LASER_STALE_MS = 2500;

/** The pointer on the slide (0–1), or null when it is outside it. */
export function laserPoint(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): LaserPoint | null {
  if (!rect.width || !rect.height) return null;
  const x = (clientX - rect.left) / rect.width, y = (clientY - rect.top) / rect.height;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}

/** Holding Ctrl while the mouse moves shows it; the menu item keeps it on without Ctrl. */
export const laserShown = (ctrlKey: boolean, toggledOn: boolean): boolean => ctrlKey || toggledOn;

export const laserMessage = (p: LaserPoint | null): LaserMessage => (p ? { type: 'laser', x: p.x, y: p.y } : { type: 'laser', off: true });
export const laserFromMessage = (m: LaserMessage): LaserPoint | null => ('off' in m ? null : { x: m.x, y: m.y });

/** A laser message that came over the network: anything not shaped right is dropped, numbers are held inside the slide. */
export function parseLaserMessage(m: unknown): LaserMessage | null {
  if (!m || typeof m !== 'object' || (m as { type?: unknown }).type !== 'laser') return null;
  const o = m as { off?: unknown; x?: unknown; y?: unknown };
  if (o.off === true) return { type: 'laser', off: true };
  if (typeof o.x !== 'number' || typeof o.y !== 'number' || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
  return { type: 'laser', x: Math.min(1, Math.max(0, o.x)), y: Math.min(1, Math.max(0, o.y)) };
}

/** Network traffic stays light: about 30 dots a second at most; "off" always goes through. */
export const LASER_SEND_MS = 33;
export const laserDue = (lastSentAt: number, now: number, p: LaserPoint | null): boolean => !p || now - lastSentAt >= LASER_SEND_MS;

/**
 * Two-projector (edge blend) layout: each output shows half the slide plus `overlap` canvas pixels of the other half,
 * the slide filling the screen's width and centred vertically. Where the dot lands on this screen, as fractions (0–1)
 * of the screen's width and height, or null when the point is on the other projector's part.
 * `screenAspect` is the screen's width / height.
 */
export function edgeLaserPosition(p: LaserPoint, edge: { part: 'none' | 'left' | 'right'; overlap: number }, slideW: number, slideH: number, screenAspect: number): LaserPoint | null {
  if (edge.part === 'none' || !(slideW > 0) || !(slideH > 0) || !(screenAspect > 0)) return null;
  const half = slideW / 2;
  const overlap = Math.min(slideW, Math.max(0, edge.overlap));
  const regionW = half + overlap / 2;
  const x0 = edge.part === 'left' ? 0 : half - overlap / 2;
  const fx = (p.x * slideW - x0) / regionW;
  if (fx < 0 || fx > 1) return null;
  // The slide is (slideW / regionW) screen-widths wide, so this many screen-heights tall.
  const heightFrac = (slideW / regionW) * (slideH / slideW) / screenAspect;
  return { x: fx, y: 0.5 + (p.y - 0.5) * heightFrac };
}

/** A finger dragging over the slide preview on a phone: the point held inside the slide (a drag that strays off the edge keeps pointing at the edge). */
export function laserPointClamped(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): LaserPoint | null {
  if (!rect.width || !rect.height) return null;
  const c = (n: number) => Math.min(1, Math.max(0, n));
  return { x: c((clientX - rect.left) / rect.width), y: c((clientY - rect.top) / rect.height) };
}

/** A laser message the relay passed on from a phone that holds the remote controls (it carries `remote: true`). */
export const isRemoteLaser = (m: unknown): boolean => !!m && typeof m === 'object' && (m as { type?: unknown }).type === 'laser' && (m as { remote?: unknown }).remote === true;
