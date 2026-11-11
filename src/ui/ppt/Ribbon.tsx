import { isPdfSlide, PDF_READ_ONLY } from '../../domain/importedSlides';
import { openMixerWindow } from '../MixerPanel';
import { MaterialProtectionButton } from '../MaterialProtection';
import { PROTECTED_MESSAGE } from '../../domain/materialProtection';
import { formatStoragePercent } from '../../domain/cloudStorage';
import { useRef, useState, type Dispatch, type MouseEvent, type ReactNode } from 'react';
import { AddToPlaylistMenu } from '../AddToPlaylist';
import type { Action, AppState } from '../../domain/reducer';
import type { Background, Presentation, Slide, SlideElement, TransitionKind } from '../../domain/types';
import { BACKGROUND_PRESETS, presetBackground, DEFAULT_CONFESSION_SONG } from '../../domain/defaults';
import { MOTION_PRESETS } from '../../domain/motion';
import { swatchStyle } from '../backgroundSwatch';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { SlideCanvas, assetUrl } from '../SlideCanvas';
import { openOutput } from '../LivePanel';
import { useMediaUrl } from '../hooks';
import { ACCEPT, type Commands } from './commands';
import { sequence } from '../../domain/arrangement';
import { SUNDAY_STEPS } from '../../domain/sunday/wizardSteps';
import { qrElement } from '../../domain/qrElements';
import { SLIDE_TEMPLATES, type SlideTemplate } from '../../domain/slideTemplates';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
  cmd: Commands;
  presentation: Presentation | null;
  slide: Slide | null;
  onDesign: () => void;
}

const TABS = ['파일', '홈', '삽입', '디자인', '슬라이드 쇼', '예배', '도구'] as const;
type Tab = (typeof TABS)[number];
const TAB_HINTS: Record<Tab, string> = {
  파일: '가져오기 · 백업 · 휴지통 · 기록',
  홈: '슬라이드 · 프레젠테이션 · 재생목록에 넣기 · 찾기',
  삽입: '슬라이드 템플릿 · 성경 · 텍스트 · 그림 · 영상',
  디자인: '테마 · 배경 · 화면 전환',
  '슬라이드 쇼': '발표 · 리허설 · 화면 제어 · 출력 창 · 믹서',
  예배: '이번 주 예배 · 마법사 · 찬양 · 예배 전 점검',
  도구: 'AI · 찬양 통계 · 저작권 보고',
};

function Big({ icon, label, onClick, disabled, active, title }: { icon: ReactNode; label: string; onClick?: (e: MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; active?: boolean; title?: string }) {
  return (
    <button className={`rb-big ${active ? 'on' : ''}`} onClick={onClick} disabled={disabled} title={title ?? label}>
      <span className="rb-icon">{icon}</span>
      <span className="rb-label">{label}</span>
    </button>
  );
}

function Small({ icon, label, onClick, disabled, active, title }: { icon: ReactNode; label: string; onClick?: () => void; disabled?: boolean; active?: boolean; title?: string }) {
  return (
    <button className={`rb-small ${active ? 'on' : ''}`} onClick={onClick} disabled={disabled} title={title}>
      <span className="rb-icon-s">{icon}</span>{label}
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rb-group">
      <div className="rb-items">{children}</div>
      <div className="rb-group-label">{label}</div>
    </div>
  );
}

function MediaSwatch({ id, video }: { id: string; video: boolean }) {
  const url = useMediaUrl(id);
  if (!url) return <span className="rb-swatch-fill" />;
  return video ? <video className="rb-swatch-fill" src={url} muted /> : <img className="rb-swatch-fill" src={url} alt="" />;
}

/** PowerPoint-style ribbon. */
export function Ribbon({ state, dispatch, cmd, presentation: p, slide, onDesign }: Props) {
  const [tab, setTab] = useState<Tab>('홈');
  const [thisSlideOnly, setThisSlideOnly] = useState(false);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadKind = useRef<'conti' | 'lyrics' | 'sermon'>('conti');
  const { service } = cmd;
  const busy = service.busy;
  const working = !!busy && !busy.startsWith('✓');
  const upload = (kind: 'conti' | 'lyrics' | 'sermon') => {
    uploadKind.current = kind;
    const input = uploadRef.current!;
    input.accept = kind === 'conti' ? 'application/pdf,.pdf' : kind === 'lyrics' ? ACCEPT.lyrics : '.pptx,.ppt,.pdf,image/*';
    input.multiple = kind !== 'conti';
    input.click();
  };
  const onUpload = (files: File[]) => {
    if (!files.length) return;
    cmd.setSlideId(null);
    if (uploadKind.current === 'conti') service.conti(files[0]);
    else if (uploadKind.current === 'lyrics') service.lyrics(files);
    else service.sermon(files);
  };
  const insertKind = useRef<'image' | 'video'>('image');
  const lib = state.library;

  const updatePres = (patch: Partial<Presentation>) => p && dispatch({ type: 'presentation/update', id: p.id, patch });
  const updateSlide = (patch: Partial<Slide>) => p && slide && dispatch({ type: 'slide/update', presentationId: p.id, slideId: slide.id, seq: cmd.slideSeq ?? undefined, sequenceLength: sequence(p).length, patch });

  const addSlide = (copy: boolean) => {
    if (!p) return;
    if (p.protected) return cmd.notify(PROTECTED_MESSAGE);
    const i = slide ? p.slides.findIndex((s) => s.id === slide.id) : p.slides.length - 1;
    const base = copy && slide ? { ...slide, id: uid('s') } : { id: uid('s'), group: slide?.group ?? 'Slide', text: '' };
    const slides = [...p.slides];
    slides.splice(i + 1, 0, base);
    updatePres({ slides });
    cmd.setSlideId(base.id);
  };
  const addFromTemplate = (t: SlideTemplate) => {
    if (!p) return;
    if (p.protected) return cmd.notify(PROTECTED_MESSAGE);
    const i = slide ? p.slides.findIndex((s) => s.id === slide.id) : p.slides.length - 1;
    const n = t.make(slide?.group ?? 'Slide');
    const slides = [...p.slides];
    slides.splice(i + 1, 0, n);
    updatePres({ slides });
    cmd.setSlideId(n.id);
  };
  const deleteSlide = () => {
    if (!p || !slide) return;
    if (p.protected) return cmd.notify(PROTECTED_MESSAGE);
    const pages = sequence(p);
    const seq = cmd.slideSeq ?? pages.findIndex((x) => x.slide.id === slide.id);
    if (seq < 0) return;
    dispatch({ type: 'slide/delete', presentationId: p.id, slideIds: [slide.id], seqs: [seq] });
    const next = Math.min(seq, pages.length - 2);
    cmd.setSlideId(pages[seq + 1]?.slide.id ?? pages[seq - 1]?.slide.id ?? null, next >= 0 ? next : undefined);
  };

  const addElement = (el: Omit<SlideElement, 'id'>) => {
    if (!p || !slide) return cmd.notify('먼저 슬라이드를 선택하세요');
    if (p.protected) return cmd.notify(PROTECTED_MESSAGE);
    if (isPdfSlide(slide)) return cmd.notify(PDF_READ_ONLY);
    updateSlide({ elements: [...(slide.elements ?? []), { id: uid('el'), ...el }] });
    onDesign();
  };
  const insertMedia = async (file: File | undefined) => {
    if (!file) return;
    if (p?.protected) return cmd.notify(PROTECTED_MESSAGE);
    const id = uid('m');
    const kind = insertKind.current;
    await putMedia(id, file);
    dispatch({ type: 'media/add', media: { id, name: file.name, type: kind } });
    addElement({ kind, mediaId: id, fit: kind === 'video' ? 'cover' : 'contain', x: 220, y: 240, w: 1000, h: 600 });
    if (fileRef.current) fileRef.current.value = '';
  };

  const applyBackground = (bg: Background | undefined) => updatePres({ background: bg });
  const transition = slide?.transition ?? p?.transition;
  const setTransition = (kind: TransitionKind) => {
    const t = { kind, duration: transition?.duration ?? 1 };
    if (thisSlideOnly) updateSlide({ transition: t });
    else updatePres({ transition: t });
  };
  const sample: Slide = { id: 'sample', group: '', text: '가나다\nAaBb' };
  /** Objects can go on the selected slide (not on a locked deck or a read-only PDF page). */
  const canAdd = !!slide && !p?.protected && !isPdfSlide(slide);

  return (
    <div className="ribbon">
      <div className="rb-tabs">
        <img className="rb-logo" src="/favicon.png" alt="KCCP" title="Korean Central Church of Pittsburgh · FreeCast" />
        {TABS.map((t) => (
          <button key={t} className={`rb-tab ${t === tab ? 'on' : ''} ${t === '파일' ? 'file' : ''}`} onClick={() => setTab(t)} title={TAB_HINTS[t]}>{t}</button>
        ))}
        <span className="rb-spacer" />
        {busy && <span className="rb-busy" role="status">{busy}</span>}
        <button className={`rb-pill ${cmd.teamRequestCount ? 'team-request-alert' : ''}`} onClick={() => cmd.open('teamRequests')} title="무대팀이 보낸 요청">
          ✉ 무대팀{cmd.teamRequestCount ? ` 요청 ${cmd.teamRequestCount}` : ''}
        </button>
        <button className="rb-pill" onClick={() => cmd.open('remoteControl')} title="휴대폰 리모컨 · 조작권 관리">
          <span className={`dot ${cmd.relayConnected ? 'ok' : ''}`} /> {cmd.relayConnected ? `휴대폰 ${cmd.remoteCount}` : '재연결 중…'}{cmd.remoteRequests > 0 && <strong className="remote-request-badge"> · 조작권 요청 {cmd.remoteRequests}</strong>}
        </button>
        <button className="rb-pill" onClick={() => cmd.open(cmd.cloud.session ? 'sync' : 'account')} title={cmd.cloud.session ? `동기화 상태 · 계정${cmd.cloud.message ? ` — ${cmd.cloud.message}` : ''}` : '로그인하면 다른 컴퓨터에서도 같은 슬라이드를 엽니다 (지금은 이 컴퓨터에만 저장)'}>
          {cmd.cloud.session ? `☁ ${cmd.cloud.session.username}${cmd.cloud.state === 'syncing' ? ' ⟳' : cmd.cloud.state === 'error' ? ' ⚠' : cmd.cloud.state === 'offline' ? ` ⏸${cmd.cloud.pending?.total ? ` ${cmd.cloud.pending.total}` : ''}` : ' ✓'}` : '☁ 로그인'}{cmd.cloud.session && (cmd.cloud.storageError ? ' · 서버 용량 확인 필요' : cmd.cloud.storageUsage?.server ? ` · 서버 ${formatStoragePercent(cmd.cloud.storageUsage.server.usedPercent)}%` : '')}
        </button>
        <button className="rb-pill rb-gear" onClick={() => cmd.open('settings')} title="설정 — 업데이트 · 출력 화면 · 무대 화면 · 리모컨 · AI · 장비" aria-label="설정">⚙</button>
        <button className="rb-present" disabled={!p} title="지금 슬라이드부터 발표 (Shift+F5) — 처음부터는 F5" onClick={() => cmd.startShow(true)}>▶ 발표</button>
        <input ref={uploadRef} type="file" hidden onChange={(e) => { onUpload(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      </div>
      <div className="rb-body">
        {tab === '파일' && (
          <>
            <Group label="가져오기">
              <Big icon="📊" label="PowerPoint · PDF · 그림" onClick={() => cmd.pickFiles('slides', ACCEPT.slides)} />
              <Big icon="🎵" label="찬양 파일" title="Text, Markdown, ProPresenter 6, ChordPro, OpenLyrics, OpenSong" onClick={() => cmd.pickFiles('lyrics', ACCEPT.lyrics)} />
              {cmd.templateMarket && <Big icon="🛍" label="템플릿 마켓" title="슬라이드 템플릿을 파일로 주고받기 (실험 기능)" onClick={() => cmd.open('templateMarket')} />}
            </Group>
            <Group label="백업">
              <Big icon="🗜" label="전체 백업 저장" title="라이브러리와 미디어를 .zip 하나로" onClick={cmd.exportBackup} />
              <Big icon="🗂" label="백업 복원" title=".zip 백업에서 되살리기" onClick={() => cmd.pickFiles('backup', ACCEPT.backup)} />
              <div className="rb-col">
                <Small icon="{ }" label="라이브러리 JSON 저장" onClick={cmd.exportLibrary} />
                <Small icon="{ }" label="라이브러리 JSON 열기" onClick={() => cmd.pickFiles('library', ACCEPT.library)} />
              </div>
            </Group>
            <Group label="되돌리기">
              <Big icon="🗑" label="휴지통" onClick={() => cmd.open('trash')} />
              <Big icon="🕘" label="복원 지점" title="라이브러리를 자동으로 저장해 둔 지점으로 되돌리기" onClick={() => cmd.open('restore')} />
            </Group>
            <Group label="기록">
              <Big icon="📋" label="사용기록" onClick={() => cmd.open('activity')} />
              <div className="rb-col">
                <Small icon="📈" label={`찬양 사용 CSV (${lib.usage.length})`} onClick={cmd.exportUsage} />
                <Small icon="🧹" label="발표 기록 지우기" onClick={cmd.clearUsage} />
              </div>
            </Group>
          </>
        )}
        {tab === '홈' && (
          <>
            <Group label="실행 취소">
              <Small icon="↶" label="실행 취소" disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })} />
              <Small icon="↷" label="다시 실행" disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })} />
            </Group>
            <Group label="슬라이드">
              <Big icon="＋" label="새 슬라이드" title="지금 슬라이드 뒤에 추가 (Enter)" disabled={!p} onClick={() => addSlide(false)} />
              <div className="rb-col">
                <Small icon="⧉" label="복제" title="⌘/Ctrl+D" disabled={!slide} onClick={() => addSlide(true)} />
                <Small icon="🗑" label="삭제" title="Delete" disabled={!slide} onClick={deleteSlide} />
                <Small icon="⏭" label={slide?.disabled ? '숨기기 해제' : '숨기기'} disabled={!slide} onClick={() => updateSlide({ disabled: slide?.disabled ? undefined : true })} />
              </div>
            </Group>
            <Group label="프레젠테이션">
              <Big icon="📄" label="새로 만들기" title="새 프레젠테이션 · 찬양 가사" onClick={() => cmd.open('new')} />
              <Big icon="📋" label="재생목록에 넣기" title="이 프레젠테이션을 아무 재생목록에나 넣습니다 — 지금 열린 재생목록이 맨 위" disabled={!p}
                onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAddMenu({ x: r.left, y: r.bottom + 4 }); }} />
              <div className="rb-col">
                <Small icon="✎" label="내용 편집" title="가사·진행·슬라이드별 내용 편집" disabled={!p} onClick={() => cmd.open('edit')} />
                <Small icon="✏️" label="개체 편집" disabled={!slide || p?.protected || isPdfSlide(slide)} onClick={onDesign} />
                <Small icon="⟲" label={p?.loop ? '반복 해제' : '반복 재생'} disabled={!p} active={!!p?.loop} onClick={() => updatePres({ loop: !p?.loop })} />
              </div>
            </Group>
            {p && <Group label="필수 자료"><MaterialProtectionButton presentation={p} dispatch={dispatch} className="rb-big" /></Group>}
            <Group label="찾기">
              <Big icon="⚡" label="빠른 찾기" title="가사·성경·광고를 모든 프레젠테이션에서 찾아 바로 표시 (⌘/Ctrl+K)" onClick={() => cmd.open('find')} />
              <Big icon="🔎" label="라이브러리 검색" title="왼쪽 라이브러리에서 제목·가사 검색 (⌘/Ctrl+F)" onClick={() => window.dispatchEvent(new Event('freecast:find-library'))} />
            </Group>
          </>
        )}
        {tab === '삽입' && (
          <>
            <Group label="슬라이드 템플릿">
              {SLIDE_TEMPLATES.map((t) => <Big key={t.id} icon={t.icon} label={t.name} disabled={!p} onClick={() => addFromTemplate(t)} />)}
            </Group>
            <Group label="말씀">
              <Big icon="🔍" label="성경 검색" title="“요 3:16”처럼 찾아서 본문이 채워진 슬라이드로 넣거나 바로 띄웁니다" onClick={() => cmd.open('bible')} />
            </Group>
            <Group label="개체">
              <Big icon="T" label="텍스트 상자" disabled={!canAdd} onClick={() => addElement({ kind: 'text', text: '텍스트', x: 320, y: 440, w: 800, h: 200, fontSize: 80, color: '#ffffff', bold: true, shadow: true, align: 'center' })} />
              <Big icon="🖼" label="그림" disabled={!canAdd} onClick={() => { insertKind.current = 'image'; if (fileRef.current) { fileRef.current.accept = 'image/*'; fileRef.current.click(); } }} />
              <Big icon="🎬" label="비디오" disabled={!canAdd} onClick={() => { insertKind.current = 'video'; if (fileRef.current) { fileRef.current.accept = 'video/*'; fileRef.current.click(); } }} />
              <div className="rb-col">
                <Small icon="⬛" label="사각형" disabled={!canAdd} onClick={() => addElement({ kind: 'shape', fill: 'rgba(0,0,0,0.55)', radius: 24, x: 100, y: 820, w: 1240, h: 200 })} />
                <Small icon="⚪" label="원" disabled={!canAdd} onClick={() => addElement({ kind: 'shape', fill: '#4bc789', ellipse: true, x: 570, y: 390, w: 300, h: 300 })} />
                <Small icon="📷" label="카메라" disabled={!canAdd} onClick={() => addElement({ kind: 'camera', deviceId: '', x: 320, y: 315, w: 800, h: 450 })} />
                <Small icon="▣" label="QR 코드" title="링크 QR 코드를 슬라이드에 넣습니다 — 오른쪽 서식에서 링크를 입력하세요" disabled={!canAdd} onClick={() => { const { id: _, ...qr } = qrElement('', (slide?.elements ?? []).filter((e) => e.kind === 'qr').length); addElement(qr); cmd.notify('QR 코드를 넣었습니다 — 열린 편집 창에서 QR 코드를 눌러 링크를 입력하세요'); }} />
              </div>
            </Group>
            <Group label="자동 글자">
              <Small icon="🕒" label="현재 시각" title="{time}" disabled={!canAdd} onClick={() => updateSlide({ text: `${slide?.text ? `${slide.text}\n` : ''}{time}` })} />
              <Small icon="📅" label="날짜" title="{date}" disabled={!canAdd} onClick={() => updateSlide({ text: `${slide?.text ? `${slide.text}\n` : ''}{date}` })} />
              <Small icon="⏱" label="타이머" disabled={!slide || isPdfSlide(slide) || !lib.timers.length} onClick={() => updateSlide({ text: `${slide?.text ? `${slide.text}\n` : ''}{timer:${lib.timers[0]?.name}}` })} />
            </Group>
            <input ref={fileRef} type="file" hidden onChange={(e) => insertMedia(e.target.files?.[0])} />
          </>
        )}
        {tab === '디자인' && (
          <>
            <Group label="테마">
              <div className="rb-gallery rb-gallery-themes">
                {lib.themes.map((t) => (
                  <button key={t.id} className={`rb-theme ${p?.themeId === t.id ? 'on' : ''}`} title={t.name} disabled={!p} onClick={() => updatePres({ themeId: t.id })}>
                    <SlideCanvas slide={sample} theme={t} background={p?.background ?? presetBackground('Black')} />
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>
              <Small icon="Aa" label="테마 편집" onClick={() => cmd.open('themes')} />
            </Group>
            <Group label="배경 · 전체 슬라이드 (한 장만은 오른쪽 서식 창)">
              <div className="rb-gallery rb-gallery-bg">
                {BACKGROUND_PRESETS.map((b) => (
                  <button key={b.name} className="rb-swatch" title={b.name} disabled={!p} onClick={() => applyBackground(b.background)}>
                    {b.background.kind === 'image' ? <img className="rb-swatch-fill" src={assetUrl(b.background.url)} alt="" />
                      : <span className="rb-swatch-fill" style={swatchStyle(b.background)} />}
                  </button>
                ))}
                {MOTION_PRESETS.map((b) => (
                  <button key={b.name} className="rb-swatch" title={b.name} disabled={!p} onClick={() => applyBackground(b.background)}>
                    <span className="rb-swatch-fill" style={swatchStyle(b.background)} />
                  </button>
                ))}
                {lib.media.filter((m) => m.type !== 'audio' && !m.backgroundHidden).map((m) => (
                  <button key={m.id} className="rb-swatch" title={m.name} disabled={!p}
                    onClick={() => applyBackground({ kind: 'media', mediaId: m.id, mediaType: m.type === 'video' ? 'video' : 'image' })}>
                    <MediaSwatch id={m.id} video={m.type === 'video'} />
                  </button>
                ))}
              </div>
              <div className="rb-col">
                <Small icon="✕" label="배경 지우기" disabled={!p} onClick={() => applyBackground(undefined)} />
                <label className="rb-range">어둡게 <input type="range" min={0} max={0.9} step={0.05} disabled={!p} value={p?.bgEffect?.dim ?? 0} onChange={(e) => updatePres({ bgEffect: { dim: Number(e.target.value), blur: p?.bgEffect?.blur ?? 0 } })} /></label>
                <label className="rb-range">흐리게 <input type="range" min={0} max={40} disabled={!p} value={p?.bgEffect?.blur ?? 0} onChange={(e) => updatePres({ bgEffect: { dim: p?.bgEffect?.dim ?? 0, blur: Number(e.target.value) } })} /></label>
              </div>
            </Group>
            <Group label="화면 전환">
              {(['cut', 'fade', 'slide', 'zoom'] as const).map((k) => (
                <Big key={k} icon={{ cut: '▮', fade: '◐', slide: '⇥', zoom: '⤢' }[k]} label={{ cut: '없음', fade: '페이드', slide: '밀어내기', zoom: '확대' }[k]}
                  active={(transition?.kind ?? 'cut') === k} disabled={!p} onClick={() => setTransition(k)} />
              ))}
              <div className="rb-col">
                <label className="rb-range">길이 (ms) <input type="number" min={1} max={3000} step={1} disabled={!p} value={transition?.duration ?? 1}
                  onChange={(e) => { const t = { kind: transition?.kind ?? 'cut', duration: Math.max(1, Number(e.target.value) || 1) }; if (thisSlideOnly) updateSlide({ transition: t }); else updatePres({ transition: t }); }} /></label>
                <label className="rb-check" title="켜면 전환 효과·길이를 이 슬라이드에만 적용 (끄면 프레젠테이션 전체)"><input type="checkbox" checked={thisSlideOnly} disabled={!slide} onChange={(e) => setThisSlideOnly(e.target.checked)} /> 이 슬라이드만</label>
                <label className="rb-range">자동 넘김 (초) <input type="number" min={0} disabled={!slide} value={slide?.autoAdvance ?? ''} title="이 슬라이드에서 몇 초 뒤 다음으로"
                  onChange={(e) => updateSlide({ autoAdvance: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })} /></label>
              </div>
            </Group>
          </>
        )}
        {tab === '슬라이드 쇼' && (
          <>
            <Group label="시작">
              <Big icon="▶" label="처음부터 (F5)" disabled={!p} onClick={() => cmd.startShow(false)} />
              <Big icon="▷" label="리허설" disabled={!p} title="송출하지 않고 미리 넘겨 보기" onClick={() => cmd.open('rehearsal')} />
              <Big icon="■" label="쇼 마침 (Esc)" disabled={cmd.view !== 'presenter'} onClick={cmd.endShow} />
            </Group>
            <Group label="화면 제어">
              <Small icon="■" label="검은 화면 (B)" active={state.live.black} onClick={() => dispatch({ type: 'live/toggleBlack' })} />
              <Small icon="◆" label="로고 (L)" active={state.live.logo} onClick={() => dispatch({ type: 'live/logo' })} />
              <Small icon="✕" label="모두 지우기 (F1)" onClick={() => dispatch({ type: 'live/clearAll' })} />
            </Group>
            <Group label="창 열기">
              <Big icon="🖵" label="청중 화면" onClick={() => openOutput('output')} />
              <Big icon="🎤" label="무대 화면" onClick={() => openOutput('stage')} />
              <Big icon="▦" label="멀티뷰" onClick={() => window.open(`${location.origin}/?view=multiview`, 'freecast-multiview', 'popup,width=1280,height=760')} />
            </Group>
            <Group label="음향">
              <Big icon="🎚" label="X32 믹서 ↗" title="새 창 (다른 창 위에 항상 표시) — 볼륨 · 뮤트 · 게인 · 로우 컷 · 컴프레서 · EQ · 모니터 · 장면" onClick={openMixerWindow} />
            </Group>
            <Group label="예배 중 도우미">
              <Big icon="🎙" label="가사 따라가기" active={cmd.followOn} title="찬양 가사를 듣고 다음 슬라이드를 준비합니다" onClick={() => cmd.open('follow')} />
            </Group>
          </>
        )}
        {tab === '예배' && (
          <>
            <Group label="이번 주 예배 (바로 반영)">
              <Big icon="⛪" label="예배 열기" title="이번 주 주일예배를 교회 템플릿으로 엽니다 — 올리는 자료가 바로 들어갑니다" disabled={working} onClick={service.open} />
              <Big icon="🎼" label="콘티 업로드" title="콘티 PDF를 올리면 이번 주 주일예배의 찬양 순서에 바로 들어갑니다" disabled={working} onClick={() => upload('conti')} />
              <Big icon="🎵" label="가사 올리기" title="가사 파일(.txt/.md 등)을 찬양 순서에 넣습니다" disabled={working} onClick={() => upload('lyrics')} />
              <Big icon="🎤" label="설교 슬라이드" title="설교 PPTX/PPT/PDF/이미지로 기존 설교 슬라이드를 교체합니다. 예배 순서와 설정은 유지됩니다. 여러 파일은 한 번에 선택하세요." disabled={working} onClick={() => upload('sermon')} />
              <Big icon="⇩" label="PPTX 저장" title="지금 재생목록을 PowerPoint 파일(MMDD)로 내보냅니다" onClick={cmd.exportPlaylistPptx} />
            </Group>
            <Group label="예배 만들기">
              <Big icon="📝" label="주일예배 마법사" title="순서 · 찬양 · 광고를 처음부터 단계별로 채웁니다" onClick={() => cmd.open('sunday')} />
              <div className="rb-col">
                <Small icon="🙏" label="기도제목" title="이번 주 기도제목 — 주일예배 Front 슬라이드에 들어갑니다" onClick={() => cmd.open('prayer')} />
                <Small icon="🙌" label="공동체 고백송" title={`지금: ${lib.sunday.confessionSong || DEFAULT_CONFESSION_SONG} — 학기·해마다 바꾸기`} onClick={() => cmd.open('confession')} />
              </div>
              <Big icon="⛺" label="수련회" onClick={() => cmd.open('retreat')} />
              <Small icon="🌌" label="수련회 배경" title="수련회 주제를 넣으면 어울리는 움직이는 배경이 정해집니다 — 언제든 바꿀 수 있고 모든 수련회 슬라이드가 따라갑니다" onClick={() => cmd.open('retreatBg')} />
            </Group>
            <Group label="단계별 수정 (마법사 없이)">
              {[[0, 1, 2], [3, 4], [5, 6]].map((col) => (
                <div key={col[0]} className="rb-col">
                  {col.map((i) => <Small key={i} icon={SUNDAY_STEPS[i].icon} label={SUNDAY_STEPS[i].edit} title={`${SUNDAY_STEPS[i].hint} — 이번 주 예배에 바로 반영`} onClick={() => cmd.editSundayStep(i)} />)}
                </div>
              ))}
            </Group>
            <Group label="찬양">
              <Big icon="🎵" label="새 찬양" title="찬양 등록 — 제목·진행·파트별 가사 (주일예배 생성기와 같은 방식)" onClick={() => cmd.open('songNew')} />
              <Big icon="☁" label={cmd.online.status === 'ok' ? `찬양 ${cmd.online.count}곡` : '찬양 라이브러리'} title="찬양 라이브러리 보기 · 편집 · 삭제" onClick={() => cmd.open('songLibrary')} />
              <Big icon="🎼" label="코드 · 키 악보" title="곡마다 키·BPM·코드를 보고, 키를 옮기고, 밴드용으로 인쇄합니다" onClick={() => cmd.open('chords')} />
            </Group>
            <Group label="예배 전">
              <Big icon="☑" label="준비 · 점검" title="준비 체크리스트와 예배 시작 전 자동 점검 (누락 파일 · 빈 슬라이드 · 발표 화면)" onClick={() => cmd.open('preparation')} />
              <Big icon="🛡" label={cmd.safeModeOn ? '안전 모드 켜짐' : '안전 모드'} active={cmd.safeModeOn} title="예배 자료를 이 컴퓨터에 모두 받아 두고 위험한 변경을 막습니다" onClick={() => cmd.open('safeMode')} />
              <Big icon="💻" label={cmd.standbyOn ? '대기 컴퓨터 켜짐' : '대기 컴퓨터'} active={cmd.standbyOn} title="메인 컴퓨터를 따라가다 멈추면 이어받습니다" onClick={() => cmd.open('standby')} />
            </Group>
          </>
        )}
        {tab === '도구' && (
          <>
            <Group label="AI">
              <Big icon="✨" label="AI로 만들기" onClick={() => cmd.open('ai')} />
              <Big icon="📈" label="AI 사용량" title="오늘 AI를 얼마나 썼는지 (모델별 무료 한도)" onClick={() => cmd.open('aiUsage')} />
            </Group>
            <Group label="통계 · 보고">
              <Big icon="📊" label="찬양 통계 · 추천" title="많이 부른 곡, 쉬었던 곡 추천, 키 점검" onClick={() => cmd.open('songStats')} />
              <Big icon="©" label="저작권(CCLI) 보고" title="기간별 사용 곡과 CCLI 번호를 CSV로" onClick={() => cmd.open('ccli')} />
            </Group>
          </>
        )}
      </div>
      {addMenu && p && <AddToPlaylistMenu state={state} dispatch={dispatch} presentationId={p.id} x={addMenu.x} y={addMenu.y} notify={cmd.notify} onClose={() => setAddMenu(null)} />}
    </div>
  );
}
