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
