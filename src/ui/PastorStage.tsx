import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { Cursor } from '../domain/live';
import type { LiveState } from '../domain/types';
import type { RemoteInfo, RemoteSlide } from '../domain/remoteSlides';
import { remoteSlideKey } from '../domain/remoteSlides';
import { formatClock, timerValue } from '../domain/timers';
import { hasChords, stripChords } from '../domain/lyrics';
import { liveChordShower, shiftKey } from '../domain/chordChart';
import { detectRefs, refsInSlides } from '../domain/bible/detect';
import { slideStageText } from '../domain/stageText';
import { SlideCanvas } from './SlideCanvas';
import { liveCanvasProps } from './liveProps';
import { StageChords } from './StageChords';
import { useNow } from './hooks';
import { useSpeechRefs } from './useSpeechRefs';
import { loadPastorOptions, savePastorOptions, type PastorOptions } from '../domain/pastorOptions';

interface Props {
  live: LiveState | null;
  info: RemoteInfo | null;
  /** The slide on screen (the running order's position), when the computer says. */
  current: Cursor | null | undefined;
  canControl: boolean;
  ready: boolean;
  connectionLabel: string;
  controllerName?: string;
  requested: boolean;
  rehearsal: boolean;
  cmd: (command: Record<string, unknown>) => void;
  requestControl: () => void;
  /** Back to the ordinary phone remote. */
  onExit: () => void;
}

type DrawerName = 'slides' | 'bible' | 'options' | null;

/** Keeps the tablet awake while the stage is up (where the browser allows it). */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let alive = true;
    const acquire = async () => {
      try {
        const wake = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wake && !document.hidden) { const l = await wake.request('screen'); if (alive) lock = l; else void l.release(); }
      } catch { /* not allowed: the tablet may dim */ }
    };
    void acquire();
    const visible = () => { if (!document.hidden) void acquire(); };
    document.addEventListener('visibilitychange', visible);
    return () => { alive = false; document.removeEventListener('visibilitychange', visible); void lock?.release().catch(() => undefined); };
  }, []);
}

/**
 * The pastor's stage display for a tablet: the words big (with chords), what comes next, the notes, the clock
 * and timers — and the controls: next/previous, black, jump to any slide, key and capo, and call up a Bible
 * verse by typing it or just saying it. Runs inside the remote link, so it shares the remote's PIN and control rules.
 */
export function PastorStage({ live, info, current, canControl, ready, connectionLabel, controllerName, requested, rehearsal, cmd, requestControl, onExit }: Props) {
  const now = useNow(500);
  const [options, setOptions] = useState(loadPastorOptions);
  const [drawer, setDrawer] = useState<DrawerName>(null);
  useWakeLock();
  useEffect(() => { document.title = 'LightCast — 무대'; }, []);
  const set = (patch: Partial<PastorOptions>) => setOptions((o) => {
    const next = { ...o, ...patch };
    savePastorOptions(next);
    return next;
  });

  const slide = live?.slide ?? null;
  const text = useMemo(() => slideStageText(slide), [slide]);
  const show = useMemo(() => liveChordShower(live ?? {}), [live?.songKey, live?.chordShift, live?.capo]);
  const chorded = hasChords(text);
  const clock = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const timers = (live?.timers ?? []).filter((t) => t.running || t.kind === 'countdownTo' || t.accumulatedMs > 0);
  const videoLeft = live?.video.endsAt ? live.video.endsAt - now : null;
  const can = ready && canControl;
  const shift = live?.chordShift ?? 0, capo = live?.capo ?? 0;
  const playKey = live?.songKey ? shiftKey(live.songKey, shift) : null;

  return (
    <div className="pastor-root" style={{ '--pastor-scale': options.scale } as React.CSSProperties}>
      <header className="pastor-top">
        {options.clock && <span className="pastor-clock">{clock}</span>}
        <span className="pastor-title truncate">{live?.title ?? '아직 시작 전'}{slide?.group ? ` · ${slide.group}` : ''}</span>
        {chorded && options.chords && playKey && (
          <span className="pastor-chip" title="연주 키 · 카포">Key {playKey}{capo ? ` · Capo ${capo}` : ''}</span>
        )}
        {videoLeft != null && videoLeft > 0 && <span className="pastor-chip">영상 {formatClock(-videoLeft)}</span>}
        {timers.slice(0, 3).map((t) => {
          const v = timerValue(t, now);
          return (
            <button key={t.id} className={`pastor-timer ${v < 0 && t.kind !== 'elapsed' ? 'over' : ''}`} disabled={!can} title={can ? (t.running ? '눌러서 멈춤' : '눌러서 시작') : ''}
              onClick={() => cmd({ type: 'timer/op', id: t.id, op: t.running ? 'stop' : 'start' })}>
              <small>{t.name}</small> {formatClock(v)}
            </button>
          );
        })}
        <span className={`pastor-conn ${ready ? 'on' : 'off'}`} role="status" aria-label={connectionLabel} title={connectionLabel}><span aria-hidden="true" /></span>
        <button className="pastor-small" onClick={() => setDrawer(drawer === 'options' ? null : 'options')} aria-label="화면 설정">⚙</button>
        <button className="pastor-small" onClick={onExit} title="폰 리모컨 화면으로">리모컨</button>
      </header>

      {!ready && <div className="pastor-banner" role="alert">{connectionLabel}</div>}
      {ready && !canControl && (
        <div className="pastor-banner view-only" role="status">
          보기 전용{controllerName ? ` · ${controllerName}이(가) 조작 중` : ''}
          <button disabled={requested} onClick={requestControl}>{requested ? '요청함' : '조작권 요청'}</button>
        </div>
      )}
      {rehearsal && <div className="pastor-banner">리허설 중 · 실제 송출은 바뀌지 않습니다</div>}

      <main className={`pastor-body ${options.preview || options.next || options.notes ? 'with-side' : ''}`}>
        {options.current && (
          <section className="pastor-current" aria-label="지금 화면" aria-live="polite">
            {text
              ? (options.chords && chorded ? <StageChords text={text} show={show} /> : <div className="pastor-plain">{stripChords(text)}</div>)
              : <span className="pastor-dim">{live?.black ? '검은 화면' : '—'}</span>}
          </section>
        )}
        {(options.preview || options.next || options.notes) && (
          <aside className="pastor-side">
            {options.preview && live && <div className="pastor-preview"><SlideCanvas {...liveCanvasProps(live)} animate={false} /></div>}
            {options.notes && <section className="pastor-note"><label>노트</label><div>{slide?.notes || <span className="pastor-dim">노트 없음</span>}</div></section>}
            {options.next && <section className="pastor-next"><label>다음</label><div>{live?.nextText ? stripChords(live.nextText.replace(/\*\*/g, '')) : <span className="pastor-dim">끝</span>}</div></section>}
          </aside>
        )}
      </main>

      {live?.stageMessage && <div className="pastor-message stage-only">🎤 {live.stageMessage}</div>}
      {live?.message && <div className="pastor-message">{live.message}</div>}

      <footer className="pastor-controls">
        <button className="pastor-nav" disabled={!can} aria-label="이전 슬라이드" onClick={() => cmd({ type: 'live/prev' })}>◀ 이전</button>
        <button className="pastor-nav primary" disabled={!can} aria-label="다음 슬라이드" onClick={() => cmd({ type: 'live/next' })}>다음 ▶</button>
        <button className={`pastor-tool ${live?.black ? 'on' : ''}`} disabled={!can} aria-pressed={live?.black ?? false} onClick={() => cmd({ type: 'live/toggleBlack' })}>{live?.black ? '화면 켜기' : '검은 화면'}</button>
        <button className={`pastor-tool ${drawer === 'slides' ? 'on' : ''}`} onClick={() => setDrawer(drawer === 'slides' ? null : 'slides')}>☰ 슬라이드</button>
        <button className={`pastor-tool ${drawer === 'bible' ? 'on' : ''}`} onClick={() => setDrawer(drawer === 'bible' ? null : 'bible')}>📖 성경</button>
        {chorded && (
          <span className="pastor-key" role="group" aria-label="키와 카포">
            <button disabled={!can} aria-label="키 반음 내리기" onClick={() => cmd({ type: 'live/chords', shift: Math.max(-11, shift - 1) })}>♭</button>
            <span>{playKey ?? (shift ? `${shift > 0 ? '+' : ''}${shift}` : '±0')}</span>
            <button disabled={!can} aria-label="키 반음 올리기" onClick={() => cmd({ type: 'live/chords', shift: Math.min(11, shift + 1) })}>♯</button>
            <button disabled={!can || capo <= 0} aria-label="카포 내리기" onClick={() => cmd({ type: 'live/chords', capo: capo - 1 })}>−</button>
            <span>카포 {capo}</span>
            <button disabled={!can || capo >= 11} aria-label="카포 올리기" onClick={() => cmd({ type: 'live/chords', capo: capo + 1 })}>＋</button>
          </span>
        )}
      </footer>

      {drawer === 'options' && <OptionsDrawer options={options} set={set} onClose={() => setDrawer(null)} />}
      {drawer === 'slides' && <SlidesDrawer info={info} current={current} live={live} can={can} cmd={cmd} onClose={() => setDrawer(null)} />}
      {drawer === 'bible' && <BibleDrawer info={info} can={can} cmd={cmd} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="pastor-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="pastor-drawer" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <header><h2>{title}</h2><button autoFocus aria-label="닫기" onClick={onClose}>✕</button></header>
        <div className="pastor-drawer-body">{children}</div>
      </section>
    </div>
  );
}

function OptionsDrawer({ options, set, onClose }: { options: PastorOptions; set: (p: Partial<PastorOptions>) => void; onClose: () => void }) {
  const flag = (key: keyof Omit<PastorOptions, 'scale'>, label: string) => (
    <label className="pastor-check"><input type="checkbox" checked={options[key]} onChange={(e) => set({ [key]: e.target.checked })} /> {label}</label>
  );
  return (
    <Drawer title="화면 설정" onClose={onClose}>
      <div className="pastor-scale" role="group" aria-label="글자 크기">
        <button aria-label="글자 작게" onClick={() => set({ scale: Math.max(0.6, +(options.scale - 0.1).toFixed(2)) })}>A−</button>
        <span>{Math.round(options.scale * 100)}%</span>
        <button aria-label="글자 크게" onClick={() => set({ scale: Math.min(2, +(options.scale + 0.1).toFixed(2)) })}>A＋</button>
      </div>
      {flag('current', '지금 가사 · 말씀')}
      {flag('chords', '코드 (찬양)')}
      {flag('next', '다음 슬라이드')}
      {flag('notes', '노트')}
      {flag('preview', '송출 화면 미리보기')}
      {flag('clock', '시계')}
      <p className="pastor-hint">설정은 이 태블릿에 저장됩니다.</p>
    </Drawer>
  );
}

function SlidesDrawer({ info, current, live, can, cmd, onClose }: { info: RemoteInfo | null; current: Cursor | null | undefined; live: LiveState | null; can: boolean; cmd: Props['cmd']; onClose: () => void }) {
  const all = info?.all ?? info?.upcoming ?? [];
  const isCurrent = (item: RemoteSlide) => current
    ? item.presentationId === current.presentationId && item.seq === current.seq && (item.playlistIndex === null || item.playlistIndex === (current.playlistIndex ?? null))
    : !!live?.slide && item.slide.id === live.slide.id;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const region = list.current, here = region?.querySelector<HTMLElement>('[aria-current="true"]');
    if (region && here) region.scrollTop = here.offsetTop - region.clientHeight / 3;
  }, []);
  return (
    <Drawer title={info?.name ? `슬라이드 · ${info.name}` : '슬라이드'} onClose={onClose}>
      <div className="pastor-slides" ref={list}>
        {all.map((u) => (
          <Fragment key={remoteSlideKey(u)}>
            {u.heading && <div className="pastor-section">{u.section ? `${u.section} · ` : ''}{u.title}</div>}
            <button className="pastor-slide" aria-current={isCurrent(u) ? 'true' : undefined} disabled={!can}
              aria-label={`${u.title} · 슬라이드 ${u.seq + 1}`}
              onClick={() => { cmd({ type: 'live/go', presentationId: u.presentationId, seq: u.seq, playlistIndex: u.playlistIndex }); onClose(); }}>
              <SlideCanvas slide={u.slide} theme={info!.themes[u.themeId]} background={u.background} bgEffect={u.bgEffect} />
              <span className="remote-slide-num">{u.seq + 1}</span>
              {isCurrent(u) && <span className="remote-slide-state">현재</span>}
            </button>
          </Fragment>
        ))}
        {!all.length && <p className="pastor-hint">컴퓨터에서 재생목록이나 프레젠테이션을 선택해 주세요.</p>}
      </div>
    </Drawer>
  );
}

/** Type a verse or say it: what is recognised appears as buttons; one tap puts the verse on the screen. */
function BibleDrawer({ info, can, cmd, onClose }: { info: RemoteInfo | null; can: boolean; cmd: Props['cmd']; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [heard, setHeard] = useState('');
  const [auto, setAuto] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const shown = useRef(new Map<string, number>());
  const speech = useSpeechRefs((recent, final) => {
    setHeard(recent);
    if (!auto || !final || !can) return;
    // Only a reference that was not put up a minute ago, and only the newest one said.
    const found = detectRefs(recent).at(-1);
    if (found && Date.now() - (shown.current.get(found.compact) ?? 0) > 60_000) send(found.compact, found.label, true);
  });
  const detected = useMemo(() => detectRefs(heard), [heard]);
  // The verses already written in this service's slides and notes (the sermon): one tap each.
  const written = useMemo(() => refsInSlides((info?.all ?? []).slice(0, 500).map((u) => u.slide)), [info]);

  function send(refs: string, label: string, live: boolean) {
    shown.current.set(refs, Date.now());
    cmd({ type: 'bible/show', refs, live });
    setSent(`${live ? '📖 띄움' : '준비함'} · ${label}`);
  }
  const submitTyped = () => {
    const found = detectRefs(typed);
    const first = found[0];
    if (first) send(found.map((d) => d.compact).join(' '), found.map((d) => d.label).join(', '), true);
    else if (typed.trim()) send(typed.trim(), typed.trim(), true);
  };

  return (
    <Drawer title="📖 성경 구절" onClose={onClose}>
      <form className="pastor-bible-form" onSubmit={(e) => { e.preventDefault(); submitTyped(); }}>
        <input value={typed} inputMode="text" enterKeyHint="go" placeholder="요한복음 3장 16절 · 요3:16 · John 3:16" aria-label="성경 구절" onChange={(e) => setTyped(e.target.value)} />
        <button className="primary" disabled={!can || !typed.trim()}>띄우기</button>
      </form>
      <div className="pastor-listen">
        <button className={speech.listening ? 'on' : ''} disabled={!speech.supported && !speech.listening} onClick={speech.listening ? speech.stop : speech.start}>{speech.listening ? '■ 듣는 중 — 누르면 멈춤' : '🎙 말로 찾기'}</button>
        <label className="pastor-check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> 인식하면 바로 띄우기</label>
        <button disabled={!heard} onClick={() => { speech.clear(); setHeard(''); setSent(null); }}>지우기</button>
      </div>
      {speech.error && <p className="pastor-warn">{speech.error}</p>}
      {!speech.supported && <p className="pastor-hint">이 브라우저는 음성 인식을 지원하지 않습니다. iPad는 Safari, 안드로이드는 Chrome에서 열어 주세요. 구절을 직접 입력해도 됩니다.</p>}
      <textarea className="pastor-heard" rows={3} value={heard} placeholder="들은 말이 여기에 나옵니다 (붙여 넣어도 됩니다)" aria-label="들은 말" onChange={(e) => setHeard(e.target.value)} />
      <div className="pastor-found" aria-live="polite">
        {detected.map((d) => (
          <span className="pastor-found-item" key={d.compact}>
            <strong>{d.label}</strong>
            <button disabled={!can} onClick={() => send(d.compact, d.label, true)}>띄우기</button>
            <button disabled={!can} onClick={() => send(d.compact, d.label, false)}>준비</button>
          </span>
        ))}
        {heard && !detected.length && <span className="pastor-dim">찾은 구절이 없습니다</span>}
      </div>
      {written.length > 0 && (
        <section className="pastor-written" aria-label="슬라이드에 적힌 구절">
          <h3>설교 자료에 적힌 구절</h3>
          <div className="pastor-chips">
            {written.map((d) => <button key={d.compact} disabled={!can} onClick={() => send(d.compact, d.label, true)}>{d.label}</button>)}
          </div>
        </section>
      )}
      {sent && <p className="pastor-sent" role="status">{sent}</p>}
      <p className="pastor-hint">구절은 컴퓨터에서 정한 번역본으로 만들어져, 지금 슬라이드 바로 다음에 들어갑니다. 끝나면 “다음 ▶”으로 원래 순서로 돌아갑니다.</p>
    </Drawer>
  );
}
