// The dialog boxes behind Insert (Header & Footer, SmartArt, Photo Album, Action, Zoom, Audio
// playback), Home › New Slide (Reuse Slides, Slides from Outline), Slide Show (Set Up Slide Show,
// Custom Shows), View (Guides) and Review (Thesaurus).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ElementAction, MediaPlayback, Presentation, Slide, SlideElement } from '../../domain/types';
import { sequence } from '../../domain/arrangement';
import { resolveBackground } from '../../domain/autoBackground';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { CANVAS_H, CANVAS_W } from '../../domain/canvas';
import { sections } from '../../domain/sections';
import { withMaster } from '../../domain/master';
import { albumSlides, readAlbum, replaceAlbum, type AlbumPicture } from '../../domain/photoAlbum';
import { nodesFromText, smartArtElements, smartArtOwner, relayoutSmartArt, textFromNodes, type SmartArtSpec } from '../../domain/smartArt';
import { smartArtCatalog, thesaurus } from '../../engine';
import { SlideCanvas } from '../SlideCanvas';
import { activeTextEditor } from '../RichTextEditor';
import { Check, Dialog, Field, Num } from './dialogs';
import { SMARTART_CATEGORIES, SMARTART_LAYOUT, SMARTART_STYLE, smartArtColorLabel } from './ko';
import type { DialogKind, Ed } from './editor';
import { GridGuidesDialog, ViewZoomDialog } from './viewDialogs';
import { selectionUnits } from '../../domain/editOps';
import { aspectLocked, fromCm, sizeUnit, toCm, type SizeSpec } from '../../domain/shapeOps';
import { InsertDialogs } from './dialogsInsert';
import { SlideSizeDialog, ThemeColorsDialog, ThemeFontsDialog } from './designTab';

const thumb = (ed: Ed, s: Slide, p: Presentation = ed.p!) => {
  const theme = ed.state.library.themes.find((t) => t.id === p.themeId) ?? ed.theme!;
  return <SlideCanvas slide={s} theme={theme} background={resolveBackground(s, p)} />;
};

/** Slides inserted after the current one (Reuse Slides, Slides from Outline, Photo Album, Summary Zoom). */
function insertSlides(ed: Ed, add: Slide[]) {
  const p = ed.p;
  if (!p || !add.length) return;
  const at = ed.slide ? p.slides.findIndex((s) => s.id === ed.slide!.id) + 1 : p.slides.length;
  const slides = [...p.slides];
  slides.splice(at, 0, ...(p.master?.elements.length ? add.map((s) => withMaster(s, p.master!.elements)) : add));
  ed.updatePres({ slides, ...(p.arrangementId ? { arrangementId: null } : {}) });
  ed.cmd.setSlideId(add[0].id);
}

// ── Insert › Header & Footer ──────────────────────────────────────────────────────────────────
function HeaderFooterDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const f = ed.slide?.footer ?? {};
  const [date, setDate] = useState(f.date !== undefined && f.date !== false);
  const [fixed, setFixed] = useState(typeof f.date === 'string');
  const [dateText, setDateText] = useState(typeof f.date === 'string' ? f.date : new Date().toLocaleDateString());
  const [number, setNumber] = useState(!!f.slideNumber);
  const [footer, setFooter] = useState(!!f.text);
  const [hideTitle, setHideTitle] = useState(!!f.hideOnTitle);
  const [text, setText] = useState(f.text ?? '');
  const value = () => {
    const v = { ...(date ? { date: fixed ? dateText : true } : {}), ...(number ? { slideNumber: true } : {}), ...(footer && text.trim() ? { text: text.trim() } : {}), ...(hideTitle ? { hideOnTitle: true } : {}) };
    return Object.keys(v).length ? v : undefined;
  };
  const apply = (all: boolean) => {
    const p = ed.p;
    if (!p) return;
    const v = value();
    if (all) ed.updatePres({ slides: p.slides.map((s) => ({ ...s, footer: v })) });
    else ed.updateSlide({ footer: v });
    onClose();
  };
  return (
    <Dialog title="머리글/바닥글" onClose={onClose} wide>
      <fieldset className="dlg-set">
        <legend>슬라이드에 포함할 내용</legend>
        <Check label="날짜 및 시간" checked={date} onChange={setDate} />
        <div className="dlg-indent">
          <label className="rb-check"><input type="radio" name="hf-date" disabled={!date} checked={!fixed} onChange={() => setFixed(false)} /> 자동으로 업데이트 ({new Date().toLocaleDateString()})</label>
          <label className="rb-check"><input type="radio" name="hf-date" disabled={!date} checked={fixed} onChange={() => setFixed(true)} /> 고정</label>
          <input disabled={!date || !fixed} value={dateText} onChange={(e) => setDateText(e.target.value)} />
        </div>
        <Check label="슬라이드 번호" checked={number} onChange={setNumber} />
        <Check label="바닥글" checked={footer} onChange={setFooter} />
        <div className="dlg-indent"><input disabled={!footer} value={text} placeholder="바닥글 텍스트" onChange={(e) => setText(e.target.value)} /></div>
        <Check label="제목 슬라이드에는 표시 안 함" checked={hideTitle} onChange={setHideTitle} />
      </fieldset>
      <div className="ppt-dialog-buttons">
        <button type="button" disabled={!ed.slide || !ed.canEdit} onClick={() => apply(false)}>적용</button>
        <button type="button" className="primary" disabled={!ed.p || !ed.canEdit} onClick={() => apply(true)}>모두 적용</button>
      </div>
    </Dialog>
  );
}

// ── Slide Show › Set Up Slide Show ────────────────────────────────────────────────────────────
function SetupShowDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const p = ed.p;
  const [loop, setLoop] = useState(!!p?.loop);
  const [noAnimation, setNoAnimation] = useState(!!p?.showSetup?.noAnimation);
  const [noTransitions, setNoTransitions] = useState(!!p?.showSetup?.noTransitions);
  const [manual, setManual] = useState(!!p?.showSetup?.manual);
  const ok = () => {
    const showSetup = { ...(noAnimation ? { noAnimation } : {}), ...(noTransitions ? { noTransitions } : {}), ...(manual ? { manual } : {}) };
    ed.updatePres({ loop: loop || undefined, showSetup: Object.keys(showSetup).length ? showSetup : undefined });
    onClose();
  };
  return (
    <Dialog title="쇼 설정" onClose={onClose} onOk={ok} okDisabled={!p || !!p.protected} wide>
      <fieldset className="dlg-set">
        <legend>보기 옵션</legend>
        <Check label="<Esc> 키를 누를 때까지 계속 실행 (마지막 슬라이드 다음에 처음으로)" checked={loop} onChange={setLoop} />
        <Check label="애니메이션 없이 보기" checked={noAnimation} onChange={setNoAnimation} />
        <Check label="화면 전환 없이 보기" checked={noTransitions} onChange={setNoTransitions} />
      </fieldset>
      <fieldset className="dlg-set">
        <legend>화면 전환</legend>
        <label className="rb-check"><input type="radio" name="adv" checked={manual} onChange={() => setManual(true)} /> 수동</label>
        <label className="rb-check"><input type="radio" name="adv" checked={!manual} onChange={() => setManual(false)} /> 설정된 시간 사용 (있는 경우)</label>
      </fieldset>
      <fieldset className="dlg-set">
        <legend>여러 모니터</legend>
        <button type="button" onClick={() => { ed.cmd.open('settings'); onClose(); }}>출력 화면 설정…</button>
      </fieldset>
    </Dialog>
  );
}

// ── Slide Show › Custom Slide Show ────────────────────────────────────────────────────────────
function CustomShowsDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const p = ed.p;
  const shows = p?.customShows ?? [];
  const [pick, setPick] = useState(shows[0]?.id ?? '');
  const [editing, setEditing] = useState<{ id: string; name: string; slideIds: string[] } | null>(null);
  const [at, setAt] = useState<string | null>(null);
  if (!p) return null;
  const save = (list: NonNullable<Presentation['customShows']>) => ed.updatePres({ customShows: list.length ? list : undefined });
  const slideNo = (id: string) => p.slides.findIndex((s) => s.id === id) + 1;
  const title = (s: Slide) => (s.title || s.text.split('\n')[0] || s.elements?.find((e) => e.text)?.text?.split('\n')[0] || '(제목 없음)').slice(0, 40);
  if (editing) {
    const has = new Set(editing.slideIds);
    const move = (d: -1 | 1) => {
      if (!at) return;
      const i = editing.slideIds.indexOf(at), j = i + d;
      if (i < 0 || j < 0 || j >= editing.slideIds.length) return;
      const ids = [...editing.slideIds];
      [ids[i], ids[j]] = [ids[j], ids[i]];
      setEditing({ ...editing, slideIds: ids });
    };
    const done = () => {
      const list = shows.some((s) => s.id === editing.id) ? shows.map((s) => (s.id === editing.id ? editing : s)) : [...shows, editing];
      save(list);
      setPick(editing.id);
      setEditing(null);
    };
    return (
      <Dialog title="재구성한 쇼 정의" onClose={() => setEditing(null)} onOk={done} okDisabled={!editing.name.trim() || !editing.slideIds.length} wide>
        <Field label="슬라이드 쇼 이름"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
        <div className="dlg-cols">
          <div>
            <b>프레젠테이션에 있는 슬라이드</b>
            <div className="dlg-list">{p.slides.map((s, i) => <Check key={s.id} label={`${i + 1}. ${title(s)}`} checked={has.has(s.id)} onChange={(on) => setEditing({ ...editing, slideIds: on ? [...editing.slideIds, s.id] : editing.slideIds.filter((x) => x !== s.id) })} />)}</div>
          </div>
          <div>
            <b>재구성한 쇼에 있는 슬라이드</b>
            <div className="dlg-list">{editing.slideIds.map((id, k) => { const s = p.slides.find((x) => x.id === id); return s ? <button key={id} type="button" className={at === id ? 'on' : ''} onClick={() => setAt(id)}>{k + 1}. ({slideNo(id)}) {title(s)}</button> : null; })}</div>
            <div className="dlg-row"><button type="button" disabled={!at} onClick={() => move(-1)}>▲</button><button type="button" disabled={!at} onClick={() => move(1)}>▼</button><button type="button" disabled={!at} onClick={() => { setEditing({ ...editing, slideIds: editing.slideIds.filter((x) => x !== at) }); setAt(null); }}>✕ 제거</button></div>
          </div>
        </div>
      </Dialog>
    );
  }
  const cur = shows.find((s) => s.id === pick);
  return (
    <Dialog title="재구성한 쇼" onClose={onClose}>
      <div className="dlg-list">{shows.length ? shows.map((s) => <button key={s.id} type="button" className={pick === s.id ? 'on' : ''} onClick={() => setPick(s.id)}>{s.name} ({s.slideIds.length}장)</button>) : <span className="dlg-note">재구성한 쇼가 없습니다.</span>}</div>
      <div className="dlg-row">
        <button type="button" disabled={!ed.canEdit && !!p.protected} onClick={() => setEditing({ id: uid('cs'), name: `재구성한 쇼 ${shows.length + 1}`, slideIds: [] })}>새로 만들기…</button>
        <button type="button" disabled={!cur} onClick={() => cur && setEditing({ ...cur })}>편집…</button>
        <button type="button" disabled={!cur} onClick={() => { save(shows.filter((s) => s.id !== pick)); setPick(''); }}>제거</button>
        <button type="button" disabled={!cur} onClick={() => cur && save([...shows, { ...cur, id: uid('cs'), name: `${cur.name}의 복사본` }])}>복사</button>
        <button type="button" className="primary" disabled={!cur} onClick={() => { if (cur) { ed.play({ ids: cur.slideIds }); onClose(); } }}>쇼 보기</button>
      </div>
    </Dialog>
  );
}

// ── Insert › SmartArt (and SmartArt Design › Text Pane / Change Layout) ─────────────────────
const SAMPLE = '첫째 항목\n\t세부 내용\n둘째 항목\n\t세부 내용\n셋째 항목';
/** Home › Paragraph › Convert to SmartArt: the text box whose lines become the graphic. */
let smartArtSeed: { text: string; box: { x: number; y: number; w: number; h: number }; replaceId: string; kind?: string } | null = null;
export const seedSmartArt = (seed: typeof smartArtSeed) => { smartArtSeed = seed; };
function SmartArtDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const cat = smartArtCatalog();
  // Read the seed once; it is forgotten when the dialog closes (the next SmartArt starts fresh).
  const [seed] = useState(() => smartArtSeed);
  useEffect(() => () => { smartArtSeed = null; }, []);
  const owner = seed ? undefined : smartArtOwner(ed.elements, ed.selEls);
  const spec0 = owner?.smartArt;
  const [kind, setKind] = useState(spec0?.kind ?? seed?.kind ?? cat?.layouts[0]?.id ?? 'list');
  const [style, setStyle] = useState(spec0?.style ?? 'flat');
  const [colors, setColors] = useState(spec0?.colors ?? 'colorful');
  const [text, setText] = useState(spec0 ? textFromNodes(spec0.nodes) : seed?.text ?? SAMPLE);
  const box = spec0?.box ?? seed?.box ?? { x: 220, y: 190, w: 1000, h: 700 };
  const spec: SmartArtSpec = useMemo(() => ({ kind, style, colors, nodes: nodesFromText(text), box }), [kind, style, colors, text, box]);
  const preview = useMemo(() => smartArtElements(spec, ed.p?.colorScheme), [spec, ed.p?.colorScheme]);
  if (!cat) return <Dialog title="SmartArt 그래픽 선택" onClose={onClose}><p>엔진을 불러오지 못했습니다.</p></Dialog>;
  const ok = () => {
    if (owner) {
      const r = relayoutSmartArt(ed.elements, owner.id, spec, ed.p?.colorScheme);
      if (r) { ed.setElements(() => r.elements); ed.setSel(r.ids); }
    } else if (preview) {
      ed.setElements((els) => [...els.filter((e) => e.id !== seed?.replaceId), ...preview]);
      ed.setSel([preview[0].id]);
    }
    onClose();
  };
  return (
    <Dialog title={owner ? 'SmartArt 편집' : 'SmartArt 그래픽 선택'} onClose={onClose} onOk={ok} okLabel={owner ? '적용' : '삽입'} okDisabled={!preview?.length || !ed.canEdit} wide>
      <div className="smartart-dlg">
        <div className="dlg-list smartart-layouts">
          {SMARTART_CATEGORIES.map((c) => {
            const items = cat.layouts.filter((l) => (SMARTART_LAYOUT[l.id]?.[1] ?? '목록형') === c);
            return items.length ? (
              <div key={c} className="smartart-cat">
                <div className="smartart-cat-head">{c}</div>
                {items.map((l) => <button key={l.id} type="button" className={kind === l.id ? 'on' : ''} title={l.label} onClick={() => setKind(l.id)}>{SMARTART_LAYOUT[l.id]?.[0] ?? l.label}</button>)}
              </div>
            ) : null;
          })}
        </div>
        <div className="smartart-side">
          <div className="smartart-preview">{preview && ed.theme && <SlideCanvas slide={{ id: '__sa', group: '', text: '', elements: preview }} theme={ed.theme} background={ed.slide && ed.p ? resolveBackground(ed.slide, ed.p) : null} />}</div>
          <Field label="텍스트 창 (Tab 키 = 한 수준 아래)">
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
              if (e.key !== 'Tab') return;
              e.preventDefault();
              const t = e.currentTarget, a = t.selectionStart, lineStart = t.value.lastIndexOf('\n', a - 1) + 1;
              const v = e.shiftKey ? (t.value[lineStart] === '\t' ? t.value.slice(0, lineStart) + t.value.slice(lineStart + 1) : t.value) : t.value.slice(0, lineStart) + '\t' + t.value.slice(lineStart);
              setText(v);
              requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = Math.max(lineStart, a + (v.length - t.value.length)); });
            }} />
          </Field>
          <div className="dlg-cols">
            <Field label="SmartArt 스타일"><select value={style} onChange={(e) => setStyle(e.target.value)}>{cat.styles.map((s) => <option key={s.id} value={s.id}>{SMARTART_STYLE[s.id] ?? s.label}</option>)}</select></Field>
            <Field label="색 변경"><select value={colors} onChange={(e) => setColors(e.target.value)}>{cat.colors.map((s) => <option key={s.id} value={s.id}>{smartArtColorLabel(s.id, s.label)}</option>)}</select></Field>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// ── Insert › Photo Album ──────────────────────────────────────────────────────────────────────
function PhotoAlbumDialog({ ed, onClose, edit }: { ed: Ed; onClose: () => void; edit?: boolean }) {
  // Edit Photo Album: the album of the current slide (or the presentation's first album).
  const albumId = edit ? (ed.slide?.album?.id ?? ed.p?.slides.find((x) => x.album)?.album?.id) : undefined;
  const existing = albumId && ed.p ? readAlbum(ed.p.slides, albumId) : null;
  const [pics, setPics] = useState<AlbumPicture[]>(existing?.pictures ?? []);
  const [per, setPer] = useState<1 | 2 | 4>(existing?.options.per ?? 1);
  const [titles, setTitles] = useState(existing?.options.titles ?? false);
  const [captions, setCaptions] = useState(existing?.options.captions ?? false);
  const [frame, setFrame] = useState<string>(existing?.options.frame ?? '');
  const [at, setAt] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  if (edit && !existing) return <Dialog title="사진 앨범 편집" onClose={onClose}><p>이 프레젠테이션에 사진 앨범이 없습니다. 삽입 › 사진 앨범으로 먼저 만드세요.</p></Dialog>;
  const addFiles = async (files: File[]) => {
    const added: AlbumPicture[] = [];
    for (const f of files) {
      const id = uid('m');
      await putMedia(id, f);
      ed.dispatch({ type: 'media/add', media: { id, name: f.name, type: 'image' } });
      added.push({ mediaId: id, name: f.name });
    }
    setPics((cur) => [...cur, ...added]);
  };
  const move = (d: -1 | 1) => {
    if (at == null) return;
    const j = at + d;
    if (j < 0 || j >= pics.length) return;
    const next = [...pics];
    [next[at], next[j]] = [next[j], next[at]];
    setPics(next);
    setAt(j);
  };
  const ok = () => {
    if (!pics.length || !ed.p) return;
    const o = { per, frame, titles, captions };
    if (existing && albumId) ed.updatePres({ slides: replaceAlbum(ed.p.slides, albumId, pics, o) });
    else insertSlides(ed, albumSlides(pics, o, ed.slide?.group ?? '사진 앨범'));
    onClose();
  };
  return (
    <Dialog title={existing ? '사진 앨범 편집' : '사진 앨범'} onClose={onClose} onOk={ok} okLabel={existing ? '업데이트' : '만들기'} okDisabled={!pics.length || !ed.canEdit} wide>
      <div className="dlg-row"><button type="button" onClick={() => input.current?.click()}>파일/디스크…</button><span>{pics.length ? `그림 ${pics.length}개` : '앨범에 넣을 그림을 고르세요'}</span></div>
      <div className="dlg-list">{pics.map((f, i) => <button key={`${f.mediaId}-${i}`} type="button" className={at === i ? 'on' : ''} onClick={() => setAt(i)}>{i + 1}. {f.name}</button>)}</div>
      <div className="dlg-row">
        <button type="button" disabled={at == null || at === 0} onClick={() => move(-1)}>▲</button>
        <button type="button" disabled={at == null || at === pics.length - 1} onClick={() => move(1)}>▼</button>
        <button type="button" disabled={at == null} onClick={() => { if (at == null) return; setPics(pics.filter((_, j) => j !== at)); setAt(null); }}>제거</button>
      </div>
      <div className="dlg-grid3">
        <Field label="그림 레이아웃"><select value={per} onChange={(e) => setPer(Number(e.target.value) as 1 | 2 | 4)}><option value={1}>그림 1개</option><option value={2}>그림 2개</option><option value={4}>그림 4개</option></select></Field>
        <Field label="프레임 모양"><select value={frame} onChange={(e) => setFrame(e.target.value)}><option value="">사각형</option><option value="rounded">둥근 사각형</option><option value="simpleFrame">단순형 프레임, 흰색</option><option value="softEdge">부드러운 가장자리 사각형</option><option value="shadowRect">그림자 사각형</option></select></Field>
      </div>
      <Check label="제목 포함" checked={titles} onChange={setTitles} />
      <Check label="모든 그림 아래에 캡션 넣기" checked={captions} onChange={setCaptions} />
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    </Dialog>
  );
}

// ── Insert › Action ───────────────────────────────────────────────────────────────────────────
function ActionDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const el = ed.selEls[0];
  const [on, setOn] = useState<'click' | 'hover'>('click');
  const initial = (w: 'click' | 'hover'): ElementAction | undefined => (w === 'hover' ? el?.hoverAction : el?.action ?? (el?.href ? { kind: 'url' as const, url: el.href } : undefined));
  const [acts, setActs] = useState<Record<'click' | 'hover', ElementAction | undefined>>({ click: initial('click'), hover: initial('hover') });
  const [tip, setTip] = useState(el?.tooltip ?? '');
  const shows = ed.p?.customShows ?? [];
  if (!el || !ed.p) return <Dialog title="실행 설정" onClose={onClose}><p>동작을 지정할 개체를 고르세요.</p></Dialog>;
  const a = acts[on];
  const kind = a?.kind ?? 'none';
  const put = (next: ElementAction | undefined) => setActs({ ...acts, [on]: next });
  const pick = (k: string) => {
    if (k === 'none') return put(undefined);
    if (k === 'slide') return put({ kind: 'slide', slideId: a?.slideId ?? ed.p!.slides[0]?.id });
    if (k === 'url') return put({ kind: 'url', url: a?.url ?? 'https://' });
    if (k === 'customShow') return put({ kind: 'customShow', show: a?.show ?? shows[0]?.id });
    put({ kind: k as ElementAction['kind'] });
  };
  const ok = () => {
    const clean = (x: ElementAction | undefined) => (x?.kind === 'url' ? { ...x, url: x.url?.trim() } : x?.kind === 'customShow' && !x.show ? undefined : x);
    ed.setElements((els) => els.map((e) => (ed.selEls.some((s) => s.id === e.id) ? { ...e, action: clean(acts.click), hoverAction: clean(acts.hover), tooltip: tip.trim() || undefined, href: undefined } : e)));
    onClose();
  };
  return (
    <Dialog title="실행 설정" onClose={onClose} onOk={ok} okDisabled={!ed.canEdit}>
      <div className="dlg-row">
        <button type="button" className={on === 'click' ? 'primary' : ''} onClick={() => setOn('click')}>마우스를 클릭할 때</button>
        <button type="button" className={on === 'hover' ? 'primary' : ''} onClick={() => setOn('hover')}>마우스를 가져갈 때</button>
      </div>
      <label className="rb-check"><input type="radio" checked={kind === 'none'} onChange={() => pick('none')} /> 없음</label>
      <label className="rb-check"><input type="radio" checked={kind !== 'none'} onChange={() => pick('next')} /> 하이퍼링크:</label>
      <select disabled={kind === 'none'} value={kind === 'none' ? 'next' : kind} onChange={(e) => pick(e.target.value)}>
        <option value="next">다음 슬라이드</option><option value="prev">이전 슬라이드</option><option value="first">첫째 슬라이드</option><option value="last">마지막 슬라이드</option>
        <option value="lastViewed">마지막으로 본 슬라이드</option><option value="end">쇼 마침</option><option value="customShow">재구성한 쇼…</option>
        <option value="slide">슬라이드…</option><option value="url">URL…</option><option value="playMedia">미디어 재생</option>
      </select>
      {kind === 'slide' && <select value={a?.slideId} onChange={(e) => put({ kind: 'slide', slideId: e.target.value })}>{ed.p.slides.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {(s.title || s.text.split('\n')[0] || s.group).slice(0, 40)}</option>)}</select>}
      {kind === 'url' && <input value={a?.url ?? ''} onChange={(e) => put({ kind: 'url', url: e.target.value })} />}
      {kind === 'customShow' && (shows.length
        ? <select value={a?.show} onChange={(e) => put({ kind: 'customShow', show: e.target.value })}>{shows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        : <p className="dlg-note">재구성한 쇼가 없습니다. 슬라이드 쇼 › 재구성한 쇼에서 먼저 만드세요.</p>)}
      <Field label="화면 설명"><input value={tip} onChange={(e) => setTip(e.target.value)} /></Field>
      <p className="dlg-note">슬라이드 쇼(읽기용 보기)에서 개체를 클릭하거나 마우스를 가져가면 실행됩니다.</p>
    </Dialog>
  );
}

// ── Home › New Slide › Reuse Slides ───────────────────────────────────────────────────────────
function ReuseDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const others = ed.state.library.presentations.filter((x) => x.id !== ed.p?.id && x.slides.length);
  const [from, setFrom] = useState(others[0]?.id ?? '');
  const [keep, setKeep] = useState(true);
  const src = others.find((x) => x.id === from);
  const reuse = (list: Slide[]) => {
    if (!src || !ed.canEdit) return;
    insertSlides(ed, list.map((s) => ({
      ...s, id: uid('s'), elements: s.elements?.map((e) => ({ ...e, id: uid('el') })), comments: undefined,
      ...(keep ? { background: s.background ?? resolveBackground(s, src) ?? undefined } : { background: undefined, style: undefined }),
    } as Slide)));
    ed.cmd.notify(`슬라이드 ${list.length}장을 넣었습니다`);
  };
  return (
    <Dialog title="슬라이드 다시 사용" onClose={onClose} wide>
      <Field label="프레젠테이션"><select value={from} onChange={(e) => setFrom(e.target.value)}>{others.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>
      <Check label="원본 서식 유지" checked={keep} onChange={setKeep} />
      <div className="reuse-grid">{src && sequence(src).map(({ slide: s }, i) => <button key={`${s.id}-${i}`} type="button" className="reuse-cell" title="클릭하면 현재 슬라이드 다음에 넣습니다" disabled={!ed.canEdit} onClick={() => reuse([s])}>{thumb(ed, s, src)}<span>{i + 1}</span></button>)}</div>
      <div className="dlg-row"><button type="button" disabled={!src || !ed.canEdit} onClick={() => src && reuse(src.slides)}>모든 슬라이드 삽입</button></div>
    </Dialog>
  );
}

// ── Home › New Slide › Slides from Outline ────────────────────────────────────────────────────
export function outlineSlides(text: string, group: string): Slide[] {
  const out: Slide[] = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    const indented = /^(\t| {2,}|[-*•] )/.test(raw);
    const line = raw.replace(/^(\t| {2,})+/, '').replace(/^[-*•]\s+/, '').replace(/^#+\s*/, '').trimEnd();
    if (!indented || !out.length) out.push({ id: uid('s'), group, title: line, text: '' });
    else out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text ? `${out[out.length - 1].text}\n${line}` : line };
  }
  return out;
}
function OutlineDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const slides = useMemo(() => outlineSlides(text, ed.slide?.group ?? 'Slide'), [text, ed.slide?.group]);
  return (
    <Dialog title="개요에서 슬라이드 만들기" onClose={onClose} onOk={() => { insertSlides(ed, slides); onClose(); }} okLabel={`슬라이드 ${slides.length}장 삽입`} okDisabled={!slides.length || !ed.canEdit} wide>
      <div className="dlg-row"><button type="button" onClick={() => input.current?.click()}>개요 파일 열기 (.txt, .md)…</button><span className="dlg-note">들여쓰지 않은 줄 = 슬라이드 제목, 들여쓴 줄 = 본문</span></div>
      <textarea rows={12} value={text} placeholder={'첫째 슬라이드 제목\n\t본문 한 줄\n\t본문 두 줄\n둘째 슬라이드 제목'} onChange={(e) => setText(e.target.value)} />
      <input ref={input} type="file" accept=".txt,.md,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(setText); e.target.value = ''; }} />
    </Dialog>
  );
}

// ── View › Guides ─────────────────────────────────────────────────────────────────────────────
// ── Review › Thesaurus ────────────────────────────────────────────────────────────────────────
function ThesaurusDialog({ onClose }: { ed: Ed; onClose: () => void }) {
  const [word, setWord] = useState(() => window.getSelection()?.toString().trim().split(/\s+/)[0] ?? '');
  const [q, setQ] = useState(word);
  const groups = useMemo(() => (q ? thesaurus(q) : []), [q]);
  const use = (w: string) => {
    const editor = activeTextEditor();
    if (editor && editor.hasSelection()) document.execCommand('insertText', false, w);
    else void navigator.clipboard?.writeText(w);
  };
  return (
    <Dialog title="동의어 사전" onClose={onClose}>
      <div className="dlg-row"><input value={word} placeholder="찾을 단어" onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setQ(word.trim()); }} /><button type="button" onClick={() => setQ(word.trim())}>찾기</button></div>
      <div className="dlg-list">
        {q && !groups.length && <span className="dlg-note">"{q}"에 대한 결과가 없습니다.</span>}
        {groups.map((g) => (
          <div key={g.word} className="thes-group"><b>{g.word}</b>{g.synonyms.map((s) => <button key={s} type="button" title="텍스트를 선택한 채로 누르면 바꾸고, 아니면 복사합니다" onMouseDown={(e) => e.preventDefault()} onClick={() => use(s)}>{s}</button>)}</div>
        ))}
      </div>
    </Dialog>
  );
}

// ── Insert › Zoom (Summary / Section / Slide Zoom) ────────────────────────────────────────────
function ZoomDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const p = ed.p;
  const [mode, setMode] = useState<'slide' | 'section' | 'summary'>('slide');
  const [picked, setPicked] = useState<string[]>([]);
  // Zoom › Return to Zoom: on for section and summary zooms, off for slide zooms (as PowerPoint).
  const [back, setBack] = useState<boolean | null>(null);
  if (!p || !ed.theme) return null;
  const theme = ed.theme;
  const returns = back ?? mode !== 'slide';
  const secs = sections(p.slides);
  const zoomEl = (target: Slide, box: { x: number; y: number; w: number; h: number }): SlideElement => ({
    id: uid('el'), kind: 'zoom', ...box, targetSlideId: target.id, name: `확대/축소: ${target.title || target.group}`,
    zoomOf: { slide: target, theme, background: resolveBackground(target, p) },
    ...(returns ? { zoomReturn: true, zoomEndSlideId: endOf(target) } : {}),
  });
  // A section zoom returns after the section's last slide; the others after the slide itself.
  const endOf = (target: Slide) => {
    if (mode !== 'section') return target.id;
    const at = p.slides.findIndex((x) => x.id === target.id);
    let last = at;
    while (last + 1 < p.slides.length && p.slides[last + 1].group === target.group) last++;
    return p.slides[last].id;
  };
  const grid = (targets: Slide[]) => {
    const n = targets.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const cw = (CANVAS_W - 160) / cols, ch = (CANVAS_H - 260) / rows;
    const w = Math.min(cw - 30, (ch - 30) * (CANVAS_W / CANVAS_H)), h = w * (CANVAS_H / CANVAS_W);
    return targets.map((t, i) => zoomEl(t, { x: 80 + (i % cols) * cw + (cw - w) / 2, y: 200 + Math.floor(i / cols) * ch + (ch - h) / 2, w, h }));
  };
  const ok = () => {
    if (mode === 'summary') {
      const targets = secs.map((s) => p.slides[s.start]);
      insertSlides(ed, [{ id: uid('s'), group: '요약', text: '', elements: [{ id: uid('el'), kind: 'text', text: '요약', x: 80, y: 50, w: CANVAS_W - 160, h: 120, fontSize: 72, bold: true, color: '#ffffff', align: 'center' }, ...grid(targets)] }]);
    } else {
      const targets = mode === 'section' ? picked.map((name) => p.slides[secs.find((s) => s.name === name)?.start ?? -1]).filter(Boolean) : picked.map((id) => p.slides.find((s) => s.id === id)).filter((s): s is Slide => !!s);
      const els = grid(targets);
      ed.setElements((cur) => [...cur, ...els]);
      ed.setSel(els.map((e) => e.id));
    }
    onClose();
  };
  return (
    <Dialog title="확대/축소 삽입" onClose={onClose} onOk={ok} okLabel="삽입" okDisabled={!ed.canEdit || (mode !== 'summary' && !picked.length)} wide>
      <div className="dlg-tabs">
        {([['slide', '슬라이드 확대/축소'], ['section', '구역 확대/축소'], ['summary', '요약 확대/축소']] as const).map(([m, l]) => <button key={m} type="button" className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setPicked([]); }}>{l}</button>)}
      </div>
      <Check label="확대/축소로 돌아가기" checked={returns} onChange={setBack} />
      {mode === 'summary' && <p className="dlg-note">각 구역의 첫 슬라이드로 가는 확대/축소가 담긴 요약 슬라이드를 현재 슬라이드 다음에 만듭니다 (구역 {secs.length}개).</p>}
      {mode === 'section' && <div className="dlg-list">{secs.map((s) => <Check key={s.name + s.start} label={`${s.name} (${s.count}장)`} checked={picked.includes(s.name)} onChange={(on) => setPicked(on ? [...picked, s.name] : picked.filter((x) => x !== s.name))} />)}</div>}
      {mode === 'slide' && (
        <div className="reuse-grid">{p.slides.map((s, i) => <button key={s.id} type="button" className={`reuse-cell ${picked.includes(s.id) ? 'on' : ''}`} onClick={() => setPicked(picked.includes(s.id) ? picked.filter((x) => x !== s.id) : [...picked, s.id])}>{thumb(ed, s)}<span>{i + 1}</span></button>)}</div>
      )}
    </Dialog>
  );
}

// ── Video / Audio Format › Playback ───────────────────────────────────────────────────────────
function PlaybackDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const el = ed.selEls.find((e) => e.kind === 'audio' || e.kind === 'video');
  const [v, setV] = useState<MediaPlayback>(el?.playback ?? {});
  if (!el) return <Dialog title="재생" onClose={onClose}><p>오디오나 비디오를 고르세요.</p></Dialog>;
  const audio = el.kind === 'audio';
  const set = (patch: Partial<MediaPlayback>) => setV({ ...v, ...patch });
  const ok = () => {
    const clean = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== false && x !== 0)) as MediaPlayback;
    if (v.volume === 0) clean.volume = 0;
    ed.setElements((els) => els.map((e) => (e.id === el.id ? { ...e, playback: Object.keys(clean).length ? clean : undefined } : e)));
    onClose();
  };
  return (
    <Dialog title={audio ? '오디오 재생' : '비디오 재생'} onClose={onClose} onOk={ok} okDisabled={!ed.canEdit}>
      <Field label="시작"><select value={v.autoplay ? 'auto' : 'click'} onChange={(e) => set({ autoplay: e.target.value === 'auto' || undefined })}><option value="click">클릭할 때</option><option value="auto">자동 실행</option></select></Field>
      <div className="dlg-grid3">
        <Field label="볼륨"><select value={v.muted ? 'mute' : String(v.volume ?? 1)} onChange={(e) => set(e.target.value === 'mute' ? { muted: true } : { muted: undefined, volume: Number(e.target.value) })}><option value="0.25">낮게</option><option value="0.6">중간</option><option value="1">높게</option><option value="mute">음소거</option></select></Field>
        <Field label="페이드 인 (초)"><Num value={v.fadeIn ?? 0} min={0} max={30} step={0.25} onChange={(n) => set({ fadeIn: n || undefined })} /></Field>
        <Field label="페이드 아웃 (초)"><Num value={v.fadeOut ?? 0} min={0} max={30} step={0.25} onChange={(n) => set({ fadeOut: n || undefined })} /></Field>
      </div>
      <fieldset className="dlg-set">
        <legend>{audio ? '오디오 맞추기' : '비디오 트리밍'} (초)</legend>
        <div className="dlg-cols">
          <Field label="시작 시간"><Num value={v.start ?? 0} min={0} step={0.5} onChange={(n) => set({ start: n || undefined })} /></Field>
          <Field label="종료 시간 (0 = 끝까지)"><Num value={v.end ?? 0} min={0} step={0.5} onChange={(n) => set({ end: n || undefined })} /></Field>
        </div>
      </fieldset>
      <div className="dlg-cols">
        <Check label="반복 재생" checked={!!v.loop} onChange={(on) => set({ loop: on || undefined })} />
        <Check label="재생 후 되감기" checked={!!v.rewind} onChange={(on) => set({ rewind: on || undefined })} />
        <Check label="쇼 동안 숨기기" checked={!!v.hideDuringShow} onChange={(on) => set({ hideDuringShow: on || undefined })} />
        {audio ? <Check label="여러 슬라이드에서 재생" checked={!!v.acrossSlides} onChange={(on) => set({ acrossSlides: on || undefined })} />
          : <Check label="전체 화면 재생" checked={!!v.fullScreen} onChange={(on) => set({ fullScreen: on || undefined })} />}
      </div>
      {!audio && <Field label="포스터 프레임 (초 — 재생 전 보여 줄 장면)"><Num value={v.poster ?? 0} min={0} step={0.5} onChange={(n) => set({ poster: n || undefined })} /></Field>}
    </Dialog>
  );
}

export function MoreDialogs({ ed, kind, onClose }: { ed: Ed; kind: DialogKind; onClose: () => void }) {
  switch (kind) {
    case 'headerFooter': return <HeaderFooterDialog ed={ed} onClose={onClose} />;
    case 'setupShow': return <SetupShowDialog ed={ed} onClose={onClose} />;
    case 'customShows': return <CustomShowsDialog ed={ed} onClose={onClose} />;
    case 'smartArt': return <SmartArtDialog ed={ed} onClose={onClose} />;
    case 'photoAlbum': return <PhotoAlbumDialog ed={ed} onClose={onClose} />;
    case 'albumEdit': return <PhotoAlbumDialog ed={ed} onClose={onClose} edit />;
    case 'action': return <ActionDialog ed={ed} onClose={onClose} />;
    case 'reuse': return <ReuseDialog ed={ed} onClose={onClose} />;
    case 'outline': return <OutlineDialog ed={ed} onClose={onClose} />;
    case 'guides': return <GridGuidesDialog ed={ed} onClose={onClose} />;
    case 'viewZoom': return <ViewZoomDialog ed={ed} onClose={onClose} />;
    case 'thesaurus': return <ThesaurusDialog ed={ed} onClose={onClose} />;
    case 'zoom': return <ZoomDialog ed={ed} onClose={onClose} />;
    case 'audio': return <PlaybackDialog ed={ed} onClose={onClose} />;
    case 'sizePosition': return <SizePositionDialog ed={ed} onClose={onClose} />;
    case 'themeColors': return <ThemeColorsDialog ed={ed} onClose={onClose} />;
    case 'themeFonts': return <ThemeFontsDialog ed={ed} onClose={onClose} />;
    case 'slideSize': return <SlideSizeDialog onClose={onClose} />;
    default: return <InsertDialogs ed={ed} kind={kind} onClose={onClose} />;
  }
}

/** Shape Format › 크기 ⤡: position, size, scale (%), rotation and 가로 세로 비율 고정 (DeckCraft's shape.sizePosition). */
function SizePositionDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const units = selectionUnits(ed.elements, ed.selEls.map((e) => e.id));
  const first = units[0];
  const one = first && first.members.length === 1 ? ed.elements.find((e) => e.id === first.members[0]) : undefined;
  const [v, setV] = useState(() => ({
    x: toCm(first?.box.x ?? 0), y: toCm(first?.box.y ?? 0), w: toCm(first?.box.w ?? 0), h: toCm(first?.box.h ?? 0),
    rot: one?.rotation ?? 0, scaleW: 100, scaleH: 100, lock: one ? aspectLocked(one) : false,
  }));
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const set = (k: keyof typeof v, n: number | boolean) => { setV((o) => ({ ...o, [k]: n })); setEdited((o) => new Set(o).add(k)); };
  if (!first) return <Dialog title="크기 및 위치" onClose={onClose}><p>크기를 바꿀 개체를 고르세요.</p></Dialog>;
  const apply = () => {
    const has = (k: string) => edited.has(k);
    // Only what was changed is written; scale (%) is relative to the size when the dialog opened.
    const spec: SizeSpec = {
      ...(has('x') ? { x: fromCm(v.x) } : {}), ...(has('y') ? { y: fromCm(v.y) } : {}),
      ...(has('w') ? { w: fromCm(v.w) } : {}), ...(has('h') ? { h: fromCm(v.h) } : {}),
      ...(has('rot') ? { rot: v.rot } : {}), ...(has('scaleW') ? { scaleW: v.scaleW } : {}), ...(has('scaleH') ? { scaleH: v.scaleH } : {}),
      lockAspect: v.lock,
    };
    ed.setElements((els) => units.reduce((acc, u) => sizeUnit(acc, u.members, spec), els));
    onClose();
  };
  return (
    <Dialog title="크기 및 위치" onClose={onClose} onOk={apply}>
      <div className="dlg-grid">
        <Field label="높이 (cm)"><Num value={v.h} step={0.1} min={0.01} onChange={(n) => set('h', n)} /></Field>
        <Field label="너비 (cm)"><Num value={v.w} step={0.1} min={0.01} onChange={(n) => set('w', n)} /></Field>
        <Field label="회전 (°)"><Num value={v.rot} step={1} onChange={(n) => set('rot', n)} disabled={!one} /></Field>
        <Field label="높이 비율 (%)"><Num value={v.scaleH} step={5} min={1} onChange={(n) => set('scaleH', n)} /></Field>
        <Field label="너비 비율 (%)"><Num value={v.scaleW} step={5} min={1} onChange={(n) => set('scaleW', n)} /></Field>
        <Check label="가로 세로 비율 고정" checked={v.lock} onChange={(b) => set('lock', b)} />
        <Field label="가로 위치 (cm)"><Num value={v.x} step={0.1} onChange={(n) => set('x', n)} /></Field>
        <Field label="세로 위치 (cm)"><Num value={v.y} step={0.1} onChange={(n) => set('y', n)} /></Field>
      </div>
    </Dialog>
  );
}
