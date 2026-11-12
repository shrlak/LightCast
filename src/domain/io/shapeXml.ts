// What PptxGenJS cannot write for a shape, put into the .pptx afterwards: outline cap / join / compound
// type, every dash preset, arrowhead kinds, gradients with per-stop transparency, fill transparency,
// pattern and picture fills, and Format Shape › 3-D Format (a:scene3d / a:sp3d). The export marks each such
// shape with a placeholder name; this module rewrites the fill, `a:ln` and 3-D parts of that shape's
// `p:spPr` in the slide XML (pure string work, so it is unit-tested without a browser).
import JSZip from 'jszip';
import type { SlideElement } from '../types';
import { scene3dXml } from '../shape3d';

const EMU_PT = 12700;
const hex6 = (c: string | undefined): string | null => /^#([0-9a-f]{6})$/i.exec(c ?? '')?.[1]?.toUpperCase() ?? null;

/** A colour as `[RRGGBB, alpha 0–1]`, reading #rrggbb, #rgb and rgba(); null when it is none / transparent. */
export function colorParts(c: string | undefined): [string, number] | null {
  if (!c || c === 'transparent' || c === 'none') return null;
  const h6 = hex6(c);
  if (h6) return [h6, 1];
  const h3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (h3) return [`${h3[1]}${h3[1]}${h3[2]}${h3[2]}${h3[3]}${h3[3]}`.toUpperCase(), 1];
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(c);
  if (!m) return null;
  const to = (v: string) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0');
  return [`${to(m[1])}${to(m[2])}${to(m[3])}`.toUpperCase(), m[4] == null ? 1 : Math.max(0, Math.min(1, Number(m[4])))];
}

/** `<a:srgbClr>` with an `a:alpha` when the colour is not fully opaque. */
export function srgb(rgb: string, alpha = 1): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 100000);
  return a >= 100000 ? `<a:srgbClr val="${rgb}"/>` : `<a:srgbClr val="${rgb}"><a:alpha val="${a}"/></a:srgbClr>`;
}

const CAP: Record<string, string> = { flat: 'flat', round: 'rnd', square: 'sq' };
const CMPD: Record<string, string> = { single: 'sng', double: 'dbl', thickThin: 'thickThin', thinThick: 'thinThick', triple: 'tri' };

/** The outline (`a:ln`): width, cap, compound type, colour, dash preset, join and arrowheads. Null without an outline. */
export function lnXml(el: SlideElement, pxToPt = 0.5): string | null {
  const c = colorParts(el.stroke);
  if (!c) return null;
  const w = Math.round((el.strokeWidth ?? 4) * pxToPt * EMU_PT);
  const attrs = [`w="${w}"`, el.cap ? `cap="${CAP[el.cap]}"` : '', el.compound && el.compound !== 'single' ? `cmpd="${CMPD[el.compound]}"` : ''].filter(Boolean).join(' ');
  const size = el.arrowSize ?? 'med';
  const end = (tag: string, on: boolean | undefined, kind: string | undefined) => (on ? `<a:${tag} type="${kind ?? 'triangle'}" w="${size}" len="${size}"/>` : '');
  const join = el.join === 'bevel' ? '<a:bevel/>' : el.join === 'miter' ? '<a:miter lim="800000"/>' : el.join === 'round' ? '<a:round/>' : '';
  return `<a:ln ${attrs}><a:solidFill>${srgb(c[0], c[1])}</a:solidFill>${el.dash && el.dash !== 'solid' ? `<a:prstDash val="${el.dash}"/>` : ''}${join}${end('headEnd', el.arrowStart, el.arrowStartKind)}${end('tailEnd', el.arrowEnd, el.arrowEndKind)}</a:ln>`;
}

/**
 * The fill: gradient (any number of stops, each with its own transparency), pattern, picture (`blipId`
 * is the relationship of the picture added to the slide) or solid, all with the fill transparency.
 * Null for none / transparent (PptxGenJS already writes that).
 */
export function fillXml(el: SlideElement, blipId?: string): string | null {
  const alpha = 1 - Math.max(0, Math.min(1, el.fillTransparency ?? 0));
  if (el.fillImage && blipId) {
    const mod = alpha < 1 ? `<a:alphaModFix amt="${Math.round(alpha * 100000)}"/>` : '';
    return `<a:blipFill><a:blip r:embed="${blipId}">${mod}</a:blip><a:stretch><a:fillRect/></a:stretch></a:blipFill>`;
  }
  const stops = el.gradientStops && el.gradientStops.length >= 2 ? el.gradientStops : el.gradient ? [{ pos: 0, color: el.gradient[0], transparency: 0 }, { pos: 100, color: el.gradient[1], transparency: 0 }] : null;
  if (stops) {
    const gs = stops.map((s) => {
      const c = colorParts(s.color) ?? ['FFFFFF', 1];
      return `<a:gs pos="${Math.round(Math.max(0, Math.min(100, s.pos)) * 1000)}">${srgb(c[0], c[1] * (1 - Math.max(0, Math.min(1, s.transparency ?? 0))) * alpha)}</a:gs>`;
    }).join('');
    const shape = el.gradientType === 'radial'
      ? '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>'
      : `<a:lin ang="${Math.round((((el.gradientAngle ?? 90) % 360) + 360) % 360 * 60000)}" scaled="0"/>`;
    return `<a:gradFill rotWithShape="1"><a:gsLst>${gs}</a:gsLst>${shape}</a:gradFill>`;
  }
  if (el.pattern) {
    const fg = colorParts(el.pattern.fg) ?? ['000000', 1], bg = colorParts(el.pattern.bg) ?? ['FFFFFF', 1];
    return `<a:pattFill prst="${el.pattern.kind}"><a:fgClr>${srgb(fg[0], fg[1] * alpha)}</a:fgClr><a:bgClr>${srgb(bg[0], bg[1] * alpha)}</a:bgClr></a:pattFill>`;
  }
  const c = colorParts(el.fill);
  if (!c) return null;
  return `<a:solidFill>${srgb(c[0], c[1] * alpha)}</a:solidFill>`;
}

/** Whether a shape has anything PptxGenJS cannot write, so its XML needs the patch. */
export function needsShapePatch(el: SlideElement): boolean {
  return !!(el.cap || el.join || (el.compound && el.compound !== 'single') || (el.dash && el.dash !== 'solid') || el.arrowStartKind || el.arrowEndKind || el.arrowSize
    || el.fillTransparency || el.gradient || el.gradientStops || el.pattern || el.fillImage || scene3dXml(el) || el.name);
}

export interface ShapePatch {
  /** The placeholder name the export gave the shape. */
  marker: string;
  /** The name the shape should end with (its Selection pane name). */
  name?: string;
  fill?: string | null;
  ln?: string | null;
  sp3d?: string | null;
  blip?: { id: string; ext: string; data: Uint8Array };
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Rewrites one shape (found by its placeholder name) in a slide's XML. Returns the XML unchanged when it is not there. */
export function patchShapeXml(xml: string, patch: ShapePatch): string {
  const nameAt = xml.indexOf(`name="${patch.marker}"`);
  if (nameAt < 0) return xml;
  const start = xml.lastIndexOf('<p:sp>', nameAt);
  const end = xml.indexOf('</p:sp>', nameAt);
  if (start < 0 || end < 0) return xml;
  let sp = xml.slice(start, end);
  sp = sp.replace(`name="${patch.marker}"`, `name="${escAttr(patch.name ?? 'Shape')}"`);
  const open = sp.indexOf('<p:spPr>'), close = sp.indexOf('</p:spPr>');
  if (open >= 0 && close > open) {
    const inner = sp.slice(open + 8, close);
    const geomEnd = Math.max(inner.indexOf('</a:prstGeom>') >= 0 ? inner.indexOf('</a:prstGeom>') + 13 : -1, inner.indexOf('</a:custGeom>') >= 0 ? inner.indexOf('</a:custGeom>') + 13 : -1);
    if (geomEnd > 0) {
      const head = inner.slice(0, geomEnd);
      const rest = inner.slice(geomEnd);
      const lnAt = rest.indexOf('<a:ln');
      const fxAt = rest.indexOf('<a:effectLst');
      const fillEnd = lnAt >= 0 ? lnAt : fxAt >= 0 ? fxAt : rest.length;
      let lnEnd = fillEnd;
      if (lnAt >= 0) {
        const tagEnd = rest.indexOf('>', lnAt);
        lnEnd = rest[tagEnd - 1] === '/' ? tagEnd + 1 : rest.indexOf('</a:ln>', lnAt) + 7;
      }
      const fill = patch.fill !== undefined && patch.fill !== null ? patch.fill : rest.slice(0, fillEnd);
      const ln = patch.ln !== undefined && patch.ln !== null ? patch.ln : rest.slice(fillEnd, lnEnd);
      sp = `${sp.slice(0, open + 8)}${head}${fill}${ln}${rest.slice(lnEnd)}${patch.sp3d ?? ''}${sp.slice(close)}`;
    }
  }
  return xml.slice(0, start) + sp + xml.slice(end);
}

/** Adds the patched pictures and rewrites the shapes of every slide of a .pptx. */
export async function patchPptx(zip: JSZip, patches: ShapePatch[]): Promise<void> {
  if (!patches.length) return;
  const files = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  const exts = new Set<string>();
  for (const f of files) {
    let xml = await zip.file(f)!.async('string');
    let rels: string | null = null;
    const relFile = f.replace('slides/', 'slides/_rels/') + '.rels';
    for (const p of patches) {
      if (!xml.includes(`name="${p.marker}"`)) continue;
      xml = patchShapeXml(xml, p);
      if (p.blip) {
        const media = `ppt/media/lcfill-${p.blip.id}.${p.blip.ext}`;
        zip.file(media, p.blip.data);
        exts.add(p.blip.ext);
        rels ??= await zip.file(relFile)!.async('string');
        rels = rels.replace('</Relationships>', `<Relationship Id="${p.blip.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/lcfill-${p.blip.id}.${p.blip.ext}"/></Relationships>`);
      }
    }
    zip.file(f, xml);
    if (rels) zip.file(relFile, rels);
  }
  if (exts.size) {
    let types = await zip.file('[Content_Types].xml')!.async('string');
    const mime: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
    for (const e of exts) if (!types.includes(`Extension="${e}"`)) types = types.replace('<Override', `<Default Extension="${e}" ContentType="${mime[e] ?? 'application/octet-stream'}"/><Override`);
    zip.file('[Content_Types].xml', types);
  }
}
