import { desktop } from '../domain/desktop';

/** Open an output/stage window — on its saved display in the desktop app, as a popup in a browser. */
export function openOutput(view: 'output' | 'stage', extra = '', displayId?: number | null) {
  const url = `${location.origin}${location.pathname}?view=${view}${extra}`;
  if (desktop) desktop.openView(url, displayId);
  else window.open(url, `freecast-${view}${extra}`, 'popup,width=960,height=540');
}

/** Slide show output: fullscreen on the connected screen straight away in the desktop app. */
export function presentOutput() {
  if (desktop) desktop.present(`${location.origin}${location.pathname}?view=output`);
  else openOutput('output');
}
