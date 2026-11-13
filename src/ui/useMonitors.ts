import { useEffect, useRef, useState } from 'react';
import { desktop } from '../domain/desktop';
import { changeNotice, fromDesktop, fromScreenDetails, loadChoice, resolveMonitors, saveChoice, type Monitor, type MonitorChoice } from '../domain/monitors';

interface ScreenDetailsLike extends EventTarget { screens: ArrayLike<{ label?: string; isPrimary?: boolean; left?: number; top?: number; width?: number; height?: number }> }

let details: ScreenDetailsLike | null = null;
/** Browser: the Window Management API (asks the person once); null when unsupported or refused. */
export async function requestScreenDetails(): Promise<ScreenDetailsLike | null> {
  try {
    const w = window as unknown as { getScreenDetails?: () => Promise<ScreenDetailsLike> };
    if (!w.getScreenDetails) return null;
    details ??= await w.getScreenDetails();
    return details;
  } catch { return null; }
}

/** Monitors now connected, kept current as displays are added or removed. `canList`: false in a browser that cannot list them. */
export function useMonitors(onChange?: (notice: string) => void) {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [canList, setCanList] = useState(true);
  const prev = useRef<Monitor[] | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    let live = true;
    const apply = (list: Monitor[]) => {
      if (!live) return;
      const notice = prev.current ? changeNotice(prev.current, list) : null;
      prev.current = list;
      setMonitors(list);
      if (notice) cb.current?.(notice);
    };
    if (desktop) {
      const read = () => void desktop!.info().then((i) => apply(fromDesktop(i.displays))).catch(() => undefined);
      read();
      const off = desktop.onDisplays((d) => apply(fromDesktop(d)));
      return () => { live = false; off(); };
    }
    let off = () => undefined as void;
    void requestScreenDetails().then((d) => {
      if (!live) return;
      if (!d) { setCanList(false); return; }
      const read = () => apply(fromScreenDetails(d.screens));
      read();
      d.addEventListener('screenschange', read);
      off = () => d.removeEventListener('screenschange', read);
    });
    return () => { live = false; off(); };
  }, []);
  return { monitors, canList };
}

/** The remembered choice (per computer / browser). */
export function useMonitorChoice(): [MonitorChoice, (c: MonitorChoice) => void] {
  const [choice, setChoice] = useState<MonitorChoice>(() => loadChoice());
  return [choice, (c) => { setChoice(c); saveChoice(c); }];
}

/**
 * Tell the desktop app which displays to use when a show starts (it remembers the choice and moves
 * the console to the presenter display); in a browser the show popup is placed by `popupFeatures`.
 */
export function applyChoiceToDesktop(monitors: Monitor[], choice: MonitorChoice) {
  if (!desktop?.setShowDisplays) return;
  const { audience, presenter } = resolveMonitors(monitors, choice);
  void desktop.setShowDisplays(audience ? Number(audience.id) : null, presenter && choice.presenter ? Number(presenter.id) : null).catch(() => undefined);
}
