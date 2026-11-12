// Export › PNG / JPEG: draws a slide (the same SlideCanvas the editor shows) into a picture. The slide is
// mounted off screen at 1440 × 1080, its styles are inlined, its pictures and fonts embedded, and the
// result is drawn through an SVG <foreignObject> onto a canvas at the chosen size.
import { createRoot } from 'react-dom/client';
import type { Background, Presentation, Slide, Theme } from '../domain/types';
import { resolveBackground } from '../domain/autoBackground';
import { familiesOf, unicodeRangeCovers } from '../domain/fontEmbed';
import { CANVAS_H, CANVAS_W } from '../domain/canvas';
import type { ExportFormat } from '../domain/filePrint';
import { SlideCanvas } from './SlideCanvas';

const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
const dataCache = new Map<string, Promise<string>>();
/** A URL (blob:, same-origin) as a data: URL, so the SVG picture carries it. */
function inlineUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return Promise.resolve(url);
  let c = dataCache.get(url);
  if (!c) { c = fetch(url).then((r) => r.blob()).then(blobToDataUrl); if (!url.startsWith('blob:')) dataCache.set(url, c); }
  return c.catch(() => url);
}

/** @font-face rules (with their files embedded) for the families and characters a slide uses. */
async function fontCss(families: Set<string>, text: string): Promise<string> {
  const out: string[] = [];
  const jobs: Promise<void>[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of Array.from(rules)) {
      if (!(r instanceof CSSFontFaceRule)) continue;
      const fam = r.style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '').toLowerCase();
      if (!families.has(fam) || !unicodeRangeCovers(r.style.getPropertyValue('unicode-range'), text)) continue;
      const src = r.style.getPropertyValue('src');
      const urls = [...src.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)(?:\s*format\(\s*["']?([^"')]+)["']?\s*\))?/g)];
      const pick = urls.find((u) => u[2] === 'woff2') ?? urls[0];
      if (!pick) continue;
      const slot = out.length;
      out.push('');
      jobs.push(inlineUrl(new URL(pick[1], sheet.href ?? location.href).href).then((data) => {
        out[slot] = `@font-face{font-family:${r.style.getPropertyValue('font-family')};font-weight:${r.style.getPropertyValue('font-weight') || 'normal'};font-style:${r.style.getPropertyValue('font-style') || 'normal'};src:url(${data});}`;
      }));
    }
  }
  await Promise.all(jobs);
  return out.join('');
}

/** A copy of `node` with every computed style inlined and pictures embedded. */
async function inlineTree(node: HTMLElement): Promise<{ root: HTMLElement; families: Set<string>; text: string }> {
  const root = node.cloneNode(true) as HTMLElement;
  const fams: string[] = [];
  let text = '';
  const jobs: Promise<void>[] = [];
  const walk = (src: Element, dst: Element) => {
    const cs = getComputedStyle(src);
    const style = (dst as HTMLElement).style;
    for (const prop of Array.from(cs)) style.setProperty(prop, cs.getPropertyValue(prop));
    fams.push(cs.fontFamily);
    const bg = cs.backgroundImage;
    if (bg && bg !== 'none' && /url\(/.test(bg)) {
      const m = [...bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)];
      jobs.push(Promise.all(m.map((u) => inlineUrl(u[1]))).then((datas) => { let i = 0; style.setProperty('background-image', bg.replace(/url\(["']?[^"')]+["']?\)/g, () => `url("${datas[i++]}")`)); }));
    }
    if (src instanceof HTMLImageElement) jobs.push(inlineUrl(src.currentSrc || src.src).then((d) => { (dst as HTMLImageElement).src = d; (dst as HTMLImageElement).removeAttribute('srcset'); }));
    if (src instanceof HTMLVideoElement) {
      try {
        const c = document.createElement('canvas');
        c.width = src.videoWidth || 1; c.height = src.videoHeight || 1;
        c.getContext('2d')!.drawImage(src, 0, 0);
        const img = document.createElement('img');
        img.src = c.toDataURL('image/png');
        img.setAttribute('style', style.cssText);
        dst.replaceWith(img);
      } catch { /* a tainted frame: leave the video's box empty */ }
    }
    if (src instanceof HTMLCanvasElement) {
      const img = document.createElement('img');
      try { img.src = src.toDataURL('image/png'); } catch { /* tainted */ }
      img.setAttribute('style', style.cssText);
      dst.replaceWith(img);
    }
    for (const n of Array.from(src.childNodes)) if (n.nodeType === 3) text += n.textContent ?? '';
    const sc = Array.from(src.children), dc = Array.from(dst.children);
    sc.forEach((c, i) => { if (dc[i]) walk(c, dc[i]); });
  };
  walk(node, root);
  await Promise.all(jobs);
  return { root, families: familiesOf(fams), text };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('슬라이드를 그림으로 그리지 못했습니다')); i.src = url; });
}

/** `node` (laid out at w × h) as a picture of `outW` pixels wide. */
export async function rasterize(node: HTMLElement, w: number, h: number, outW: number, format: ExportFormat): Promise<Blob> {
  const { root, families, text } = await inlineTree(node);
  root.style.cssText += `;width:${w}px;height:${h}px;position:relative;left:0;top:0;filter:none;margin:0;`;
  const css = await fontCss(families, text);
  const html = new XMLSerializer().serializeToString(root);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>${css.replace(/</g, '&lt;')}</style><foreignObject x="0" y="0" width="${w}" height="${h}">${html}</foreignObject></svg>`;
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const outH = Math.round((outW * h) / w);
  const canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  if (format === 'jpeg') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, outW, outH); }
  ctx.drawImage(img, 0, 0, outW, outH);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('그림을 저장하지 못했습니다'))), format === 'png' ? 'image/png' : 'image/jpeg', 0.92));
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mounts one slide off screen at full size, waits for its pictures, and hands its element to `fn`. */
async function withMountedSlide<T>(slide: Slide, theme: Theme, background: Background | null, fn: (el: HTMLElement) => Promise<T>): Promise<T> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${CANVAS_W}px;height:${CANVAS_H}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<SlideCanvas slide={slide} theme={theme} background={background} />);
    const el = await new Promise<HTMLElement>((res, rej) => {
      const t0 = Date.now();
      const tick = () => {
        const frame = host.querySelector('.canvas-frame') as HTMLElement | null;
        const canvas = frame?.querySelector('.canvas') as HTMLElement | null;
        const imgs = Array.from(host.querySelectorAll('img'));
        if (frame && canvas && canvas.style.transform.includes('scale(1)') && imgs.every((i) => i.complete)) return res(frame);
        if (Date.now() - t0 > 8000) return frame ? res(frame) : rej(new Error('슬라이드를 그리지 못했습니다'));
        setTimeout(tick, 50);
      };
      tick();
    });
    await settle(150);
    return await fn(el);
  } finally {
    root.unmount();
    host.remove();
  }
}

/** One slide as a PNG / JPEG of `width` pixels wide. */
export function slideToImage(p: Presentation, slide: Slide, theme: Theme, width: number, format: ExportFormat): Promise<Blob> {
  return withMountedSlide(slide, theme, resolveBackground(slide, p), (el) => rasterize(el, CANVAS_W, CANVAS_H, width, format));
}
