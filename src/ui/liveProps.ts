import type { LiveState, Screen } from '../domain/types';
import type { CanvasProps } from './SlideCanvas';

/** Canvas props for showing the live state, optionally through a screen's layer/theme config. */
export function liveCanvasProps(live: LiveState, screen?: Screen): CanvasProps {
  const theme = (screen?.themeId && live.themes.find((t) => t.id === screen.themeId)) || live.theme;
  return {
    slide: live.slide,
    theme,
    background: live.background,
    black: live.black,
    message: live.message,
    props: live.props.filter((p) => live.activeProps.includes(p.id)),
    timers: live.timers,
    outputTimerId: live.outputTimerId,
    copyright: live.copyright,
    transition: live.transition,
    screen,
    video: live.video,
    logo: live.logo,
    logoMediaId: live.logoMediaId,
    announcement: live.announcement,
    messageScroll: live.messageScroll,
    bgEffect: live.bgEffect,
    build: live.build ?? null,
    animate: true,
  };
}
