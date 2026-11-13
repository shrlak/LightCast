// 동영상 만들기, the fast way: slides are drawn on a canvas and handed straight to a WebCodecs VideoEncoder, so a ten-minute
// show is made in seconds instead of ten minutes. The frames are muxed by domain/videoMux. Where the browser has no
// VideoEncoder (or cannot encode anything we can mux) `fastVideoCodec` is null and the caller records in real time.
import { muxMp4, muxWebm, pickFastCodec, planFrames, type EncodedFrame, type FastCodec } from '../domain/videoMux';

const hasEncoder = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

/** The codec the fast way would use at this size, or null when it is not available here. */
export async function fastVideoCodec(width: number, height: number): Promise<FastCodec | null> {
  if (!hasEncoder) return null;
  return pickFastCodec(async (c) => !!(await VideoEncoder.isConfigSupported({ ...c, ...(c.codec.startsWith('avc1') ? { avc: { format: 'avc' as const } } : {}) })).supported, width, height);
}

export interface FastVideoOptions {
  /** One picture per slide, already drawn at the video size. */
  bitmaps: ImageBitmap[];
  /** Seconds each slide is shown. */
  seconds: number[];
  width: number;
  height: number;
  codec: FastCodec;
  bitrate: number;
  /** Frames done so far / frames in all. */
  onProgress: (done: number, total: number) => void;
  isCancelled: () => boolean;
}

/** The finished file, or null when it was cancelled. Throws with a readable message when the encoder fails. */
export async function exportFastVideo(o: FastVideoOptions): Promise<Blob | null> {
  const plan = planFrames(o.seconds);
  const frames: EncodedFrame[] = [];
  let avcC: Uint8Array | undefined;
  let failure: Error | null = null;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const desc = meta?.decoderConfig?.description;
      if (desc && !avcC) avcC = new Uint8Array(desc instanceof ArrayBuffer ? desc : (desc as ArrayBufferView).buffer.slice((desc as ArrayBufferView).byteOffset, (desc as ArrayBufferView).byteOffset + (desc as ArrayBufferView).byteLength));
      frames.push({ data, timestampUs: chunk.timestamp, durationUs: chunk.duration ?? 0, key: chunk.type === 'key' });
    },
    error: (e) => { failure = e instanceof Error ? e : new Error(String(e)); },
  });
  try {
    encoder.configure({
      codec: o.codec.codec, width: o.width, height: o.height, bitrate: o.bitrate, framerate: 30, latencyMode: 'quality',
      ...(o.codec.id === 'avc' ? { avc: { format: 'avc' as const } } : {}),
    });
    const canvas = document.createElement('canvas');
    canvas.width = o.width; canvas.height = o.height;
    const ctx = canvas.getContext('2d')!;
    let shown = -1;
    for (let i = 0; i < plan.length; i++) {
      if (o.isCancelled()) return null;
      if (failure) throw failure;
      const f = plan[i];
      if (f.slide !== shown) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, o.width, o.height);
        ctx.drawImage(o.bitmaps[f.slide], 0, 0, o.width, o.height);
        shown = f.slide;
      }
      const frame = new VideoFrame(canvas, { timestamp: f.tUs, duration: f.durUs });
      encoder.encode(frame, { keyFrame: f.key });
      frame.close();
      // Do not let the encoder's queue grow without bound; this also lets the cancel button be heard.
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
      if (i % 8 === 0) { o.onProgress(i + 1, plan.length); await new Promise((r) => setTimeout(r, 0)); }
    }
    await encoder.flush();
    if (o.isCancelled()) return null;
    if (failure) throw failure;
    o.onProgress(plan.length, plan.length);
  } finally {
    try { encoder.close(); } catch { /* already closed */ }
  }
  if (!frames.length) throw new Error('인코더가 프레임을 만들지 못했습니다.');
  frames.sort((a, b) => a.timestampUs - b.timestampUs);
  if (o.codec.container === 'mp4') {
    if (!avcC) throw new Error('H.264 인코더가 설정 정보를 주지 않았습니다.');
    return new Blob([muxMp4({ width: o.width, height: o.height, avcC, frames }) as BlobPart], { type: o.codec.mime });
  }
  return new Blob([muxWebm({ width: o.width, height: o.height, codecId: o.codec.webmId!, frames }) as BlobPart], { type: o.codec.mime });
}
