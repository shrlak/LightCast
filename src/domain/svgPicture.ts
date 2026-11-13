// SVG pictures. An .svg stays a vector: its (cleaned) source is what the media store keeps, and every
// place that draws it (the editor, the slide show, the image / PDF export) hands the browser that
// source, so it is drawn sharp at any size. SVG is also a document that can carry script, embedded
// HTML (foreignObject), event handlers and links to the network — so before an .svg is kept or drawn
// it goes through `sanitizeSvg`, which keeps only drawing elements and local references.
import { parseMarkup, type MNode } from './io/markup';

export const SVG_MIME = 'image/svg+xml';

/** Elements an SVG picture may use: shapes, text, gradients, patterns, clipping, masks and filters. Everything else (script, foreignObject, animation, iframes …) is dropped with its content. */
const ALLOWED = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'switch', 'title', 'desc', 'metadata',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'marker', 'image', 'style',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap',
  'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode',
  'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
]);
/** Elements that are only unwrapped: their drawing children are kept (a link in a logo still draws). */
const UNWRAP = new Set(['a']);

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i;
/** An SVG attribute holding a link: only a reference inside the file (#id) or an embedded raster picture is kept. */
const isHref = (name: string) => name === 'href' || name === 'xlink:href';

/** CSS that may stay: no @import, no behaviour / expression, and url() only to an id in the file or an embedded raster picture. */
export function sanitizeCss(css: string): string {
  const stripped = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/@namespace[^;]*;?/gi, '')
    .replace(/(?:expression|behavior|-moz-binding)\s*\((?:[^()]|\([^()]*\))*\)/gi, '')
    .replace(/(?:behavior|-moz-binding)\s*:[^;}]*;?/gi, '');
  return stripped.replace(/url\(\s*(["']?)([^)]*?)\1\s*\)/gi, (m, _q: string, target: string) => {
    const t = target.trim();
    return t.startsWith('#') || SAFE_DATA_IMAGE.test(t) ? m : 'none';
  });
}

/** A presentation attribute value that points outside the file (url(http…), javascript:) is dropped. */
function safeValue(value: string): boolean {
  const v = value.replace(/[\u0000- ]+/g, '').toLowerCase();
  if (/^(javascript|vbscript|data:text|data:application|data:image\/svg)/.test(v)) return false;
  for (const m of value.matchAll(/url\(\s*(["']?)([^)]*?)\1\s*\)/gi)) {
    const t = m[2].trim();
    if (!t.startsWith('#') && !SAFE_DATA_IMAGE.test(t)) return false;
  }
  return true;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');

function serialize(n: MNode, root: boolean): string {
  if (n.name === '#text') return esc(n.text ?? '');
  const tag = n.name;
  const attrs: string[] = [];
  for (const [name, raw] of Object.entries(n.attrs)) {
    if (/^on/i.test(name)) continue;
    if (!/^[A-Za-z_:][\w:.-]*$/.test(name)) continue;
    if (name === 'style') {
      const css = sanitizeCss(raw);
      if (css.trim()) attrs.push(`style="${escAttr(css)}"`);
      continue;
    }
    if (isHref(name)) {
      const v = raw.trim();
      // <use> and gradients refer to ids in the file; <image> may embed a raster picture; nothing may load from outside.
      if (v.startsWith('#') || (tag === 'image' && SAFE_DATA_IMAGE.test(v))) attrs.push(`${name}="${escAttr(v)}"`);
      continue;
    }
    if (name === 'xmlns' || name.startsWith('xmlns:')) {
      // Only the SVG and XLink namespaces: no scripting / XHTML namespace declarations.
      if (/^(http:\/\/www\.w3\.org\/2000\/svg|http:\/\/www\.w3\.org\/1999\/xlink)$/.test(raw.trim())) attrs.push(`${name}="${escAttr(raw.trim())}"`);
      continue;
    }
    if (!safeValue(raw)) continue;
    attrs.push(`${name}="${escAttr(raw)}"`);
  }
  if (root && !n.attrs.xmlns) attrs.unshift('xmlns="http://www.w3.org/2000/svg"');
  const hasXlink = Object.keys(n.attrs).some((k) => k.startsWith('xlink:'));
  if (root && hasXlink && !n.attrs['xmlns:xlink']) attrs.push('xmlns:xlink="http://www.w3.org/1999/xlink"');
  const inner = n.children.map((c) => clean(c)).join('');
  return inner ? `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${inner}</${tag}>` : `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}/>`;
}

function clean(n: MNode): string {
  if (n.name === '#text') return esc(n.text ?? '');
  const name = n.name.replace(/^svg:/, '');
  if (UNWRAP.has(name)) return n.children.map(clean).join('');
  if (!ALLOWED.has(name)) return '';
  if (name === 'style') {
    const css = sanitizeCss(n.children.map((c) => c.text ?? '').join(''));
    return css.trim() ? `<style>${esc(css)}</style>` : '';
  }
  return serialize(name === n.name ? n : { ...n, name }, false);
}

/** The `viewBox` of an SVG element as [x, y, w, h], else null. */
function viewBoxOf(attrs: Record<string, string>): [number, number, number, number] | null {
  const parts = (attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0 ? (parts as [number, number, number, number]) : null;
}

/** A length like "120", "120px", "3in", "50%": its size in CSS pixels (a percentage has none). */
function pxOf(v: string | undefined): number | null {
  const m = /^\s*([\d.]+)\s*(px|pt|pc|mm|cm|in|em|ex)?\s*$/i.exec(v ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? 'px').toLowerCase();
  const k = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 }[unit] ?? 1;
  return n * k;
}

/** The picture's own size in CSS pixels, from width / height, else from the view box; null when it states neither. */
export function svgIntrinsicSize(svg: string): { w: number; h: number } | null {
  const root = parseMarkup(svg).children.find((c) => c.name === 'svg' || c.name.endsWith(':svg'));
  if (!root) return null;
  const vb = viewBoxOf(root.attrs);
  const w = pxOf(root.attrs.width), h = pxOf(root.attrs.height);
  if (w && h) return { w, h };
  if (vb) {
    if (w) return { w, h: (w * vb[3]) / vb[2] };
    if (h) return { w: (h * vb[2]) / vb[3], h };
    return { w: vb[2], h: vb[3] };
  }
  return null;
}

/**
 * The SVG source made safe to keep and draw: only drawing elements, no script / foreignObject /
 * event handlers / animation, no link that leaves the file. Null when `src` is not an SVG picture.
 * A picture that gave no size gets width / height from its view box (so it has a size to draw at).
 */
export function sanitizeSvg(src: string): string | null {
  const root = parseMarkup(src.replace(/^﻿/, '')).children.find((c) => c.name === 'svg' || c.name.endsWith(':svg'));
  if (!root) return null;
  const named: MNode = { ...root, name: 'svg', attrs: { ...root.attrs } };
  for (const k of Object.keys(named.attrs)) if (k.includes(':') && /^svg:/.test(k)) delete named.attrs[k];
  const vb = viewBoxOf(named.attrs);
  if (vb && !pxOf(named.attrs.width) && !pxOf(named.attrs.height)) {
    named.attrs.width = String(Math.round(vb[2] * 100) / 100);
    named.attrs.height = String(Math.round(vb[3] * 100) / 100);
  } else if (vb && !pxOf(named.attrs.width) !== !pxOf(named.attrs.height)) {
    const size = svgIntrinsicSize(`<svg viewBox="${named.attrs.viewBox}" width="${named.attrs.width ?? ''}" height="${named.attrs.height ?? ''}"/>`);
    if (size) { named.attrs.width = String(Math.round(size.w * 100) / 100); named.attrs.height = String(Math.round(size.h * 100) / 100); }
  } else if (!vb) {
    const w = pxOf(named.attrs.width), h = pxOf(named.attrs.height);
    if (w && h) named.attrs.viewBox = `0 0 ${w} ${h}`;
  }
  return serialize(named, true);
}

/** Does this look like an SVG file (by type, name or the start of its text)? */
export function looksLikeSvg(type: string | undefined, name?: string, head?: string): boolean {
  if (type && type.toLowerCase().startsWith(SVG_MIME)) return true;
  if (name && /\.svgz?$/i.test(name) && (!type || type === '' || type === 'text/xml' || type === 'application/xml' || type === 'text/plain')) return true;
  return !!head && (!type || /^(text\/(xml|plain)|application\/xml)$/i.test(type)) && /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s/>]/i.test(head);
}

/** The blob to store for a picture: an SVG is replaced by its sanitized source (typed image/svg+xml); anything else passes unchanged. */
export async function prepareMediaBlob(blob: Blob): Promise<Blob> {
  const typed = (blob.type || '').toLowerCase();
  const maybe = typed.startsWith(SVG_MIME) || typed === '' || typed === 'text/xml' || typed === 'application/xml' || typed === 'text/plain';
  if (!maybe || blob.size > 16e6) return blob;
  const name = (blob as File).name;
  let text: string;
  try { text = await blob.text(); } catch { return blob; }
  if (!looksLikeSvg(blob.type, name, text.slice(0, 2048))) return blob;
  const clean = sanitizeSvg(text);
  if (!clean) return blob;
  return new Blob([clean], { type: SVG_MIME });
}

/** Is a stored picture an SVG? */
export const isSvgBlob = (blob: Blob | undefined | null): boolean => !!blob && (blob.type || '').toLowerCase().startsWith(SVG_MIME);

/** Where a picture of `size` goes when it must fit the box `max` (contain, centred). */
export function containBox(box: { x: number; y: number; w: number; h: number }, size: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  if (!(size.w > 0 && size.h > 0)) return box;
  const k = Math.min(box.w / size.w, box.h / size.h);
  const w = size.w * k, h = size.h * k;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * The SVG written into a PowerPoint file: its size set to the pixels PowerPoint's PNG fallback is
 * drawn at (twice the object's size on a 96 dpi screen, at most 4096), the view box kept so the
 * vector part still scales to the object.
 */
export function svgForPptx(svg: string, widthInches: number, heightInches: number): string {
  const clean = sanitizeSvg(svg) ?? svg;
  const k = Math.min(4096 / Math.max(widthInches * 96, heightInches * 96, 1), 2);
  const w = Math.max(16, Math.round(widthInches * 96 * k)), h = Math.max(16, Math.round(heightInches * 96 * k));
  const root = parseMarkup(clean).children.find((c) => c.name === 'svg');
  if (!root) return clean;
  const size = svgIntrinsicSize(clean);
  const vb = viewBoxOf(root.attrs) ?? (size ? [0, 0, size.w, size.h] : null);
  return clean.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    const kept = attrs.replace(/\s(?:width|height|viewBox)=("[^"]*"|'[^']*')/g, '');
    return `<svg${kept} width="${w}" height="${h}"${vb ? ` viewBox="${vb.join(' ')}"` : ''}>`;
  });
}
