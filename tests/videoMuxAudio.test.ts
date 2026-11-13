// The muxers with a narration track: the output is parsed back (audio track present, blocks and durations consistent).
import { describe, expect, it } from 'vitest';
import { WEBM_IDS, aacConfig, muxMp4, muxWebm, opusHead, type AudioTrack, type EncodedFrame } from '../src/domain/videoMux';

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
const kids = (b: Uint8Array, e: Elem) => readElems(b, e.start, e.end);
const f64 = (b: Uint8Array, e: Elem) => new DataView(b.buffer, b.byteOffset + e.start, 8).getFloat64(0);
const str = (b: Uint8Array, e: Elem) => String.fromCharCode(...b.slice(e.start, e.end));
const vframe = (n: number, ms: number, key: boolean, len = 5): EncodedFrame => ({ data: new Uint8Array(len).fill(n), timestampUs: ms * 1000, durationUs: 1_000_000, key });
const video = [vframe(1, 0, true), vframe(2, 1000, false), vframe(3, 2000, false)]; // 3 s

describe('WebM with a narration track', () => {
  const pkt = (n: number, ms: number) => ({ data: new Uint8Array(6).fill(n), timestampUs: ms * 1000, durationUs: 20_000 });
  const opus: AudioTrack = { codec: 'opus', sampleRate: 48000, channels: 2, frames: Array.from({ length: 150 }, (_, i) => pkt(0x40 + (i % 8), i * 20)) }; // 3 s

  it('has a second (Opus) track with its header, and audio blocks interleaved in time order', () => {
    const bytes = muxWebm({ width: 960, height: 720, codecId: 'V_VP9', frames: video, audio: opus });
    const seg = kids(bytes, readElems(bytes).find((e) => e.id === WEBM_IDS.Segment)!);
    const entries = kids(bytes, seg.find((e) => e.id === WEBM_IDS.Tracks)!);
    expect(entries).toHaveLength(2);
    const f = kids(bytes, entries[1]);
    expect(str(bytes, f.find((e) => e.id === WEBM_IDS.CodecID)!)).toBe('A_OPUS');
    expect(num(bytes, f.find((e) => e.id === WEBM_IDS.TrackType)!)).toBe(2);
    const head = f.find((e) => e.id === WEBM_IDS.CodecPrivate)!;
    expect(str(bytes, { id: 0, start: head.start, end: head.start + 8 })).toBe('OpusHead');
    const a = kids(bytes, f.find((e) => e.id === WEBM_IDS.Audio)!);
    expect(f64(bytes, a[0])).toBe(48000);
    expect(num(bytes, a[1])).toBe(2);
    const blocks: { track: number; t: number }[] = [];
    for (const c of seg.filter((e) => e.id === WEBM_IDS.Cluster)) {
      const k = kids(bytes, c);
      const base = num(bytes, k[0]);
      for (const b of k.slice(1)) blocks.push({ track: bytes[b.start] & 0x7f, t: base + ((((bytes[b.start + 1] << 8) | bytes[b.start + 2]) << 16) >> 16) });
    }
    expect(blocks.filter((b) => b.track === 1)).toHaveLength(3);
    expect(blocks.filter((b) => b.track === 2)).toHaveLength(150);
    expect(blocks.map((b) => b.t)).toEqual([...blocks.map((b) => b.t)].sort((x, y) => x - y));
    const dur = kids(bytes, seg.find((e) => e.id === WEBM_IDS.Info)!).find((e) => e.id === WEBM_IDS.Duration)!;
    expect(f64(bytes, dur)).toBe(3000);
    // The seek index still points only at video key frames.
    const cues = kids(bytes, seg.find((e) => e.id === WEBM_IDS.Cues)!);
    expect(cues).toHaveLength(1);
  });

  it('stretches the duration when the audio is longer than the pictures', () => {
    const long: AudioTrack = { ...opus, frames: Array.from({ length: 300 }, (_, i) => pkt(1, i * 20)) }; // 6 s
    const bytes = muxWebm({ width: 2, height: 2, codecId: 'V_VP8', frames: [vframe(1, 0, true)], audio: long });
    const seg = kids(bytes, readElems(bytes).find((e) => e.id === WEBM_IDS.Segment)!);
    const dur = kids(bytes, seg.find((e) => e.id === WEBM_IDS.Info)!).find((e) => e.id === WEBM_IDS.Duration)!;
    expect(f64(bytes, dur)).toBe(6000);
  });

  it('writes only the video track when there is no audio (or an empty one)', () => {
    const bytes = muxWebm({ width: 2, height: 2, codecId: 'V_VP8', frames: video, audio: { ...opus, frames: [] } });
    const seg = kids(bytes, readElems(bytes).find((e) => e.id === WEBM_IDS.Segment)!);
    expect(kids(bytes, seg.find((e) => e.id === WEBM_IDS.Tracks)!)).toHaveLength(1);
  });

  it('builds an OpusHead and AAC-LC configs', () => {
    const h = opusHead(2, 48000);
    expect([h.length, h[8], h[9]]).toEqual([19, 1, 2]);
    expect(Array.from(aacConfig(48000, 2))).toEqual([0x11, 0x90]);
    expect(Array.from(aacConfig(44100, 2))).toEqual([0x12, 0x10]);
  });
});

describe('MP4 with a narration track', () => {
  const avcC = Uint8Array.of(1, 0x64, 0, 0x2a, 0xff, 0xe1, 0, 2, 0x67, 0x64, 1, 0, 1, 0x68);
  const aacDur = Math.round((1024 * 1e6) / 48000);
  const aac: AudioTrack = { codec: 'aac', sampleRate: 48000, channels: 2, description: aacConfig(48000, 2), frames: Array.from({ length: 141 }, (_, i) => ({ data: new Uint8Array(9).fill(0xa0 + (i % 5)), timestampUs: Math.round((i * 1024 * 1e6) / 48000), durationUs: aacDur })) }; // 3.008 s
  const bytes = muxMp4({ width: 960, height: 720, avcC, frames: video.map((f) => ({ ...f, data: new Uint8Array(10).fill(f.data[0]) })), audio: aac });
  const u32At = (at: number) => bytes[at] * 2 ** 24 + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
  const boxes = (from: number, to: number) => {
    const out: { type: string; start: number; end: number }[] = [];
    for (let at = from; at < to; ) { const size = u32At(at); out.push({ type: String.fromCharCode(...bytes.slice(at + 4, at + 8)), start: at + 8, end: at + size }); at += size; }
    return out;
  };
  const top = boxes(0, bytes.length);
  const moov = top.find((b) => b.type === 'moov')!;
  const traks = boxes(moov.start, moov.end).filter((b) => b.type === 'trak');
  const sub = (b: { start: number; end: number }, name: string) => boxes(b.start, b.end).find((x) => x.type === name)!;
  const stbl = (t: { start: number; end: number }) => sub(sub(sub(t, 'mdia'), 'minf'), 'stbl');

  it('has a video and a sound track and the file is still ftyp, moov, mdat', () => {
    expect(top.map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
    expect(traks).toHaveLength(2);
    const handler = (t: { start: number; end: number }) => { const h = sub(sub(t, 'mdia'), 'hdlr'); return String.fromCharCode(...bytes.slice(h.start + 8, h.start + 12)); };
    expect(traks.map(handler)).toEqual(['vide', 'soun']);
  });

  it('describes the sound track: mp4a with the AudioSpecificConfig, sample count, sizes, duration', () => {
    const mdhd = sub(sub(traks[1], 'mdia'), 'mdhd');
    expect(u32At(mdhd.start + 12)).toBe(48000);
    expect(u32At(mdhd.start + 16)).toBe(141 * 1024);
    const st = stbl(traks[1]);
    const stsd = sub(st, 'stsd');
    const mp4a = boxes(stsd.start + 8, stsd.end)[0];
    expect(mp4a.type).toBe('mp4a');
    expect(Array.from(bytes.slice(mp4a.start, mp4a.end)).join(',')).toContain([0x05, 0x80, 0x80, 0x80, 2, ...aacConfig(48000, 2)].join(','));
    const stsz = sub(st, 'stsz');
    expect([u32At(stsz.start + 8), u32At(stsz.start + 12)]).toEqual([141, 9]);
    const stts = sub(st, 'stts');
    expect([u32At(stts.start + 4), u32At(stts.start + 8), u32At(stts.start + 12)]).toEqual([1, 141, 1024]);
  });

  it('points the audio chunk after the video bytes in mdat, and the movie lasts as long as the longer track', () => {
    const mdat = top.find((b) => b.type === 'mdat')!;
    const off = u32At(sub(stbl(traks[1]), 'stco').start + 8);
    expect(off).toBe(mdat.start + 30);
    expect(bytes[off]).toBe(0xa0);
    expect(off + 141 * 9).toBe(mdat.end);
    expect(u32At(sub(stbl(traks[0]), 'stco').start + 8)).toBe(mdat.start);
    const mvhd = sub(moov, 'mvhd');
    expect([u32At(mvhd.start + 12), u32At(mvhd.start + 16)]).toEqual([1000, 3008]);
  });

  it('is the plain video file without audio', () => {
    const plain = muxMp4({ width: 2, height: 2, avcC, frames: video });
    const m = (() => { const t: { type: string }[] = []; for (let at = 0; at < plain.length; ) { const sz = plain[at] * 2 ** 24 + (plain[at + 1] << 16) + (plain[at + 2] << 8) + plain[at + 3]; t.push({ type: String.fromCharCode(...plain.slice(at + 4, at + 8)) }); at += sz; } return t; })();
    expect(m.map((x) => x.type)).toEqual(['ftyp', 'moov', 'mdat']);
  });
});
