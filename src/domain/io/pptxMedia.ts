// Audio and video on PPTX export: PptxGenJS writes the clip (p:pic with a:videoFile and the p14:media
// part), this file finishes it when the file is written: an audio clip is marked a:audioFile, and
// the clip's playback settings go into the slide's p:timing as PowerPoint keeps them (after
// DeckCraft's write/timing.rs write_media_node): p:video / p:audio > p:cMediaNode with vol, mute,
// showWhenStopped="0" (슬라이드 쇼 동안 숨기기), numSld (여러 슬라이드에서 재생), fill="remove"
// (재생 후 되감기), repeatCount="indefinite" (반복 재생) and fullScrn (전체 화면 재생, video only).
// 자동 실행 is written the way PowerPoint writes it: a Play effect leading the main sequence, After
// Previous, with no delay; the media node itself waits (delay="indefinite") for that effect or a click.
import type JSZip from 'jszip';
import type { MediaPlayback } from '../types';

export interface MediaPatch {
  /** The objectName the clip was written with, found again in the slide XML. */
  marker: string;
  kind: 'video' | 'audio';
  /** The object's own name (선택 창), when it has one. */
  name?: string;
  playback?: MediaPlayback;
}

/** File extension PowerPoint expects for a clip of MIME type `mime`. */
export function mediaExtension(mime: string, kind: 'video' | 'audio'): string {
  const ext: Record<string, string> = {
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-ms-wmv': 'wmv', 'video/x-msvideo': 'avi', 'video/mpeg': 'mpg', 'video/x-matroska': 'mkv', 'video/ogg': 'ogv',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/x-ms-wma': 'wma', 'audio/flac': 'flac', 'audio/midi': 'mid', 'audio/aiff': 'aif', 'audio/webm': 'weba',
  };
  return ext[mime.split(';')[0].trim().toLowerCase()] ?? (kind === 'video' ? 'mp4' : 'mp3');
}

/** Whether the clip's playback needs a media node at all (DeckCraft writes none for the defaults). */
export const needsMediaNode = (kind: 'video' | 'audio', pb: MediaPlayback | undefined) =>
  !!pb && (!!pb.autoplay || (pb.volume !== undefined && Math.abs(pb.volume - 1) > 1e-6) || !!pb.muted || !!pb.hideDuringShow || !!pb.loop || !!pb.rewind || !!pb.acrossSlides || (kind === 'video' && !!pb.fullScreen));

/** p:timing for the clips of one slide (shape id, kind, playback); '' when none needs one. */
export function mediaTimingXml(clips: { spid: string; kind: 'video' | 'audio'; playback?: MediaPlayback }[]): string {
  const used = clips.filter((c) => needsMediaNode(c.kind, c.playback));
  if (!used.length) return '';
  let id = 1;
  const next = () => ++id;
  const auto = used.filter((c) => c.playback?.autoplay);
  let main = '';
  if (auto.length) {
    const seqId = next(), groupId = next(), stepId = next();
    const effects = auto.map((c, i) => {
      const e = next(), b = next();
      return `<p:par><p:cTn id="${e}" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="${i === 0 ? 'afterEffect' : 'withEffect'}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="${b}" fill="hold"/><p:tgtEl><p:spTgt spid="${c.spid}"/></p:tgtEl></p:cBhvr></p:cmd></p:childTnLst></p:cTn></p:par>`;
    }).join('');
    main = `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${seqId}" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="${groupId}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="${seqId}"/></p:cond></p:stCondLst><p:childTnLst><p:par><p:cTn id="${stepId}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>`;
  }
  const nodes = used.map((c) => {
    const pb = c.playback ?? {};
    const tag = c.kind === 'video' ? 'p:video' : 'p:audio';
    const vol = Math.round(Math.max(0, Math.min(1, pb.volume ?? 1)) * 100000);
    const cm = `vol="${vol}"${pb.muted || vol === 0 ? ' mute="1"' : ''}${pb.hideDuringShow ? ' showWhenStopped="0"' : ''}${pb.acrossSlides ? ' numSld="999"' : ''}`;
    return `<${tag}${c.kind === 'video' && pb.fullScreen ? ' fullScrn="1"' : ''}><p:cMediaNode ${cm}><p:cTn id="${next()}" fill="${pb.rewind ? 'remove' : 'hold'}" display="0"${pb.loop ? ' repeatCount="indefinite"' : ''}><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${c.spid}"/></p:tgtEl></p:cMediaNode></${tag}>`;
  }).join('');
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>${main}${nodes}</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A p:pic whose p:cNvPr carries an `lcm-N` clip marker; neither side may run past the picture's own end. */
const CLIP_PIC = /<p:pic>((?:(?!<\/p:pic>)[\s\S])*?)<p:cNvPr id="(\d+)" name="(lcm-\d+)"((?:(?!<\/p:pic>)[\s\S])*?)<\/p:pic>/g;
const SHAPE_OPEN = /<p:(?:sp|cxnSp|pic|grpSp|graphicFrame)[ >]/;

/**
 * Whether the marked p:cNvPr belongs to the p:pic the match starts at (DeckCraft 6ebac8b9, strict shape-owner
 * scoping): it sits in that picture's own p:nvPicPr, and no other shape opens between the picture's start and end.
 */
export function ownsCNvPr(before: string, rest: string): boolean {
  const nv = before.lastIndexOf('<p:nvPicPr>');
  if (nv < 0 || SHAPE_OPEN.test(before) || SHAPE_OPEN.test(rest)) return false;
  return !/<\/p:nvPicPr>|<p:nvGrpSpPr>|<p:nvGraphicFramePr>|<p:nvSpPr>|<p:nvCxnSpPr>/.test(before.slice(nv));
}

/** Finishes the exported clips in the written file: names, a:audioFile for audio, and each slide's p:timing. */
export async function patchMediaClips(zip: JSZip, patches: MediaPatch[]): Promise<void> {
  if (!patches.length) return;
  const byMarker = new Map(patches.map((p) => [p.marker, p]));
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    let xml = await zip.file(f)!.async('string');
    const clips: { spid: string; kind: 'video' | 'audio'; playback?: MediaPlayback }[] = [];
    xml = xml.replace(CLIP_PIC, (all, before: string, spid: string, marker: string, rest: string) => {
      const p = byMarker.get(marker);
      if (!p || !ownsCNvPr(before, rest)) return all;
      clips.push({ spid, kind: p.kind, playback: p.playback });
      const body = p.kind === 'audio' ? rest.replace(/<a:videoFile /, '<a:audioFile ') : rest;
      return `<p:pic>${before}<p:cNvPr id="${spid}" name="${esc(p.name || (p.kind === 'video' ? '동영상' : '오디오'))}"${body}</p:pic>`;
    });
    const timing = mediaTimingXml(clips);
    if (timing && !xml.includes('<p:timing>')) {
      const at = xml.lastIndexOf('</p:sld>');
      // p:timing goes after p:clrMapOvr / p:transition and before the slide's own p:extLst.
      const ext = /<p:extLst>(?:(?!<p:extLst>)[\s\S])*<\/p:extLst>\s*<\/p:sld>\s*$/.exec(xml);
      const pos = ext && !xml.slice(ext.index).includes('</p:cSld>') ? ext.index : at;
      if (pos >= 0) xml = xml.slice(0, pos) + timing + xml.slice(pos);
    }
    if (clips.length) zip.file(f, xml);
  }
}
