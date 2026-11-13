// Faster-than-real-time video export, the pure part: which WebCodecs codec to use, when each frame is, and two small
// muxers that put encoded frames into a WebM (VP8 / VP9) or an MP4 (H.264) file. No browser APIs here, so tests can run it.

// ── Which codec ─────────────────────────────────────────────────────────────────────────────────
export interface FastCodec {
  id: 'avc' | 'vp9' | 'vp8';
  /** The WebCodecs codec string. */
  codec: string;
  container: 'mp4' | 'webm';
  ext: 'mp4' | 'webm';
  label: string;
  mime: string;
  /** The WebM CodecID (webm only). */
  webmId?: 'V_VP8' | 'V_VP9';
}

/** In order of preference: MP4 (plays everywhere) when the encoder can write H.264, else WebM. */
export const FAST_CODECS: FastCodec[] = [
  { id: 'avc', codec: 'avc1.64002A', container: 'mp4', ext: 'mp4', label: 'MP4', mime: 'video/mp4' },
  { id: 'vp9', codec: 'vp09.00.40.08', container: 'webm', ext: 'webm', label: 'WebM', mime: 'video/webm', webmId: 'V_VP9' },
  { id: 'vp8', codec: 'vp8', container: 'webm', ext: 'webm', label: 'WebM', mime: 'video/webm', webmId: 'V_VP8' },
];

/** The first codec `isSupported` (VideoEncoder.isConfigSupported) accepts at this size; null when the fast way is not possible here. */
export async function pickFastCodec(isSupported: (c: { codec: string; width: number; height: number }) => Promise<boolean>, width: number, height: number): Promise<FastCodec | null> {
  for (const c of FAST_CODECS) {
    try { if (await isSupported({ codec: c.codec, width, height })) return c; } catch { /* this one cannot be asked: try the next */ }
  }
  return null;
}

// ── Frames ──────────────────────────────────────────────────────────────────────────────────────
export interface FramePlan {
  /** Index of the slide this frame shows. */
  slide: number;
  /** Start and length in microseconds. */
  tUs: number;
  durUs: number;
  /** The first frame of a slide is a key frame (so every slide start can be seeked to). */
  key: boolean;
}

/**
 * The frames to encode for slides shown `durationsSec` each: one at the start of every slide and one more every
 * `gapSec` while it stays (a still slide costs almost nothing, and players that dislike very long frames stay happy).
 */
export function planFrames(durationsSec: number[], gapSec = 1): FramePlan[] {
  const out: FramePlan[] = [];
  let t = 0; // microseconds
  const gap = Math.max(0.1, gapSec) * 1e6;
  durationsSec.forEach((sec, slide) => {
    const len = Math.max(0.01, sec) * 1e6;
    for (let at = 0; at < len - 1; at += gap) out.push({ slide, tUs: Math.round(t + at), durUs: Math.round(Math.min(gap, len - at)), key: at === 0 });
    t += len;
  });
  return out;
}

export const totalMicros = (plan: FramePlan[]): number => (plan.length ? plan[plan.length - 1].tUs + plan[plan.length - 1].durUs : 0);

export interface EncodedFrame { data: Uint8Array; timestampUs: number; durationUs: number; key: boolean }

// ── Bytes ───────────────────────────────────────────────────────────────────────────────────────
export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const bytesOf = (n: number, len: number): Uint8Array => {
  const out = new Uint8Array(len);
  let v = n;
  for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  return out;
};
const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

// ── WebM (Matroska subset) ──────────────────────────────────────────────────────────────────────
const sizeVint = (n: number): Uint8Array => {
  let len = 1;
  while (len < 8 && n >= 2 ** (7 * len) - 1) len++;
  const out = bytesOf(n, len);
  out[0] |= 0x80 >> (len - 1);
  return out;
};
const idBytes = (id: number): Uint8Array => bytesOf(id, id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1);
const el = (id: number, ...payload: Uint8Array[]): Uint8Array => {
  const body = concat(payload);
  return concat([idBytes(id), sizeVint(body.length), body]);
};
const uintEl = (id: number, n: number): Uint8Array => {
  let len = 1;
  while (len < 7 && n >= 256 ** len) len++;
  return el(id, bytesOf(n, len));
};
const floatEl = (id: number, v: number): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return el(id, b);
};
const strEl = (id: number, s: string): Uint8Array => el(id, ascii(s));

const ID = {
  EBML: 0x1a45dfa3, EBMLVersion: 0x4286, EBMLReadVersion: 0x42f7, EBMLMaxIDLength: 0x42f2, EBMLMaxSizeLength: 0x42f3, DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285,
  Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, MuxingApp: 0x4d80, WritingApp: 0x5741,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83, CodecID: 0x86, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
} as const;
export const WEBM_IDS = ID;

/** Writes encoded VP8 / VP9 frames into a WebM file with a seek index (Cues) at every key frame cluster. */
export function muxWebm(o: { width: number; height: number; codecId: 'V_VP8' | 'V_VP9'; frames: EncodedFrame[] }): Uint8Array {
  const { frames } = o;
  const ms = (us: number) => Math.round(us / 1000);
  // Clusters start at each key frame (and every 30 s, a block's time is a signed 16-bit offset in ms).
  const clusters: { startMs: number; blocks: Uint8Array[]; key: boolean }[] = [];
  for (const f of frames) {
    const t = ms(f.timestampUs);
    let c = clusters[clusters.length - 1];
    if (!c || f.key || t - c.startMs > 30000) { c = { startMs: t, blocks: [], key: f.key }; clusters.push(c); }
    const rel = t - c.startMs;
    c.blocks.push(el(ID.SimpleBlock, Uint8Array.of(0x81, (rel >> 8) & 0xff, rel & 0xff, f.key ? 0x80 : 0), f.data));
  }
  const last = frames[frames.length - 1];
  const durationMs = last ? ms(last.timestampUs + last.durationUs) : 0;

  const header = el(ID.EBML, uintEl(ID.EBMLVersion, 1), uintEl(ID.EBMLReadVersion, 1), uintEl(ID.EBMLMaxIDLength, 4), uintEl(ID.EBMLMaxSizeLength, 8), strEl(ID.DocType, 'webm'), uintEl(ID.DocTypeVersion, 4), uintEl(ID.DocTypeReadVersion, 2));
  const info = el(ID.Info, uintEl(ID.TimecodeScale, 1_000_000), floatEl(ID.Duration, durationMs), strEl(ID.MuxingApp, 'LightCast'), strEl(ID.WritingApp, 'LightCast'));
  const tracks = el(ID.Tracks, el(ID.TrackEntry, uintEl(ID.TrackNumber, 1), uintEl(ID.TrackUID, 1), uintEl(ID.TrackType, 1), strEl(ID.CodecID, o.codecId), el(ID.Video, uintEl(ID.PixelWidth, o.width), uintEl(ID.PixelHeight, o.height))));

  const body: Uint8Array[] = [info, tracks];
  let pos = info.length + tracks.length; // offset from the start of the segment's data
  const cuePoints: Uint8Array[] = [];
  for (const c of clusters) {
    const cluster = el(ID.Cluster, uintEl(ID.Timecode, c.startMs), ...c.blocks);
    if (c.key) cuePoints.push(el(ID.CuePoint, uintEl(ID.CueTime, c.startMs), el(ID.CueTrackPositions, uintEl(ID.CueTrack, 1), uintEl(ID.CueClusterPosition, pos))));
    body.push(cluster);
    pos += cluster.length;
  }
  if (cuePoints.length) body.push(el(ID.Cues, ...cuePoints));
  return concat([header, el(ID.Segment, ...body)]);
}

// ── MP4 (ISO base media, one H.264 track) ───────────────────────────────────────────────────────
const u32 = (n: number) => bytesOf(n >>> 0, 4);
const u16 = (n: number) => bytesOf(n, 2);
const box = (type: string, ...payload: Uint8Array[]): Uint8Array => {
  const body = concat(payload);
  return concat([u32(body.length + 8), ascii(type), body]);
};
const fullBox = (type: string, version: number, flags: number, ...payload: Uint8Array[]) => box(type, Uint8Array.of(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...payload);
const zeros = (n: number) => new Uint8Array(n);
const MATRIX = concat([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32));

/** Writes encoded H.264 frames (length-prefixed, `avcC` = the encoder's decoder-config description) into an MP4 file. */
export function muxMp4(o: { width: number; height: number; avcC: Uint8Array; frames: EncodedFrame[] }): Uint8Array {
  const { frames } = o;
  const timescale = 1000;
  const ms = (us: number) => Math.round(us / 1000);
  // Sample durations from the gaps between frame times (the last one has its own length).
  const durs = frames.map((f, i) => (i + 1 < frames.length ? Math.max(1, ms(frames[i + 1].timestampUs) - ms(f.timestampUs)) : Math.max(1, ms(f.durationUs))));
  const total = durs.reduce((a, b) => a + b, 0);
  const mdat = box('mdat', ...frames.map((f) => f.data));
  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));

  const stts: number[] = [];
  let run = 0;
  durs.forEach((d, i) => { run++; if (i + 1 === durs.length || durs[i + 1] !== d) { stts.push(run, d); run = 0; } });
  const keys = frames.flatMap((f, i) => (f.key ? [i + 1] : []));

  const moov = (chunkOffset: number) => box('moov',
    fullBox('mvhd', 0, 0, u32(0), u32(0), u32(timescale), u32(total), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2)),
    box('trak',
      fullBox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(total), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(o.width * 65536), u32(o.height * 65536)),
      box('mdia',
        fullBox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(total), u16(0x55c4), u16(0)),
        fullBox('hdlr', 0, 0, u32(0), ascii('vide'), zeros(12), ascii('VideoHandler'), zeros(1)),
        box('minf',
          fullBox('vmhd', 0, 1, zeros(8)),
          box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
          box('stbl',
            fullBox('stsd', 0, 0, u32(1), box('avc1', zeros(6), u16(1), zeros(16), u16(o.width), u16(o.height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff), box('avcC', o.avcC))),
            fullBox('stts', 0, 0, u32(stts.length / 2), ...stts.map(u32)),
            ...(keys.length ? [fullBox('stss', 0, 0, u32(keys.length), ...keys.map(u32))] : []),
            fullBox('stsc', 0, 0, u32(1), u32(1), u32(frames.length), u32(1)),
            fullBox('stsz', 0, 0, u32(0), u32(frames.length), ...frames.map((f) => u32(f.data.length))),
            fullBox('stco', 0, 0, u32(1), u32(chunkOffset)),
          )))));
  const size = moov(0).length;
  return concat([ftyp, moov(ftyp.length + size + 8), mdat]);
}
