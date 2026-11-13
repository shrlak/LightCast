import { desktop, type DesktopBridge } from '../domain/desktop';
import { fromDesktop, fromScreenDetails, loadChoice, popupFeatures, resolveMonitors } from '../domain/monitors';
import { applyChoiceToDesktop, requestScreenDetails } from './useMonitors';

/** Open an output/stage window — on its saved display in the desktop app, as a popup in a browser. */
export function openOutput(view: 'output' | 'stage', extra = '', displayId?: number | null) {
  const url = `${location.origin}${location.pathname}?view=${view}${extra}`;
  if (desktop) desktop.openView(url, displayId);
  else window.open(url, `freecast-${view}${extra}`, 'popup,width=960,height=540');
}

/**
 * Slide show output: fullscreen on the connected screen straight away in the desktop app. A monitor
 * chosen in 쇼 설정 › 모니터 is used for the audience (and the presenter view moves to its own);
 * without a choice nothing changes. In a browser the popup opens on the chosen monitor when the
 * browser lists them (Window Management API).
 */
export function presentOutput() {
  const url = `${location.origin}${location.pathname}?view=output`;
  const choice = loadChoice();
  const chosen = !!(choice.audience || choice.presenter);
  if (desktop) {
    const d: DesktopBridge = desktop;
    if (!chosen) return void d.present(url);
    // The desktop app is told first so the show opens on the chosen display.
    void d.info().then((i) => applyChoiceToDesktop(fromDesktop(i.displays), choice)).catch(() => undefined).then(() => d.present(url));
    return;
  }
  if (!chosen) return openOutput('output');
  void requestScreenDetails().then((details) => {
    const audience = details ? resolveMonitors(fromScreenDetails(details.screens), choice).audience : null;
    window.open(url, 'freecast-output', popupFeatures(audience));
  });
}
