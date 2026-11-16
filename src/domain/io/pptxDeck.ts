// A whole .pptx → LightCast slides that look and behave like the original, with an import report.
//
// Per slide: the background (own, else the layout's, else the master's, theme background styles
// included), the master's and layout's own art (logos, bands; locked, behind the slide's objects),
// every shape, picture, group, connector, freeform, text box and placeholder (placeholders take their
// place, look and text style from layout → master → presentation defaults, as PowerPoint layers them),
// tables (style fills written onto the cells), charts (editable LightCast charts from the cached data),
// SmartArt (the shapes PowerPoint saved in the diagram drawing part), OLE objects (their picture), audio
// and video, hyperlinks and slide jumps, speaker notes, comments, hidden slides, sections, the transition
// and the animations. A slide that is not 4:3 is scaled into the 4:3 canvas and centred.
//
// What cannot be represented is counted in the report (importReport.ts) and put on the slide
// (importSource.warnings); nothing is left out silently. The reader never throws for a damaged part:
// it skips it and says so. Size caps keep a hostile file from exhausting memory.
import JSZip from 'jszip';
import type { Background, ElementAction, Slide, SlideComment, SlideElement } from '../types';
import { uid } from '../lyrics';
import { CANVAS_H, CANVAS_W } from '../canvas';
import { metafileToBlob } from '../metafile/image';
import { shrinkBulletPicture } from '../pictureBullet';
import { stopsCss } from './odpGeometry';
import { colorOf, EMU_PER_PX, fillFromNode, mergeStyle, nodeToElements, OFFICE_THEME, readDmlTheme, type DmlContext, type DmlTheme, type Inherit } from './drawingml';
import { child, find, kids, local, parseMarkup, path, textOf, type MNode } from './markup';
import { readTable } from './pptxTable';
import { readChart, readChartEx } from './pptxChart';
import { readAnimations, readTransition } from './pptxTiming';
import { newReport, note, slideWarnings, type ImportReport } from './importReport';

/** Size caps: parts in the package, one XML part, one media file, all media together, slides. */
export const PPTX_LIMITS = { parts: 20000, xmlBytes: 32 * 1024 * 1024, mediaBytes: 400 * 1024 * 1024, totalMedia: 1536 * 1024 * 1024, slides: 2000 };

export interface DeckOptions {
  /** File name, for the report and importSource. */
  file: string;
  /** Slide group when the file has no sections. */
  group: string;
  /** Store a picture / video / audio; returns its media id (undefined: not stored). */
  store: (blob: Blob, name: string, type: 'image' | 'video' | 'audio') => Promise<string | undefined>;
  onProgress?: (done: number, total: number) => void;
}

export interface DeckResult { slides: Slide[]; report: ImportReport }

const NULL_NODE: MNode = { name: '#root', attrs: {}, children: [] };
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|wmv|avi|mpe?g|mkv|asf|ogv)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|wma|aac|ogg|oga|mid|midi|aiff?|flac)$/i;
const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', ico: 'image/x-icon' };
const MEDIA_MIME: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', wmv: 'video/x-ms-wmv', avi: 'video/x-msvideo', mpg: 'video/mpeg', mpeg: 'video/mpeg', mkv: 'video/x-matroska', ogv: 'video/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', wma: 'audio/x-ms-wma', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', mid: 'audio/midi', midi: 'audio/midi', aif: 'audio/aiff', aiff: 'audio/aiff', flac: 'audio/flac' };

interface Rel { type: string; target: string; external: boolean }

/** Everything one part (slide, layout, master, diagram drawing) needs to turn into objects. */
interface PartCtx {
  path: string;
  rels: Map<string, Rel>;
  media: Map<string, string>;
  files: Map<string, { id: string; type: 'video' | 'audio' }>;
  bullets: Map<string, string>;
  /** Charts, diagram data / drawings and other XML parts the part points at, parsed. */
  parts: Map<string, MNode>;
  /** Their own contexts (a SmartArt drawing has its own pictures). */
  subs: Map<string, PartCtx>;
}

interface MasterInfo { theme: DmlTheme; doc: MNode; path: string; ctx: PartCtx; tree: MNode | null; showMasterSp: boolean }
interface LayoutInfo { doc: MNode; path: string; ctx: PartCtx; tree: MNode | null; master: MasterInfo | null }

const relsPath = (part: string) => part.replace(/([^/]*)$/, '_rels/$1.rels');
function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  try { return decodeURIComponent(new URL(target, `https://x/${base}`).pathname.slice(1)); } catch { return target; }
}

const phOf = (n: MNode) => path(child(n, 'nvSpPr') ?? child(n, 'nvPicPr') ?? child(n, 'nvGraphicFramePr') ?? NULL_NODE, 'nvPr', 'ph');
const MASTER_TYPE: Record<string, string> = { ctrTitle: 'title', title: 'title', dt: 'dt', ftr: 'ftr', sldNum: 'sldNum', hdr: 'hdr' };
const masterType = (t: string | undefined) => MASTER_TYPE[t ?? ''] ?? 'body';

/** The placeholder of `tree` that a slide's placeholder of this type / index takes after. */
function findPh(tree: MNode | null, type: string | undefined, idx: string | undefined, byMasterType: boolean): MNode | null {
  if (!tree) return null;
  const all: MNode[] = [];
  const collect = (n: MNode) => { for (const c of n.children) { if (local(c) === 'grpSp') collect(c); else if (phOf(c)) all.push(c); } };
  collect(tree);
  const t = (n: MNode) => phOf(n)!.attrs.type;
  if (!byMasterType && idx !== undefined) {
    const hit = all.find((n) => phOf(n)!.attrs.idx === idx && (t(n) ?? 'body') === (type ?? 'body')) ?? all.find((n) => phOf(n)!.attrs.idx === idx);
    if (hit) return hit;
  }
  if (!byMasterType) { const hit = all.find((n) => (t(n) ?? 'body') === (type ?? 'body')); if (hit) return hit; }
  const want = masterType(type);
  return all.find((n) => masterType(t(n)) === want) ?? null;
}

/** The shape tree without placeholders (what a layout or master shows on each slide). */
function artOnly(tree: MNode | null): MNode | null {
  if (!tree) return null;
  return { ...tree, children: tree.children.filter((c) => !phOf(c)) };
}

/** Theme colours seen through a colour map (p:clrMap / a:overrideClrMapping): bg1 → lt1 and so on. */
function mapColors(theme: DmlTheme, map: MNode | null, base?: DmlTheme): DmlTheme {
  if (!map) return theme;
  const src = (base ?? theme).colors;
  const colors = { ...theme.colors };
  for (const [k, v] of Object.entries(map.attrs)) if (src[v]) colors[k] = src[v];
  return { ...theme, colors };
}

/** Every element's sizes × k, moved by (dx, dy): fits a slide of another size into the canvas. */
export function scaleElement(el: SlideElement, k: number, dx: number, dy: number): SlideElement {
  if (k === 1 && !dx && !dy) return el;
  const s = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * k * 10) / 10);
  const runs = <T extends { fontSize?: number; letterSpacing?: number }>(r: T): T => ({ ...r, ...(r.fontSize !== undefined ? { fontSize: s(r.fontSize) } : {}), ...(r.letterSpacing ? { letterSpacing: s(r.letterSpacing) } : {}) });
  const out: SlideElement = { ...el, x: Math.round((el.x * k + dx) * 10) / 10, y: Math.round((el.y * k + dy) * 10) / 10, w: s(el.w)!, h: s(el.h)! };
  for (const key of ['fontSize', 'strokeWidth', 'glowSize', 'softEdge', 'spaceBefore', 'spaceAfter', 'letterSpacing', 'firstIndent', 'defaultTab'] as const) if (el[key] !== undefined) (out as unknown as Record<string, number | undefined>)[key] = s(el[key]);
  if (el.margins) out.margins = el.margins.map((m) => s(m)!) as [number, number, number, number];
  if (el.lineExact) out.lineExact = { ...el.lineExact, px: s(el.lineExact.px)! };
  if (el.runs) out.runs = el.runs.map((l) => l.map(runs));
  if (el.paragraphs) out.paragraphs = el.paragraphs.map((p) => ({ ...runs(p), ...(p.runs ? { runs: p.runs.map(runs) } : {}), ...(p.spaceBefore ? { spaceBefore: s(p.spaceBefore) } : {}), ...(p.spaceAfter ? { spaceAfter: s(p.spaceAfter) } : {}) }));
  if (el.shadowOpts) out.shadowOpts = { ...el.shadowOpts, ...(el.shadowOpts.blur !== undefined ? { blur: s(el.shadowOpts.blur) } : {}), ...(el.shadowOpts.dist !== undefined ? { dist: s(el.shadowOpts.dist) } : {}) };
  if (el.reflectionOpts?.dist) out.reflectionOpts = { ...el.reflectionOpts, dist: s(el.reflectionOpts.dist) };
  if (el.textOutline) out.textOutline = { ...el.textOutline, width: s(el.textOutline.width)! };
  if (el.table) out.table = { ...el.table, cols: el.table.cols.map((c) => s(c)!), heights: el.table.heights.map((h) => s(h)!), ...(el.table.margins ? { margins: el.table.margins.map((m) => s(m)!) as [number, number, number, number] } : {}) };
  if (el.tabStops) out.tabStops = el.tabStops.map((t) => ({ ...t, pos: s(t.pos)! }));
  return out;
}

const KIND_LABEL: Record<string, string> = { text: '텍스트 상자', shape: '도형', image: '그림', table: '표', chart: '차트', video: '동영상', audio: '오디오' };

export async function readPptxDeck(data: ArrayBuffer | Uint8Array, opts: DeckOptions): Promise<DeckResult> {
  const report = newReport(opts.file);
  const zip = await JSZip.loadAsync(data);
  const names = Object.keys(zip.files);
  if (names.length > PPTX_LIMITS.parts) throw new Error(`PPTX 구성 파일이 너무 많습니다 (${names.length}개).`);
  const sizeOf = (f: JSZip.JSZipObject) => Number((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0);
  const xmlCache = new Map<string, Promise<MNode | null>>();
  const readXml = (p: string): Promise<MNode | null> => {
    let hit = xmlCache.get(p);
    if (!hit) {
      const f = zip.file(p);
      hit = !f || f.dir || sizeOf(f) > PPTX_LIMITS.xmlBytes ? Promise.resolve(null) : f.async('string').then((s) => parseMarkup(s)).catch(() => null);
      xmlCache.set(p, hit);
    }
    return hit;
  };
  const relCache = new Map<string, Promise<Map<string, Rel>>>();
  const readRels = (part: string) => {
    let hit = relCache.get(part);
    if (!hit) {
      hit = readXml(relsPath(part)).then((doc) => {
        const m = new Map<string, Rel>();
        for (const r of doc ? find(doc, 'Relationship') : []) {
          const external = r.attrs.TargetMode === 'External';
          m.set(r.attrs.Id, { type: r.attrs.Type ?? '', target: external ? r.attrs.Target ?? '' : resolve(part, r.attrs.Target ?? ''), external });
        }
        return m;
      });
      relCache.set(part, hit);
    }
    return hit;
  };

  // ── Media, stored once per package part ──
  let mediaTotal = 0;
  const stored = new Map<string, Promise<string | undefined>>();
  const storePart = (target: string, type: 'image' | 'video' | 'audio'): Promise<string | undefined> => {
    let hit = stored.get(target);
    if (hit) return hit;
    hit = (async () => {
      const f = zip.file(target);
      if (!f) { note(report, type === 'image' ? '그림' : '미디어', 'dropped', 0, '파일 안에 없는 그림·미디어를'); return undefined; }
      const size = sizeOf(f);
      if (size > PPTX_LIMITS.mediaBytes || mediaTotal + size > PPTX_LIMITS.totalMedia) { note(report, type === 'image' ? '그림' : '미디어', 'dropped', 0, '너무 커서'); return undefined; }
      mediaTotal += size;
      const name = target.split('/').pop() ?? 'media';
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      try {
        if (type === 'image' && (ext === 'emf' || ext === 'wmf')) {
          const blob = await metafileToBlob(await f.async('arraybuffer'));
          if (!blob) { note(report, 'WMF/EMF 그림', 'dropped', 0, '읽을 수 없어'); return undefined; }
          return await opts.store(blob, name.replace(/\.(emf|wmf)$/i, blob.type === 'image/png' ? '.png' : '.svg'), 'image');
        }
        const mime = type === 'image' ? IMAGE_MIME[ext] ?? 'image/png' : MEDIA_MIME[ext] ?? (type === 'video' ? 'video/mp4' : 'audio/mpeg');
        if (type === 'image' && (ext === 'tif' || ext === 'tiff')) note(report, 'TIFF 그림', 'approximated', 0, '브라우저가 표시하지 못할 수 있는 형식으로');
        return await opts.store(new Blob([await f.async('arraybuffer')], { type: mime }), name, type);
      } catch { return undefined; }
    })();
    stored.set(target, hit);
    return hit;
  };

  // ── A part's context: its pictures, media, bullet pictures and the XML parts it points at ──
  const ctxCache = new Map<string, Promise<PartCtx>>();
  const partCtx = (part: string, xml: MNode): Promise<PartCtx> => {
    let hit = ctxCache.get(part);
    if (hit) return hit;
    hit = (async () => {
      const rels = await readRels(part);
      const ctx: PartCtx = { path: part, rels, media: new Map(), files: new Map(), bullets: new Map(), parts: new Map(), subs: new Map() };
      const used = new Set<string>();
      const bulletIds = new Set<string>();
      const scan = (n: MNode, inBullet: boolean) => {
        for (const [k, v] of Object.entries(n.attrs)) if (/^r:(embed|link|id|dm|pict)$/.test(k)) { used.add(v); if (inBullet) bulletIds.add(v); }
        for (const c of n.children) scan(c, inBullet || local(c) === 'buBlip');
      };
      scan(xml, false);
      for (const id of used) {
        const rel = rels.get(id);
        if (!rel) continue;
        const t = rel.type;
        if (rel.external) {
          if (/\/(video|audio|media)$/.test(t)) note(report, '외부 연결 미디어', 'dropped', 0, '파일 밖에 있는 동영상·소리를');
          else if (/\/image$/.test(t)) note(report, '외부 연결 그림', 'dropped', 0, '파일 밖에 있는 그림을');
          continue;
        }
        if (/\/image$/.test(t)) {
          if (bulletIds.has(id)) {
            const f = zip.file(rel.target);
            const blob = f && sizeOf(f) < 4 * 1024 * 1024 ? new Blob([await f.async('arraybuffer')], { type: IMAGE_MIME[rel.target.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/png' }) : null;
            const url = blob ? await shrinkBulletPicture(blob).catch(() => null) : null;
            if (url) ctx.bullets.set(id, url);
          }
          const mid = await storePart(rel.target, 'image');
          if (mid) ctx.media.set(id, mid);
        } else if (/\/(video|audio|media)$/.test(t)) {
          const type = AUDIO_EXT.test(rel.target) || /\/audio$/.test(t) && !VIDEO_EXT.test(rel.target) ? 'audio' : 'video';
          const mid = await storePart(rel.target, type);
          if (mid) ctx.files.set(id, { id: mid, type });
        } else if (/\/(chart|diagramData|diagramDrawing|diagramLayout)$/.test(t) || /chartEx$/i.test(t) || /\/chartex$/.test(t)) {
          const doc = await readXml(rel.target);
          if (doc) ctx.parts.set(rel.target, doc);
        }
      }
      // A SmartArt drawing's own pictures.
      for (const [, rel] of rels) {
        if (!/diagramDrawing$/.test(rel.type) || rel.external) continue;
        const doc = await readXml(rel.target);
        if (doc) { ctx.parts.set(rel.target, doc); ctx.subs.set(rel.target, await partCtx(rel.target, doc)); }
      }
      return ctx;
    })();
    ctxCache.set(part, hit);
    return hit;
  };

  // ── Presentation ──
  const pres = (await readXml('ppt/presentation.xml')) ?? NULL_NODE;
  const presRels = await readRels('ppt/presentation.xml');
  const sldSz = find(pres, 'sldSz')[0];
  const W = (Number(sldSz?.attrs.cx) || 9144000) / EMU_PER_PX, H = (Number(sldSz?.attrs.cy) || 6858000) / EMU_PER_PX;
  const k = Math.min(CANVAS_W / W, CANVAS_H / H);
  const dx = (CANVAS_W - W * k) / 2, dy = (CANVAS_H - H * k) / 2;
  if (Math.abs(W / H - CANVAS_W / CANVAS_H) > 0.01) note(report, '슬라이드 크기', 'approximated', 0, `${(W / 144 * 2.54).toFixed(1)}×${(H / 144 * 2.54).toFixed(1)} cm를 4:3 화면에 맞춰 가운데에 놓아`);
  const defaults = find(pres, 'defaultTextStyle')[0] ?? null;
  const tableStyles = await readXml('ppt/tableStyles.xml');
  const sldIds = kids(find(pres, 'sldIdLst')[0], 'sldId').map((s) => ({ id: s.attrs.id, rId: s.attrs['r:id'] ?? Object.entries(s.attrs).find(([k2]) => /:id$/.test(k2) && k2 !== 'id')?.[1] }));
  let slidePaths = sldIds.map((s) => ({ sid: s.id, path: s.rId ? presRels.get(s.rId)?.target : undefined })).filter((s): s is { sid: string; path: string } => !!s.path && !!zip.file(s.path));
  if (!slidePaths.length) slidePaths = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1])).map((p) => ({ sid: '', path: p }));
  if (slidePaths.length > PPTX_LIMITS.slides) { note(report, '슬라이드', 'dropped', 0, `${PPTX_LIMITS.slides}개를 넘는`, slidePaths.length - PPTX_LIMITS.slides); slidePaths = slidePaths.slice(0, PPTX_LIMITS.slides); }
  // Sections (구역) become slide groups.
  const sectionOf = new Map<string, string>();
  const sections = find(pres, 'section');
  for (const sec of sections) for (const s of find(sec, 'sldId')) sectionOf.set(s.attrs.id, sec.attrs.name ?? '');
  if (sections.length) note(report, '구역', 'converted', 0, '슬라이드 그룹으로', sections.length);
  if (find(pres, 'custShow').length) note(report, '재구성한 쇼', 'dropped', 0, undefined, find(pres, 'custShow').length);
  if (names.some((n) => /vbaProject\.bin$/i.test(n))) note(report, '매크로', 'dropped', 0, '실행하지 않고');
  const fontCount = find(find(pres, 'embeddedFontLst')[0] ?? NULL_NODE, 'embeddedFont').length;
  if (fontCount) note(report, '포함된 글꼴', 'converted', 0, '글꼴 목록에', fontCount);
  // Comment authors (legacy and modern comments).
  const authors = new Map<string, string>();
  for (const a of find((await readXml('ppt/commentAuthors.xml')) ?? NULL_NODE, 'cmAuthor')) authors.set(`l${a.attrs.id}`, a.attrs.name ?? '');
  for (const a of find((await readXml('ppt/authors.xml')) ?? NULL_NODE, 'author')) authors.set(`m${a.attrs.id}`, a.attrs.name ?? '');

  // Slide ids up front, so links to slides can name them.
  const slideIds = new Map(slidePaths.map((s) => [s.path, uid('s')]));

  // ── Masters and layouts (cached) ──
  const masters = new Map<string, Promise<MasterInfo | null>>();
  const masterOf = (p: string) => {
    let hit = masters.get(p);
    if (!hit) {
      hit = (async () => {
        const doc = await readXml(p);
        if (!doc) return null;
        const rels = await readRels(p);
        const themeRel = [...rels.values()].find((r) => /\/theme$/.test(r.type));
        const themeDoc = themeRel ? zip.file(themeRel.target) : null;
        let theme = themeDoc ? readDmlTheme(await themeDoc.async('string')) : OFFICE_THEME;
        theme = mapColors(theme, find(doc, 'clrMap')[0] ?? null);
        return { theme, doc, path: p, ctx: await partCtx(p, doc), tree: find(doc, 'spTree')[0] ?? null, showMasterSp: true };
      })().catch(() => null);
      masters.set(p, hit);
    }
    return hit;
  };
  const layouts = new Map<string, Promise<LayoutInfo | null>>();
  const layoutOf = (p: string) => {
    let hit = layouts.get(p);
    if (!hit) {
      hit = (async () => {
        const doc = await readXml(p);
        if (!doc) return null;
        const rels = await readRels(p);
        const m = [...rels.values()].find((r) => /\/slideMaster$/.test(r.type));
        return { doc, path: p, ctx: await partCtx(p, doc), tree: find(doc, 'spTree')[0] ?? null, master: m ? await masterOf(m.target) : null };
      })().catch(() => null);
      layouts.set(p, hit);
    }
    return hit;
  };

  // ── Background ──
  const backgroundOf = (cSld: MNode | null, theme: DmlTheme, pc: PartCtx): Background | undefined => {
    const bg = child(cSld, 'bg');
    if (!bg) return undefined;
    let node: MNode | null = null, ph: string | undefined;
    const bgPr = child(bg, 'bgPr');
    if (bgPr) node = bgPr.children.find((c) => ['solidFill', 'gradFill', 'blipFill', 'pattFill', 'noFill'].includes(local(c))) ?? null;
    const ref = child(bg, 'bgRef');
    if (!node && ref) {
      const idx = Number(ref.attrs.idx ?? 0);
      ph = colorOf(ref.children.find((c) => /Clr$/.test(local(c))), theme)?.hex;
      node = (idx >= 1001 ? theme.bgFills?.[idx - 1001] : theme.fills?.[idx - 1]) ?? null;
      if (!node && ph) return { kind: 'color', value: ph };
    }
    if (!node || local(node) === 'noFill') return { kind: 'color', value: '#ffffff' };
    const f = fillFromNode(node, ph, { theme, media: (id) => pc.media.get(id) });
    if (f.fillImage) return { kind: 'media', mediaId: f.fillImage, mediaType: 'image', fit: 'cover', ...(child(node, 'tile') ? { pic: { tile: true } } : {}), ...(f.fillTransparency ? { transparency: f.fillTransparency } : {}) };
    if (f.pattern) return { kind: 'pattern', preset: f.pattern.kind, fg: f.pattern.fg, bg: f.pattern.bg };
    if (f.gradient) {
      const stops = f.gradientStops ?? [{ pos: 0, color: f.gradient[0] }, { pos: 100, color: f.gradient[1] }];
      return { kind: 'gradient', value: stopsCss({ type: f.gradientType === 'radial' ? 'radial' : 'linear', angle: f.gradientAngle ?? 0, stops }) };
    }
    if (f.fill) return { kind: 'color', value: f.fill };
    return undefined;
  };

  const slides: Slide[] = [];
  for (const [si, { sid, path: sp }] of slidePaths.entries()) {
    const n = si + 1;
    opts.onProgress?.(si, slidePaths.length);
    const id = slideIds.get(sp)!;
    const doc = await readXml(sp);
    if (!doc) { note(report, '슬라이드', 'dropped', n, '읽을 수 없어'); slides.push({ id, group: opts.group, text: '', importSource: { format: 'pptx', name: opts.file, page: n } }); continue; }
    try {
      const sld = find(doc, 'sld')[0] ?? doc;
      const rels = await readRels(sp);
      const layoutRel = [...rels.values()].find((r) => /\/slideLayout$/.test(r.type));
      const layout = layoutRel ? await layoutOf(layoutRel.target) : null;
      const master = layout?.master ?? null;
      let theme = master?.theme ?? OFFICE_THEME;
      theme = mapColors(theme, path(child(layout?.doc ? find(layout.doc, 'sldLayout')[0] ?? null : null, 'clrMapOvr'), 'overrideClrMapping'), theme);
      theme = mapColors(theme, path(child(sld, 'clrMapOvr'), 'overrideClrMapping'), master?.theme ?? theme);
      const pc = await partCtx(sp, doc);
      const tree = find(doc, 'spTree')[0] ?? null;
      const targets = new Map<string, string[]>();

      // Objects made from one part (slide, layout or master), with that part's pictures and links.
      const convert = (container: MNode | null, part: PartCtx, isSlide: boolean): SlideElement[] => {
        if (!container) return [];
        const ctx: DmlContext = {
          theme, strict: true, defaults,
          media: (rid) => part.media.get(rid),
          bulletPicture: (rid) => part.bullets.get(rid),
          mediaFile: (rid) => part.files.get(rid),
          link: (h) => {
            const rel = part.rels.get(h.attrs['r:id'] ?? '');
            if (rel?.external) return rel.target;
            if (h.attrs.action || rel) note(report, '슬라이드로 이동하는 글자 링크', 'approximated', n, '일반 글자로');
            return undefined;
          },
          action: (h) => actionOf(h, part),
          note: (ev, what) => note(report, what, ev, n),
          made: isSlide ? (shapeId, els) => targets.set(shapeId, els.map((e) => e.id)) : undefined,
          inherit: isSlide ? (shape) => inheritOf(shape) : undefined,
          frame: (node, box, groupId) => frameOf(node, box, part, ctx, groupId),
        };
        return nodeToElements(container, ctx);
      };
      const actionOf = (h: MNode, part: PartCtx): Pick<SlideElement, 'href' | 'action'> | undefined => {
        const act = h.attrs.action ?? '';
        const rel = part.rels.get(h.attrs['r:id'] ?? '');
        if (!act && rel?.external) return { href: rel.target };
        const jump = /jump=(\w+)/.exec(act)?.[1];
        const kinds: Record<string, ElementAction['kind']> = { nextslide: 'next', previousslide: 'prev', firstslide: 'first', lastslide: 'last', lastslideviewed: 'lastViewed', endshow: 'end' };
        if (/hlinksldjump/.test(act) && rel) { const target = slideIds.get(rel.target); if (target) return { action: { kind: 'slide', slideId: target } }; }
        if (jump && kinds[jump]) return { action: { kind: kinds[jump] } };
        if (/ppaction:\/\/media/.test(act)) return { action: { kind: 'playMedia' } };
        if (rel?.external) return { href: rel.target };
        if (act) note(report, '실행 단추·동작', 'dropped', n, act.replace(/^ppaction:\/\//, '').split('?')[0] + ' 동작을');
        return undefined;
      };
      const inheritOf = (shape: MNode): Inherit | null => {
        const ph = phOf(shape);
        if (!ph) return null;
        const type = ph.attrs.type, idx = ph.attrs.idx;
        const lph = findPh(layout?.tree ?? null, type, idx, false);
        const mph = findPh(master?.tree ?? null, type ?? phOf(lph ?? NULL_NODE)?.attrs.type, idx, true);
        const txStyles = find(master?.doc ?? NULL_NODE, 'txStyles')[0];
        const mt = masterType(type ?? phOf(lph ?? NULL_NODE)?.attrs.type);
        const bucket = child(txStyles, mt === 'title' ? 'titleStyle' : mt === 'body' ? 'bodyStyle' : 'otherStyle');
        const lstOf = (n: MNode | null) => path(n, 'txBody', 'lstStyle');
        const bodyOf = (n: MNode | null) => path(n, 'txBody', 'bodyPr');
        return {
          spPr: mergeStyle(child(mph, 'spPr'), child(lph, 'spPr')),
          bodyPr: mergeStyle(bodyOf(mph), bodyOf(lph)),
          lst: mergeStyle(mergeStyle(mergeStyle(defaults, bucket), lstOf(mph)), lstOf(lph)),
          font: mt === 'title' ? 'major' : 'minor',
        };
      };
      const frameOf = (node: MNode, box: { x: number; y: number; w: number; h: number; rot: number }, part: PartCtx, ctx: DmlContext, groupId?: string): SlideElement[] | null => {
        const gd = path(node, 'graphic', 'graphicData') ?? find(node, 'graphicData')[0];
        const uri = gd?.attrs.uri ?? '';
        const nv = child(child(node, 'nvGraphicFramePr'), 'cNvPr');
        const base = { x: box.x, y: box.y, w: box.w, h: box.h, ...(groupId ? { groupId } : {}), ...(nv?.attrs.name ? { name: nv.attrs.name } : {}), ...(nv?.attrs.descr ? { alt: nv.attrs.descr } : {}) };
        const tbl = child(gd, 'tbl');
        if (tbl) {
          const { table, styled } = readTable(tbl, box.w, box.h, theme, tableStyles);
          note(report, '표', styled === 'unknown' ? 'approximated' : 'converted', n, styled === 'unknown' ? '알 수 없는 표 스타일을 기본 스타일로' : undefined);
          if (find(tbl, 'r').some((r) => find(r, 'rPr').some((p) => p.attrs.sz || p.attrs.i === '1' || child(p, 'latin')))) note(report, '표 셀 글자 서식', 'approximated', n, '셀마다 하나의 굵기·색으로');
          return [{ id: uid('el'), kind: 'table', ...base, table }];
        }
        const chartRef = gd && gd.children.find((c) => local(c) === 'chart');
        if (chartRef) {
          const rel = part.rels.get(chartRef.attrs['r:id'] ?? '');
          const xml = rel ? part.parts.get(rel.target) : undefined;
          const isEx = /cx|chartex/i.test(chartRef.name) || /chartex/i.test(uri) || /chartEx/i.test(rel?.type ?? '');
          const res = xml ? (isEx ? readChartEx(xml, theme) : readChart(xml, theme)) : null;
          if (!res) { note(report, '차트', 'dropped', n, '읽을 수 없는 차트 종류라서'); return null; }
          note(report, '차트', res.approximated.length ? 'approximated' : 'converted', n, res.approximated.length ? `편집 가능한 차트로 (${res.approximated.join(', ')} 제외)` : '편집 가능한 차트로');
          return [{ id: uid('el'), kind: 'chart', ...base, chart: res.chart }];
        }
        const dgm = gd && gd.children.find((c) => local(c) === 'relIds');
        if (dgm) {
          const dataRel = part.rels.get(dgm.attrs['r:dm'] ?? '');
          const data = dataRel ? part.parts.get(dataRel.target) : undefined;
          const extId = data ? find(data, 'dataModelExt')[0]?.attrs.relId : undefined;
          const drawingRel = (extId ? part.rels.get(extId) : undefined) ?? [...part.rels.values()].find((r) => /diagramDrawing$/.test(r.type));
          const drawing = drawingRel ? part.parts.get(drawingRel.target) : undefined;
          const sub = drawingRel ? part.subs.get(drawingRel.target) : undefined;
          const shapeTree = drawing ? find(drawing, 'spTree')[0] : undefined;
          const gid = groupId ?? uid('g');
          if (shapeTree && sub) {
            const els = nodeToElements(shapeTree, { ...ctx, media: (rid) => sub.media.get(rid), made: undefined, inherit: undefined, frame: undefined }, { x: box.x, y: box.y }, gid);
            if (els.length) { note(report, 'SmartArt', 'converted', n, '그룹으로 묶인 도형으로'); return els.map((e) => ({ ...e, groupName: e.groupName ?? nv?.attrs.name ?? 'SmartArt' })); }
          }
          // No saved drawing: its text as a bulleted list.
          const pts = data ? find(data, 'pt').filter((p) => !p.attrs.type || p.attrs.type === 'node') : [];
          const lines = pts.map((p) => find(p, 't').map(textOf).join('')).filter((t) => t.trim());
          if (!lines.length) { note(report, 'SmartArt', 'dropped', n, '도형 정보가 없어'); return null; }
          note(report, 'SmartArt', 'approximated', n, '텍스트 목록으로');
          return [{ id: uid('el'), kind: 'text', ...base, text: lines.join('\n'), list: 'bullet', fontSize: 36, color: theme.colors.dk1, align: 'left', vAlign: 'top', autoFit: 'shrink' }];
        }
        const ole = find(node, 'oleObj')[0];
        if (ole) {
          const blip = find(ole, 'blip')[0];
          const mid = blip ? part.media.get(blip.attrs['r:embed'] ?? '') : undefined;
          const what = ole.attrs.progId ? ` (${ole.attrs.progId.split('.')[0]})` : '';
          if (!mid) { note(report, `OLE 개체${what}`, 'dropped', n, '미리 보기 그림이 없어'); return null; }
          note(report, `OLE 개체${what}`, 'approximated', n, '그림으로');
          return [{ id: uid('el'), kind: 'image', ...base, mediaId: mid, fit: 'fill' }];
        }
        const kind = /diagram/.test(uri) ? 'SmartArt' : /model3d/i.test(uri) ? '3D 모델' : /ink/i.test(uri) ? '잉크' : /slicer/i.test(uri) ? '슬라이서' : '기타 개체';
        note(report, kind, 'dropped', n, uri ? `(${uri.split('/').slice(-2).join('/')})` : undefined);
        return null;
      };

      // Choose PowerPoint 2016 charts (cx) and other content LightCast can read over their fallbacks.
      const preferChoice = (n2: MNode) => {
        for (const c of n2.children) {
          if (local(c) === 'AlternateContent') {
            const choice = child(c, 'Choice');
            const req = choice?.attrs.Requires ?? '';
            if (choice && /\bcx\d*\b/.test(req)) { c.children = [{ ...choice, name: 'mc:Fallback' }]; continue; }
            if (/am3d/.test(req)) note(report, '3D 모델', 'approximated', n, '그림으로');
            else if (/pslz|psez|p164|sldzm|secZm|sumZm/.test(req)) note(report, '확대/축소(줌)', 'approximated', n, '그림으로');
          }
          preferChoice(c);
        }
      };
      if (tree) preferChoice(tree);
      if (find(doc, 'contentPart').length) note(report, '잉크', 'dropped', n, undefined, find(doc, 'contentPart').length);

      // Background graphics: master's, then layout's, unless hidden ("배경 그래픽 숨기기").
      const showMaster = sld.attrs.showMasterSp !== '0';
      const layoutRoot = layout ? find(layout.doc, 'sldLayout')[0] ?? null : null;
      const art: SlideElement[] = [];
      if (showMaster && master && layoutRoot?.attrs.showMasterSp !== '0') art.push(...convert(artOnly(master.tree), master.ctx, false));
      if (showMaster && layout) art.push(...convert(artOnly(layout.tree), layout.ctx, false));
      const own = convert(tree, pc, true);
      const elements = [...art.map((e) => ({ ...e, locked: true })), ...own].map((e) => scaleElement(e, k, dx, dy));

      const cSld = child(sld, 'cSld');
      const background = backgroundOf(cSld, theme, pc)
        ?? (layout ? backgroundOf(find(layout.doc, 'cSld')[0] ?? null, theme, layout.ctx) : undefined)
        ?? (master ? backgroundOf(find(master.doc, 'cSld')[0] ?? null, theme, master.ctx) : undefined)
        ?? { kind: 'color', value: '#ffffff' };

      const slide: Slide = {
        id, group: sectionOf.get(sid) || opts.group, text: '', background, elements,
        importSource: { format: 'pptx', name: opts.file, page: n },
        ...(cSld?.attrs.name ? { label: cSld.attrs.name } : {}),
      };
      if (sld.attrs.show === '0') { slide.disabled = true; note(report, '숨긴 슬라이드', 'converted', n, '숨긴 슬라이드로'); }
      if (!showMaster) slide.hideMaster = true;

      const tr = readTransition(sld);
      if (tr.transition) slide.transition = tr.transition;
      if (tr.autoAdvance !== undefined) slide.autoAdvance = tr.autoAdvance;
      if (tr.transition || tr.autoAdvance) note(report, '화면 전환', 'converted', n);
      for (const a of tr.approximated) note(report, a, 'approximated', n, '비슷한 전환으로');
      for (const d of tr.dropped) note(report, d, 'dropped', n);
      const an = readAnimations(sld, targets);
      if (an.animations.length) { slide.animations = an.animations; note(report, '애니메이션', 'converted', n, undefined, an.animations.length); }
      for (const a of an.approximated) note(report, a, 'approximated', n, '비슷한 효과로');
      for (const d of an.dropped) note(report, d, 'dropped', n);

      // Speaker notes.
      const notesRel = [...rels.values()].find((r) => /\/notesSlide$/.test(r.type));
      const notesDoc = notesRel ? await readXml(notesRel.target) : null;
      if (notesDoc) {
        const body = find(notesDoc, 'sp').find((s2) => phOf(s2)?.attrs.type === 'body');
        const text = body ? kids(child(body, 'txBody'), 'p').map((p) => find(p, 't').map(textOf).join('')).join('\n').trim() : '';
        if (text) { slide.notes = text; note(report, '슬라이드 노트', 'converted', n); }
      }
      // Comments (legacy p:cmLst and PowerPoint 365 threaded comments).
      const comments: SlideComment[] = [];
      for (const rel of rels.values()) {
        if (!/\/comments$/.test(rel.type) || rel.external) continue;
        const cdoc = await readXml(rel.target);
        for (const cm of cdoc ? find(cdoc, 'cm') : []) {
          const modern = /\/2018\//.test(rel.type) || !!child(cm, 'txBody');
          const text = modern ? kids(child(cm, 'txBody'), 'p').map((p) => find(p, 't').map(textOf).join('')).join('\n') : textOf(child(cm, 'text') ?? NULL_NODE);
          const replies = kids(child(cm, 'replyLst'), 'reply').map((r) => ({ author: authors.get(`m${r.attrs.authorId}`) ?? '', text: kids(child(r, 'txBody'), 'p').map((p) => find(p, 't').map(textOf).join('')).join('\n'), at: Date.parse(r.attrs.created ?? '') || 0 }));
          comments.push({
            id: uid('c'), author: authors.get(`${modern ? 'm' : 'l'}${cm.attrs.authorId}`) ?? '', text,
            at: Date.parse(cm.attrs.dt ?? cm.attrs.created ?? '') || 0,
            ...(cm.attrs.status === 'resolved' ? { resolved: true } : {}),
            ...(replies.length ? { replies } : {}),
          });
        }
      }
      if (comments.length) { slide.comments = comments; note(report, '메모', 'converted', n, undefined, comments.length); }
      // Count what came over, by kind.
      const byKind = new Map<string, number>();
      for (const e of own) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
      for (const [kind, c] of byKind) if (kind !== 'table' && kind !== 'chart') note(report, KIND_LABEL[kind] ?? kind, 'converted', n, undefined, c);
      if (art.length) note(report, '마스터·레이아웃 배경 개체', 'converted', n, '잠긴 개체로', art.length);
      const warnings = slideWarnings(report, n);
      if (warnings.length) slide.importSource = { ...slide.importSource!, warnings };
      slides.push(slide);
    } catch (e) {
      note(report, '슬라이드', 'dropped', n, `오류로 내용을 (${(e as Error).message?.slice(0, 60)})`);
      slides.push({ id, group: opts.group, text: '', importSource: { format: 'pptx', name: opts.file, page: n, warnings: ['이 슬라이드를 읽는 중 오류가 나서 내용을 가져오지 못했습니다'] } });
    }
  }
  report.slideCount = slides.length;
  opts.onProgress?.(slides.length, slides.length);
  return { slides, report };
}

/** Relationship namespace (kept for callers that build parts by hand). */
export const PPTX_R_NS = R_NS;
