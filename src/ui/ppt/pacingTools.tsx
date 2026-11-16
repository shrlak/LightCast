// Presenter view › 설교 시간: a target-time countdown with optional checkpoints, a pace indicator and a silent
// visual flash at 5 and 1 minute left. Settings are remembered per presentation. The same numbers go to phones and the
// stage display as a small `timer` message (see ../pacingFeed).
import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_TARGET_MIN, defaultPacing, flashMark, formatSpan, pacingKey, pacingView, parsePacing, paceText, pauseClock, resetClock, startClock,
  timerDue, timerMessage, timerOffMessage, idleClock, type PacingClock, type PacingSettings,
} from '../../domain/pacing';
import { openLiveChannel } from '../../domain/sync';
import { useNow } from '../hooks';

const LAST_TARGET = 'lightcast.pacing.lastTarget';
const lastTarget = (): number => { try { const n = Number(localStorage.getItem(LAST_TARGET)); return n >= 1 ? n : DEFAULT_TARGET_MIN; } catch { return DEFAULT_TARGET_MIN; } };

function load(id: string | null): PacingSettings {
  if (!id) return defaultPacing(lastTarget());
  try { return parsePacing(JSON.parse(localStorage.getItem(pacingKey(id)) ?? 'null'), lastTarget()); } catch { return defaultPacing(lastTarget()); }
}
function save(id: string | null, s: PacingSettings) {
  if (!id) return;
  try { localStorage.setItem(pacingKey(id), JSON.stringify(s)); localStorage.setItem(LAST_TARGET, String(s.targetMin)); } catch { /* kept for this session only */ }
}

let channel: ReturnType<typeof openLiveChannel> | null = null;
const send = (m: ReturnType<typeof timerMessage> | ReturnType<typeof timerOffMessage>) => { try { (channel ??= openLiveChannel(() => undefined)).post(m); } catch { /* nobody listening */ } };

/** Slide number the speaker is on (1-based) and the number of slides, for the pace. */
export function PacingBar({ presentationId, slideIndex, total }: { presentationId: string | null; slideIndex: number | null; total: number }) {
  const now = useNow(500);
  const [settings, setSettings] = useState<PacingSettings>(() => load(presentationId));
  const [clock, setClock] = useState<PacingClock>(idleClock);
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const idRef = useRef(presentationId);
  useEffect(() => { if (idRef.current !== presentationId) { idRef.current = presentationId; setSettings(load(presentationId)); } }, [presentationId]);

  const change = (next: PacingSettings) => { setSettings(next); save(presentationId, next); };
  const view = pacingView(clock, settings, now, slideIndex, total);

  // Flash once when the 5- or 1-minute mark is crossed (no sound, no vibration).
  const prevRemaining = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevRemaining.current;
    prevRemaining.current = view.running ? view.remainingMs : null;
    if (!settings.flash || prev === null || !view.running) return undefined;
    const mark = flashMark(prev, view.remainingMs, view.targetMs);
    if (mark === null) return undefined;
    setFlash(mark);
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [view.remainingMs, view.running, view.targetMs, settings.flash]);

  // Phones and the stage display: when something changed, else a slow heartbeat.
  const sent = useRef<{ at: number; running: boolean; target: number; pace: string | undefined; started: boolean }>({ at: 0, running: false, target: 0, pace: undefined, started: false });
  useEffect(() => {
    const started = clock.running || clock.accumulatedMs > 0;
    if (!started) { if (sent.current.started) { sent.current = { ...sent.current, started: false, at: 0 }; send(timerOffMessage()); } return; }
    const s = sent.current;
    const changed = !s.started || s.running !== view.running || s.target !== view.targetMs || s.pace !== view.pace?.kind;
    if (!timerDue(s.at, now, changed)) return;
    sent.current = { at: now, running: view.running, target: view.targetMs, pace: view.pace?.kind, started: true };
    send(timerMessage(view));
  }, [now, view, clock]);
  useEffect(() => () => { if (sent.current.started) send(timerOffMessage()); }, []);

  const started = clock.running || clock.accumulatedMs > 0;
  const over = view.remainingMs < 0;
  return (
    <span className={`pacing-bar pacing-${started ? view.zone : 'idle'} ${flash !== null ? 'pacing-flash' : ''}`} role="timer">
      {started ? (
        <>
          <span className="pacing-main" title={`경과 ${formatSpan(view.elapsedMs)} · 목표 ${settings.targetMin}분`}>
            <small>{over ? '초과' : '남은 시간'}</small> <strong>{formatSpan(Math.abs(view.remainingMs))}</strong>
          </span>
          <span className="pacing-elapsed">경과 {formatSpan(view.elapsedMs)} / {settings.targetMin}분</span>
          {view.pace && <em className={`pacing-pace pacing-pace-${view.pace.kind}`}>{paceText(view.pace)}</em>}
          {flash !== null && <span className="pacing-alert" role="status">{flash >= 300_000 ? '5분 남았습니다' : '1분 남았습니다'}</span>}
        </>
      ) : <span className="pacing-main"><small>설교 시간</small> <strong>{settings.targetMin}:00</strong></span>}
      <button type="button" className={clock.running ? 'on' : ''} onClick={() => setClock(clock.running ? pauseClock(clock, Date.now()) : startClock(clock, Date.now()))}>{clock.running ? '⏸ 일시정지' : started ? '▶ 계속' : '▶ 시작'}</button>
      {started && <button type="button" onClick={() => { setClock(resetClock()); setFlash(null); }}>↺</button>}
      <button type="button" className={open ? 'on' : ''} aria-expanded={open} title="목표 시간과 중간 점검 설정" onClick={() => setOpen(!open)}>⚙</button>
      {open && <PacingSettingsPanel settings={settings} onChange={change} slideNumber={slideIndex === null ? null : slideIndex + 1} total={total} onClose={() => setOpen(false)} />}
    </span>
  );
}

function PacingSettingsPanel({ settings, onChange, slideNumber, total, onClose }: { settings: PacingSettings; onChange: (s: PacingSettings) => void; slideNumber: number | null; total: number; onClose: () => void }) {
  const [draft, setDraft] = useState({ slide: '', min: '' });
  const add = (slide: number, min: number) => {
    if (!Number.isFinite(slide) || !Number.isFinite(min)) return;
    const others = settings.checkpoints.filter((c) => c.slide !== Math.round(slide));
    onChange(parsePacing({ ...settings, checkpoints: [...others, { slide, min }] }));
    setDraft({ slide: '', min: '' });
  };
  return (
    <div className="pacing-panel" role="dialog" aria-label="설교 시간 설정">
      <label>목표 시간 <input type="number" min={1} max={600} value={settings.targetMin} onChange={(e) => onChange(parsePacing({ ...settings, targetMin: Number(e.target.value) || DEFAULT_TARGET_MIN }))} /> 분</label>
      <label className="check small"><input type="checkbox" checked={settings.flash} onChange={(e) => onChange({ ...settings, flash: e.target.checked })} /> 5분·1분 남았을 때 화면 깜박임</label>
      <div className="pacing-cps">
        <strong>중간 점검 <span className="muted small">(슬라이드에 도착해야 하는 시각)</span></strong>
        {settings.checkpoints.length === 0 && <p className="muted small">없음 — 슬라이드 수에 맞춰 일정하게 나눈 속도로 비교합니다{total ? ` (전체 ${total}장)` : ''}.</p>}
        {settings.checkpoints.map((c) => (
          <div key={c.slide} className="pacing-cp">
            <span>슬라이드 {c.slide}</span><span>{c.min}분</span>
            <button type="button" aria-label={`슬라이드 ${c.slide} 점검 삭제`} onClick={() => onChange({ ...settings, checkpoints: settings.checkpoints.filter((x) => x !== c) })}>✕</button>
          </div>
        ))}
        <div className="pacing-cp">
          <input type="number" min={2} placeholder="슬라이드" aria-label="슬라이드 번호" value={draft.slide} onChange={(e) => setDraft({ ...draft, slide: e.target.value })} />
          <input type="number" min={0} step={0.5} placeholder="분" aria-label="도착 시각(분)" value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value })} />
          <button type="button" disabled={draft.slide === '' || draft.min === ''} onClick={() => add(Number(draft.slide), Number(draft.min))}>추가</button>
        </div>
        {slideNumber !== null && slideNumber > 1 && <button type="button" onClick={() => setDraft({ slide: String(slideNumber), min: draft.min })}>현재 슬라이드({slideNumber}) 번호 넣기</button>}
      </div>
      <button type="button" className="primary" onClick={onClose}>닫기</button>
    </div>
  );
}
