import { isFrontSlide } from '../domain/frontLayout';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Background, ListStyle, Prop, Screen, Slide, SlideElement, TextRun, Theme, Timer, Transition } from '../domain/types';
import { lineRuns, slideLineRuns } from '../domain/richText';
import { INDENT_PX, listMarkers } from '../domain/textFormat';
import { stripChords } from '../domain/lyrics';
import { CHURCH_LOGO_URL } from '../domain/defaults';
import { qrDataUrl } from '../domain/io/qr';
import { formatClock, timerValue } from '../domain/timers';
import { isDecoded, preloadImage, useMediaUrl, useNow, useReadyImage, useWidth } from './hooks';
import { mediaUrl, peekMediaUrl } from '../domain/media';
import { MotionLayer } from './MotionLayer';
import { AnimatedElements, FxTransition } from './ShowEffects';
import type { LiveBuild } from '../domain/animations';
import { shapeGeometry } from '../engine';
import { ChartElement, IconElement, InkElement, ShapeElement, TableElement, effectCss, effects, elementTransform } from './EngineElements';

export { CANVAS_W, CANVAS_H } from '../domain/canvas';
import { CANVAS_W, CANVAS_H } from '../domain/canvas';
import { useAutoTextBoxes, useFontEpoch } from './textBoxLayout';
import { elementTextStyle } from '../domain/textBoxLayout';
import { fitTextNode, type TextLayout } from '../domain/boundedTextLayout';
import { slideTextFrame } from '../domain/slideTextLayout';

export interface CanvasProps {
  slide: Slide | null;
  theme: Theme;
  background: Background | null;
  black?: boolean;
  message?: string | null;
  props?: Prop[];
  timers?: Timer[];
  outputTimerId?: string | null;
  copyright?: string | null;
  transition?: Transition;
  screen?: Screen;
  video?: { playing: boolean; restart: number; seek?: { t: number; n: number }; loop?: boolean };
  logo?: boolean;
  logoMediaId?: string | null;
  announcement?: { slide: Slide; theme: Theme } | null;
  messageScroll?: boolean;
  bgEffect?: { dim: number; blur: number } | null;
  /** Reports background-video position (operator preview transport bar). */
  onVideoTime?: (t: number, duration: number) => void;
  /** Live rendering: play video/camera and run transitions. Off for thumbnails. */
  animate?: boolean;
  /** Where the slide's object animations are; without it every object is simply shown. */
  build?: LiveBuild | null;
  /** The slide's number, for Insert › Slide Number and the footer. */
  number?: number;
  className?: string;
}

function VideoBg({ url, fit, loop, video, onTime }: { url: string; fit: string; loop: boolean; video?: CanvasProps['video']; onTime?: CanvasProps['onVideoTime'] }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && video?.seek) ref.current.currentTime = video.seek.t;
  }, [video?.seek?.n]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (video?.playing === false) v.pause();
    else v.play().catch(() => undefined);
  }, [video?.playing, url]);
  useEffect(() => {
    if (ref.current && video && video.restart > 0) ref.current.currentTime = 0;
  }, [video?.restart]);
  return (
    <video ref={ref} className="layer media" style={{ objectFit: fit as 'cover' }} src={url} autoPlay muted loop={video?.loop ?? loop} playsInline
      onTimeUpdate={onTime ? (e) => onTime(e.currentTarget.currentTime, e.currentTarget.duration || 0) : undefined} />
  );
}

function CameraBg({ deviceId, label, animate }: { deviceId: string; label: string; animate: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!animate || !navigator.mediaDevices) return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: 1920, height: 1080 } : true, audio: false })
      .then((s) => {
        stream = s;
        if (ref.current) ref.current.srcObject = s;
      })
      .catch((e: Error) => setError(e.message));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [deviceId, animate]);
  if (!animate || error) return <div className="layer camera-placeholder">📷 {label}{error ? ` — ${error}` : ''}</div>;
  return <video ref={ref} className="layer media" autoPlay muted playsInline />;
}

function BackgroundLayer({ background, animate, video, onTime }: { background: Background | null; animate: boolean; video?: CanvasProps['video']; onTime?: CanvasProps['onVideoTime'] }) {
  const url = useMediaUrl(background?.kind === 'media' ? background.mediaId : null);
  const imageSrc = background?.kind === 'image' ? assetUrl(background.url) : background?.kind === 'media' && background.mediaType === 'image' ? url : null;
  const ready = useReadyImage(imageSrc);
  // What was drawn last: kept on screen while the next picture is still loading, so a slide change never shows an empty frame.
  const held = useRef<ReactNode>(null);
  if (!background) {
    held.current = null;
    return null;
  }
  const fit = background.kind === 'color' || background.kind === 'gradient' || background.kind === 'camera' || background.kind === 'motion' ? undefined : background.fit ?? 'cover';
  let node: ReactNode = null;
  let pending = false;
  if (background.kind === 'color') node = <div className="layer" style={{ background: background.value }} />;
  else if (background.kind === 'gradient') node = <div className="layer" style={{ backgroundImage: background.value }} />;
  else if (background.kind === 'motion') node = <MotionLayer bg={background} animate={animate} />;
  else if (background.kind === 'camera') node = <CameraBg deviceId={background.deviceId} label={background.label} animate={animate} />;
  else if (background.kind === 'image' || background.mediaType === 'image') {
    pending = !ready;
    if (ready) node = <img className="layer media" style={{ objectFit: fit, background: background.kind === 'image' ? '#fff' : undefined }} src={ready} alt="" decoding="sync" />;
  } else if (url) {
    node = animate
      ? <VideoBg url={url} fit={fit!} loop={background.loop !== false} video={video} onTime={onTime} />
      : <video className="layer media" style={{ objectFit: fit }} src={url} muted preload="metadata" />;
  } else pending = background.kind === 'media';
  if (pending) return held.current;
  held.current = node;
  return node;
}

/** Timers available to dynamic text ({timer:Name}) inside slides. */
const TimersContext = createContext<Timer[]>([]);

const TOKEN = /\{(time|date|slide|timer:[^}]+)\}/;

/** Replace {time}, {date} and {timer:Name} with live values. */
function DynamicText({ text }: { text: string }) {
  const timers = useContext(TimersContext);
  const slideNumber = useContext(SlideNumberContext);
  const now = useNow(500);
  const out = text.replace(new RegExp(TOKEN.source, 'g'), (_, tok: string) => {
    if (tok === 'time') return new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (tok === 'date') return new Date(now).toLocaleDateString();
    if (tok === 'slide') return String(slideNumber ?? '#');
    const name = tok.slice(6).trim().toLowerCase();
    const t = timers.find((x) => x.name.toLowerCase() === name || x.id === name);
    return t ? formatClock(timerValue(t, now)) : '--:--';
  });
  return <>{out}</>;
}

export function textStyle(theme: Theme): CSSProperties {
  const glow = theme.glowColor ? `0 0 18px ${theme.glowColor}, 0 0 36px ${theme.glowColor}` : '';
  const shadow = theme.shadow ? '0 4px 18px rgba(0,0,0,.85), 0 2px 4px rgba(0,0,0,.9)' : '';
  const effects: CSSProperties = {};
  if (theme.strokeWidth && theme.strokeColor) {
    effects.WebkitTextStroke = `${theme.strokeWidth}px ${theme.strokeColor}`;
    effects.paintOrder = 'stroke fill';
  }
  if (theme.gradient) {
    effects.backgroundImage = theme.gradient;
    effects.WebkitBackgroundClip = 'text';
    effects.backgroundClip = 'text';
  }
  return {
    ...effects,
    fontFamily: theme.fontFamily,
    fontSize: theme.fontSize,
    fontWeight: theme.fontWeight,
    color: theme.color,
    textAlign: theme.align,
    lineHeight: theme.lineHeight,
    textTransform: theme.uppercase ? 'uppercase' : 'none',
    fontStyle: theme.italic ? 'italic' : undefined,
    textDecoration: decoration(theme),
    letterSpacing: theme.letterSpacing || undefined,
    ...columnsAndDirection(theme),
    textShadow: [glow, theme.gradient ? '' : shadow].filter(Boolean).join(', ') || 'none',
    ...(theme.gradient ? { color: 'transparent' } : {}),
  };
}

/** 밑줄 and 취소선 together. */
const decoration = (f: { underline?: boolean; strike?: boolean }) => [f.underline && 'underline', f.strike && 'line-through'].filter(Boolean).join(' ') || undefined;

/** 단 (columns) and 텍스트 방향 (vertical text). */
const columnsAndDirection = (f: { columns?: number; vertical?: boolean }): CSSProperties => ({
  ...(f.columns && f.columns > 1 ? { columnCount: f.columns, columnGap: '1.2em', display: 'block' } : {}),
  ...(f.vertical ? { writingMode: 'vertical-rl' } : {}),
});

/** A line with its bullet / number and its highlight. */
function ListLine({ marker, highlight, children }: { marker: string | null; highlight?: string; children: ReactNode }) {
  const body = highlight ? <span style={{ background: highlight, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}>{children}</span> : children;
  return marker ? <><span className="list-marker">{marker}</span>{body}</> : <>{body}</>;
}

/** Lines wrapped in **…** render bold (prayer topic titles); bullets / numbering and highlight as the slide sets. */
function Lines({ text, list, highlight, runs }: { text: string; list?: ListStyle; highlight?: string; runs?: (TextRun[] | null)[] }) {
  const lines = stripChords(text).split('\n');
  const markers = listMarkers(lines, list);
  return (
    <>
      {lines.map((line, i) => {
        const bold = /^\*\*(.+)\*\*$/.exec(line);
        const content = bold ? bold[1] : line;
        // Runs only stand for a line they still spell once chords are taken out.
        const own = runs?.[i] && runs[i]!.map((r) => r.text).join('') === line ? runs[i] : null;
        const body = own ? own.map((r, k) => <span key={k} style={runStyle(r)}>{r.text}</span>) : TOKEN.test(content) ? <DynamicText text={content} /> : content || '\u00a0';
        return <div key={i}><ListLine marker={markers[i]} highlight={line.trim() ? highlight : undefined}>{bold ? <strong style={{ fontWeight: 800 }}>{body}</strong> : body}</ListLine></div>;
      })}
    </>
  );
}

const V_ALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const;
const H_ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end', justify: 'stretch' } as const;

/** Drawn for a slide show (output, reading view) rather than in the editor: media play by their settings. */
export const ShowContext = createContext(false);
export const SlideNumberContext = createContext<number | undefined>(undefined);

/** Insert › Header & Footer: date (left), footer text (centre), slide number (right). */
function FooterLayer({ slide, theme }: { slide: Slide; theme: Theme }) {
  const n = useContext(SlideNumberContext);
  const f = slide.footer;
  if (!f || (!f.date && !f.slideNumber && !f.text)) return null;
  const date = f.date === true ? new Date().toLocaleDateString('ko-KR') : typeof f.date === 'string' ? f.date : '';
  const style: CSSProperties = { position: 'absolute', bottom: 28, fontSize: 30, color: theme.color, opacity: 0.85, fontFamily: theme.fontFamily, whiteSpace: 'nowrap' };
  return (
    <div className="footer-layer">
      {date && <div style={{ ...style, left: 48 }}>{date}</div>}
      {f.text && <div style={{ ...style, left: '50%', transform: 'translateX(-50%)' }}>{f.text}</div>}
      {f.slideNumber && <div style={{ ...style, right: 48 }}>{n ?? '#'}</div>}
    </div>
  );
}

const PICTURE_STYLES: Record<string, CSSProperties> = {
  simpleFrame: { border: '12px solid #fff', boxSizing: 'border-box', boxShadow: '0 4px 10px rgba(0,0,0,.35)' },
  thickMatte: { border: '26px solid #1a1a1a', boxSizing: 'border-box', boxShadow: '0 6px 16px rgba(0,0,0,.45)' },
  polaroid: { borderStyle: 'solid', borderColor: '#fff', borderWidth: '14px 14px 52px', boxSizing: 'border-box', boxShadow: '0 6px 16px rgba(0,0,0,.4)' },
  shadowRect: { boxShadow: '10px 12px 24px rgba(0,0,0,.6)' },
  rounded: { borderRadius: '12%' },
  oval: { borderRadius: '50%' },
  softEdge: { WebkitMaskImage: 'radial-gradient(ellipse at center, #000 55%, transparent 75%)' },
  reflected: { borderRadius: 8, WebkitBoxReflect: 'below 4px linear-gradient(transparent 60%, rgba(255,255,255,.35))' },
  tilted: { transform: 'perspective(1000px) rotateY(-14deg)', boxShadow: '12px 10px 20px rgba(0,0,0,.45)' },
  beveled: { boxShadow: 'inset 4px 4px 8px rgba(255,255,255,.5), inset -4px -4px 8px rgba(0,0,0,.45), 0 4px 12px rgba(0,0,0,.4)' },
};
/** Picture Format › Picture Styles. */
export const PICTURE_STYLE_IDS = Object.keys(PICTURE_STYLES);
const pictureStyleCss = (id: string | undefined): CSSProperties => (id ? PICTURE_STYLES[id] ?? {} : {});

/** A video object: in a slide show it follows its playback settings (start / end, loop, volume, sound). */
function VideoObject({ el, url, style, live }: { el: SlideElement; url: string; style: CSSProperties; live: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const pb = el.playback ?? {};
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.volume = pb.volume ?? 1;
    if (pb.start) v.currentTime = pb.start;
    if (!live) { v.pause(); if (pb.poster) v.currentTime = pb.poster; return; }
    if (pb.autoplay !== false) v.play().catch(() => undefined);
    const onTime = () => {
      if (pb.end && v.currentTime >= pb.end) {
        if (pb.loop !== false) v.currentTime = pb.start ?? 0;
        else v.pause();
      }
    };
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [live, url, pb.start, pb.end, pb.loop, pb.volume, pb.autoplay, pb.poster]);
  // Output windows play without sound unless the video's sound is turned on (the room hears one copy).
  return <video ref={ref} src={url} style={{ ...style, objectFit: el.fit ?? 'cover' }} muted={pb.muted !== false} loop={pb.loop !== false && !pb.end} playsInline />;
}

/** One free-positioned object from the slide editor. */
export function ElementView({ el }: { el: SlideElement }) {
  const url = useMediaUrl(el.kind === 'image' ? el.mediaId : null);
  const videoUrl = useMediaUrl(el.kind === 'video' ? el.mediaId : null);
  const box: CSSProperties = {
    position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, opacity: el.opacity ?? 1,
    transform: elementTransform(el), filter: effects(el), ...effectCss(el),
  };
  const show = useContext(ShowContext);
  if (el.hidden) return null;
  // While a picture is still loading nothing is drawn (a placeholder box would flash); the slide waits for it, see useReadySlide.
  if (el.kind === 'image') {
    if (!url) return null;
    const mask = el.maskShape ? shapeGeometry(el.maskShape, el.w, el.h)?.paths.map((q) => q.d).join(' ') : undefined;
    const style = { ...box, ...pictureStyleCss(el.pictureStyle), ...(el.stroke ? { outline: `${el.strokeWidth ?? 6}px solid ${el.stroke}`, outlineOffset: -(el.strokeWidth ?? 6) / 2 } : {}), ...(mask ? { clipPath: `path('${mask}')` } : {}) };
    const c = el.crop;
    if (!c || c.every((v) => !v)) return <img src={url} alt={el.alt ?? ''} decoding="sync" style={{ ...style, objectFit: el.fit ?? 'contain' }} />;
    // Cropped: the picture stretched so its kept part fills the box.
    const fw = Math.max(0.01, 1 - c[0] - c[2]), fh = Math.max(0.01, 1 - c[1] - c[3]);
    return (
      <div style={{ ...style, overflow: 'hidden' }}>
        <img src={url} alt={el.alt ?? ''} decoding="sync" style={{ position: 'absolute', left: -(c[0] / fw) * el.w, top: -(c[1] / fh) * el.h, width: el.w / fw, height: el.h / fh, objectFit: 'fill', maxWidth: 'none' }} />
      </div>
    );
  }
  if (el.kind === 'video') return videoUrl ? <VideoObject el={el} url={videoUrl} style={box} live={show} /> : <div style={{ ...box, outline: '2px dashed #555' }} />;
  if (el.kind === 'audio') return show && el.playback?.hideDuringShow ? null : <div style={box} className="audio-object" title={el.name ?? '오디오'}><svg viewBox="0 0 48 48" width="100%" height="100%"><circle cx="24" cy="24" r="22" fill="rgba(0,0,0,.45)" stroke="#fff" strokeWidth="2" /><path d="M12 19h7l9-8v26l-9-8h-7z" fill="#fff" /><path d="M32 17c3 3 3 11 0 14M35 13c5 5 5 17 0 22" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" /></svg></div>;
  if (el.kind === 'zoom') return el.zoomOf ? <div style={{ ...box, outline: '2px solid rgba(255,255,255,.6)' }} className="zoom-object"><SlideCanvas slide={el.zoomOf.slide} theme={el.zoomOf.theme} background={el.zoomOf.background} /></div> : <div style={{ ...box, outline: '2px dashed #888' }} />;
  if (el.kind === 'camera') return <div style={box}><CameraBg deviceId={el.deviceId ?? ''} label="Camera" animate /></div>;
  if (el.kind === 'qr') return el.link ? <img className="qr-object" src={qrDataUrl(el.link)} alt={el.link} title={el.link} style={box} /> : <div className="qr-object empty" style={box}>QR</div>;
  if (el.kind === 'shape') {
    // Preset shapes (and anything rotated, flipped, dashed, gradient-filled or carrying text) are drawn
    // by the engine; a plain box or circle from an older slide stays the div it always was.
    if (el.shape || el.text || el.gradient || el.dash || el.flipH || el.flipV || el.dropShadow || el.glow || el.strokeWidth) return <ShapeElement el={el} />;
    return <div style={{ ...box, background: el.fill ?? '#ffffff', borderRadius: el.ellipse ? '50%' : el.radius ?? 0, border: el.stroke ? `4px solid ${el.stroke}` : undefined }} />;
  }
  if (el.kind === 'table') return <TableElement el={el} />;
  if (el.kind === 'chart') return <ChartElement el={el} />;
  if (el.kind === 'icon') return <IconElement el={el} />;
  if (el.kind === 'ink') return <InkElement el={el} />;
  return <TextElement el={el} box={box} />;
}

export { runStyle } from './runStyle';
import { runStyle } from './runStyle';

/** The path a warped (Transform) text follows, in its box. */
export function warpPath(kind: NonNullable<SlideElement['warp']>, w: number, h: number): string {
  switch (kind) {
    case 'archUp': return `M 0 ${h * 0.85} Q ${w / 2} ${-h * 0.55} ${w} ${h * 0.85}`;
    case 'archDown': return `M 0 ${h * 0.25} Q ${w / 2} ${h * 1.6} ${w} ${h * 0.25}`;
    case 'wave': return `M 0 ${h * 0.6} C ${w / 4} ${h * 0.05} ${w / 4} ${h * 1.1} ${w / 2} ${h * 0.6} S ${w * 0.75} ${h * 0.05} ${w} ${h * 0.6}`;
    case 'slantUp': return `M 0 ${h * 0.9} L ${w} ${h * 0.3}`;
    default: return `M 0 ${h * 0.3} L ${w} ${h * 0.9}`;
  }
}

function WarpText({ el, box }: { el: SlideElement; box: CSSProperties }) {
  const id = `warp-${el.id}`;
  const text = (el.text ?? '').replace(/\n/g, ' ');
  return (
    <svg style={{ ...box, left: el.x, top: el.y, width: el.w, height: el.h, overflow: 'visible', ...elementTextStyle(el) }} viewBox={`0 0 ${el.w} ${el.h}`}>
      <path id={id} d={warpPath(el.warp!, el.w, el.h)} fill="none" />
      <text fill={el.color ?? '#fff'} fontSize={el.fontSize ?? 64} fontFamily={el.fontFamily} fontWeight={el.bold ? 800 : 500} fontStyle={el.italic ? 'italic' : undefined} textAnchor="middle"
        stroke={el.textOutline?.color} strokeWidth={el.textOutline?.width} paintOrder="stroke" opacity={el.textTransparency ? 1 - el.textTransparency : undefined}
        style={{ filter: el.shadow ? 'drop-shadow(0 3px 6px rgba(0,0,0,.8))' : undefined }}>
        <textPath href={`#${id}`} startOffset="50%">{text}</textPath>
      </text>
    </svg>
  );
}

function TextElement({ el, box }: { el: SlideElement; box: CSSProperties }) {
  if (el.warp && el.text) return <WarpText el={el} box={box} />;
  const base = el.fontSize ?? 64;
  const lines = el.paragraphs ? el.paragraphs.map((p) => p.text) : (el.text ?? '').split('\n');
  const markers = listMarkers(lines, el.list);
  const runs = lineRuns(el);
  const styled = !!(el.list || el.highlight || runs.some(Boolean));
  const lineBody = (text: string, i: number) => (
    <ListLine marker={markers[i]} highlight={text.trim() ? el.highlight : undefined}>
      {runs[i] ? runs[i]!.map((r, k) => <span key={k} style={runStyle(r)}>{r.text}</span>) : TOKEN.test(text) ? <DynamicText text={text} /> : text}
    </ListLine>
  );
  return (
    <div data-text-element={el.id} style={{
      ...box, left: el.x, top: el.y, width: el.w, height: el.h, ...elementTextStyle(el), display: 'flex', flexDirection: 'column', whiteSpace: 'pre-wrap',
      justifyContent: V_ALIGN[el.vAlign ?? 'middle'], textAlign: el.align ?? 'center',
      fontSize: base, fontFamily: el.fontFamily, color: el.color ?? '#fff',
      fontWeight: el.bold ? 800 : el.paragraphs ? 400 : 500, fontStyle: el.italic ? 'italic' : undefined, lineHeight: el.lineHeight ?? (el.paragraphs ? 1.2 : 1.25),
      textDecoration: decoration(el), letterSpacing: el.letterSpacing ? el.letterSpacing : undefined,
      paddingLeft: el.indent ? el.indent * INDENT_PX : undefined, ...columnsAndDirection(el),
      // A box that does not fit itself to its text (a font size set by hand, Front) lets the text show
      // past its edge, as PowerPoint does, instead of cutting it off.
      textShadow: el.shadow ? '0 3px 12px rgba(0,0,0,.8)' : undefined, overflow: el.autoFit === false ? 'visible' : 'hidden',
      ...(el.textTransparency ? { color: `color-mix(in srgb, ${el.color ?? '#fff'} ${Math.round((1 - el.textTransparency) * 100)}%, transparent)` } : {}),
      ...(el.margins ? { padding: `${el.margins[1]}px ${el.margins[2]}px ${el.margins[3]}px ${el.margins[0]}px` } : {}),
      ...(el.spaceBefore || el.spaceAfter ? { ['--sp-before' as string]: `${el.spaceBefore ?? 0}px`, ['--sp-after' as string]: `${el.spaceAfter ?? 0}px` } : {}),
    }} className={el.spaceBefore || el.spaceAfter ? 'para-spaced' : undefined}>
      {el.paragraphs
        ? el.paragraphs.map((p, i) => (
            <div key={i} style={{
              fontSize: (p.fontSize ?? base), fontWeight: p.bold ? 700 : undefined, fontStyle: p.italic ? 'italic' : undefined,
              color: p.color, textAlign: p.align, minHeight: '1.2em', flexShrink: 0,
            }}>
              {lineBody(p.text, i)}
            </div>
          ))
        : styled ? lines.map((l, i) => <div key={i}>{l ? lineBody(l, i) : '\u00a0'}</div>)
          : el.text && TOKEN.test(el.text) ? <DynamicText text={el.text} /> : el.text}
    </div>
  );
}

/** The theme with this slide's own formatting applied on top. */
export const slideTheme = (theme: Theme, slide: Slide): Theme => (slide.style ? { ...theme, ...slide.style } : theme);

function SlideBody({ slide, theme: base, build }: { slide: Slide; theme: Theme; build?: LiveBuild | null }) {
  const originalTheme = { ...slideTheme(base, slide), ...(!isFrontSlide(slide) && slide.preferredFontSize !== undefined ? { fontSize: slide.preferredFontSize } : {}), ...(isFrontSlide(slide) ? { autoFit: false } : {}) };
  const fontEpoch = useFontEpoch();
  const { box: baseBox, bounds, noWrap: lyricLines } = slideTextFrame(slide, originalTheme);
  const hasQr = !!slide.qr?.length;
  const elements = useAutoTextBoxes(slide.elements ?? [], undefined, isFrontSlide(slide));
  const key = JSON.stringify([slide.id, slide.title, slide.text, slide.subtext, originalTheme, bounds, fontEpoch]);
  const [layout, setLayout] = useState<{ key: string; result: TextLayout } | null>(null);
  const resolved = layout?.key === key ? layout.result : { box: baseBox, fontSize: originalTheme.fontSize, wrap: false };
  const frame = resolved.box, noWrap = lyricLines && !resolved.wrap;
  const theme = { ...originalTheme, fontSize: resolved.fontSize };
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!inner.current || originalTheme.autoFit === false) return;
    setLayout({ key, result: fitTextNode(inner.current, baseBox, bounds, originalTheme.align, originalTheme.vAlign, lyricLines) });
  }, [key]);
  const t = theme;
  return (
    <>
      <div
        className="layer text-layer"
        style={{ inset: 'auto', left: frame.x, top: frame.y, width: frame.w, height: frame.h, justifyContent: V_ALIGN[theme.vAlign], alignItems: H_ALIGN[theme.align] }}
      >
        <div ref={inner} data-slide-text-box data-fitted-font-size={resolved.fontSize} data-preferred-font-size={originalTheme.fontSize} style={{ ...textStyle(t), width: frame.w, flexShrink: 0, whiteSpace: noWrap ? 'pre' : 'pre-wrap', overflowWrap: 'anywhere', paddingLeft: theme.indent ? theme.indent * INDENT_PX : undefined }}>
          {slide.title && <div className="slide-title" style={{ fontSize: t.fontSize * 0.72, marginBottom: t.fontSize * 0.35 }}>{slide.title}</div>}
          {slide.text && <Lines text={slide.text} list={theme.list} highlight={theme.highlight} runs={slide.textRuns ? slideLineRuns(slide) : undefined} />}
          {slide.subtext && (
            <div style={{ fontSize: t.fontSize * (theme.subScale ?? 0.62), color: theme.subColor ?? theme.color, marginTop: t.fontSize * 0.35, fontWeight: Math.min(theme.fontWeight, 500) }}>
              <Lines text={slide.subtext} />
            </div>
          )}
        </div>
      </div>
      {build && slide.animations?.length
        ? <AnimatedElements slide={slide} elements={elements} build={build} render={(el) => <ElementView el={el} />} />
        : elements.map((el) => <ElementView key={el.id} el={el} />)}
      {/* QR codes float over the text boxes in the corner; the boxes keep their own place. */}
      {hasQr && (
          <div className="qr-stack">
            {slide.qr!.map((link) => <img key={link} src={qrDataUrl(link)} alt={link} />)}
          </div>
      )}
      {slide.caption && <div className="slide-caption" style={{ fontFamily: theme.fontFamily, color: theme.color }}>{slide.caption}</div>}
      <FooterLayer slide={slide} theme={theme} />
    </>
  );
}

/** Pictures a slide needs on screen with it: its background picture and its image elements. */
function frameAssets(slide: Slide | null, background: Background | null) {
  const urls: string[] = [];
  const ids: string[] = [];
  if (background?.kind === 'image') urls.push(assetUrl(background.url));
  else if (background?.kind === 'media' && background.mediaType === 'image') ids.push(background.mediaId);
  for (const e of slide?.elements ?? []) if (e.kind === 'image' && e.mediaId) ids.push(e.mediaId);
  return { urls, ids };
}

/**
 * The slide and background to draw. A new slide waits (at most 0.6 s, the old one staying up) until its
 * background and pictures are decoded, and then slide, background and pictures appear in the same frame:
 * no black flash from a dark-on-white slide over the old background, no logo popping in late.
 * Slides without pictures, and pictures shown before, switch at once.
 */
function useReadyFrame(slide: Slide | null, background: Background | null, theme: Theme): Frame {
  const [shown, setShown] = useState<Frame>({ slide, background, theme });
  const same = shown.slide === slide && shown.background === background && shown.theme === theme;
  const { urls, ids } = frameAssets(slide, background);
  const ready = urls.every(isDecoded) && ids.every((id) => {
    const u = peekMediaUrl(id);
    return !!u && isDecoded(u);
  });
  if (!same && ready) setShown({ slide, background, theme });
  useEffect(() => {
    if (same) return;
    let alive = true;
    const go = () => alive && setShown({ slide, background, theme });
    Promise.all([...urls.map(preloadImage), ...ids.map((id) => mediaUrl(id).then((u) => (u ? preloadImage(u) : undefined)))]).then(go, go);
    const t = setTimeout(go, 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide, background, theme, same]);
  return shown;
}

const sameSlide = (a: Slide, b: Slide) => a === b || (a.id === b.id && JSON.stringify(a) === JSON.stringify(b));

/** Keeps the outgoing slide on screen while the new one transitions in. */
function TransitionLayer({ slide, theme, transition, animate, build }: { slide: Slide | null; theme: Theme; transition?: Transition; animate: boolean; build?: LiveBuild | null }) {
  const [prev, setPrev] = useState<{ slide: Slide; theme: Theme } | null>(null);
  const last = useRef<{ slide: Slide | null; theme: Theme }>({ slide, theme });
  const kind = animate ? transition?.kind ?? 'cut' : 'cut';
  const fx = kind.startsWith('fx:') ? kind.slice(3) : null;
  const duration = transition?.duration ?? 1;
  useEffect(() => {
    const old = last.current;
    last.current = { slide, theme };
    // The same slide delivered twice (computer and network) must not fade into itself.
    if (kind === 'cut' || !old.slide || (slide && sameSlide(old.slide, slide))) return;
    setPrev({ slide: old.slide, theme: old.theme });
    // An engine transition ends itself (FxTransition); the timer is its safety net.
    const t = setTimeout(() => setPrev(null), fx ? duration + 400 : duration);
    return () => clearTimeout(t);
  }, [slide, theme, kind, duration]);
  const style = { ['--tr' as string]: `${duration}ms` } as CSSProperties;
  // One element each for the outgoing and incoming slide, so the frames of an engine transition
  // re-place them without drawing them again.
  const oldBody = useMemo(() => (prev ? <SlideBody slide={prev.slide} theme={prev.theme} /> : null), [prev]);
  const newBody = useMemo(() => (slide ? <SlideBody slide={slide} theme={theme} build={build} /> : null), [slide, theme, build]);
  if (fx && prev && slide) {
    return <FxTransition key={`fx-${prev.slide.id}-${slide.id}`} kind={fx} option={transition?.option ?? ''} duration={duration} oldBody={oldBody} newBody={newBody} onDone={() => setPrev(null)} />;
  }
  return (
    <>
      {prev && kind !== 'cut' && !fx && (
        <div className={`layer tr-out tr-${kind}`} style={style} key={`out-${prev.slide.id}`}>{oldBody}</div>
      )}
      {slide && (
        <div className={`layer ${kind !== 'cut' && !fx ? `tr-in tr-${kind}` : ''}`} style={style} key={`in-${slide.id}-${slide.text.length}`}>
          {newBody}
        </div>
      )}
    </>
  );
}

const POS: Record<Prop['position'], CSSProperties> = {
  'top-left': { top: 40, left: 40 }, top: { top: 40, left: '50%', transform: 'translateX(-50%)' }, 'top-right': { top: 40, right: 40 },
  center: { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' },
  'bottom-left': { bottom: 40, left: 40 }, bottom: { bottom: 40, left: '50%', transform: 'translateX(-50%)' }, 'bottom-right': { bottom: 40, right: 40 },
  full: { inset: 0 },
};

function PropBox({ prop, timers }: { prop: Prop; timers: Timer[] }) {
  const url = useMediaUrl(prop.kind === 'image' ? prop.mediaId : null);
  const now = useNow(prop.kind === 'clock' || prop.kind === 'timer' ? 250 : 60000);
  let content: ReactNode = prop.text ?? '';
  if (prop.kind === 'clock') content = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (prop.kind === 'timer') {
    const t = timers.find((x) => x.id === prop.timerId);
    content = t ? formatClock(timerValue(t, now)) : '--:--';
  }
  if (prop.kind === 'image') {
    content = url ? <img src={url} alt="" style={prop.position === 'full' ? { width: '100%', height: '100%', objectFit: 'cover' } : { height: prop.size * 3 }} /> : null;
  }
  return (
    <div className="prop" style={{ ...POS[prop.position], color: prop.color, background: prop.background, fontSize: prop.size, padding: prop.kind === 'image' || prop.background === 'transparent' ? 0 : '0.25em 0.6em' }}>
      {content}
    </div>
  );
}

function TimerOverlay({ timer }: { timer: Timer }) {
  const now = useNow(250);
  const v = timerValue(timer, now);
  return <div className={`countdown-overlay ${v < 0 && timer.kind !== 'elapsed' ? 'over' : ''}`}>{formatClock(v)}</div>;
}

const KEY_FILL = { black: '#000', green: '#00b140', transparent: 'transparent', matte: '#000' } as const;

/** App-relative asset path → absolute URL (works for the console and output windows). */
export const assetUrl = (url: string) => (/^(https?:|data:|blob:)/.test(url) ? url : `${location.origin}${document.body?.dataset.view === 'team' && location.pathname.startsWith('/freecast/team/') ? '/freecast/team' : ''}/${url.replace(/^\//, '')}`);

/** Full-screen church logo ("clear to logo"); falls back to the FreeCast mark. */
function LogoLayer({ mediaId }: { mediaId: string | null }) {
  const url = useMediaUrl(mediaId);
  // Without a chosen logo, show the church logo from the templates on white.
  return (
    <div className="layer logo-layer" style={url ? undefined : { background: '#fff' }}>
      <img src={url ?? assetUrl(CHURCH_LOGO_URL)} alt="" />
    </div>
  );
}

/** Renders a slide at 1440x1080 (4:3) and scales it to fit its container. */
/** Pictures this window has already put on screen once: showing one again paints at once. */
const paintedAssets = new Set<string>();

type Frame = { slide: Slide | null; background: Background | null; theme: Theme };

/**
 * Double buffering for a picture's first appearance. A large picture takes a few frames to paint the
 * first time, and until it does the new slide would show over an empty (black) background. So when the
 * new frame has a picture never shown before, the previous frame stays on top for 0.1 s while the new
 * one paints underneath, then it is removed. Returns that previous frame while it is held.
 */
function useFrameHold(frame: Frame): Frame | null {
  const [view, setView] = useState<{ frame: Frame; ghost: Frame | null }>({ frame, ghost: null });
  if (view.frame !== frame) {
    const { urls, ids } = frameAssets(frame.slide, frame.background);
    const fresh = [...urls, ...ids].some((k) => !paintedAssets.has(k));
    setView({ frame, ghost: fresh && (view.frame.slide || view.frame.background) ? view.frame : null });
  }
  useEffect(() => {
    const { urls, ids } = frameAssets(view.frame.slide, view.frame.background);
    [...urls, ...ids].forEach((k) => paintedAssets.add(k));
    if (!view.ghost) return;
    const t = setTimeout(() => setView((v) => (v.ghost ? { ...v, ghost: null } : v)), 100);
    return () => clearTimeout(t);
  }, [view]);
  return view.ghost;
}

export function SlideCanvas(p: CanvasProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const layers = p.screen?.layers ?? { background: true, slide: true, props: true, messages: true, timer: true };
  const fill = KEY_FILL[p.screen?.key ?? 'black'];
  const activeProps = layers.props ? p.props ?? [] : [];
  const timer = layers.timer && p.outputTimerId ? p.timers?.find((t) => t.id === p.outputTimerId) : undefined;
  const matte = p.screen?.key === 'matte';
  const fx = p.bgEffect;
  const m = p.screen?.mask;
  const frame = useReadyFrame(p.slide, p.background, p.theme);
  const ghost = useFrameHold(frame);
  const mask: CSSProperties | null = m && m.kind !== 'none'
    ? { boxShadow: `0 0 0 3000px ${fill === 'transparent' ? '#000' : fill}`, inset: m.inset, borderRadius: m.kind === 'oval' ? '50%' : 0 }
    : null;
  return (
    <div ref={ref} className={`canvas-frame ${p.className ?? ''}`} style={{ background: fill }}>
      <TimersContext.Provider value={p.timers ?? []}>
      <ShowContext.Provider value={!!p.animate}>
      <SlideNumberContext.Provider value={p.number}>
      <div className={`canvas ${matte ? 'matte' : ''}`} style={{ transform: `scale(${width / CANVAS_W})`, width: CANVAS_W, height: CANVAS_H }}>
        {layers.background && !matte && (
          <div className="layer bg-layer" style={fx?.blur ? { filter: `blur(${fx.blur}px)`, inset: -fx.blur * 2 } : undefined}>
            <BackgroundLayer background={frame.background} animate={!!p.animate} video={p.video} onTime={p.onVideoTime} />
          </div>
        )}
        {layers.background && !matte && fx?.dim ? <div className="layer" style={{ background: `rgba(0,0,0,${fx.dim})` }} /> : null}
        {layers.slide && <TransitionLayer slide={frame.slide} theme={frame.theme} transition={p.transition} animate={!!p.animate} build={p.build} />}
        {ghost && (
          <>
            {layers.background && !matte && <div className="layer bg-layer"><BackgroundLayer background={ghost.background} animate={false} /></div>}
            {layers.slide && ghost.slide && <div className="layer"><SlideBody slide={ghost.slide} theme={ghost.theme} /></div>}
          </>
        )}
        {(layers.announcements ?? true) && p.announcement && (
          <div className="layer announcement-layer" key={p.announcement.slide.id}><SlideBody slide={p.announcement.slide} theme={p.announcement.theme} /></div>
        )}
        {activeProps.map((prop) => <PropBox key={prop.id} prop={prop} timers={p.timers ?? []} />)}
        {timer && <TimerOverlay timer={timer} />}
        {layers.slide && p.copyright && <div className="copyright-line">{p.copyright}</div>}
        {layers.messages && p.message && (
          <div className={`message-bar ${p.messageScroll ? 'ticker' : ''}`}>{p.messageScroll ? <span>{p.message}</span> : p.message}</div>
        )}
        {p.logo && <LogoLayer mediaId={p.logoMediaId ?? null} />}
        {p.black && <div className="layer" style={{ background: '#000' }} />}
        {mask && <div className="layer screen-mask" style={mask} />}
      </div>
      </SlideNumberContext.Provider>
      </ShowContext.Provider>
      </TimersContext.Provider>
    </div>
  );
}
