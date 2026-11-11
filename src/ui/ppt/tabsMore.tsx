// 슬라이드 쇼 · 검토 · 보기 tabs, and FreeCast's own 예배 · 도구 tabs (like an add-in's tabs).
import { useRef, useState, type MouseEvent } from 'react';
import { openOutput } from '../outputWindows';
import { openMixerWindow } from '../MixerPanel';
import { MaterialProtectionButton } from '../MaterialProtection';
import { AddToPlaylistMenu } from '../AddToPlaylist';
import { DEFAULT_CONFESSION_SONG } from '../../domain/defaults';
import { SUNDAY_STEPS } from '../../domain/sunday/wizardSteps';
import { ACCEPT } from './commands';
import { setSpellCheck, spellCheckOn } from '../RichTextEditor';
import type { Ed } from './editor';
import { Big, Col, DropButton, Group, MenuItem, RI, Small } from './ribbonParts';

export function SlideShowTab({ ed }: { ed: Ed }) {
  const { cmd, state, dispatch, p, slide } = ed;
  return (
    <>
      <Group label="슬라이드 쇼 시작">
        <Big icon={RI.fromStart} label="처음부터" title="처음부터 (F5)" disabled={!p} onClick={() => cmd.startShow(false)} />
        <Big icon={RI.fromCurrent} label="현재 슬라이드부터" title="현재 슬라이드부터 (Shift+F5)" disabled={!p} onClick={() => cmd.startShow(true)} />
        <DropButton big icon="☰" label="재구성한 쇼" disabled={!p} render={(close) => (
          <>
            {(p?.customShows ?? []).map((s) => <MenuItem key={s.id} label={s.name} hint={`${s.slideIds.length}장`} onClick={() => { ed.play({ ids: s.slideIds }); close(); }} />)}
            <MenuItem label="재구성한 쇼…" onClick={() => { ed.setDialog('customShows'); close(); }} />
          </>
        )} />
      </Group>
      <Group label="설정">
        <Big icon={RI.hideSlide} label="슬라이드 숨기기" active={!!slide?.disabled} disabled={!slide || !ed.canEdit} onClick={() => ed.updateSlide({ disabled: slide?.disabled ? undefined : true })} />
        <Big icon="⚙" label="쇼 설정" title="반복 · 애니메이션 · 화면 전환 · 타이밍 · 모니터" disabled={!p} onClick={() => ed.setDialog('setupShow')} />
        <Big icon={RI.rehearse} label="예행 연습" title="슬라이드마다 시간을 재고 자동으로 넘어가게 저장합니다" disabled={!p} onClick={() => ed.play({ rehearse: true })} />
        <Col>
          <label className="rb-check"><input type="checkbox" disabled={!p || !!p.protected} checked={!p?.showSetup?.manual} onChange={(e) => ed.updatePres({ showSetup: { ...p?.showSetup, manual: e.target.checked ? undefined : true } })} /> 타이밍 사용</label>
          <Small icon="▶" label="송출 없이 넘겨 보기" disabled={!p} onClick={() => cmd.open('rehearsal')} />
          <Small icon="✕" label="타이밍 지우기" disabled={!p?.slides.some((s) => s.autoAdvance) || !ed.canEdit} onClick={() => p && ed.updatePres({ slides: p.slides.map((s) => ({ ...s, autoAdvance: undefined })) })} />
        </Col>
      </Group>
      <Group label="모니터">
        <Big icon={RI.presenter} label="발표자 보기" active={cmd.view === 'presenter'} onClick={() => cmd.setView(cmd.view === 'presenter' ? 'normal' : 'presenter')} />
        <Col>
          <Small icon={RI.monitor} label="청중 화면 열기" onClick={() => openOutput('output')} />
          <Small icon={RI.black} label="검은 화면 (B)" active={state.live.black} onClick={() => dispatch({ type: 'live/toggleBlack' })} />
        </Col>
      </Group>
      <Group label="쇼">
        <Big icon="■" label="쇼 마침" title="쇼 마침 (Esc)" disabled={cmd.view !== 'presenter'} onClick={cmd.endShow} />
      </Group>
    </>
  );
}

export function ReviewTab({ ed, onComment }: { ed: Ed; onComment: () => void }) {
  const comments = ed.slide?.comments?.length ?? 0;
  const [spell, setSpell] = useState(spellCheckOn());
  return (
    <>
      <Group label="언어 교정">
        <Big icon="abc✓" label="맞춤법 검사" title="프레젠테이션의 틀린 단어를 하나씩 찾아 고칩니다" active={ed.pane === 'spelling'} onClick={() => ed.setPane(ed.pane === 'spelling' ? null : 'spelling')} />
        <Col>
          <label className="rb-check" title="입력할 때 틀린 단어에 빨간 밑줄"><input type="checkbox" checked={spell} onChange={() => { setSpellCheck(!spell); setSpell(!spell); }} /> 입력할 때 검사</label>
          <Small icon="🌐" label="언어" title="교정 언어 설정 · 맞춤법 검사 안 함" onClick={() => ed.setDialog('language')} />
        </Col>
        <Big icon="📖" label="동의어 사전" title="선택한 단어와 뜻이 같은 단어" onClick={() => ed.setDialog('thesaurus')} />
      </Group>
      <Group label="비교">
        <Big icon="⇆" label="비교" title="다른 버전과 비교해 바뀐 내용을 하나씩 적용하거나 거부합니다" disabled={!ed.p} onClick={() => ed.setDialog('compare')} />
        <Big icon="☑" label="수정 내용" active={ed.pane === 'revisions'} onClick={() => ed.setPane(ed.pane === 'revisions' ? null : 'revisions')} />
      </Group>
      <Group label="메모">
        <Big icon={RI.comment} label="새 메모" disabled={!ed.slide} onClick={onComment} />
        <Col>
          <Small icon="💬" label={`메모 표시${comments ? ` (${comments})` : ''}`} active={ed.pane === 'comments'} onClick={() => ed.setPane(ed.pane === 'comments' ? null : 'comments')} />
          <Small icon={RI.deleteIcon} label="이 슬라이드의 메모 삭제" disabled={!comments || !ed.canEdit} onClick={() => ed.updateSlide({ comments: undefined })} />
        </Col>
      </Group>
      <Group label="기록">
        <Big icon="📋" label="사용 기록" onClick={() => ed.cmd.open('activity')} />
        <Big icon="🕘" label="복원 지점" onClick={() => ed.cmd.open('restore')} />
      </Group>
    </>
  );
}

const ZOOMS = [33, 50, 66, 75, 100, 150, 200, 300, 400];

export function ViewTab({ ed, onOutline, onReading }: { ed: Ed; onOutline: () => void; onReading: () => void }) {
  const { cmd } = ed;
  return (
    <>
      <Group label="프레젠테이션 보기">
        <Big icon={RI.normalView} label="기본" active={cmd.view === 'normal'} onClick={() => cmd.setView('normal')} />
        <Big icon={RI.outlineView} label="개요 보기" active={cmd.view === 'outline'} onClick={onOutline} />
        <Big icon={RI.sorterView} label="여러 슬라이드" active={cmd.view === 'sorter'} onClick={() => cmd.setView('sorter')} />
        <Big icon={RI.readingView} label="읽기용 보기" onClick={onReading} />
      </Group>
      <Group label="마스터 보기">
        <Big icon="▤" label="슬라이드 마스터" title="모든 슬라이드에 나오는 개체와 배경" disabled={!ed.p} onClick={() => ed.setDialog('master')} />
        <Big icon="▥" label="유인물 마스터" title="유인물 인쇄: 페이지당 슬라이드 수, 머리글 · 바닥글" disabled={!ed.p} onClick={() => ed.setDialog('handoutMaster')} />
        <Big icon="▦" label="슬라이드 노트 마스터" title="슬라이드 노트 페이지 인쇄 모양" disabled={!ed.p} onClick={() => ed.setDialog('notesMaster')} />
      </Group>
      <Group label="표시">
        <Col>
          <label className="rb-check"><input type="checkbox" checked={!!ed.view.grid} onChange={(e) => ed.setView({ ...ed.view, grid: e.target.checked })} /> 눈금선</label>
          <label className="rb-check"><input type="checkbox" checked={!!ed.view.ruler} onChange={(e) => ed.setView({ ...ed.view, ruler: e.target.checked })} /> 눈금자</label>
          <label className="rb-check"><input type="checkbox" checked={!!ed.view.guides} onChange={(e) => ed.setView({ ...ed.view, guides: e.target.checked })} /> 안내선</label>
          <label className="rb-check"><input type="checkbox" checked={ed.notesOpen} onChange={(e) => ed.setNotesOpen(e.target.checked)} /> 슬라이드 노트</label>
        </Col>
        <Small icon="⌗" label="눈금 및 안내선…" onClick={() => ed.setDialog('guides')} />
      </Group>
      <Group label="확대/축소">
        <DropButton big icon={RI.zoom} label="확대/축소" render={(close) => <>{ZOOMS.map((z) => <MenuItem key={z} label={`${z}%`} on={ed.zoom === z / 100} onClick={() => { ed.setZoom(z / 100); close(); }} />)}<MenuItem label="창에 맞춤" on={ed.zoom === null} onClick={() => { ed.setZoom(null); close(); }} /></>} />
        <Big icon={RI.fit} label="창에 맞춤" active={ed.zoom === null} onClick={() => ed.setZoom(null)} />
      </Group>
      <Group label="작업창">
        <Col>
          <Small icon={RI.selectionPane} label="선택 창" active={ed.pane === 'selection'} onClick={() => ed.setPane(ed.pane === 'selection' ? null : 'selection')} />
          <Small icon={RI.animPane} label="애니메이션 창" active={ed.pane === 'animation'} onClick={() => ed.setPane(ed.pane === 'animation' ? null : 'animation')} />
          <Small icon="✎" label="서식 창" active={ed.pane === 'format'} onClick={() => ed.setPane(ed.pane === 'format' ? null : 'format')} />
        </Col>
      </Group>
    </>
  );
}

export function WorshipTab({ ed }: { ed: Ed }) {
  const { cmd, state, dispatch, p } = ed;
  const { service } = cmd;
  const busy = service.busy;
  const working = !!busy && !busy.startsWith('✓');
  const lib = state.library;
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadKind = useRef<'conti' | 'lyrics' | 'sermon'>('conti');
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
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
  return (
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
      <Group label="재생목록">
        <Big icon="📋" label="재생목록에 넣기" title="이 프레젠테이션을 아무 재생목록에나 넣습니다" disabled={!p}
          onClick={(e: MouseEvent<HTMLButtonElement>) => { const r = e.currentTarget.getBoundingClientRect(); setAddMenu({ x: r.left, y: r.bottom + 4 }); }} />
        <Col>
          <Small icon="✎" label="내용 편집" title="가사·진행·슬라이드별 내용 편집" disabled={!p} onClick={() => cmd.open('edit')} />
          <Small icon="⟲" label={p?.loop ? '반복 해제' : '반복 재생'} disabled={!p} active={!!p?.loop} onClick={() => ed.updatePres({ loop: !p?.loop })} />
          <Small icon="⚡" label="빠른 찾기" title="가사·성경·광고를 모든 프레젠테이션에서 찾아 바로 표시 (Ctrl+K)" onClick={() => cmd.open('find')} />
        </Col>
        {p && <MaterialProtectionButton presentation={p} dispatch={dispatch} className="rb-big" />}
      </Group>
      <Group label="예배 중">
        <Big icon="🎚" label="X32 믹서 ↗" title="새 창 (다른 창 위에 항상 표시)" onClick={openMixerWindow} />
        <Big icon="🎙" label="가사 따라가기" active={cmd.followOn} title="찬양 가사를 듣고 다음 슬라이드를 준비합니다" onClick={() => cmd.open('follow')} />
      </Group>
      <input ref={uploadRef} type="file" hidden onChange={(e) => { onUpload(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      {addMenu && p && <AddToPlaylistMenu state={state} dispatch={dispatch} presentationId={p.id} x={addMenu.x} y={addMenu.y} notify={cmd.notify} onClose={() => setAddMenu(null)} />}
    </>
  );
}

export function ToolsTab({ ed }: { ed: Ed }) {
  const { cmd } = ed;
  return (
    <>
          <Group label="AI">
            <Big icon={RI.ai} label="AI로 만들기" onClick={() => cmd.open('ai')} />
            <Big icon="📈" label="AI 사용량" title="오늘 AI를 얼마나 썼는지 (모델별 무료 한도)" onClick={() => cmd.open('aiUsage')} />
          </Group>
          <Group label="통계 · 보고">
            <Big icon="📊" label="찬양 통계 · 추천" title="많이 부른 곡, 쉬었던 곡 추천, 키 점검" onClick={() => cmd.open('songStats')} />
            <Big icon="©" label="저작권(CCLI) 보고" title="기간별 사용 곡과 CCLI 번호를 CSV로" onClick={() => cmd.open('ccli')} />
          </Group>
          {cmd.templateMarket && (
            <Group label="템플릿">
              <Big icon="🛍" label="템플릿 마켓" title="슬라이드 템플릿을 파일로 주고받기 (실험 기능 — 설정에서 켭니다)" onClick={() => cmd.open('templateMarket')} />
            </Group>
          )}
    </>
  );
}
