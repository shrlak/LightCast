// Embedded OLE objects of a .pptx (p:oleObj: an Excel sheet, a Word file, a chart from another program…). LightCast cannot
// open them, so it keeps them intact: on import the preview picture becomes an ordinary picture object that also remembers the
// embedded file, and on export the picture is turned back into the original object. Sizes are capped.
import type JSZip from 'jszip';
import type { OleObject } from '../types';

/** One embedded file / all embedded files of a deck stay under these (a larger one is kept as its preview picture only). */
export const OLE_MAX_BYTES = 20 * 1024 * 1024;
export const OLE_MAX_TOTAL_BYTES = 60 * 1024 * 1024;

export const OLE_NOTE = 'PowerPoint에서만 열 수 있는 OLE 개체입니다. LightCast에서는 미리보기 그림으로 보이고, PPTX로 내보내면 원래 개체로 돌아갑니다.';
export const OLE_DROPPED_NOTE = 'OLE 개체의 원본 파일이 너무 커서 미리보기 그림만 가져왔습니다.';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CONTENT_TYPES: Record<string, string> = {
  bin: 'application/vnd.openxmlformats-officedocument.oleObject',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  vsdx: 'application/vnd.ms-visio.drawing',
  xls: 'application/vnd.ms-excel', doc: 'application/msword', pdf: 'application/pdf',
};
export const oleContentType = (ext: string): string => CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';

/** 'bin' files are OLE storages (relationship "oleObject"); Office Open XML files embed as a "package". */
export const oleRelTypeOf = (target: string): OleObject['relType'] => (/\.bin$/i.test(target) ? 'oleObject' : 'package');
export const oleExtOf = (target: string): string => (/\.([a-z0-9]{1,5})$/i.exec(target)?.[1] ?? 'bin').toLowerCase();

/** What a slide's OLE frame says (DOM read; the caller resolves the relationship ids). */
export interface ParsedOleFrame {
  progId: string;
  name?: string;
  /** Relationship id of the embedded file (absent for a linked object, which is not kept). */
  embedRId?: string;
  imgW?: number;
  imgH?: number;
  icon: boolean;
  /** The preview `p:pic`. */
  pic: Element;
  /** The frame's `p:xfrm` (or the preview picture's own `a:xfrm` when the frame has none). */
  xfrm: Element | null;
}

const byLocal = (root: Element, name: string): Element[] => Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name);

/** Read the OLE object inside a graphicFrame or an AlternateContent wrapper; null when it has no preview picture or is not an OLE object. */
export function readOleFrame(node: Element): ParsedOleFrame | null {
  const objs = byLocal(node, 'oleObj');
  // The version that carries the preview picture (the other one, for old viewers, points at a VML drawing).
  const obj = objs.find((o) => byLocal(o, 'pic').length) ?? null;
  if (!obj) return null;
  const pic = byLocal(obj, 'pic')[0];
  const frame = node.localName === 'graphicFrame' ? node : byLocal(node, 'graphicFrame')[0];
  const frameXfrm = frame ? (Array.from(frame.childNodes) as Element[]).find((e) => e.nodeType === 1 && e.localName === 'xfrm') ?? null : null;
  const picXfrm = byLocal(pic, 'xfrm')[0] ?? null;
  const embed = byLocal(obj, 'embed')[0];
  const num = (k: string) => { const v = Number(obj.getAttribute(k)); return Number.isFinite(v) && v > 0 ? v : undefined; };
  return {
    progId: obj.getAttribute('progId') ?? '',
    name: obj.getAttribute('name') || undefined,
    embedRId: embed ? obj.getAttributeNS(REL, 'id') || obj.getAttribute('r:id') || undefined : undefined,
    imgW: num('imgW'), imgH: num('imgH'),
    icon: embed?.getAttribute('showAsIcon') === '1',
    pic, xfrm: frameXfrm ?? picXfrm,
  };
}

/** Does the slide part contain an OLE frame (a cheap check before parsing)? */
export const hasOleFrame = (slideXml: string): boolean => /<p:oleObj\b/.test(slideXml);

// ── Export ──────────────────────────────────────────────────────────────────────────────────
/** One picture of the export that must become an OLE object again. */
export interface OlePatch { marker: string; ole: OleObject; data: Uint8Array }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The graphicFrame that replaces one exported picture `pic` (its blipFill and shape properties become the preview). */
export function oleFrameXml(picXml: string, ole: OleObject, rId: string): string | null {
  const blipFill = /<p:blipFill>[\s\S]*?<\/p:blipFill>/.exec(picXml)?.[0];
  const spPr = /<p:spPr>[\s\S]*?<\/p:spPr>/.exec(picXml)?.[0];
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/.exec(spPr ?? '');
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/.exec(spPr ?? '');
  const id = /<p:cNvPr id="(\d+)"/.exec(picXml)?.[1] ?? '2';
  if (!blipFill || !spPr || !off || !ext) return null;
  const name = esc(ole.name ?? ole.progId);
  const hint = `${ole.imgW ? ` imgW="${ole.imgW}"` : ''}${ole.imgH ? ` imgH="${ole.imgH}"` : ''}`;
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>`
    + `<p:xfrm><a:off x="${off[1]}" y="${off[2]}"/><a:ext cx="${ext[1]}" cy="${ext[2]}"/></p:xfrm>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj name="${name}" r:id="${rId}"${hint} progId="${esc(ole.progId)}">`
    + `<p:embed${ole.icon ? ' showAsIcon="1"' : ''}/><p:pic><p:nvPicPr><p:cNvPr id="0" name=""/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>${blipFill}${spPr}</p:pic></p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`;
}

/** Replace the marked pictures of one slide part; returns the new XML and which markers it used with the relationship id given to each. */
export function patchOleSlideXml(xml: string, patches: OlePatch[], rIdFor: (p: OlePatch) => string): { xml: string; used: OlePatch[] } {
  const used: OlePatch[] = [];
  const out = xml.replace(/<p:pic>[\s\S]*?<\/p:pic>/g, (pic) => {
    const patch = patches.find((p) => pic.includes(`name="${p.marker}"`));
    if (!patch) return pic;
    const frame = oleFrameXml(pic, patch.ole, rIdFor(patch));
    if (!frame) return pic;
    used.push(patch);
    return frame;
  });
  return { xml: out, used };
}

/** Put the embedded files into the exported package and turn the marked pictures back into OLE objects. */
export async function patchOleObjects(zip: JSZip, patches: OlePatch[]): Promise<number> {
  if (!patches.length) return 0;
  let n = 0;
  const exts = new Set<string>();
  for (const f of Object.keys(zip.files).filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x))) {
    const relFile = f.replace('slides/', 'slides/_rels/') + '.rels';
    let rels = (await zip.file(relFile)?.async('string')) ?? '';
    const assigned = new Map<OlePatch, { rId: string; path: string }>();
    const { xml, used } = patchOleSlideXml(await zip.file(f)!.async('string'), patches, (p) => {
      const k = ++n;
      const rId = `rIdOle${k}`;
      assigned.set(p, { rId, path: `ppt/embeddings/oleObject${k}.${p.ole.ext}` });
      return rId;
    });
    if (!used.length) continue;
    zip.file(f, xml);
    for (const p of used) {
      const a = assigned.get(p)!;
      zip.file(a.path, p.data);
      exts.add(p.ole.ext);
      rels = rels.replace('</Relationships>', `<Relationship Id="${a.rId}" Type="${REL}/${p.ole.relType}" Target="../embeddings/${a.path.split('/').pop()}"/></Relationships>`);
    }
    zip.file(relFile, rels);
  }
  if (exts.size) {
    let types = await zip.file('[Content_Types].xml')!.async('string');
    for (const e of exts) if (!new RegExp(`Extension="${e}"`, 'i').test(types)) types = types.replace('<Override', `<Default Extension="${e}" ContentType="${oleContentType(e)}"/><Override`);
    zip.file('[Content_Types].xml', types);
  }
  return n;
}
