import { useEffect, useRef, useState } from 'react';
import { actionAt, actionOf, hoverActionOf, hoverAt, runLinkAt, type ShowAction } from '../domain/showActions';
import type { SlideElement } from '../domain/types';
import { SlideCanvas, assetUrl } from '../ui/SlideCanvas';
import { preloadImage } from '../ui/hooks';
import { mediaUrl } from '../domain/media';
import { CANVAS_W } from '../domain/canvas';
import { useLiveFeed } from '../ui/hooks';
import { liveCanvasProps } from '../ui/liveProps';
import { openLiveChannel } from '../domain/sync';
import { LaserDot, useLaserDot } from '../ui/ppt/showTools';
import { CaptionBand } from '../ui/ppt/captionTools';
import { AllSlidesGrid, PointerSurface, ShowContextMenu, ShowHelp, ShowToolbar, pointerKey, useAwake, usePointerState, type ShowControl } from '../ui/ppt/showScreen';
import { loadLibrary } from '../domain/persistence';
import { sequence } from '../domain/arrangement';
import type { ScreenAction } from '../domain/showScreen';

/**
 * Audience output: the slide show screen, as PowerPoint's. Open it on the projector screen and press F for fullscreen.
 * Keys pressed here (arrows, Space, Esc, B, W, numbers…) are passed to the console, so a show on a single screen still
 * runs; a click (or the wheel) moves the show on; the toolbar at the bottom left and the right-click menu appear when
 * the mouse moves, and the pen, highlighter, eraser and laser write on the slide for everyone.
 * `?screen=<id>` picks a screen configuration (e.g. lyrics only on chroma green).
 */
export function OutputView() {
  const live = useLiveFeed();
  const laser = useLaserDot();
  const latest = useRef(live);
  latest.current = live;
  const screenId = new URLSearchParams(location.search).get('screen');
  const screen = live?.screens.find((s) => s.id === screenId) ?? live?.screens[0];
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const ps = usePointerState();
  const psRef = useRef(ps);
  psRef.current = ps;
  const [awake, poke] = useAwake();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [all, setAll] = useState(false);
  const allRef = useRef(all);
  allRef.current = all;
  const [help, setHelp] = useState(false);
  const chRef = useRef<ReturnType<typeof openLiveChannel> | null>(null);
  // The slide show toolbar and menus belong to the projector picture, not to chroma / transparent / blended outputs.
  const showUi = !screen?.key || screen.key === 'black';

  // A ScreenTip belongs to the slide it was shown on.
  useEffect(() => setTip(null), [live?.slide?.id]);

  // The next slide's pictures are decoded while this one is up, as PowerPoint does, so the next click shows it at once
  // (a big photo otherwise decodes on the click, and the slide waits up to 0.6 s for it).
  const ahead = live?.nextAssets;
  useEffect(() => {
    if (!ahead) return;
    for (const u of ahead.urls) void preloadImage(assetUrl(u));
    for (const id of ahead.ids) void mediaUrl(id).then((u) => (u ? preloadImage(u) : undefined)).catch(() => undefined);
  }, [ahead?.ids.join(','), ahead?.urls.join(',')]);

  useEffect(() => {
    document.title = `LightCast — ${screen?.name ?? 'Output'}`;
    document.body.classList.toggle('transparent', screen?.key === 'transparent');
  }, [screen?.name, screen?.key]);

  useEffect(() => {
    const toggle = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => undefined);
    };
    const ch = openLiveChannel(() => undefined);
    chRef.current = ch;
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+L / P / I / E / A / H: this screen's pointer (laser, pen, highlighter, eraser, arrow), as in PowerPoint.
      if (pointerKey(e, psRef.current)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === 'f') return toggle();
      if (e.key === 'F1') { e.preventDefault(); setHelp(true); return; }
      // 모든 슬라이드 보기 (G or −) opens on this screen.
      if ((e.key === 'g' || e.key === 'G' || (e.key === '-' && !latest.current?.zoom)) && !allRef.current) { e.preventDefault(); setAll(true); return; }
      // Every other key drives the show from the console, like PowerPoint's slide show window.
      e.preventDefault();
      ch.post({ type: 'key', key: e.key, shiftKey: e.shiftKey });
    };
    // What an object's action does here: a link opens in this window, a video plays in it, anything else is
    // the console's to do (it moves the live show on, or plays the audio).
    const perform = (a: ShowAction, el: SlideElement) => {
      if (a.kind === 'url') { if (a.url) window.open(a.url, '_blank', 'noopener'); return; }
      if (a.kind === 'playMedia' && el.kind === 'video') { window.dispatchEvent(new CustomEvent('lightcast:media', { detail: { id: el.id } })); return; }
      ch.post({ type: 'show', action: a });
    };
    const pointAt = (e: MouseEvent) => {
      const r = document.querySelector('.output-canvas')?.getBoundingClientRect();
      if (!r?.width) return null;
      const k = CANVAS_W / r.width;
      return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
    };
    // A click on an object with an action (Action Settings, a link, a slide zoom) does it, as in
    // PowerPoint's slide show; clicks elsewhere are left alone (double-click is full screen).
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || (e.target as Element | null)?.closest?.('.show-toolbar, .show-menu, .show-all, .show-help-back, [data-media-bar]')) return;
      const link = runLinkAt(e.target);
      if (link) { window.open(link, '_blank', 'noopener'); return; }
      const at = pointAt(e);
      if (!at) return;
      const el = actionAt(latest.current?.slide, at.x, at.y);
      const a = el ? actionOf(el) : null;
      if (el && a) { perform(a, el); return; }
      // A click anywhere else moves the show on, as in PowerPoint; on the end screen it ends the show.
      if (!latest.current?.slide) return;
      ch.post({ type: 'show', action: { kind: latest.current.ended ? 'end' : 'next' } });
    };
    // The mouse wheel: down is the next slide, up the previous one.
    let wheelAt = 0;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest?.('.show-all, .show-menu, .show-help-back') || !latest.current?.slide || Date.now() - wheelAt < 250 || !e.deltaY) return;
      wheelAt = Date.now();
      ch.post({ type: 'show', action: { kind: e.deltaY > 0 ? (latest.current.ended ? 'end' : 'next') : 'prev' } });
    };
    // Pointing at an object: its ScreenTip, and its Mouse Over action once as the pointer enters it.
    let hovered: string | null = null;
    const onMove = (e: MouseEvent) => {
      const at = pointAt(e);
      const over = at ? hoverAt(latest.current?.slide, at.x, at.y) : null;
      const tipped = over ?? (at ? actionAt(latest.current?.slide, at.x, at.y) : null);
      setTip(tipped?.tooltip ? { x: e.clientX, y: e.clientY, text: tipped.tooltip } : null);
      if ((over?.id ?? null) === hovered) return;
      hovered = over?.id ?? null;
      const a = over ? hoverActionOf(over) : null;
      if (over && a) perform(a, over);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('wheel', onWheel);
      chRef.current = null;
      ch.close();
    };
  }, []);

  if (!live) return <div className="output-root waiting">Waiting for the LightCast console…</div>;
  const bg = screen?.key === 'transparent' ? 'transparent' : screen?.key === 'green' ? '#00b140' : '#000';
  const edge = screen?.edge && screen.edge.part !== 'none' ? screen.edge : null;
  if (edge) {
    // Each projector shows half the picture plus the overlap; the overlap fades out so the two blend.
    const half = CANVAS_W / 2;
    const regionW = half + edge.overlap / 2;
    const x = edge.part === 'left' ? 0 : half - edge.overlap / 2;
    const scale = CANVAS_W / regionW;
    return (
      <div className="output-root edge-root" style={{ background: bg }}>
        <div className="edge-view">
          <div className="edge-slide" style={{ width: `${scale * 100}%`, transform: `translateX(${(-x / CANVAS_W) * 100}%)` }}>
            <SlideCanvas {...liveCanvasProps(live, screen)} />
          </div>
          <div className={`edge-fade ${edge.part}`} style={{ width: `${(edge.overlap / regionW) * 100}%` }} />
          <LaserDot point={laser} edge={edge} />
          <CaptionBand />
        </div>
      </div>
    );
  }
  const post = (a: ScreenAction) => chRef.current?.post({ type: 'screen', action: a });
  const show = (kind: 'next' | 'prev' | 'end' | 'lastViewed') => chRef.current?.post({ type: 'show', action: { kind } });
  // The presentation on screen (this computer's library), for 모든 슬라이드 보기 and 사용자 지정 쇼.
  const presId = live.inkKey ? live.inkKey.slice(0, live.inkKey.lastIndexOf('#')) : null;
  const seqNow = live.inkKey ? Number(live.inkKey.slice(live.inkKey.lastIndexOf('#') + 1)) : null;
  const lib = all || menu ? loadLibrary() : null;
  const pres = presId && lib ? lib.presentations.find((x) => x.id === presId) ?? null : null;
  const c: ShowControl = {
    next: () => show(live.ended ? 'end' : 'next'),
    prev: () => show('prev'),
    go: (seq) => { const s = pres ? sequence(pres)[seq]?.slide : null; if (s) chRef.current?.post({ type: 'show', action: { kind: 'slide', slideId: s.id } }); },
    lastViewed: () => show('lastViewed'),
    black: () => post({ kind: 'black' }),
    white: () => post({ kind: 'white' }),
    end: () => show('end'),
    ink: (stroke) => post({ kind: 'ink', stroke }),
    erase: (x, y) => post({ kind: 'erase', x, y }),
    clearInk: () => post({ kind: 'clearInk' }),
    zoom: (zoom) => post({ kind: 'zoom', zoom }),
    presenter: window.opener ? () => (window.opener as Window).focus() : undefined,
    customShows: pres?.customShows?.map((s) => ({ id: s.id, name: s.name })),
    customShow: (id) => chRef.current?.post({ type: 'show', action: { kind: 'customShow', show: id } }),
  };
  const hideArrow = ps.arrow === 'hidden' || (ps.arrow === 'auto' && !awake && ps.pointer === 'arrow' && !menu);
  if (!showUi) {
    return (
      <div className="output-root" style={{ background: bg }}>
        <SlideCanvas {...liveCanvasProps(live, screen)} className="output-canvas" />
        <LaserDot point={laser} />
        <CaptionBand />
      </div>
    );
  }
  return (
    <div className={`output-root show-screen ${hideArrow ? 'no-arrow' : ''}`} style={{ background: bg }} onMouseMove={poke}
      onContextMenu={(e) => { e.preventDefault(); if (live.slide) setMenu({ x: e.clientX, y: e.clientY }); }}>
      <PointerSurface ps={ps} c={c} zoom={live.zoom ?? null}>
        <SlideCanvas {...liveCanvasProps(live, screen)} className="output-canvas" />
      </PointerSurface>
      {/* The next slide, laid out unseen (fonts, text fitting, pictures), so the click shows it at once. */}
      {live.next && <div aria-hidden style={{ position: 'fixed', left: -100000, top: 0, width: '100vw', visibility: 'hidden', pointerEvents: 'none' }}><SlideCanvas slide={live.next.slide} theme={live.next.theme} background={live.next.background} /></div>}
      <LaserDot point={laser} />
      <CaptionBand />
      {tip && <div className="output-tip" style={{ left: tip.x + 14, top: tip.y + 18 }}>{tip.text}</div>}
      {live.slide && <ShowToolbar c={c} ps={ps} visible={awake} black={live.black} white={!!live.white} zoomed={!!live.zoom} onAll={() => setAll(true)} onHelp={() => setHelp(true)} />}
      {menu && <ShowContextMenu at={menu} c={c} ps={ps} black={live.black} white={!!live.white} zoomed={!!live.zoom} onAll={() => setAll(true)} onHelp={() => setHelp(true)} onClose={() => setMenu(null)} />}
      {all && pres && <AllSlidesGrid p={pres} theme={lib!.themes.find((t) => t.id === pres.themeId) ?? live.theme} current={seqNow} onPick={c.go} onClose={() => setAll(false)} />}
      {help && <ShowHelp onClose={() => setHelp(false)} />}
    </div>
  );
}
