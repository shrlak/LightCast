import PptxGenJS from 'pptxgenjs';
import type { Background, Library, ListStyle, Playlist, Presentation, SlideElement, Theme } from '../types';
import { iconCatalog, layoutTable } from '../../engine';
import { lineRuns } from '../richText';
import { sequence } from '../arrangement';
import { getMedia } from '../media';
import { qrDataUrl } from './qr';
import { stripChords } from '../lyrics';
import { pptxFont } from '../fonts';
import { CANVAS_W } from '../canvas';
import { fitTextElement } from '../textBoxLayout';
import { fitSlideText } from '../slideTextLayout';
import { textElementBounds } from '../textBox';
import { prepareAnnouncementSizing } from '../announcementSizing';
import { isFrontPresentation, isFrontSlide } from '../frontLayout';
import { resolveBackground } from '../autoBackground';
import { motionFlatColor } from '../motion';
import JSZip from 'jszip';
import { fillXml, lnXml, needsShapePatch, patchPptx, type ShapePatch } from './shapeXml';
import { scene3dXml } from '../shape3d';

const W = 10;
const H = 7.5;
const PX = W / CANVAS_W; // inches per canvas pixel (4:3 slides, 10 × 7.5 in)

const hex = (c: string | undefined, d = 'FFFFFF') => /#?([0-9a-f]{6})/i.exec(c ?? '')?.[1] ?? d;
type Box = { x: number; y: number; w: number; h: number; rotate?: number };

/** What each export still has to put into the shapes' XML (outline cap / join / compound, gradients, 3-D…; see shapeXml). */
const shapePatches = new WeakMap<PptxGenJS, ShapePatch[]>();
let markerSeq = 0;

/** A picture fill's bytes and file type, from the data URL the media store gives. */
function blipOf(data: string | null): { ext: string; data: Uint8Array } | null {
  const m = /^data:image\/([a-z+.-]+);base64,(.*)$/is.exec(data ?? '');
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = m[1].toLowerCase().replace('svg+xml', 'svg');
  return { ext, data: bytes };
}

/** A preset shape as PowerPoint's own (same OOXML preset name and adjust values), with its text. */
async function addShapeElement(pptx: PptxGenJS, s: PptxGenJS.Slide, el: SlideElement, box: Box) {
  const name = (el.shape ?? (el.ellipse ? 'ellipse' : el.radius ? 'roundRect' : 'rect')) as PptxGenJS.SHAPE_NAME;
  const transparent = !el.fill || el.fill === 'transparent' || /rgba\([^)]*,\s*0\)/.test(el.fill);
  const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(el.fill ?? '')?.[1];
  const opts: PptxGenJS.ShapeProps = {
    ...box,
    fill: transparent ? { type: 'none' } : { color: hex(el.gradient?.[0] ?? el.fill), transparency: alpha ? Math.round((1 - Number(alpha)) * 100) : undefined },
    line: el.stroke ? { color: hex(el.stroke), width: (el.strokeWidth ?? 4) * 0.5, dashType: el.dash === 'dash' ? 'dash' : el.dash === 'dot' ? 'sysDot' : el.dash === 'dashDot' ? 'dashDot' : 'solid', beginArrowType: el.arrowStart ? 'triangle' : undefined, endArrowType: el.arrowEnd ? 'triangle' : undefined } : undefined,
    flipH: el.flipH, flipV: el.flipV,
    rectRadius: !el.shape && el.radius ? Math.min(0.5, (el.radius * PX) / Math.min(box.w, box.h)) : undefined,
    shadow: el.dropShadow ? { type: 'outer', blur: 6, offset: 3, angle: 90, color: '000000', opacity: 0.45 } : undefined,
  };
  if (needsShapePatch(el)) {
    const marker = `lcs-${++markerSeq}`;
    (opts as { objectName?: string }).objectName = marker;
    const pic = el.fillImage ? blipOf(await dataUrl(el.fillImage)) : null;
    const blip = pic ? { id: `rIdLc${markerSeq}`, ...pic } : undefined;
    const list = shapePatches.get(pptx) ?? [];
    list.push({ marker, name: el.name, fill: fillXml(el, blip?.id), ln: lnXml(el), sp3d: scene3dXml(el), blip });
    shapePatches.set(pptx, list);
  }
  if (el.text) s.addText(el.text, { ...opts, shape: name, fontSize: (el.fontSize ?? 40) * 0.5, color: hex(el.color), bold: el.bold, italic: el.italic, align: el.align ?? 'center', valign: el.vAlign === 'top' ? 'top' : el.vAlign === 'bottom' ? 'bottom' : 'middle', fontFace: el.fontFamily ? pptxFont(el.fontFamily) : undefined });
  else s.addShape(name, opts);
}

function addTableElement(s: PptxGenJS.Slide, el: SlideElement, box: Box) {
  const t = el.table!;
  const cells = layoutTable(t, el.w, el.h);
  const look = new Map(cells.map((c) => [`${c.r}:${c.c}`, c]));
  const rows: PptxGenJS.TableRow[] = t.rows.map((row, r) => row.flatMap((cell, c) => {
    if (cell.hMerge || cell.vMerge) return [];
    const l = look.get(`${r}:${c}`);
    return [{ text: cell.text, options: { colspan: cell.span && cell.span > 1 ? cell.span : undefined, rowspan: cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined, fill: l?.fill ? { color: hex(l.fill) } : undefined, color: hex(l?.color ?? el.color), bold: l?.bold, align: (cell.align as 'left') ?? 'left', valign: 'middle' as const, border: l?.border ? { type: 'solid' as const, pt: l.borderWidth * 0.5, color: hex(l.border) } : undefined } }];
  }));
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0) || 1;
  s.addTable(rows, { x: box.x, y: box.y, w: box.w, colW: t.cols.map((c) => (c / sum(t.cols)) * box.w), rowH: t.heights.map((h) => (h / sum(t.heights)) * box.h), fontSize: (el.fontSize ?? 32) * 0.5, fontFace: el.fontFamily ? pptxFont(el.fontFamily) : undefined });
}

function addChartElement(pptx: PptxGenJS, s: PptxGenJS.Slide, el: SlideElement, box: Box) {
  const ch = el.chart!;
  const type = ({ column: pptx.ChartType.bar, columnStacked: pptx.ChartType.bar, bar: pptx.ChartType.bar, barStacked: pptx.ChartType.bar, line: pptx.ChartType.line, area: pptx.ChartType.area, pie: pptx.ChartType.pie, doughnut: pptx.ChartType.doughnut, scatter: pptx.ChartType.scatter } as const)[ch.kind];
  const data = ch.series.map((sr) => ({ name: sr.name, labels: ch.categories, values: sr.values }));
  const text = hex(ch.textColor ?? el.color);
  s.addChart(type, data, {
    ...box, barDir: ch.kind.startsWith('bar') ? 'bar' : 'col', barGrouping: ch.kind.endsWith('Stacked') ? 'stacked' : 'clustered',
    showLegend: ch.legend !== false, legendPos: 'b', showTitle: !!ch.title, title: ch.title || undefined, showValue: !!ch.dataLabels,
    titleColor: text, legendColor: text, catAxisLabelColor: text, valAxisLabelColor: text, dataLabelColor: text,
  });
}

/** Icons and ink go to PowerPoint as SVG pictures (what they are drawn with on screen). */
function svgOf(el: SlideElement): string | null {
  if (el.kind === 'ink' && el.path) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${el.pathW ?? el.w} ${el.pathH ?? el.h}" preserveAspectRatio="none"><path d="${el.path}" fill="none" stroke="${el.stroke ?? '#ff3b30'}" stroke-width="${el.strokeWidth ?? 6}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${el.opacity ?? 1}"/></svg>`;
  if (el.kind === 'icon') {
    const icon = iconCatalog().find((i) => i.name === el.icon);
    if (!icon) return null;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${el.stroke ?? el.color ?? '#ffffff'}" stroke-width="${el.strokeWidth ?? icon.stroke}" stroke-linecap="round" stroke-linejoin="round">${icon.d.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
  }
  return null;
}

function firstColor(b: Background | undefined | null): string {
  if (!b) return '000000';
  if (b.kind === 'color') return b.value.replace('#', '').slice(0, 6);
  if (b.kind === 'gradient') return (/#([0-9a-f]{6})/i.exec(b.value)?.[1] ?? '000000');
  if (b.kind === 'motion') return motionFlatColor(b).replace('#', '');
  return '000000';
}

/** 취소선, 문자 간격, 강조 색, 글머리 기호 / 번호, 들여쓰기, 세로 쓰기 — in PowerPoint's terms. */
function textOptions(f: { strike?: boolean; letterSpacing?: number; highlight?: string; list?: ListStyle; indent?: number; vertical?: boolean }) {
  const numbered = f.list === 'number' || f.list === 'number-paren' || f.list === 'roman' || f.list === 'alpha' || f.list === 'hangul' || f.list === 'roman-lower' || f.list === 'alpha-lower' || f.list === 'alpha-lower-paren';
  const numberType = ({ 'number-paren': 'arabicParenR', roman: 'romanUcPeriod', alpha: 'alphaUcPeriod', 'roman-lower': 'romanLcPeriod', 'alpha-lower': 'alphaLcPeriod', 'alpha-lower-paren': 'alphaLcParenR' } as const)[f.list as 'roman'] ?? 'arabicPeriod';
  return {
    strike: f.strike ? ('sngStrike' as const) : undefined,
    charSpacing: f.letterSpacing ? f.letterSpacing * 0.5 : undefined,
    highlight: f.highlight?.replace('#', ''),
    bullet: f.list ? (numbered ? { type: 'number' as const, style: numberType } : { characterCode: { circle: '25CB', square: '25A0', check: '2713', arrow: '27A2', box: '25A1', diamond: '25C6', dash: '2013', star: '2605' }[f.list as 'circle'] ?? '2022' }) : undefined,
    indentLevel: f.indent || undefined,
    vert: f.vertical ? ('eaVert' as const) : undefined,
  };
}

async function dataUrl(mediaId: string): Promise<string | null> {
  const blob = await getMedia(mediaId);
  if (!blob) return null;
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => res(null);
    r.readAsDataURL(blob);
  });
}

async function urlData(url: string): Promise<string | null> {
  try {
    const blob = await (await fetch(new URL(url, location.origin))).blob();
    return await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => res(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const fontFace = (t: Theme) => pptxFont(t.fontFamily);

/*
 * What keeps the exported slides looking like the screen:
 * - No inner margin: a LightCast box is already the text area (importing a PowerPoint deck takes
 *   its margins off), so PowerPoint's default 0.1" / 0.05" would make lines wrap sooner and spill.
 * - Line spacing as exact points (font size × the screen's line height): PowerPoint's "multiple"
 *   counts in the font's own line height, which differs by font (and by the Korean fallback font).
 * - Korean text marked Korean, as in the church decks, so PowerPoint picks its Korean font for it.
 */
const NO_MARGIN = 0;
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
const langOf = (text: string) => (HANGUL.test(text) ? 'ko-KR' : undefined);
/** Points between lines for text of `sizePx` canvas pixels at line height `lineHeight` (×font size). */
const linePts = (sizePx: number, lineHeight: number) => Math.round(sizePx * 0.5 * lineHeight * 10) / 10;
const stripBold = (s: string) => stripChords(s.replace(/\*\*/g, ''));

async function addPresentation(pptx: PptxGenJS, lib: Library, p: Presentation) {
  p = prepareAnnouncementSizing(p);
  const baseTheme = lib.themes.find((t) => t.id === p.themeId) ?? lib.themes[0];
  for (const { slide } of sequence(p)) {
    if (slide.disabled) continue;
    const original: Theme = slide.style ? { ...baseTheme, ...slide.style } : baseTheme;
    const fixed = isFrontPresentation(p) || isFrontSlide(slide);
    const layout = fitSlideText(fixed ? { ...slide, preserveTextLayout: true } : slide, original);
    const theme = { ...original, fontSize: layout.fontSize };
    const s = pptx.addSlide();
    const bg = resolveBackground(slide, p);
    if (bg?.kind === 'image') {
      const data = await urlData(bg.url);
      s.background = data ? { data } : { color: 'FFFFFF' };
    } else if (bg?.kind === 'media' && bg.mediaType === 'image') {
      const data = await dataUrl(bg.mediaId);
      if (data) s.background = { data };
      else s.background = { color: '000000' };
    } else {
      s.background = { color: firstColor(bg) };
    }
    const color = theme.color.replace('#', '');
    const valign = theme.vAlign === 'middle' ? 'middle' : theme.vAlign;
    const runs: PptxGenJS.TextProps[] = [];
    if (slide.title) runs.push({ text: slide.title, options: { bold: true, fontSize: theme.fontSize * 0.72 * 0.5, lineSpacing: linePts(theme.fontSize * 0.72, theme.lineHeight), breakLine: true } });
    for (const line of slide.text.split('\n')) {
      runs.push({ text: stripBold(line), options: { bold: /^\*\*.*\*\*$/.test(line) || theme.fontWeight >= 700, lineSpacing: linePts(theme.fontSize, theme.lineHeight), breakLine: true } });
    }
    if (slide.subtext) {
      const sub = theme.fontSize * (theme.subScale ?? 0.62);
      for (const line of slide.subtext.split('\n')) {
        runs.push({ text: line, options: { fontSize: sub * 0.5, color: (theme.subColor ?? theme.color).replace('#', ''), lineSpacing: linePts(sub, theme.lineHeight), breakLine: true } });
      }
    }
    // A trailing paragraph would put an empty line below the lyrics and shift the
    // visible words above the middle of an otherwise centered PowerPoint box.
    if (p.lyricsCentered && slide.group !== 'Title' && runs.length) runs[runs.length - 1].options = { ...runs[runs.length - 1].options, breakLine: false };
    s.addText(runs, {
      x: layout.box.x * PX, y: layout.box.y * PX, w: layout.box.w * PX, h: layout.box.h * PX,
      fontFace: fontFace(theme), fontSize: theme.fontSize * 0.5, color, italic: theme.italic, underline: theme.underline ? { style: 'sng' } : undefined,
      ...textOptions(theme),
      margin: NO_MARGIN, lang: langOf(`${slide.title ?? ''}${slide.text}${slide.subtext ?? ''}`),
      align: theme.align, valign,
      shadow: theme.shadow ? { type: 'outer', blur: 6, offset: 2, angle: 45, color: '000000', opacity: 0.6 } : undefined,
      fit: undefined,
    });
    for (const original of slide.elements ?? []) {
      if (original.hidden) continue;
      const el = fixed ? original : fitTextElement(original, textElementBounds(original, slide.elements));
      const box = { x: el.x * PX, y: el.y * PX, w: el.w * PX, h: el.h * PX, rotate: el.rotation };
      if (el.kind === 'text' && el.text) {
        // Empty Front paragraphs also carry a source font size (and therefore spacer height).
        // The screen's line height for this box (as elementTextStyle draws it). A paragraph's last
        // line break shows no extra line on screen, so it adds none here either.
        const lh = el.lineHeight ?? (el.paragraphs ? 1.2 : 1.25);
        // Characters formatted on their own (size, bold, italic, underline, colour) keep it.
        const runs = lineRuns(el);
        const richLines = runs.some(Boolean) ? (el.paragraphs?.map((x) => x.text) ?? el.text.split('\n')) : null;
        const rich: PptxGenJS.TextProps[] | null = richLines && richLines.flatMap((line, i) => {
          const parts = runs[i] ?? [{ text: line || ' ' }];
          return parts.map((r, k) => ({ text: r.text, options: { fontSize: (r.fontSize ?? el.paragraphs?.[i]?.fontSize ?? el.fontSize ?? 64) * 0.5, bold: r.bold ?? el.bold, italic: r.italic ?? el.italic, underline: r.underline ? { style: 'sng' as const } : undefined, color: (r.color ?? el.color ?? '#ffffff').replace('#', ''), fontFace: r.fontFamily ? pptxFont(r.fontFamily) : undefined, highlight: r.highlight?.replace('#', ''), strike: r.strike ? ('sngStrike' as const) : undefined, superscript: r.baseline === 'super' || undefined, subscript: r.baseline === 'sub' || undefined, breakLine: k === parts.length - 1 && i < richLines.length - 1 } }));
        });
        const content = rich ?? (el.paragraphs?.length ? el.paragraphs.map((p, i) => ({ text: fixed ? p.text.replace(/\n$/, '').split('\n').map((line) => line || '\u00a0').join('\n') : p.text, options: { fontSize: (p.fontSize ?? el.fontSize ?? 64) * 0.5, lineSpacing: linePts(p.fontSize ?? el.fontSize ?? 64, lh), bold: p.bold ?? el.bold, italic: p.italic ?? el.italic, color: (p.color ?? el.color ?? '#ffffff').replace('#', ''), align: p.align ?? el.align, breakLine: i < el.paragraphs!.length - 1 } })) : el.text);
        s.addText(content, { ...box, fontFace: pptxFont(el.fontFamily ?? baseTheme.fontFamily), lineSpacing: el.paragraphs?.length ? undefined : linePts(el.fontSize ?? 64, lh), margin: NO_MARGIN, lang: langOf(el.text), fontSize: (el.fontSize ?? 64) * 0.5, color: (el.color ?? '#ffffff').replace('#', ''), bold: el.bold, italic: el.italic, underline: el.underline ? { style: 'sng' } : undefined, ...textOptions(el), align: el.align ?? 'center', valign: el.vAlign === 'top' ? 'top' : el.vAlign === 'bottom' ? 'bottom' : 'middle', fit: el.autoFit === 'resize' ? 'resize' : el.autoFit === 'shrink' ? 'shrink' : undefined, ...(el.wrap === false ? { wrap: false } : {}) });
      } else if (el.kind === 'image' && el.mediaId) {
        const data = await dataUrl(el.mediaId);
        if (data) s.addImage({ ...box, data, sizing: { type: el.fit === 'cover' ? 'cover' : 'contain', w: box.w, h: box.h } });
      } else if (el.kind === 'qr' && el.link) {
        s.addImage({ ...box, data: qrDataUrl(el.link) });
      } else if (el.kind === 'shape') {
        await addShapeElement(pptx, s, el, box);
      } else if (el.kind === 'table' && el.table) {
        addTableElement(s, el, box);
      } else if (el.kind === 'chart' && el.chart) {
        addChartElement(pptx, s, el, box);
      } else if ((el.kind === 'icon' || el.kind === 'ink') && svgOf(el)) {
        s.addImage({ ...box, data: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgOf(el)!)))}` });
      }
    }
    // QR codes go over the text boxes, in the corner (added last, so they are on top).
    slide.qr?.forEach((link, i) => {
      s.addImage({ data: qrDataUrl(link), x: W - 2.1, y: H - 2.1 - i * 2.1, w: 1.8, h: 1.8 });
    });
    if (slide.caption) s.addText(slide.caption, { x: 0.3, y: 0.15, w: 8, h: 0.5, fontSize: 14, color, fontFace: fontFace(theme) });
    if (slide.notes) s.addNotes(slide.notes);
  }
}

/** Export presentations (in playlist order when given) to a .pptx file download. */
export async function exportPptx(lib: Library, source: { playlist: Playlist } | { presentation: Presentation }, fileName: string) {
  const pptx = await buildPptx(lib, source);
  await pptx.writeFile({ fileName: fileName.endsWith('.pptx') ? fileName : `${fileName}.pptx` });
}

/** The deck as PowerPoint will get it (in playlist order when given). */
export async function buildPptx(lib: Library, source: { playlist: Playlist } | { presentation: Presentation }): Promise<PptxGenJS> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_4x3';
  const list = 'playlist' in source
    ? source.playlist.items.flatMap((i) => (i.kind === 'header' ? [] : lib.presentations.filter((p) => p.id === i.presentationId)))
    : [source.presentation];
  // File › Info › Properties of a single presentation go into the file's own properties.
  const props = list.length === 1 ? list[0].properties : undefined;
  if (props) {
    if (props.title) pptx.title = props.title;
    if (props.subject) pptx.subject = props.subject;
    if (props.author) pptx.author = props.author;
    if (props.company) pptx.company = props.company;
  }
  for (const p of list) await addPresentation(pptx, lib, p);
  patchOnWrite(pptx);
  return pptx;
}

/** PptxGenJS writes the file; shapes that need more than it can say are rewritten in that file (shapeXml). */
function patchOnWrite(pptx: PptxGenJS) {
  const patches = shapePatches.get(pptx);
  if (!patches?.length) return;
  const write = pptx.write.bind(pptx);
  const patched = async (props?: PptxGenJS.WriteProps) => {
    const type = typeof props === 'string' ? props : props?.outputType ?? 'blob';
    const out = await write({ ...(typeof props === 'object' ? props : {}), outputType: 'arraybuffer' });
    const zip = await JSZip.loadAsync(out as ArrayBuffer);
    await patchPptx(zip, patches);
    const asType = ({ nodebuffer: 'nodebuffer', arraybuffer: 'arraybuffer', uint8array: 'uint8array', base64: 'base64', binarystring: 'binarystring', blob: 'blob' } as const)[type as 'blob'] ?? 'blob';
    return zip.generateAsync({ type: asType as 'blob', compression: 'DEFLATE' });
  };
  pptx.write = patched as PptxGenJS['write'];
  pptx.writeFile = async (props?: PptxGenJS.WriteFileProps) => {
    const fileName = (typeof props === 'string' ? props : props?.fileName) ?? 'Presentation.pptx';
    const blob = await patched({ outputType: 'blob' }) as Blob;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName.endsWith('.pptx') ? fileName : `${fileName}.pptx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return fileName;
  };
}
