// File › Export › 동영상 만들기 / 애니메이션 GIF / 개요 내보내기. Slides are drawn with slideToImage (the same
// picture the PNG export makes). The video is recorded in real time with canvas.captureStream + MediaRecorder
// (MP4 where Chromium can write it, else WebM) and carries the deck's recorded narration track when it has one.
import { useState } from 'react';
import { encodeGif } from '../../domain/gifEncoder';
import { buildOutline, outlineToRtf, outlineToText } from '../../domain/outlineExport';
import { DEFAULT_SECONDS, GIF_SIZES, VIDEO_SIZES, clampSeconds, gifDelayCs, pickVideoType, slideDurations } from '../../domain/videoExport';
import { printPages } from '../../domain/filePrint';
import { mediaUrl } from '../../domain/media';
import { slideToImage } from '../slideImage';
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
  if (!p || !ed.theme) return null;
  const theme = ed.theme;
  const pages = printPages(p, { range: '', includeHidden: false }).pages;
  const hasAudio = !!p.timeline?.audioMediaId;
  const fail = (e: unknown) => setMsg(e instanceof Error ? e.message : String(e));

  const makeVideo = async () => {
    setMsg(null);
    if (!videoType) { setMsg('이 컴퓨터에서는 동영상을 만들 수 없습니다 (MediaRecorder 미지원).'); return; }
    let audioEl: HTMLAudioElement | null = null, actx: AudioContext | null = null;
    try {
      const size = VIDEO_SIZES.find((s) => s.id === vSize)!;
      const secs = slideDurations(p, pages.map((x) => x.slide), vSecs, vSaved);
      const bitmaps: ImageBitmap[] = [];
      for (let i = 0; i < pages.length; i++) {
        setBusy(`${i + 1} / ${pages.length} 그리는 중…`);
        bitmaps.push(await toBitmap(await slideToImage(p, pages[i].slide, slideTheme(theme, pages[i].slide), size.width, 'png')));
      }
      const canvas = document.createElement('canvas');
      canvas.width = size.width; canvas.height = size.height;
      const ctx = canvas.getContext('2d')!;
      const draw = (i: number) => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size.width, size.height); ctx.drawImage(bitmaps[i], 0, 0, size.width, size.height); };
      draw(0);
      const stream = canvas.captureStream(30);
      let narrated = false;
      if (vAudio && p.timeline?.audioMediaId) {
        const url = await mediaUrl(p.timeline.audioMediaId);
        if (url) {
          audioEl = new Audio(url);
          actx = new AudioContext();
          const dest = actx.createMediaStreamDestination();
          actx.createMediaElementSource(audioEl).connect(dest);
          dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
          narrated = true;
        }
      }
      const rec = new MediaRecorder(stream, { mimeType: videoType.mime, videoBitsPerSecond: size.width >= 1440 ? 8_000_000 : 4_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise<void>((res) => { rec.onstop = () => res(); });
      rec.start(500);
      if (audioEl) void audioEl.play().catch(() => undefined);
      const total = secs.reduce((a, b) => a + b, 0);
      let elapsed = 0;
      for (let i = 0; i < bitmaps.length; i++) {
        draw(i);
        // Redraw while waiting so the stream keeps producing frames.
        const end = elapsed + secs[i];
        const t0 = performance.now();
        while ((performance.now() - t0) / 1000 < secs[i]) {
          setBusy(`녹화 중… ${Math.min(total, Math.round(elapsed + (performance.now() - t0) / 1000))} / ${Math.round(total)}초`);
          draw(i);
          await sleep(100);
        }
        elapsed = end;
      }
      rec.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());
      save(`${baseName(p.title)}.${videoType.ext}`, new Blob(chunks, { type: videoType.mime.split(';')[0] }));
      setMsg(`${videoType.label} 동영상을 저장했습니다 (${bitmaps.length}장, ${Math.round(total)}초${narrated ? ', 녹음된 내레이션 포함' : ''}).`);
    } catch (e) {
      fail(e);
    } finally {
      audioEl?.pause();
      void actx?.close();
      setBusy(null);
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
        <p className="bs-note">{videoType ? `${videoType.label} 형식으로 저장합니다${videoType.ext === 'webm' ? ' (이 컴퓨터에서는 MP4를 만들 수 없어 WebM으로 저장합니다)' : ''}. 만드는 데 동영상 길이만큼 걸립니다.` : '이 컴퓨터에서는 동영상을 만들 수 없습니다.'}</p>
        <button type="button" className="bs-print-go primary" disabled={none || !!busy || !videoType} onClick={() => void makeVideo()}>동영상 만들기</button>
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
