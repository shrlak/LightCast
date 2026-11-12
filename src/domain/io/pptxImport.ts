import JSZip from 'jszip';

export interface ImportedSlide {
  title?: string;
  text: string;
  notes?: string;
  /** Largest picture on the slide, used as its background. */
  image?: Blob;
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Paragraph texts from a slide/notes XML part. */
function paragraphs(xml: string): { text: string; isTitle: boolean }[] {
  const out: { text: string; isTitle: boolean }[] = [];
  for (const sp of xml.split(/<p:sp[ >]/).slice(1)) {
    const isTitle = /<p:ph[^>]*type="(?:title|ctrTitle)"/.test(sp);
    for (const p of sp.split(/<a:p[ >]/).slice(1)) {
      const runs = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1]));
      const text = runs.join('').trim();
      if (text) out.push({ text, isTitle });
    }
  }
  return out;
}

function slideNumber(path: string): number {
  return Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

/**
 * Read a .pptx: per slide, its title, body text, speaker notes and biggest image.
 * Layout and animation are not kept — LightCast re-renders the text with its own theme.
 */
export async function importPptx(file: Blob): Promise<ImportedSlide[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const fallback = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => slideNumber(a) - slideNumber(b));
  const presentation = (await zip.file('ppt/presentation.xml')?.async('string')) ?? '';
  const relationships = (await zip.file('ppt/_rels/presentation.xml.rels')?.async('string')) ?? '';
  const attrs = (xml: string, name: string) => new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`).exec(xml)?.[1];
  const targets = new Map([...relationships.matchAll(/<Relationship\b[^>]*>/g)].map(([xml]) => [attrs(xml, 'Id'), attrs(xml, 'Target')]));
  const ordered = [...presentation.matchAll(/<p:sldId\b[^>]*>/g)].map(([xml]) => targets.get(attrs(xml, 'r:id'))).filter((p): p is string => !!p).map((p) => new URL(p, 'https://x/ppt/presentation.xml').pathname.slice(1));
  const slidePaths = ordered.length ? ordered : fallback;
  const slides: ImportedSlide[] = [];
  for (const path of slidePaths) {
    const xml = await zip.file(path)!.async('string');
    const paras = paragraphs(xml);
    const title = paras.find((p) => p.isTitle)?.text;
    const text = paras.filter((p) => !p.isTitle).map((p) => p.text).join('\n');
    const relsPath = path.replace('slides/', 'slides/_rels/') + '.rels';
    const rels = (await zip.file(relsPath)?.async('string')) ?? '';
    let image: Blob | undefined;
    let notes: string | undefined;
    for (const m of rels.matchAll(/Target="([^"]+)"/g)) {
      const target = new URL(m[1], `https://x/${path}`).pathname.slice(1);
      if (/\/media\/[^/]+\.(png|jpe?g|gif|webp)$/i.test(target)) {
        const f = zip.file(target);
        if (!f) continue;
        const blob = await f.async('blob');
        if (!image || blob.size > image.size) {
          const ext = target.split('.').pop()!.toLowerCase();
          image = new Blob([blob], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
        }
      } else if (/notesSlide\d+\.xml$/.test(target)) {
        const nx = await zip.file(target)?.async('string');
        if (nx) notes = paragraphs(nx).map((p) => p.text).filter((t) => !/^\d+$/.test(t)).join('\n') || undefined;
      }
    }
    slides.push({ title, text, notes, image });
  }
  return slides;
}
