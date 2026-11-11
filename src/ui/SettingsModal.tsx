import { useState, type Dispatch, type ReactNode } from 'react';
import type { Action, AppState } from '../domain/reducer';
import type { Screen, ScreenLayers, StageLayout } from '../domain/types';
import { uid } from '../domain/lyrics';
import { openOutput } from './LivePanel';
import { DesktopAi, DesktopDisplays, DesktopRemote, DesktopUpdate, useDesktopInfo } from './DesktopSettings';
import { desktop } from '../domain/desktop';
import { contentServer, DEFAULT_SERVER, setContentServer } from '../domain/online';
import { FEATURES, loadFeatures, setFeature, type FeatureId } from '../domain/features';
import { X32SettingsCard } from './X32SettingsCard';
import type { X32Settings } from '../domain/x32';

export type SettingsPage = 'general' | 'outputs' | 'stage' | 'remote' | 'ai' | 'devices';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
  relayConnected: boolean;
  mixer: X32Settings;
  onMixer: (s: X32Settings) => void;
  /** 실험 기능 were switched on or off. */
  onFeatures: () => void;
  initialPage?: SettingsPage;
  onClose: () => void;
}

const PAGES: { id: SettingsPage; icon: string; label: string; intro: string; desktopOnly?: boolean }[] = [
  { id: 'general', icon: '⚙', label: '일반', intro: '업데이트, 단축키, 실험 기능' },
  { id: 'outputs', icon: '🖵', label: '출력 화면', intro: '프로젝터 · TV로 보내는 화면' },
  { id: 'stage', icon: '🎤', label: '무대 화면', intro: '찬양팀 · 설교자가 보는 화면' },
  { id: 'remote', icon: '📱', label: '리모컨 · 휴대폰', intro: '휴대폰 · 태블릿으로 조작하기' },
  { id: 'ai', icon: '✨', label: 'AI', intro: '콘티 인식 · 가사 찾기에 쓰는 AI', desktopOnly: true },
  { id: 'devices', icon: '🎛', label: '장비 · 연결', intro: 'X32 믹서, 조명(DMX), 찬양 서버' },
];

const LAYERS: { id: keyof ScreenLayers; label: string }[] = [
  { id: 'background', label: '배경' }, { id: 'slide', label: '슬라이드' },
];

const STAGE_FLAGS: { id: keyof StageLayout; label: string }[] = [
  { id: 'clock', label: '시계' }, { id: 'timers', label: '타이머' }, { id: 'current', label: '지금 슬라이드' }, { id: 'next', label: '다음 슬라이드' },
  { id: 'notes', label: '노트' }, { id: 'preview', label: '화면 미리보기' }, { id: 'chords', label: '코드' }, { id: 'videoCountdown', label: '영상 남은 시간' },
];

const SHORTCUTS: [string, string][] = [
  ['F5', '처음부터 발표'], ['Shift+F5', '현재 슬라이드부터 발표'], ['→ ↓ Space', '다음 슬라이드 (발표 중)'], ['← ↑', '이전 슬라이드 (발표 중)'],
  ['B', '검은 화면'], ['L', '로고 화면'], ['F1', '모두 지우기'], ['F2', '슬라이드 글자 지우기'], ['F3', '배경 지우기'],
  ['⌘/Ctrl+K', '빠른 찾기'], ['⌘/Ctrl+F', '라이브러리 찾기'], ['⌘/Ctrl+Z', '실행 취소'], ['⌘/Ctrl+D', '슬라이드 복제'], ['Enter', '새 슬라이드 (편집 중)'],
];

/** ⚙ 설정: one page per topic instead of everything on one screen. */
export function SettingsModal({ state, dispatch, relayConnected, mixer, onMixer, onFeatures, initialPage = 'general', onClose }: Props) {
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const desk = useDesktopInfo();
  const pages = PAGES.filter((p) => !p.desktopOnly || desktop);
  const current = pages.find((p) => p.id === page) ?? pages[0];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-modal" role="dialog" aria-label="설정">
        <header className="modal-head">
          <h2>⚙ 설정</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="설정 항목">
            {pages.map((p) => (
              <button key={p.id} className={p.id === current.id ? 'on' : ''} aria-current={p.id === current.id ? 'page' : undefined} onClick={() => setPage(p.id)}>
                <span className="settings-nav-icon">{p.icon}</span>
                <span className="settings-nav-text"><b>{p.label}</b><small>{p.intro}</small></span>
              </button>
            ))}
          </nav>
          <div className="settings-page" key={current.id}>
            <div className="settings-page-head">
              <h3>{current.icon} {current.label}</h3>
              <p className="muted">{current.intro}</p>
            </div>
            {current.id === 'general' && <GeneralPage desk={desk} onFeatures={onFeatures} />}
            {current.id === 'outputs' && <OutputsPage state={state} dispatch={dispatch} desk={desk} />}
            {current.id === 'stage' && <StagePage state={state} dispatch={dispatch} />}
            {current.id === 'remote' && (desk ? <DesktopRemote {...desk} /> : <WebRemote relayConnected={relayConnected} />)}
            {current.id === 'ai' && (desk ? <DesktopAi {...desk} /> : <Loading />)}
            {current.id === 'devices' && <DevicesPage mixer={mixer} onMixer={onMixer} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return <p className="hint">설정을 불러오는 중…</p>;
}

function Card({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <section className="settings-card">
      <h4>{title}</h4>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

function GeneralPage({ desk, onFeatures }: { desk: ReturnType<typeof useDesktopInfo>; onFeatures: () => void }) {
  const [on, setOn] = useState(loadFeatures);
  const toggle = (id: FeatureId, value: boolean) => { setFeature(id, value); setOn(loadFeatures()); onFeatures(); };
  return (
    <>
      {desktop && (desk ? <DesktopUpdate info={desk.info} /> : <Loading />)}
      <Card title="키보드 단축키" hint="글자를 입력하는 중에는 단축키가 동작하지 않습니다.">
        <dl className="shortcut-list">
          {SHORTCUTS.map(([k, label]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{label}</dd></div>)}
        </dl>
      </Card>
      <Card title="🧪 실험 기능" hint="아직 기본으로 켜지 않은 기능입니다. 이 컴퓨터에서만 켜고 끕니다.">
        {FEATURES.map((f) => (
          <label key={f.id} className="settings-switch">
            <span><b>{f.label}</b><small className="muted">{f.detail}</small></span>
            <input type="checkbox" checked={on[f.id] === true} onChange={(e) => toggle(f.id, e.target.checked)} />
          </label>
        ))}
      </Card>
    </>
  );
}

function OutputsPage({ state, dispatch, desk }: { state: AppState; dispatch: Dispatch<Action>; desk: ReturnType<typeof useDesktopInfo> }) {
  const { screens, themes } = state.library;
  const save = (s: Screen) => dispatch({ type: 'screen/upsert', screen: s });
  const base = `${location.origin}${location.pathname}`;
  return (
    <>
      {desktop && (desk ? <DesktopDisplays {...desk} screens={screens} /> : <Loading />)}
      <Card title="출력 화면" hint="화면마다 따로 창이 열립니다. 프로젝터 · TV · 보조 모니터로 옮기고 F를 누르면 전체 화면이 됩니다.">
        {screens.map((s) => (
          <div key={s.id} className="settings-item">
            <div className="settings-item-head">
              <input className="plain grow strong" value={s.name} aria-label="화면 이름" onChange={(e) => save({ ...s, name: e.target.value })} />
              <button onClick={() => openOutput('output', `&screen=${s.id}`)}>열기 ↗</button>
              <button className="mini-btn" title="이 화면 삭제" disabled={screens.length <= 1} onClick={() => dispatch({ type: 'screen/delete', id: s.id })}>✕</button>
            </div>
            <div className="settings-item-body">
              <div className="settings-fields">
                <label>테마
                  <select value={s.themeId ?? ''} onChange={(e) => save({ ...s, themeId: e.target.value || null })}>
                    <option value="">프레젠테이션 테마 따르기</option>
                    {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <label>빈 곳
                  <select value={s.key} onChange={(e) => save({ ...s, key: e.target.value as Screen['key'] })}>
                    <option value="black">검은색</option><option value="green">크로마 그린</option><option value="transparent">투명</option><option value="matte">키 (매트)</option>
                  </select>
                </label>
                <label>가장자리 가리기
                  <select value={s.mask?.kind ?? 'none'} onChange={(e) => save({ ...s, mask: { kind: e.target.value as 'none' | 'rect' | 'oval', inset: s.mask?.inset ?? 60 } })}>
                    <option value="none">없음</option><option value="rect">사각형</option><option value="oval">타원</option>
                  </select>
                </label>
                <label>프로젝터 겹치기 (엣지 블렌딩)
                  <select value={s.edge?.part ?? 'none'} onChange={(e) => save({ ...s, edge: { part: e.target.value as 'none' | 'left' | 'right', overlap: s.edge?.overlap ?? 200 } })}>
                    <option value="none">끔</option><option value="left">왼쪽 프로젝터</option><option value="right">오른쪽 프로젝터</option>
                  </select>
                </label>
                {s.mask && s.mask.kind !== 'none' && (
                  <label>가리는 폭 {s.mask.inset}px<input type="range" min={0} max={400} value={s.mask.inset} onChange={(e) => save({ ...s, mask: { ...s.mask!, inset: Number(e.target.value) } })} /></label>
                )}
                {s.edge && s.edge.part !== 'none' && (
                  <label>겹치는 폭 {s.edge.overlap}px<input type="range" min={40} max={600} step={10} value={s.edge.overlap} onChange={(e) => save({ ...s, edge: { ...s.edge!, overlap: Number(e.target.value) } })} /></label>
                )}
              </div>
              <div className="settings-chips" role="group" aria-label="보일 항목">
                <span className="muted small">보일 항목</span>
                {LAYERS.map((l) => (
                  <label key={l.id} className={`settings-chip ${(s.layers[l.id] ?? true) ? 'on' : ''}`}>
                    <input type="checkbox" checked={s.layers[l.id] ?? true} onChange={(e) => save({ ...s, layers: { ...s.layers, [l.id]: e.target.checked } })} /> {l.label}
                  </label>
                ))}
              </div>
              <code className="small selectable">{base}?view=output&screen={s.id}</code>
            </div>
          </div>
        ))}
        <div className="row gap-xs wrap">
          <button onClick={() => save({ id: uid('screen'), name: '새 화면', themeId: null, key: 'black', layers: { background: true, slide: true, props: true, messages: true, timer: true } })}>＋ 화면 추가</button>
        </div>
        <p className="hint">영상 스위처용 키 · 필 출력: “키 (매트)” 화면 하나와 일반 화면 하나를 함께 쓰세요.</p>
      </Card>
    </>
  );
}

function StagePage({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  return (
    <Card title="무대 화면 구성" hint="찬양팀 · 설교자 모니터에 무엇을 보여 줄지 정합니다. 구성마다 따로 열 수 있습니다.">
      {state.library.stageLayouts.map((l) => {
        const up = (patch: Partial<StageLayout>) => dispatch({ type: 'stageLayout/upsert', layout: { ...l, ...patch } });
        return (
          <div key={l.id} className="settings-item">
            <div className="settings-item-head">
              <input className="plain grow strong" value={l.name} aria-label="구성 이름" onChange={(e) => up({ name: e.target.value })} />
              <button onClick={() => openOutput('stage', `&layout=${l.id}`)}>열기 ↗</button>
              <button className="mini-btn" title="이 구성 삭제" onClick={() => dispatch({ type: 'stageLayout/delete', id: l.id })}>✕</button>
            </div>
            <div className="settings-item-body">
              <div className="settings-chips" role="group" aria-label="보일 항목">
                {STAGE_FLAGS.map(({ id, label }) => (
                  <label key={id} className={`settings-chip ${l[id] ? 'on' : ''}`}>
                    <input type="checkbox" checked={!!l[id]} onChange={(e) => up({ [id]: e.target.checked } as Partial<StageLayout>)} /> {label}
                  </label>
                ))}
              </div>
              <label className="settings-range">글자 크기 <input type="range" min={0.6} max={2} step={0.1} value={l.scale} onChange={(e) => up({ scale: Number(e.target.value) })} /> <span className="muted">{Math.round(l.scale * 100)}%</span></label>
            </div>
          </div>
        );
      })}
      <div>
        <button onClick={() => dispatch({ type: 'stageLayout/upsert', layout: { id: uid('stage'), name: '새 무대 화면', clock: true, timers: true, current: true, next: true, notes: false, preview: false, chords: true, videoCountdown: true, scale: 1 } })}>＋ 무대 화면 구성 추가</button>
      </div>
    </Card>
  );
}

function WebRemote({ relayConnected }: { relayConnected: boolean }) {
  const base = `${location.origin}${location.pathname}`;
  return (
    <>
      <Card title={<><span className={`dot ${relayConnected ? 'ok' : ''}`} /> {relayConnected ? '리모컨 서버 연결됨' : '리모컨 서버 꺼짐'}</>}
        hint={relayConnected ? '같은 Wi-Fi의 휴대폰 · 태블릿에서 아래 주소를 여세요.' : 'npm run dev 또는 npm start로 FreeCast를 시작하면 켜집니다.'}>
        <label className="stack small">리모컨<code className="selectable">{base}?view=remote</code></label>
        <label className="stack small">🎤 목사님 태블릿 (무대 화면 + 조작)<code className="selectable">{base}?view=remote&amp;mode=stage</code></label>
        <label className="stack small">무대 화면 · 출력 화면<code className="selectable">{base}?view=stage</code><code className="selectable">{base}?view=output</code></label>
        <p className="hint">PIN이 필요하면 <code>FREECAST_REMOTE_PIN</code>을 설정하세요.</p>
      </Card>
    </>
  );
}

function DevicesPage({ mixer, onMixer }: { mixer: X32Settings; onMixer: (s: X32Settings) => void }) {
  return (
    <>
      <X32SettingsCard settings={mixer} onChange={onMixer} />
      <Card title="찬양 · 성경 서버" hint="찬양 라이브러리(library.json)와 성경(bible-text/*.json)을 FreeCast를 켤 때마다 이 주소에서 읽습니다.">
        <form className="row gap-xs wrap" onSubmit={(e) => {
          e.preventDefault();
          const v = (new FormData(e.currentTarget).get('server') as string) ?? '';
          try {
            setContentServer(v === DEFAULT_SERVER ? null : v);
            if (confirm('저장했습니다. 지금 FreeCast를 다시 불러와 적용할까요?')) location.reload();
          } catch (err) {
            alert((err as Error).message);
          }
        }}>
          <input name="server" className="grow" aria-label="서버 주소" defaultValue={contentServer()} />
          <button type="submit">저장</button>
          <button type="button" onClick={() => { setContentServer(null); location.reload(); }}>기본값</button>
        </form>
      </Card>
    </>
  );
}
