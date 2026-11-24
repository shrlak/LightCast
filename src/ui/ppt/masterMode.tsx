// 보기 › 슬라이드 마스터 / 유인물 마스터 / 슬라이드 노트 마스터, as PowerPoint and DeckCraft (ribbon/masters.rs) do
// them: the editor switches to the master. Its contextual tab sits left of 홈, the slide list becomes the master and
// its layouts, and the slide area edits the one picked; 홈, 삽입 and the panes work on it like on a slide.
// 마스터 보기 닫기 goes back. The handout and notes masters show their printed page.
import { useState } from 'react';
import type { HandoutMaster, MasterLayout, NotesMaster, Presentation, Slide, SlideElement } from '../../domain/types';
import { defaultLayouts, deleteLayoutBlocker, duplicateLayout, insertLayout, makePlaceholder, placeholderState, setPlaceholders, syncMaster, type PlaceholderWant } from '../../domain/master';
import { SlideCanvas } from '../SlideCanvas';
import { Check, Dialog } from './dialogs';
import type { Ed } from './editor';
import { Big, Col, DropButton, Group, MenuHead, MenuItem } from './ribbonParts';
import { DEFAULT_HANDOUT, DEFAULT_NOTES, PrintPages } from './printing';

/** Which master the editor shows (null: the slides). For the slide master, the layout picked (null: the master). */
export type MasterMode = null | { kind: 'slide'; at: string | null } | { kind: 'handout' } | { kind: 'notes' };

export interface MasterApi {
  mode: MasterMode;
  open: (kind: 'slide' | 'handout' | 'notes') => void;
  close: () => void;
  select: (at: string | null) => void;
}

type SlideMaster = NonNullable<Presentation['master']>;

/** The master as the editor edits it: the master or one of its layouts, as a slide. */
export function masterSlide(p: Presentation, at: string | null): Slide {
  const master = p.master ?? { elements: [] };
  const layout = at ? master.layouts?.find((l) => l.id === at) : undefined;
  return { id: `__master-${layout?.id ?? 'm'}`, group: '', text: '', elements: layout ? layout.elements : master.elements, background: master.background };
}

/** The presentation patch that saves the master with `patch` applied (slides keep the master's objects in step). */
export function masterPatch(p: Presentation, patch: Partial<SlideMaster>): Partial<Presentation> {
  const master: SlideMaster = { ...(p.master ?? { elements: [] }), ...patch };
  const empty = !master.elements.length && !master.background && !master.layouts?.length && !master.preserve;
  return { master: empty ? undefined : master, ...(patch.elements ? { slides: syncMaster(p.slides, patch.elements) } : {}) };
}

/** A change made to the master's slide in the editor (its objects or its background), as a presentation patch. */
export function masterSlidePatch(p: Presentation, at: string | null, patch: Partial<Slide>): Partial<Presentation> | null {
  const master = p.master ?? { elements: [] };
  const layouts = master.layouts ?? [];
  const out: Partial<SlideMaster> = {};
  if ('elements' in patch) {
    const els = patch.elements ?? [];
    if (at && layouts.some((l) => l.id === at)) out.layouts = layouts.map((l) => (l.id === at ? { ...l, elements: els } : l));
    else out.elements = els;
  }
  if ('background' in patch) out.background = patch.background ?? undefined;
  return Object.keys(out).length ? masterPatch(p, out) : null;
}

function useMasterTarget(ed: Ed) {
  const p = ed.p;
  const at = ed.master?.mode?.kind === 'slide' ? ed.master.mode.at : null;
  const master = p?.master ?? { elements: [] };
  const layouts = master.layouts ?? [];
  const layout = at ? layouts.find((l) => l.id === at) ?? null : null;
  const save = (patch: Partial<SlideMaster>) => p && ed.updatePres(masterPatch(p, patch));
  const setLayouts = (ls: MasterLayout[]) => save({ layouts: ls.length ? ls : undefined });
  const elements = layout ? layout.elements : master.elements;
  const saveEls = (els: SlideElement[]) => (layout ? setLayouts(layouts.map((l) => (l.id === layout.id ? { ...l, elements: els } : l))) : save({ elements: els }));
  return { p, at, master, layouts, layout, save, setLayouts, elements, saveEls };
}

const PLACEHOLDERS: [NonNullable<SlideElement['placeholder']>, string][] = [['content', '내용'], ['text', '텍스트'], ['picture', '그림'], ['chart', '차트'], ['table', '표'], ['media', '미디어']];

/** The 슬라이드 마스터 tab: 마스터 편집, 마스터 레이아웃, 테마 편집, 배경, 크기, 닫기. */
export function SlideMasterTab({ ed }: { ed: Ed }) {
  const t = useMasterTarget(ed);
  const [naming, setNaming] = useState<string | null>(null);
  const [layoutBox, setLayoutBox] = useState(false);
  const off = !t.p || !!t.p.protected;
  const ph = placeholderState(t.elements);
  const footersOn = ph.date && ph.footer && ph.slideNumber;
  const want = (w: PlaceholderWant) => t.saveEls(setPlaceholders(t.elements, w, t.master.elements));
  const lib = ed.state.library;
  return (
    <>
      <Group label="마스터 편집">
        <Big icon="▭⁺" label="레이아웃 삽입" title="현재 레이아웃 다음에 제목이 있는 새 레이아웃을 넣습니다" disabled={off}
          onClick={() => { const r = insertLayout(t.layouts.length ? t.layouts : defaultLayouts(), t.master.elements, t.at); t.setLayouts(r.layouts); ed.master?.select(r.id); }} />
        <Col>
          <MenuItem label="삭제" disabled={off || !t.layout} onClick={() => {
            if (!t.layout || !t.p) return;
            const why = deleteLayoutBlocker(t.layouts, t.p.slides, t.layout.id);
            if (why) return ed.cmd.notify(why);
            t.setLayouts(t.layouts.filter((l) => l.id !== t.layout!.id));
            ed.master?.select(null);
          }} />
          <MenuItem label="이름 바꾸기" disabled={off || !t.layout} onClick={() => t.layout && setNaming(t.layout.name)} />
          <MenuItem label="레이아웃 복제" disabled={off || !t.layout} onClick={() => { const r = t.layout && duplicateLayout(t.layouts, t.layout.id); if (r) { t.setLayouts(r.layouts); ed.master?.select(r.id); } }} />
        </Col>
        <Col>
          <label className="rb-check" title="쓰는 슬라이드가 없어도 지우지 않습니다"><input type="checkbox" disabled={off} checked={!!(t.layout ? t.layout.preserve : t.master.preserve)}
            onChange={(e) => (t.layout ? t.setLayouts(t.layouts.map((l) => (l.id === t.layout!.id ? { ...l, preserve: e.target.checked || undefined } : l))) : t.save({ preserve: e.target.checked || undefined }))} /> 유지</label>
        </Col>
      </Group>
      <Group label="마스터 레이아웃">
        <Big icon="▦" label="마스터 레이아웃" title="슬라이드 마스터에 둘 개체 틀" disabled={off || !!t.layout} onClick={() => setLayoutBox(true)} />
        <DropButton big icon="⊞" label="개체 틀 삽입" title="이 레이아웃에 개체 틀을 넣습니다" disabled={off || !t.layout} render={(close) => (
          <>{PLACEHOLDERS.map(([k, l]) => <MenuItem key={k} label={l} onClick={() => { const el = makePlaceholder(k); t.saveEls([...t.elements, el]); ed.setSel([el.id]); close(); }} />)}</>
        )} />
        <Col>
          <label className="rb-check"><input type="checkbox" disabled={off} checked={ph.title} onChange={(e) => want({ title: e.target.checked })} /> 제목</label>
          <label className="rb-check"><input type="checkbox" disabled={off} checked={footersOn} ref={(el) => { if (el) el.indeterminate = !footersOn && (ph.date || ph.footer || ph.slideNumber); }} onChange={(e) => want({ date: e.target.checked, footer: e.target.checked, slideNumber: e.target.checked })} /> 바닥글</label>
        </Col>
      </Group>
      <Group label="테마 편집">
        <DropButton big icon="Aa" label="테마" disabled={off} render={(close) => (
          <>
            <MenuHead>테마</MenuHead>
            {lib.themes.map((th) => <MenuItem key={th.id} label={th.name} on={t.p?.themeId === th.id} onClick={() => { ed.updatePres({ themeId: th.id }); close(); }} />)}
          </>
        )} />
        <Col>
          <MenuItem label="색" onClick={() => ed.setDialog('themeColors')} />
          <MenuItem label="글꼴" onClick={() => ed.setDialog('themeFonts')} />
        </Col>
      </Group>
      <Group label="배경">
        <Big icon="▧" label="배경 스타일" title="배경 서식 (마스터의 배경 — 모든 슬라이드)" disabled={off} onClick={() => ed.setPane(ed.pane === 'format' ? null : 'format')} />
      </Group>
      <Group label="크기">
        <Big icon="▭" label="슬라이드 크기" onClick={() => ed.setDialog('slideSize')} />
      </Group>
      <Group label="닫기">
        <Big icon="✕" label="마스터 보기 닫기" onClick={() => ed.master?.close()} />
      </Group>
      {naming !== null && t.layout && (
        <Dialog title="레이아웃 이름 바꾸기" onClose={() => setNaming(null)} okLabel="이름 바꾸기" okDisabled={!naming.trim()}
          onOk={() => { const name = naming.trim(); if (name) t.setLayouts(t.layouts.map((l) => (l.id === t.layout!.id ? { ...l, name } : l))); setNaming(null); }}>
          <label className="dlg-field">레이아웃 이름: <input autoFocus aria-label="레이아웃 이름" value={naming} onChange={(e) => setNaming(e.target.value)} /></label>
        </Dialog>
      )}
      {layoutBox && (
        <Dialog title="마스터 레이아웃" onClose={() => setLayoutBox(false)} onOk={() => setLayoutBox(false)}>
          <fieldset className="dlg-set"><legend>개체 틀</legend>
            <Check label="제목" checked={ph.title} onChange={(v) => want({ title: v })} />
            <Check label="텍스트" checked={ph.text} onChange={(v) => want({ text: v })} />
            <Check label="날짜" checked={ph.date} onChange={(v) => want({ date: v })} />
            <Check label="슬라이드 번호" checked={ph.slideNumber} onChange={(v) => want({ slideNumber: v })} />
            <Check label="바닥글" checked={ph.footer} onChange={(v) => want({ footer: v })} />
          </fieldset>
        </Dialog>
      )}
    </>
  );
}

/** The master and its layouts in the slide list: the master first, its layouts under it (PowerPoint's master view). */
export function MasterThumbs({ ed }: { ed: Ed }) {
  const t = useMasterTarget(ed);
  if (!t.p || !ed.theme) return null;
  const bg = t.master.background ?? null;
  const thumb = (els: SlideElement[]) => <SlideCanvas slide={{ id: '__t', group: '', text: '', elements: els }} theme={ed.theme!} background={bg} />;
  return (
    <div className="master-thumbs" role="listbox" aria-label="슬라이드 마스터">
      <button type="button" role="option" aria-selected={!t.at} className={`master-thumb main ${!t.at ? 'on' : ''}`} title="슬라이드 마스터: 모든 슬라이드에서 사용" onClick={() => ed.master?.select(null)}>
        <span className="master-num">1</span>{thumb(t.master.elements)}
      </button>
      {t.layouts.map((l) => (
        <button key={l.id} type="button" role="option" aria-selected={t.at === l.id} className={`master-thumb layout ${t.at === l.id ? 'on' : ''}`} title={`${l.name} 레이아웃${l.preserve ? ' (유지)' : ''}`} onClick={() => ed.master?.select(l.id)}>
          {thumb([...t.master.elements, ...l.elements])}<span className="master-name">{l.name}</span>
        </button>
      ))}
      {!t.layouts.length && <button type="button" className="master-add" disabled={!!t.p.protected} onClick={() => t.setLayouts(defaultLayouts())}>기본 레이아웃 추가</button>}
    </div>
  );
}

type PageMaster = HandoutMaster & NotesMaster;

function usePageMaster(ed: Ed, kind: 'handout' | 'notes') {
  const p = ed.p;
  const m: PageMaster = kind === 'handout' ? { ...DEFAULT_HANDOUT, ...p?.handoutMaster } : { ...DEFAULT_NOTES, ...p?.notesMaster } as PageMaster;
  const set = (patch: Partial<PageMaster>) => ed.updatePres(kind === 'handout' ? { handoutMaster: { ...(m as HandoutMaster), ...patch } } : { notesMaster: { ...(m as NotesMaster), ...patch } });
  return { m, set, off: !p || !!p.protected };
}

/** 머리글 / 날짜 / 바닥글 / 페이지 번호 check boxes (and the header and footer text). */
function PagePlaceholderGroup({ m, set, off, notes }: { m: PageMaster; set: (p: Partial<PageMaster>) => void; off: boolean; notes?: boolean }) {
  return (
    <Group label="개체 틀">
      <Col>
        <label className="rb-check"><input type="checkbox" disabled={off} checked={m.header !== undefined} onChange={(e) => set({ header: e.target.checked ? m.header ?? '' : undefined })} /> 머리글</label>
        {notes && <label className="rb-check"><input type="checkbox" disabled={off} checked={!m.noSlideImage} onChange={(e) => set({ noSlideImage: e.target.checked ? undefined : true })} /> 슬라이드 이미지</label>}
        <label className="rb-check"><input type="checkbox" disabled={off} checked={m.footer !== undefined} onChange={(e) => set({ footer: e.target.checked ? m.footer ?? '' : undefined })} /> 바닥글</label>
      </Col>
      <Col>
        <label className="rb-check"><input type="checkbox" disabled={off} checked={!!m.date} onChange={(e) => set({ date: e.target.checked || undefined })} /> 날짜</label>
        {notes && <label className="rb-check"><input type="checkbox" disabled={off} checked={!m.noBody} onChange={(e) => set({ noBody: e.target.checked ? undefined : true })} /> 본문</label>}
        <label className="rb-check"><input type="checkbox" disabled={off} checked={!!m.pageNumber} onChange={(e) => set({ pageNumber: e.target.checked || undefined })} /> 페이지 번호</label>
      </Col>
      <Col>
        {m.header !== undefined && <label className="rb-field">머리글 <input value={m.header} disabled={off} onChange={(e) => set({ header: e.target.value })} /></label>}
        {m.footer !== undefined && <label className="rb-field">바닥글 <input value={m.footer} disabled={off} onChange={(e) => set({ footer: e.target.value })} /></label>}
      </Col>
    </Group>
  );
}

/** The 유인물 마스터 tab: 페이지 설정 (유인물 방향, 페이지당 슬라이드 수), 개체 틀, 닫기. */
export function HandoutMasterTab({ ed }: { ed: Ed }) {
  const { m, set, off } = usePageMaster(ed, 'handout');
  return (
    <>
      <Group label="페이지 설정">
        <DropButton big icon="⬒" label="유인물 방향" disabled={off} render={(close) => (
          <><MenuItem label="세로" on={!m.landscape} onClick={() => { set({ landscape: undefined }); close(); }} /><MenuItem label="가로" on={!!m.landscape} onClick={() => { set({ landscape: true }); close(); }} /></>
        )} />
        <DropButton big icon="▦" label={`페이지당 슬라이드 수: ${m.perPage}`} disabled={off} render={(close) => (
          <>{([1, 2, 3, 4, 6, 9] as const).map((n) => <MenuItem key={n} label={`슬라이드 ${n}개`} on={m.perPage === n} onClick={() => { set({ perPage: n }); close(); }} />)}</>
        )} />
      </Group>
      <PagePlaceholderGroup m={m} set={set} off={off} />
      <Group label="닫기"><Big icon="✕" label="마스터 보기 닫기" onClick={() => ed.master?.close()} /></Group>
    </>
  );
}

/** The 슬라이드 노트 마스터 tab: 페이지 설정 (슬라이드 노트 방향), 개체 틀, 닫기. */
export function NotesMasterTab({ ed }: { ed: Ed }) {
  const { m, set, off } = usePageMaster(ed, 'notes');
  return (
    <>
      <Group label="페이지 설정">
        <DropButton big icon="⬒" label="슬라이드 노트 방향" disabled={off} render={(close) => (
          <><MenuItem label="세로" on={!m.landscape} onClick={() => { set({ landscape: undefined }); close(); }} /><MenuItem label="가로" on={!!m.landscape} onClick={() => { set({ landscape: true }); close(); }} /></>
        )} />
      </Group>
      <PagePlaceholderGroup m={m} set={set} off={off} notes />
      <Group label="닫기"><Big icon="✕" label="마스터 보기 닫기" onClick={() => ed.master?.close()} /></Group>
    </>
  );
}

/** The handout or notes master's page, where the slides would be. */
export function PageMasterStage({ ed, kind }: { ed: Ed; kind: 'handout' | 'notes' }) {
  const { m } = usePageMaster(ed, kind);
  const p = ed.p;
  if (!p) return null;
  const sample = { ...ed, p: { ...p, slides: p.slides.slice(0, kind === 'handout' ? m.perPage : 1) } };
  return (
    <div className="page-master-stage">
      <div className={`page-preview ${m.landscape ? 'landscape' : ''}`}>
        <div className="page-preview-inner"><PrintPages ed={sample} mode={kind} handout={kind === 'handout' ? m : undefined} notes={kind === 'notes' ? m : undefined} /></div>
      </div>
    </div>
  );
}
