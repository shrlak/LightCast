export type HAlign = 'left' | 'center' | 'right' | 'justify';
/** Bullets or numbering in front of each line (PowerPoint's 글머리 기호 / 번호 매기기). */
export type ListStyle = 'bullet' | 'circle' | 'square' | 'check' | 'arrow' | 'number' | 'number-paren' | 'roman' | 'alpha' | 'hangul'
  /** DeckCraft's other bullets (□ ◆ – ★) and numbering schemes (i. a. a)). */
  | 'box' | 'diamond' | 'dash' | 'star' | 'roman-lower' | 'alpha-lower' | 'alpha-lower-paren';
export type VAlign = 'top' | 'middle' | 'bottom';

/** Text styling, sized against the 1440x1080 (4:3) canvas. */
export interface Theme {
  /** Set on a theme LightCast generated from a church template: a fingerprint of what it generated. */
  generated?: string;
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: HAlign;
  vAlign: VAlign;
  lineHeight: number;
  padding: number;
  shadow: boolean;
  uppercase: boolean;
  /** Secondary line (translation / second Bible version). */
  subColor?: string;
  subScale?: number;
  /** Grow the text box to fit its content without changing font sizes (default on). */
  autoFit?: boolean;
  /** Prefer unwrapped lyric lines: widen the box, wrapping only if the slide width is exhausted. */
  noWrap?: boolean;
  /** Text effects. */
  strokeColor?: string;
  strokeWidth?: number;
  glowColor?: string;
  /** CSS gradient used as the text fill, e.g. "linear-gradient(#fff,#fde68a)". */
  gradient?: string;
  italic?: boolean;
  underline?: boolean;
  /** PowerPoint text options (글꼴 / 단락 groups). */
  strike?: boolean;
  /** Character spacing in canvas pixels (0 = normal). */
  letterSpacing?: number;
  /** Text highlight colour. */
  highlight?: string;
  list?: ListStyle;
  /** Indent level (each level 60 canvas pixels). */
  indent?: number;
  columns?: number;
  /** Vertical text (세로 쓰기). */
  vertical?: boolean;
}

/** Per-slide text formatting that overrides the presentation's theme for that slide only. */
export type SlideStyle = Partial<Pick<Theme,
  'fontFamily' | 'fontSize' | 'fontWeight' | 'color' | 'align' | 'vAlign' | 'lineHeight' | 'shadow' | 'uppercase' |
  'subColor' | 'strokeColor' | 'strokeWidth' | 'italic' | 'underline' | 'padding' | 'strike' | 'letterSpacing' | 'highlight' |
  'list' | 'indent' | 'columns' | 'vertical' | 'autoFit' | 'glowColor'>>;

export type MediaType = 'image' | 'video' | 'audio';
/** 'fill' stretches to the box (how PowerPoint draws a picture in its frame). */
export type MediaFit = 'cover' | 'contain' | 'fill';

export type Background =
  | { kind: 'color'; value: string }
  | { kind: 'gradient'; value: string }
  | { kind: 'media'; mediaId: string; mediaType: 'image' | 'video'; fit?: MediaFit; loop?: boolean; /** Format Background › Transparency, 0–1. */ transparency?: number }
  /** Format Background › Pattern fill (domain/patterns). */
  | { kind: 'pattern'; preset: string; fg: string; bg: string }
  /** Built-in image shipped with the app (the church's template backgrounds). */
  | { kind: 'image'; url: string; fit?: MediaFit }
  | { kind: 'camera'; deviceId: string; label: string }
  /** Generated moving background (aurora, waves, stars…); drawn live, no file needed. */
  | { kind: 'motion'; style: MotionStyle; colors: string[]; speed?: number };

export type MotionStyle = 'aurora' | 'waves' | 'stars' | 'rays' | 'embers' | 'bokeh';

/** The 수련회's moving background: follows the retreat theme (자동) or is set by hand, and can be changed at any time. */
export interface RetreatLook {
  /** The retreat theme text (주제), e.g. "빛으로 나아가라". */
  theme: string;
  enabled: boolean;
  /** Style and colours follow the theme text; off = the style and colours below are used as set. */
  auto: boolean;
  style: MotionStyle;
  /** [base, accent, highlight] as #rrggbb. */
  colors: string[];
  /** 0.25 – 3, 1 = normal. */
  speed: number;
  /** 0 – 0.9 darkening so lyrics stay readable. */
  dim: number;
}

/** Cue at a time in a video/audio file (ProPresenter "playback markers"). */
export interface PlaybackMarker {
  id: string;
  /** Seconds from the start. */
  t: number;
  label: string;
  macroId?: string;
  stageMessage?: string;
}

export interface MediaMeta {
  id: string;
  name: string;
  type: MediaType;
  /** Slide assets stay available for playback without appearing in the background library. */
  backgroundHidden?: boolean;
  markers?: PlaybackMarker[];
}

/** 'table', 'chart', 'icon' and 'ink' are drawn by the Rust engine (src/engine), as are preset shapes. */
export type ElementKind = 'text' | 'image' | 'shape' | 'video' | 'camera' | 'qr' | 'table' | 'chart' | 'icon' | 'ink' | 'audio' | 'zoom';
export type DashStyle = 'solid' | 'dash' | 'dot' | 'dashDot' | 'lgDash' | 'sysDash' | 'sysDot';
/** Shape Outline › Arrows: the arrowhead drawn at a line's end (DeckCraft's LineEnd kinds). */
export type ArrowKind = 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow';

/** A stretch of text inside a line with its own character formatting (see domain/richText). */
export interface TextRun {
  text: string;
  /** Canvas pixels. */
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  strike?: boolean;
  /** 위 첨자 / 아래 첨자. */
  baseline?: 'super' | 'sub';
  /** The run's own typeface (kept from pasted PowerPoint / web text). */
  fontFamily?: string;
  /** Highlighter colour behind the run. */
  highlight?: string;
}

/** What clicking an object does in a slide show (Insert › Action). */
export interface ElementAction {
  /** lastViewed: back to the slide shown before; customShow: play custom show `show` and come back; playMedia: play the object's own audio / video. */
  kind: 'next' | 'prev' | 'first' | 'last' | 'slide' | 'url' | 'end' | 'lastViewed' | 'customShow' | 'playMedia';
  slideId?: string;
  url?: string;
  /** customShow: the custom show's id. */
  show?: string;
}

/** Playback (video / audio objects). */
export interface MediaPlayback {
  /** 자동 실행 when the slide appears; otherwise on click (in the slide show). */
  autoplay?: boolean;
  loop?: boolean;
  /** 0–1. */
  volume?: number;
  muted?: boolean;
  /** Trim, seconds. */
  start?: number;
  end?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Hide the object during the show while it is not playing (audio icon, video). */
  hideDuringShow?: boolean;
  /** Video poster frame, seconds. */
  poster?: number;
  /** Rewind after playing: back to the start (or poster frame) when it ends. */
  rewind?: boolean;
  /** Play across slides: audio keeps playing after its slide is left. */
  acrossSlides?: boolean;
  /** Play full screen: a video fills the slide while it plays. */
  fullScreen?: boolean;
}

/** Picture Format adjustments; the shown picture is made from `original` by the engine. */
export interface PictureAdjust {
  original: string;
  removeBackground?: number;
  transparentColor?: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  sharpness?: number;
  recolor?: string;
  artistic?: string;
}

/** One line of a text element with its own formatting (kept from imported PowerPoint text boxes). */
export interface ElementParagraph {
  text: string;
  /** Character formatting within the line; used only while it spells `text`. */
  runs?: TextRun[];
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: HAlign;
}

/** A free-positioned object on a slide (slide editor), in 1440×1080 canvas pixels. */
export interface SlideElement {
  /** Legacy maximum-fit request; automatic layout no longer enlarges fonts. */
  maximizeFont?: boolean;
  /** Original/manual size retained when extreme overflow needs a temporary smaller font. */
  preferredFontSize?: number;
  id: string;
  kind: ElementKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: HAlign;
  vAlign?: VAlign;
  shadow?: boolean;
  mediaId?: string;
  fit?: MediaFit;
  fill?: string;
  stroke?: string;
  radius?: number;
  ellipse?: boolean;
  /** Camera / capture device for 'camera' objects. */
  deviceId?: string;
  /** The address a 'qr' object encodes. */
  link?: string;
  /** Per-line formatting; `text` stays the plain text (lines joined by \n). */
  paragraphs?: ElementParagraph[];
  /** Character formatting of a box without `paragraphs`: the runs of each line of `text`. */
  runs?: TextRun[][];
  /**
   * Format Shape › 텍스트 상자 › 자동 맞춤: false 자동 맞춤 안 함, 'shrink' 넘치면 텍스트 크기 조정,
   * 'resize' 도형을 텍스트 크기에 맞춤 (PowerPoint / DeckCraft, domain/textFit). true / unset is
   * LightCast's fit for template boxes: grow inside the slide, preserving font sizes.
   */
  autoFit?: boolean | 'shrink' | 'resize';
  /** 'shrink' boxes: the scale their text is drawn at so it fits (PowerPoint's normAutofit fontScale, 0.1–1). */
  fontScale?: number;
  /** PowerPoint text options, as on the slide text (see Theme). */
  underline?: boolean;
  strike?: boolean;
  letterSpacing?: number;
  lineHeight?: number;
  highlight?: string;
  list?: ListStyle;
  indent?: number;
  columns?: number;
  vertical?: boolean;
  /** Text-box purpose, retained when editing or filling a template. */
  role?: 'prayer' | 'lyrics';
  /**
   * PowerPoint preset shape by its Office Open XML name (rect, roundRect, ellipse, star5, rightArrow,
   * heart, wedgeRoundRectCallout… 183 of them); the outline comes from the engine. Without it a shape
   * is the plain box / circle of older slides (`radius`, `ellipse`).
   */
  shape?: string;
  /** The preset's adjust values (the yellow handles), in the file format's units. */
  adj?: number[];
  /** Outline width in canvas pixels (default 4 when `stroke` is set). */
  strokeWidth?: number;
  dash?: DashStyle;
  /** Two-colour gradient fill, drawn at `gradientAngle` degrees (0 = left to right, 90 = top to bottom). */
  gradient?: [string, string];
  gradientAngle?: number;
  /** Shape Fill › Gradient: linear (default, along gradientAngle) or radial (from the centre). */
  gradientType?: 'linear' | 'radial';
  /** Shape Fill › Picture: a media id; the picture fills the outline (cropped to fit). */
  fillImage?: string;
  /** Shape Fill › Pattern: one of PATTERNS, foreground over background colour. */
  pattern?: { kind: string; fg: string; bg: string };
  /** Shape effects. */
  dropShadow?: boolean;
  glow?: string;
  softEdge?: number;
  /** Lines: arrowheads at the start / end. */
  arrowStart?: boolean;
  arrowEnd?: boolean;
  flipH?: boolean;
  flipV?: boolean;
  /** Objects with the same group id are selected, moved and sized together (Arrange › Group). */
  groupId?: string;
  /** Review › Language: the proofing language (BCP-47), and "do not check spelling". */
  lang?: string;
  noProof?: boolean;
  /** The group this object was in before Ungroup (Arrange › Regroup puts it back). */
  prevGroupId?: string;
  /** A layout placeholder: shows a prompt in the editor while empty (Slide Master › Insert Placeholder). */
  placeholder?: 'title' | 'body' | 'text' | 'picture';
  /** Name shown in the Selection pane. */
  name?: string;
  /** Hidden in the Selection pane: kept on the slide, not drawn. */
  hidden?: boolean;
  /** Alt text (accessibility). */
  alt?: string;
  /** A link opened when the object is clicked in a slide show. */
  href?: string;
  /** Insert › Link › ScreenTip: shown when the pointer rests on the object in a slide show. */
  tooltip?: string;
  /** Insert › Action › Mouse Over: what pointing at the object does in a slide show. */
  hoverAction?: ElementAction;
  table?: import('../engine').TableData;
  chart?: import('../engine').ChartData;
  /** Lucide icon name ('icon' objects). */
  icon?: string;
  /** Glued connector: its ends follow these objects' connection sites. */
  connect?: { from?: { id: string; site: number }; to?: { id: string; site: number } };
  /** Shape effects beyond shadow / glow. */
  shadowKind?: 'outer' | 'inner' | 'perspective' | 'bottom' | 'center';
  /** Format Shape › Shadow: colour, transparency (0–1), blur and distance (canvas px), angle (°). */
  shadowOpts?: { color?: string; transparency?: number; blur?: number; dist?: number; dir?: number };
  glowSize?: number;
  /** Glow transparency 0–1 (default 0.6, PowerPoint's 60%). */
  glowAlpha?: number;
  reflection?: boolean;
  /** Reflection variations: size (0–1 of the object shown), transparency (0–1), distance (px). */
  reflectionOpts?: { size?: number; transparency?: number; dist?: number };
  /** 3-D rotation in degrees (x tilts forward, y turns sideways, z turns in the slide); `persp` draws it in perspective. */
  rotate3d?: { x: number; y: number; z?: number; persp?: boolean };
  /** The 3-D rotation preset picked (DeckCraft's camera presets), shown as chosen in the gallery. */
  camera3d?: string;
  bevel?: boolean;
  /** Bevel preset (circle, relaxedInset, cross, coolSlant, angle, softRound, convex, slope, divot, riblet, hardEdge, artDeco). */
  bevelKind?: string;
  /** Arrowhead kinds and size (default triangle, medium) where `arrowStart` / `arrowEnd` are on. */
  arrowStartKind?: ArrowKind;
  arrowEndKind?: ArrowKind;
  arrowSize?: 'sm' | 'med' | 'lg';
  /** Size and Position › 가로 세로 비율 고정 (pictures default to on). */
  lockAspect?: boolean;
  /** Selection pane lock: selectable and formattable, but not moved, sized or turned on the slide. */
  locked?: boolean;
  /** Placed by the slide master (kept in step with it; not selectable on the slide). */
  master?: boolean;
  /** Pictures: crop as fractions of the picture cut from each side (l, t, r, b). */
  crop?: [number, number, number, number];
  picture?: PictureAdjust;
  /** Picture Styles preset. */
  pictureStyle?: string;
  /** An animated GIF held on its first frame (DeckCraft media.gifPlay). */
  gifPaused?: boolean;
  /** Picture Format › Crop › Crop to Shape: the preset the picture is cut to. */
  maskShape?: string;
  playback?: MediaPlayback;
  action?: ElementAction;
  /** Slide Zoom: the slide it shows (and jumps to in a slide show), with a copy to draw it from. */
  targetSlideId?: string;
  /** Zoom › Return to Zoom: after `zoomEndSlideId` (default the target) the show comes back to the zoom's slide. */
  zoomReturn?: boolean;
  zoomEndSlideId?: string;
  zoomOf?: { slide: Slide; theme: Theme; background: Background | null };
  /** SmartArt: the diagram this object belongs to (one member, `smartArt.owner`, keeps it); `rtl`: Right to Left. */
  smartArt?: { kind: string; style: string; colors: string; nodes: { text: string; level: number }[]; box: { x: number; y: number; w: number; h: number }; rtl?: boolean };
  /** Text effects. */
  caps?: 'all' | 'small';
  /** WordArt › Text Effects › Transform: the text follows this path. */
  warp?: string;
  textOutline?: { color: string; width: number };
  /** 0–1 transparency of the text. */
  textTransparency?: number;
  /** Text box margins in canvas pixels: left, top, right, bottom. */
  margins?: [number, number, number, number];
  /** false = do not wrap text in the shape. */
  wrap?: boolean;
  spaceBefore?: number;
  spaceAfter?: number;
  firstIndent?: number;
  rtl?: boolean;
  /** Home › Paragraph › Tabs…: tab stops in canvas px from the text area's left, sorted. */
  tabStops?: { pos: number; align: 'left' | 'center' | 'right' | 'decimal' }[];
  /** Default tab spacing in canvas px (144 = 2.54 cm when unset). */
  defaultTab?: number;
  /** 'ink' objects: SVG path drawn in a `pathW`×`pathH` box that is stretched to the object. */
  path?: string;
  pathW?: number;
  pathH?: number;
}

/** One effect in a slide's animation list (the Animation Pane's order); timing runs in the engine. */
export interface SlideAnimation {
  id: string;
  elementId: string;
  /** DeckCraft effect id: appear, fade, fly, wipe, zoom, spin, pulse, flyOut, lines… */
  effect: string;
  class: 'entrance' | 'emphasis' | 'exit' | 'path';
  /** Effect option (direction and the like). */
  option?: string;
  /** 클릭할 때 / 이전 효과와 함께 / 이전 효과 다음에 */
  start: 'click' | 'with' | 'after';
  durationMs: number;
  delayMs: number;
  /** Timing › Repeat: times played (unset/1 = once); `REPEAT_UNTIL_CLICK` = until the next click. */
  repeat?: number;
  /** Timing › Rewind when done playing: the object goes back to how it was before the effect. */
  rewind?: boolean;
  /** Trigger › On Click of: the object (id) whose click plays this effect, outside the slide's clicks. */
  trigger?: string;
  /** Motion Paths › Custom Path: `M 0 0 L dx dy …` in slide fractions from where the object sits. */
  path?: string;
  /**
   * Effect Options › 순서, for objects with text: 하나의 개체로 (default) or 단락별로 — each
   * first-level paragraph its own step, deeper paragraphs going with the one above them.
   */
  sequence?: 'one' | 'paragraph';
}

/** A review comment on a slide (Review › New Comment). */
export interface SlideComment {
  id: string;
  author: string;
  text: string;
  at: number;
  resolved?: boolean;
  replies?: { author: string; text: string; at: number }[];
  /** The object it was written on (selected when the comment was added), as DeckCraft anchors it. */
  elementId?: string;
}

/** Things a slide does when it goes live (ProPresenter "slide actions"). */
export type SlideAction = MacroStep | { type: 'runMacro'; macroId: string };

export interface Slide {
  /** Front template: preserve original fonts/paragraph sizes/geometry; only its date is refreshed. */
  preserveTextLayout?: boolean;
  /** Legacy maximum-fit request; automatic layout no longer enlarges fonts. */
  maximizeFont?: boolean;
  /** Original/manual size retained when extreme overflow needs a temporary smaller font. */
  preferredFontSize?: number;
  id: string;
  /** Original import type: PowerPoint objects remain editable; PDF page content is read-only. */
  importSource?: { format: 'pptx' | 'ppt' | 'pdf'; name: string; page: number };
  /** Original slide identity when a repeated arrangement occurrence is made independent. */
  sourceSlideId?: string;
  /** Main text is song lyrics; corner QR codes must leave equal space on both sides. */
  lyricBody?: boolean;
  group: string;
  text: string;
  /** Bold heading above the text (announcement title, prayer topic, scripture reference). */
  title?: string;
  /** Smaller line under the text: English lyrics, a second Bible translation. */
  subtext?: string;
  /** Links rendered as QR codes in the bottom-right corner. */
  qr?: string[];
  label?: string;
  notes?: string;
  disabled?: boolean;
  background?: Background;
  /** Small title in the top-left corner, e.g. "한글 제목 | English Title". */
  caption?: string;
  /** This slide's own font / size / colour / alignment (overrides the theme). */
  style?: SlideStyle;
  elements?: SlideElement[];
  actions?: SlideAction[];
  /** Seconds before advancing to the next slide automatically. */
  autoAdvance?: number;
  /** Single key that jumps to this slide while its presentation is selected. */
  hotkey?: string;
  transition?: Transition;
  animations?: SlideAnimation[];
  comments?: SlideComment[];
  /** Review › Language for the slide's own text. */
  lang?: string;
  noProof?: boolean;
  /** Insert › Photo Album: the album this slide belongs to (Edit Photo Album rebuilds it). */
  album?: { id: string; per: 1 | 2 | 4; frame: string; titles: boolean; captions: boolean };
  /** The Slide Master layout this slide was made from. */
  layoutId?: string;
  /** Character formatting of the slide's own text, one list of runs per line (ignored for a line they no longer spell). */
  textRuns?: TextRun[][];
  /** Header & Footer on this slide. */
  footer?: SlideFooter;
  /** Format Background › Hide background graphics: the master's objects are not shown here. */
  hideMaster?: boolean;
}

export interface SlideFooter {
  /** true: today's date; a string: that fixed text. */
  date?: boolean | string;
  /** Header & Footer › Don't show on title slide. */
  hideOnTitle?: boolean;
  /** Date & Time format of an updating date (insertTools DATE_FORMATS id); the locale date when absent. */
  dateFormat?: string;
  slideNumber?: boolean;
  text?: string;
}

export interface Arrangement {
  id: string;
  name: string;
  groups: string[];
}

export interface SongMeta {
  author?: string;
  copyright?: string;
  ccli?: string;
  key?: string;
  tempo?: string;
  /** Key the team plays this song in at the service (when different from `key`); the stage chords follow it. */
  playKey?: string;
  /** Capo fret for the stage chords. */
  capo?: number;
  /** The song's 진행 as written on the 콘티 / in the library, e.g. ["I","V1","C","V2","C"]. */
  order?: string[];
}

/**
 * 'cut' | 'fade' | 'slide' | 'zoom' are LightCast's own (CSS); `fx:<id>` is one of the engine's
 * PowerPoint transitions (fx:push, fx:wipe, fx:split, fx:blinds, fx:clock…), drawn frame by frame.
 */
export type TransitionKind = 'cut' | 'fade' | 'slide' | 'zoom' | `fx:${string}`;
export interface Transition {
  kind: TransitionKind;
  /** Milliseconds. */
  duration: number;
  /** Effect option of an engine transition (direction and the like). */
  option?: string;
  /** Transitions › Sound: an audio file from the media library played as the slide comes on. */
  sound?: string;
  /** Sound › Loop Until Next Sound. */
  soundLoop?: boolean;
  /** Sound › [Stop Previous Sound]: the slide stops a sound still playing. */
  stopSound?: boolean;
  /** Timing › On Mouse Click; `false`: a click no longer moves to the next slide (animations still play). */
  advanceOnClick?: boolean;
}

export interface Presentation {
  id: string;
  /** An image from a Saturday dawn service; retain ownership while other playlists still use it. */
  cleanupOnPlaylistRemoval?: 'saturday-dawn';
  /** Essential material: unlock explicitly before editing, replacing or deleting it. */
  protected?: boolean;
  /** A newer explicit protection change wins during device sync; old clients cannot silently unlock. */
  protectionChangedAt?: number;
  /** Which church template (and 고백송) this deck was last built from; set on decks LightCast keeps in sync. */
  templateKey?: string;
  /** A song's lyrics by part as written (blank lines kept) and its 진행 — what the song editor edits. */
  songSource?: { sections: { label: string; lines: string[] }[]; order?: string[] };
  /** Lyrics already laid out the church's way (each part once, blank-line breaks) at this many lines per slide. */
  lyricsLayout?: { linesPerSlide: number };
  /** Sheet-music slides of a song found on the internet (기도회 찬양): the title searched, the file and the page it came from. */
  scoreSheet?: { title: string; file: string; page: string };
  /** Individual slide content/design was edited; automatic song styling must preserve it. */
  slidesEdited?: boolean;
  /** Existing lyric boxes have received the centered default; later individual edits are kept. */
  lyricsCentered?: boolean;
  title: string;
  slides: Slide[];
  themeId: string;
  background?: Background;
  arrangements?: Arrangement[];
  arrangementId?: string | null;
  meta?: SongMeta;
  transition?: Transition;
  showCopyright?: boolean;
  /** Folder in the library sidebar (e.g. "Songs", "0712 주일예배"). */
  folder?: string;
  /** After the last slide, go back to the first (announcement loops). */
  loop?: boolean;
  /** Comes from the online library: loaded each session, never saved on this computer. */
  online?: boolean;
  /** When a library song was last saved (ms); the newest copy of a song title is the one kept. */
  updatedAt?: number;
  /** Dim / blur applied to the background while this presentation is live. */
  bgEffect?: BackgroundEffect;
  /** Built by the 수련회 builder: its background follows the retreat's moving background setting. */
  retreatBg?: boolean;
  /** Recorded slide timings, optionally synced to an audio track. */
  timeline?: Timeline;
  /** Design › Variants › Colors: the engine colour scheme tables, charts and the colour picker use. */
  colorScheme?: string;
  /** View › Slide Master: objects shown on every slide (copied onto the slides with `master`). */
  master?: { elements: SlideElement[]; background?: Background; layouts?: MasterLayout[] };
  /** Slide Show › Set Up Slide Show. */
  showSetup?: { noAnimation?: boolean; manual?: boolean; noTransitions?: boolean };
  /** Slide Show › Custom Slide Show: named lists of slides. */
  customShows?: { id: string; name: string; slideIds: string[] }[];
  /** View › Guides the user placed (canvas pixels). */
  guides?: { v: number[]; h: number[] };
  /** Design › Variants › Effects: how strong the shape styles' shadows and bevels are. */
  themeEffects?: 'subtle' | 'moderate' | 'intense';
  /** View › Handout Master: how handouts print. */
  handoutMaster?: HandoutMaster;
  /** View › Notes Master: what notes pages show. */
  notesMaster?: NotesMaster;
  /** File › Info › Properties (written to the .pptx). */
  properties?: DocProperties;
  /** Home › Drawing › Set as Default Shape: the look new shapes get. */
  defaultShape?: Partial<SlideElement>;
}

export interface BackgroundEffect {
  /** 0 – 0.9 black overlay. */
  dim: number;
  /** Blur radius in canvas pixels. */
  blur: number;
}

export interface Timeline {
  audioMediaId: string | null;
  /** Seconds from start → position in the play sequence. */
  cues: { t: number; seq: number }[];
}

export type PlaylistItem =
  | { id: string; kind?: 'presentation'; presentationId: string }
  | { id: string; kind: 'header'; title: string };

export interface Playlist {
  /** Keep this service until the next weekly cleanup, even after its own service ends. */
  autoDeleteAfter?: number;
  id: string;
  name: string;
  items: PlaylistItem[];
}

export type TimerKind = 'countdown' | 'countdownTo' | 'elapsed';
export interface Timer {
  id: string;
  name: string;
  kind: TimerKind;
  durationMs: number;
  /** "HH:MM" for countdownTo. */
  target: string;
  running: boolean;
  startedAt: number | null;
  accumulatedMs: number;
}

export type PropKind = 'text' | 'image' | 'clock' | 'timer';
export type PropPosition =
  | 'top-left' | 'top' | 'top-right' | 'center' | 'bottom-left' | 'bottom' | 'bottom-right' | 'full';
export interface Prop {
  id: string;
  name: string;
  kind: PropKind;
  text?: string;
  mediaId?: string;
  timerId?: string;
  position: PropPosition;
  size: number;
  color: string;
  background: string;
}

export interface MessageTemplate {
  id: string;
  name: string;
  /** Text with {tokens} the operator fills in, e.g. "Parent of {child}, please come to the nursery". */
  template: string;
}

export type MacroStep =
  | { type: 'clearAll' }
  | { type: 'clearText' }
  | { type: 'clearBackground' }
  | { type: 'clearProps' }
  | { type: 'black'; on: boolean }
  | { type: 'background'; background: Background | null }
  | { type: 'go'; presentationId: string; index: number }
  | { type: 'timer'; timerId: string; op: 'start' | 'stop' | 'reset' }
  | { type: 'prop'; propId: string; on: boolean }
  | { type: 'message'; text: string | null }
  | { type: 'audio'; mediaId: string | null }
  | { type: 'logo'; on: boolean }
  | { type: 'stageMessage'; text: string | null }
  | { type: 'announce'; presentationId: string | null }
  /** DMX lighting over Art-Net: set channels (1–512) of a universe. Run by the console. */
  | { type: 'dmx'; universe: number; channels: Record<string, number> }
  /**
   * Behringer X32 over Wi-Fi: mute / unmute / set the fader (0–1) of a strip ('ch/05', 'dca/2',
   * 'main/st'), or recall a scene (0–99). Run by the console.
   */
  | { type: 'x32'; action: 'mute' | 'unmute' | 'fader'; strip: string; value?: number }
  | { type: 'x32'; action: 'scene'; scene: number };

export interface Macro {
  id: string;
  name: string;
  color: string;
  steps: MacroStep[];
}

export interface ScreenLayers {
  background: boolean;
  slide: boolean;
  props: boolean;
  messages: boolean;
  timer: boolean;
  announcements?: boolean;
}

export interface ScreenMask {
  kind: 'none' | 'rect' | 'oval';
  /** Inset from each edge, in canvas pixels. */
  inset: number;
}

export interface Screen {
  id: string;
  name: string;
  layers: ScreenLayers;
  /** Override theme for this screen (e.g. a lower-third look). */
  themeId: string | null;
  /** Fill for transparent areas: black, chroma green, or truly transparent. */
  /** 'matte' = key output: white where content is, black elsewhere (pair with a fill screen). */
  key: 'black' | 'green' | 'transparent' | 'matte';
  mask?: ScreenMask;
  /** Edge blend: this screen shows the left or right part of a two-projector picture. */
  edge?: { part: 'none' | 'left' | 'right'; overlap: number };
}

/** A saved set of layer choices for every screen (ProPresenter "Looks"). */
export interface Look {
  id: string;
  name: string;
  screens: Record<string, ScreenLayers>;
}

export interface StageLayout {
  id: string;
  name: string;
  clock: boolean;
  timers: boolean;
  current: boolean;
  next: boolean;
  notes: boolean;
  preview: boolean;
  chords: boolean;
  videoCountdown: boolean;
  /** Text size multiplier. */
  scale: number;
}

export interface Schedule {
  id: string;
  name: string;
  macroId: string;
  /** "HH:MM" local time. */
  time: string;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  enabled: boolean;
  /** "YYYY-MM-DD HH:MM" of the last run, so a schedule fires once per slot. */
  lastRun?: string;
}

export interface DeviceIdentity {
  id: string;
  name: string;
  userName: string;
  platform: string;
  computerName?: string;
  appVersion?: string;
}
export interface DeviceRegistration extends DeviceIdentity { lastSeen: number; account: string | null }
export interface ActivityEntry {
  id: string;
  at: number;
  action: string;
  detail: string;
  device: DeviceIdentity;
  account: string | null;
}

export interface UsageEntry {
  device?: DeviceIdentity;
  account?: string | null;
  at: number;
  presentationId: string;
  title: string;
  ccli?: string;
}

export interface SundaySettings {
  frontId: string | null;
  prayerId: string | null;
  backId: string | null;
  confessionSong: string;
  /** This week's 기도제목 as typed (numbered topics, points under them); shown on the Front deck. */
  prayerText?: string;
  linesPerSlide: number;
  translations: string[];
  versesPerSlide: number;
  /** Church-PPT defaults applied so far: 1 = one verse per slide, 2 = up to 4 lyric lines per slide. */
  styleVersion?: number;
}

export interface TrashEntry {
  id: string; kind: 'presentation' | 'slides'; deletedAt: number; expiresAt: number;
  presentation: Presentation;
  placements?: { playlistId: string; index: number; item: PlaylistItem }[];
  slides?: { slide: Slide; seq: number; previous?: { id: string; occurrence: number }; next?: { id: string; occurrence: number } }[];
}

export interface Library {
  /** Server-issued generation: a complete clear replaces old local content instead of merging it. */
  cloudResetId?: string;
  /** Explicit protection changes survive deletion so another device can honor an unlocked deletion. */
  protectionChanges?: { id: string; on: boolean; at: number }[];
  version: 1;
  devices?: DeviceRegistration[];
  activity?: ActivityEntry[];
  lastModified?: ActivityEntry;
  trash?: TrashEntry[];
  /** '4:3' once slides use the 1440×1080 canvas (libraries without it were laid out at 1920×1080). */
  aspect?: '4:3';
  /** Set once every presentation's and slide's own transition has been cleared (default is 없음, 1 ms). */
  transitionsReset?: true;
  /** Existing background registrations have been cleared without deleting slide assets. */
  backgroundLibraryReset?: true;
  presentations: Presentation[];
  themes: Theme[];
  playlists: Playlist[];
  media: MediaMeta[];
  timers: Timer[];
  props: Prop[];
  messageTemplates: MessageTemplate[];
  macros: Macro[];
  screens: Screen[];
  usage: UsageEntry[];
  sunday: SundaySettings;
  schedules: Schedule[];
  logoMediaId: string | null;
  looks: Look[];
  stageLayouts: StageLayout[];
  /** 수련회 moving background; decks with `retreatBg` follow it. */
  retreat?: RetreatLook;
}

/** Everything the output and stage windows need to render. */
export interface LiveState {
  slide: Slide | null;
  title: string | null;
  nextText: string | null;
  theme: Theme;
  transition: Transition;
  background: Background | null;
  black: boolean;
  message: string | null;
  activeProps: string[];
  props: Prop[];
  timers: Timer[];
  outputTimerId: string | null;
  screens: Screen[];
  themes: Theme[];
  copyright: string | null;
  video: { playing: boolean; restart: number; seek?: { t: number; n: number }; loop?: boolean; endsAt?: number | null };
  bgEffect: BackgroundEffect | null;
  logo: boolean;
  logoMediaId: string | null;
  /** Shown only on stage displays. */
  stageMessage: string | null;
  /** Scroll the message across the screen like a ticker. */
  messageScroll: boolean;
  stageLayouts?: StageLayout[];
  /** Stage display chords: semitones the key is moved up (negative = down). */
  chordShift?: number;
  /** Stage display chords: capo fret, so the chords shown are the shapes to play. */
  capo?: number;
  /** The key the live song is written in (its chords are in this key), for the stage displays. */
  songKey?: string | null;
  /** Separate looping layer (e.g. lower-third announcements during pre-service). */
  announcement: { slide: Slide; theme: Theme; title: string } | null;
  /** The live slide's number in its presentation (Insert › Slide Number). */
  number?: number;
  /** Where the live slide's animations are (click builds); absent when it has none. */
  build?: import('./animations').LiveBuild;
}

/** Handout and notes page placeholders (View › Handout / Notes Master). */
export interface PagePlaceholders { header?: string; footer?: string; date?: boolean; pageNumber?: boolean }
export interface HandoutMaster extends PagePlaceholders { perPage: 1 | 2 | 3 | 4 | 6 | 9; landscape?: boolean }
export interface NotesMaster extends PagePlaceholders { landscape?: boolean }
export interface DocProperties { title?: string; subject?: string; author?: string; manager?: string; company?: string; category?: string; keywords?: string; comments?: string }

/** View › Slide Master › Insert Layout: a named set of placeholders new slides can start from. */
export interface MasterLayout { id: string; name: string; elements: SlideElement[]; preserve?: boolean }
