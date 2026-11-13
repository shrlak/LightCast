// Faster-than-real-time video export: codec choice, frame plan and the two small muxers (read back with a tiny parser).
import { describe, expect, it } from 'vitest';
import { FAST_CODECS, WEBM_IDS, muxMp4, muxWebm, pickFastCodec, planFrames, totalMicros, type EncodedFrame } from '../src/domain/videoMux';

describe('fast video codec choice', () => {
  const size = { width: 960, height: 720 };
  it('prefers H.264 in MP4, then VP9, then VP8 in WebM, and says null when nothing can be encoded', async () => {
    expect((await pickFastCodec(async () => true, size.width, size.height))?.id).toBe('avc');
    expect((await pickFastCodec(async (c) => !c.codec.startsWith('avc1'), size.width, size.height))?.id).toBe('vp9');
    expect(await pickFastCodec(async (c) => c.codec === 'vp8', size.width, size.height)).toMatchObject({ id: 'vp8', ext: 'webm', webmId: 'V_VP8' });
    expect(await pickFastCodec(async () => false, size.width, size.height)).toBeNull();
  });
  it('treats a codec that cannot be asked about as unsupported', async () => {
    const c = await pickFastCodec(async (x) => { if (x.codec.startsWith('avc1')) throw new Error('boom'); return true; }, size.width, size.height);
    expect(c?.id).toBe('vp9');
    expect(FAST_CODECS.every((x) => (x.container === 'mp4') === (x.ext === 'mp4'))).toBe(true);
  });
});

describe('frame plan', () => {
  it('has a key frame at every slide start and one frame per second while a slide stays', () => {
    const plan = planFrames([2.5, 1]);
    expect(plan.map((f) => [f.slide, f.tUs / 1e6, f.durUs / 1e6, f.key])).toEqual([
      [0, 0, 1, true], [0, 1, 1, false], [0, 2, 0.5, false], [1, 2.5, 1, true],
    ]);
    expect(totalMicros(plan)).toBe(3_500_000);
  });
  it('keeps very short and empty input sane', () => {
    expect(planFrames([0.25]).map((f) => f.durUs)).toEqual([250_000]);
    expect(planFrames([])).toEqual([]);
    expect(totalMicros([])).toBe(0);
  });
  it('covers a long slide without gaps', () => {
    const plan = planFrames([600]);
    expect(plan).toHaveLength(600);
    expect(plan.filter((f) => f.key)).toHaveLength(1);
    expect(plan.every((f, i) => i === 0 || f.tUs === plan[i - 1].tUs + plan[i - 1].durUs)).toBe(true);
  });
});

// A tiny EBML reader: the elements of a byte range as { id, start, end } (payload range).
interface Elem { id: number; start: number; end: number }
function readElems(b: Uint8Array, from = 0, to = b.length): Elem[] {
  const out: Elem[] = [];
  let at = from;
  while (at < to) {
    let idLen = 1;
    while (idLen < 4 && !(b[at] & (0x80 >> (idLen - 1)))) idLen++;
    let id = 0;
    for (let i = 0; i < idLen; i++) id = id * 256 + b[at + i];
    at += idLen;
    let szLen = 1;
    while (szLen < 8 && !(b[at] & (0x80 >> (szLen - 1)))) szLen++;
    let size = b[at] & (0xff >> szLen);
    for (let i = 1; i < szLen; i++) size = size * 256 + b[at + i];
    at += szLen;
    out.push({ id, start: at, end: at + size });
    at += size;
  }
  return out;
}
const num = (b: Uint8Array, e: Elem) => b.slice(e.start, e.end).reduce((a, v) => a * 256 + v, 0);
const frame = (n: number, ms: number, key: boolean, len = 5): EncodedFrame => ({ data: new Uint8Array(len).fill(n), timestampUs: ms * 1000, durationUs: 1_000_000, key });
const kids = (b: Uint8Array, e: Elem) => readElems(b, e.start, e.end);

describe('WebM muxer', () => {
  const bytes = muxWebm({ width: 960, height: 720, codecId: 'V_VP9', frames: [frame(1, 0, true), frame(2, 1000, false), frame(3, 2000, true), frame(4, 3000, false)] });
  const top = readElems(bytes);
  const segment = top.find((e) => e.id === WEBM_IDS.Segment)!;
  const seg = kids(bytes, segment);

  it('starts with an EBML header for "webm" and a segment that fills the file', () => {
    expect(top.map((e) => e.id)).toEqual([WEBM_IDS.EBML, WEBM_IDS.Segment]);
    expect(segment.end).toBe(bytes.length);
    const doc = kids(bytes, top[0]).find((e) => e.id === WEBM_IDS.DocType)!;
    expect(String.fromCharCode(...bytes.slice(doc.start, doc.end))).toBe('webm');
  });

  it('describes the video track and the total length', () => {
    const info = kids(bytes, seg.find((x) => x.id === WEBM_IDS.Info)!);
    const dur = info.find((e) => e.id === WEBM_IDS.Duration)!;
    expect(new DataView(bytes.buffer, bytes.byteOffset + dur.start, 8).getFloat64(0)).toBe(4000);
    const entry = kids(bytes, seg.find((e) => e.id === WEBM_IDS.Tracks)!)[0];
    const fields = kids(bytes, entry);
    const codec = fields.find((e) => e.id === WEBM_IDS.CodecID)!;
    expect(String.fromCharCode(...bytes.slice(codec.start, codec.end))).toBe('V_VP9');
    const dims = kids(bytes, fields.find((e) => e.id === WEBM_IDS.Video)!);
    expect(dims.map((d) => num(bytes, d))).toEqual([960, 720]);
  });

  it('puts each key frame at the start of a cluster, with blocks in order and a cue for each', () => {
    const clusters = seg.filter((e) => e.id === WEBM_IDS.Cluster);
    expect(clusters).toHaveLength(2);
    const blocks = clusters.map((c) => kids(bytes, c));
    expect(blocks[0].map((e) => e.id)).toEqual([WEBM_IDS.Timecode, WEBM_IDS.SimpleBlock, WEBM_IDS.SimpleBlock]);
    const first = blocks[0][1];
    expect(bytes[first.start]).toBe(0x81); // track 1
    expect(bytes[first.start + 3]).toBe(0x80); // key frame flag
    expect(bytes[first.start + 4]).toBe(1); // payload
    const second = blocks[0][2];
    expect((bytes[second.start + 1] << 8) | bytes[second.start + 2]).toBe(1000); // 1 s after the cluster start
    expect(bytes[second.start + 3]).toBe(0);
    const cues = kids(bytes, seg.find((x) => x.id === WEBM_IDS.Cues)!);
    expect(cues).toHaveLength(2);
    // The second cue points at the second cluster, counted from the start of the segment's data.
    const pos = kids(bytes, cues[1]).find((e) => e.id === WEBM_IDS.CueTrackPositions)!;
    const cp = kids(bytes, pos).find((e) => e.id === WEBM_IDS.CueClusterPosition)!;
    expect(segment.start + num(bytes, cp)).toBe(clusters[1].start - 5); // the id (4 bytes) and the size (1 byte) come first
  });

  it('handles an empty frame list and big frames (multi-byte sizes)', () => {
    expect(readElems(muxWebm({ width: 2, height: 2, codecId: 'V_VP8', frames: [] }))).toHaveLength(2);
    const big = muxWebm({ width: 2, height: 2, codecId: 'V_VP8', frames: [frame(9, 0, true, 70000)] });
    expect(big.length).toBeGreaterThan(70000);
    expect(readElems(big).find((e) => e.id === WEBM_IDS.Segment)!.end).toBe(big.length);
  });
});

describe('MP4 muxer', () => {
  const avcC = Uint8Array.of(1, 0x64, 0, 0x2a, 0xff, 0xe1, 0, 2, 0x67, 0x64, 1, 0, 1, 0x68);
  const frames = [frame(1, 0, true, 10), frame(2, 1000, false, 7), frame(3, 2000, false, 4)];
  const bytes = muxMp4({ width: 960, height: 720, avcC, frames });
  const u32At = (at: number) => (bytes[at] * 2 ** 24) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
  const typeAt = (at: number) => String.fromCharCode(...bytes.slice(at + 4, at + 8));
  const boxes = (from: number, to: number) => {
    const out: { type: string; start: number; end: number }[] = [];
    for (let at = from; at < to; ) { const size = u32At(at); out.push({ type: typeAt(at), start: at + 8, end: at + size }); at += size; }
    return out;
  };
  const find = (path: string[]): { type: string; start: number; end: number } => {
    let cur = { start: 0, end: bytes.length, type: '' };
    for (const name of path) { const b = boxes(cur.start, cur.end).find((x) => x.type === name); expect(b, name).toBeTruthy(); cur = b!; }
    return cur;
  };

  it('lays out ftyp, moov and mdat that exactly fill the file', () => {
    expect(boxes(0, bytes.length).map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
  });

  it('has the sample tables: count, sizes, key frames and times', () => {
    const stbl = find(['moov', 'trak', 'mdia', 'minf', 'stbl']);
    const tables = boxes(stbl.start, stbl.end);
    expect(tables.map((k) => k.type)).toEqual(['stsd', 'stts', 'stss', 'stsc', 'stsz', 'stco']);
    const stsz = tables.find((k) => k.type === 'stsz')!;
    expect([u32At(stsz.start + 8), u32At(stsz.start + 12), u32At(stsz.start + 16), u32At(stsz.start + 20)]).toEqual([3, 10, 7, 4]);
    const stss = tables.find((k) => k.type === 'stss')!;
    expect([u32At(stss.start + 4), u32At(stss.start + 8)]).toEqual([1, 1]);
    const stts = tables.find((k) => k.type === 'stts')!;
    expect([u32At(stts.start + 4), u32At(stts.start + 8), u32At(stts.start + 12)]).toEqual([1, 3, 1000]);
    const mdhd = find(['moov', 'trak', 'mdia', 'mdhd']);
    expect([u32At(mdhd.start + 12), u32At(mdhd.start + 16)]).toEqual([1000, 3000]); // timescale, duration
  });

  it('points the chunk offset at the first frame in mdat, and stores the avcC', () => {
    const stco = find(['moov', 'trak', 'mdia', 'minf', 'stbl', 'stco']);
    const offset = u32At(stco.start + 8);
    const mdat = find(['mdat']);
    expect(offset).toBe(mdat.start);
    expect(Array.from(bytes.slice(offset, offset + 10))).toEqual(Array(10).fill(1));
    expect(bytes.length).toBe(mdat.end);
    const stsd = find(['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']);
    const avc1 = boxes(stsd.start + 8, stsd.end)[0];
    expect(avc1.type).toBe('avc1');
    expect(Array.from(bytes.slice(avc1.end - avcC.length, avc1.end))).toEqual(Array.from(avcC));
    expect(typeAt(avc1.end - avcC.length - 8)).toBe('avcC');
  });
});
