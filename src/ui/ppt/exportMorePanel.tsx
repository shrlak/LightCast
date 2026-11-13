// File › Export › 동영상 만들기 / 애니메이션 GIF / 개요 내보내기. Slides are drawn with slideToImage (the same
// picture the PNG export makes). The video is made the fast way when the browser has WebCodecs (VideoEncoder + our own
// MP4 / WebM muxer, many times faster than real time), narration included (decoded, mixed to one track aligned to the
// slides, encoded with AudioEncoder: AAC in MP4, Opus in WebM); otherwise, and when there is no AudioEncoder for the
// narration, it is recorded in real time with canvas.captureStream + MediaRecorder (MP4 where Chromium can write it, else WebM).
import { useEffect, useRef, useState } from 'react';
import { encodeGif } from '../../domain/gifEncoder';
import { buildOutline, outlineToRtf, outlineToText } from '../../domain/outlineExport';
import { DEFAULT_SECONDS, GIF_SIZES, VIDEO_SIZES, clampSeconds, gifDelayCs, pickVideoType, slideDurations } from '../../domain/videoExport';
import { printPages } from '../../domain/filePrint';
import { hasNarrationAudio, type FastAudioCodec } from '../../domain/narrationMix';
import { buildNarrationMix, encodeNarration, fastAudioCodec, type NarrationMix } from '../narrationAudio';
import { slideToImage } from '../slideImage';
import { exportFastVideo, fastVideoCodec } from '../fastVideoExport';
import type { FastCodec } from '../../domain/videoMux';
import { slideTheme } from '../SlideCanvas';
import { Check } from './dialogs';
import type { Ed } from './editor';

function save(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const baseName = (t: string) => t.replace(/[\\/:*?"<>|\s]+/g, ' ').trim() || 'slides';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function toBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

const canRecord = typeof MediaRecorder !== 'undefined';
const videoType = canRecord ? pickVideoType((m) => MediaRecorder.isTypeSupported(m)) : null;

export function ExportMorePanel({ ed }: { ed: Ed }) {
  const p = ed.p;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [vSize, setVSize] = useState<(typeof VIDEO_SIZES)[number]['id']>('hd720');
  const [vSecs, setVSecs] = useState(DEFAULT_SECONDS);
  const [vSaved, setVSaved] = useState(true);
  const [vAudio, setVAudio] = useState(true);
  const [gSize, setGSize] = useState('medium');
  const [gSecs, setGSecs] = useState(2);
  const [gSaved, setGSaved] = useState(false);
  const [oNotes, setONotes] = useState(false);
  const [oHidden, setOHidden] = useState(false);
  const [fastCodec, setFastCodec] = useState<FastCodec | null>(null);
  const [audioCodec, setAudioCodec] = useState<FastAudioCodec | null>(null);
  const [vFast, setVFast] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [videoRunning, setVideoRunning] = useState(false);
  const cancelled = useRef(false);
  const vDims = VIDEO_SIZES.find((x) => x.id === vSize)!;
  useEffect(() => {
    let live = true;
    setFastCodec(null);
    fastVideoCodec(vDims.width, vDims.height).then((c) => { if (live) setFastCodec(c); }).catch(() => undefined);
    return () => { live = false; };
  }, [vDims.width, vDims.height]);
  useEffect(() => {
    let live = true;
    setAudioCodec(null);
    if (fastCodec) fastAudioCodec(fastCodec.container).then((c) => { if (live) setAudioCodec(c); }).catch(() => undefined);
    return () => { live = false; };
  }, [fastCodec]);
  if (!p || !ed.theme) return null;
  const theme = ed.theme;
  const pages = printPages(p, { range: '', includeHidden: false }).pages;
  const hasAudio = hasNarrationAudio(p);
  const fail = (e: unknown) => setMsg(e instanceof Error ? e.message : String(e));

  const makeVideo = async () => {
    setMsg(null);
    const withAudio = vAudio && hasAudio;
    // The fast way carries the narration when the browser can encode it (AudioEncoder); else the video is recorded in real time.
    const fast = vFast && !!fastCodec && (!withAudio || !!audioCodec) ? fastCodec : null;
    if (!videoType && !fast) { setMsg('이 컴퓨터에서는 동영상을 만들 수 없습니다 (MediaRecorder 미지원).'); return; }
    cancelled.current = false;
    setProgress(null);
    setVideoRunning(true);
    let audioSrc: AudioBufferSourceNode | null = null, actx: AudioContext | null = null;
    try {
      const size = VIDEO_SIZES.find((s) => s.id === vSize)!;
      const secs = slideDurations(p, pages.map((x) => x.slide), vSecs, vSaved);
      const bitmaps: ImageBitmap[] = [];
      for (let i = 0; i < pages.length; i++) {
        if (cancelled.current) { setMsg('동영상 만들기를 취소했습니다.'); return; }
        setBusy(`${i + 1} / ${pages.length} 그리는 중…`);
        bitmaps.push(await toBitmap(await slideToImage(p, pages[i].slide, slideTheme(theme, pages[i].slide), size.width, 'png')));
      }
      // The narration, mixed to one track aligned to each slide's start (both ways use it).
      let mix: NarrationMix | null = null;
      if (withAudio) {
        setBusy('내레이션을 준비하는 중…');
        mix = await buildNarrationMix(p, pages.map((x) => x.slide), secs);
      }
      if (fast) {
        try {
          const started = performance.now();
          setBusy('빠르게 만드는 중…');
          const audio = mix && audioCodec ? await encodeNarration(mix, audioCodec, () => cancelled.current) : null;
          if (cancelled.current) { setMsg('동영상 만들기를 취소했습니다. 파일은 저장하지 않았습니다.'); return; }
          const blob = await exportFastVideo({
            bitmaps, seconds: secs, width: size.width, height: size.height, codec: fast, audio, bitrate: size.width >= 1440 ? 6_000_000 : 3_000_000,
            onProgress: (done, total) => { setProgress({ done, total }); setBusy(`빠르게 만드는 중… ${Math.round((done / total) * 100)}%`); },
            isCancelled: () => cancelled.current,
          });
          if (!blob) { setMsg('동영상 만들기를 취소했습니다. 파일은 저장하지 않았습니다.'); return; }
          bitmaps.forEach((b) => b.close());
          const total = secs.reduce((a, b) => a + b, 0);
          save(`${baseName(p.title)}.${fast.ext}`, blob);
          setMsg(`${fast.label} 동영상을 저장했습니다 (${bitmaps.length}장, ${Math.round(total)}초 분량을 ${Math.max(1, Math.round((performance.now() - started) / 1000))}초 만에 만들었습니다${audio ? ', 녹음된 내레이션 포함' : ''}).`);
          return;
        } catch (e) {
          // The narration could not be encoded here: record in real time instead (the pictures are still drawn).
          if (!withAudio || !videoType) throw e;
          setProgress(null);
        }
      }
      if (!videoType) return;
      const canvas = document.createElement('canvas');
      canvas.width = size.width; canvas.height = size.height;
      const ctx = canvas.getContext('2d')!;
      const draw = (i: number) => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size.width, size.height); ctx.drawImage(bitmaps[i], 0, 0, size.width, size.height); };
      draw(0);
      const stream = canvas.captureStream(30);
      let narrated = false;
      if (mix) {
        actx = new AudioContext();
        const buf = actx.createBuffer(mix.channels.length, mix.channels[0].length, mix.sampleRate);
        mix.channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
        audioSrc = actx.createBufferSource();
        audioSrc.buffer = buf;
        const dest = actx.createMediaStreamDestination();
        audioSrc.connect(dest);
        dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
        narrated = true;
      }
      const rec = new MediaRecorder(stream, { mimeType: videoType.mime, videoBitsPerSecond: size.width >= 1440 ? 8_000_000 : 4_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise<void>((res) => { rec.onstop = () => res(); });
      rec.start(500);
      audioSrc?.start();
      const total = secs.reduce((a, b) => a + b, 0);
      let elapsed = 0;
      for (let i = 0; i < bitmaps.length; i++) {
        draw(i);
        // Redraw while waiting so the stream keeps producing frames.
        const end = elapsed + secs[i];
        const t0 = performance.now();
        while ((performance.now() - t0) / 1000 < secs[i]) {
          if (cancelled.current) break;
          setProgress({ done: Math.round(elapsed + (performance.now() - t0) / 1000), total: Math.round(total) });
          setBusy(`녹화 중… ${Math.min(total, Math.round(elapsed + (performance.now() - t0) / 1000))} / ${Math.round(total)}초`);
          draw(i);
          await sleep(100);
        }
        elapsed = end;
        if (cancelled.current) break;
      }
      rec.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());
      if (cancelled.current) { setMsg('동영상 만들기를 취소했습니다. 파일은 저장하지 않았습니다.'); return; }
      save(`${baseName(p.title)}.${videoType.ext}`, new Blob(chunks, { type: videoType.mime.split(';')[0] }));
      setMsg(`${videoType.label} 동영상을 저장했습니다 (${bitmaps.length}장, ${Math.round(total)}초${narrated ? ', 녹음된 내레이션 포함' : ''}).`);
    } catch (e) {
      fail(e);
    } finally {
      try { audioSrc?.stop(); } catch { /* not started */ }
      void actx?.close();
      setBusy(null);
      setProgress(null);
      setVideoRunning(false);
    }
  };

  const makeGif = async () => {
    setMsg(null);
    try {
      const w = GIF_SIZES.find((s) => s.id === gSize)!.width, h = Math.round((w * 3) / 4);
      const secs = slideDurations(p, pages.map((x) => x.slide), gSecs, gSaved);
      const frames: { data: Uint8ClampedArray; delayCs: number }[] = [];
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      for (let i = 0; i < pages.length; i++) {
        setBusy(`${i + 1} / ${pages.length} 그리는 중…`);
        const bmp = await toBitmap(await slideToImage(p, pages[i].slide, slideTheme(theme, pages[i].slide), w, 'png'));
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bmp, 0, 0, w, h);
        frames.push({ data: ctx.getImageData(0, 0, w, h).data, delayCs: gifDelayCs(secs[i]) });
      }
      setBusy('GIF로 만드는 중…');
      await sleep(30);
      const bytes = encodeGif(frames, { width: w, height: h });
      save(`${baseName(p.title)}.gif`, new Blob([bytes as BlobPart], { type: 'image/gif' }));
      setMsg(`애니메이션 GIF를 저장했습니다 (${frames.length}장).`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const makeOutline = (kind: 'rtf' | 'txt') => {
    setMsg(null);
    try {
      const outline = buildOutline(p, { notes: oNotes, includeHidden: oHidden });
      if (kind === 'rtf') save(`${baseName(p.title)}.rtf`, new Blob([outlineToRtf(outline)], { type: 'application/rtf' }));
      else save(`${baseName(p.title)}.txt`, new Blob(['﻿', outlineToText(outline)], { type: 'text/plain;charset=utf-8' }));
      setMsg(`개요를 저장했습니다 (슬라이드 ${outline.length}장).`);
    } catch (e) {
      fail(e);
    }
  };

  const none = pages.length === 0;
  const withAudioNow = vAudio && hasAudio;
  const fastOn = vFast && !!fastCodec && (!withAudioNow || !!audioCodec);
  const fastNote = fastOn
    ? `${fastCodec!.label} 형식으로 빠르게 만듭니다${withAudioNow ? ` (녹음된 내레이션은 ${audioCodec!.id === 'aac' ? 'AAC' : 'Opus'} 소리로 함께 넣습니다)` : ''} (동영상 길이보다 훨씬 짧게 걸립니다).`
    : videoType
      ? `${videoType.label} 형식으로 저장합니다${videoType.ext === 'webm' ? ' (이 컴퓨터에서는 MP4를 만들 수 없어 WebM으로 저장합니다)' : ''}. 만드는 데 동영상 길이만큼 걸립니다${withAudioNow && fastCodec && !audioCodec ? ' (이 컴퓨터에서는 내레이션 소리를 빠르게 만들 수 없어 실시간으로 녹화합니다)' : ''}.`
      : '이 컴퓨터에서는 동영상을 만들 수 없습니다.';
  return (
    <div className="bs-export bs-export-more">
      <h2>동영상 만들기</h2>
      <div className="bs-print-opts">
        <label className="bs-opt"><span>해상도</span>
          <select value={vSize} onChange={(e) => setVSize(e.target.value as typeof vSize)}>{VIDEO_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </label>
        <Check label="저장된 타이밍 사용" checked={vSaved} onChange={setVSaved} />
        <label className="bs-opt"><span>타이밍이 없는 슬라이드의 시간(초)</span>
          <input type="number" min={0.5} step={0.5} value={vSecs} onChange={(e) => setVSecs(clampSeconds(Number(e.target.value)))} />
        </label>
        <Check label={hasAudio ? '녹음된 내레이션 포함' : '녹음된 내레이션 포함 (녹음 없음)'} checked={vAudio && hasAudio} disabled={!hasAudio} onChange={setVAudio} />
        <Check label={fastCodec ? '빠르게 만들기 (실시간보다 빠름)' : '빠르게 만들기 (이 컴퓨터에서는 사용할 수 없음)'} checked={vFast && !!fastCodec} disabled={!fastCodec} onChange={setVFast} />
        <p className="bs-note">{fastNote}</p>
        <div className="bs-video-go">
          <button type="button" className="bs-print-go primary" disabled={none || !!busy || (!videoType && !fastCodec)} onClick={() => void makeVideo()}>동영상 만들기</button>
          {videoRunning && <button type="button" className="bs-print-go bs-cancel" onClick={() => { cancelled.current = true; setBusy('취소하는 중…'); }}>취소</button>}
        </div>
        {progress && <progress className="bs-progress" max={progress.total} value={progress.done} aria-label="동영상 만드는 중" />}
      </div>
      <h2>애니메이션 GIF</h2>
      <div className="bs-print-opts">
        <label className="bs-opt"><span>크기</span>
          <select value={gSize} onChange={(e) => setGSize(e.target.value)}>{GIF_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </label>
        <label className="bs-opt"><span>슬라이드당 시간(초)</span>
          <input type="number" min={0.1} step={0.5} value={gSecs} onChange={(e) => setGSecs(clampSeconds(Number(e.target.value)))} />
        </label>
        <Check label="저장된 타이밍 사용" checked={gSaved} onChange={setGSaved} />
        <button type="button" className="bs-print-go primary" disabled={none || !!busy} onClick={() => void makeGif()}>애니메이션 GIF 저장</button>
      </div>
      <h2>개요 내보내기</h2>
      <div className="bs-print-opts">
        <Check label="슬라이드 노트 포함" checked={oNotes} onChange={setONotes} />
        <Check label="숨겨진 슬라이드 포함" checked={oHidden} onChange={setOHidden} />
        <button type="button" className="bs-print-go primary" disabled={!!busy} onClick={() => makeOutline('rtf')}>서식 있는 텍스트 개요 (.rtf)</button>
        <button type="button" className="bs-print-go" disabled={!!busy} onClick={() => makeOutline('txt')}>일반 텍스트 개요 (.txt)</button>
      </div>
      {busy && <p className="bs-note" role="status">{busy}</p>}
      {msg && <p className="bs-note" role="status">{msg}</p>}
    </div>
  );
}
