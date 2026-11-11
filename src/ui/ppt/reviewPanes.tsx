// Review › Proofing › Spelling pane and Review › Language (DeckCraft review.spellingChange,
// review.replaceWord, format.language / languageAll).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Presentation, Slide } from '../../domain/types';
import { accept, compare, type Revision } from '../../domain/compare';
import { importPptx } from '../../domain/io/pptxImport';
import { desktop } from '../../domain/desktop';
import { addToDictionary, changeWord, misspellings, userDictionary, type SpellWord } from '../../domain/spelling';
import { thesaurus } from '../../engine';
import { Check, Dialog, Field } from './dialogs';
import type { Ed } from './editor';

const keyOf = (h: SpellWord) => `${h.slideId}|${h.field}|${h.elementId ?? ''}|${h.cell?.join(',') ?? ''}|${h.start}`;

export function SpellingPane({ ed }: { ed: Ed }) {
  const p = ed.p;
  const [ignoreAll, setIgnoreAll] = useState<Set<string>>(() => userDictionary());
  const [ignoreOnce, setIgnoreOnce] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState(0);
  const check = desktop?.isMisspelled;
  const hits = useMemo(() => (p && check ? misspellings(p, (w) => check(w), ignoreAll).filter((h) => !ignoreOnce.has(keyOf(h))) : []), [p, check, ignoreAll, ignoreOnce]);
  const cur = hits[0];
  const suggestions = useMemo(() => (cur && desktop?.spellSuggestions ? desktop.spellSuggestions(cur.word).slice(0, 8) : []), [cur?.word]);
  useEffect(() => { setPick(0); }, [cur?.word, cur?.start, cur?.slideId]);
  // Show where the word is: its slide, and its text box selected.
  useEffect(() => {
    if (!cur) return;
    ed.cmd.setSlideId(cur.slideId);
    if (cur.elementId) setTimeout(() => ed.setSel([cur.elementId!]), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.slideId, cur?.elementId, cur?.start]);
  const to = suggestions[pick];
  const synonyms = useMemo(() => (to ? thesaurus(to).flatMap((g) => g.synonyms).slice(0, 6) : []), [to]);
  const change = (all: boolean) => { if (p && cur && to) ed.updatePres({ slides: changeWord(p.slides, cur, to, all) }); };
  return (
    <div className="spell-pane">
      <div className="task-head"><span>맞춤법 검사</span><button type="button" className="task-x" onClick={() => ed.setPane(null)}>✕</button></div>
      {!check ? (
        <p className="dlg-note">맞춤법 사전은 데스크톱 앱에서 씁니다. 이 브라우저에서는 검토 › 맞춤법 검사를 켜면 입력할 때 틀린 단어에 밑줄이 그어집니다.</p>
      ) : !cur ? (
        <p className="spell-done">✔ 맞춤법 검사를 마쳤습니다. 틀린 단어가 없습니다.</p>
      ) : (
        <>
          <div className="spell-word"><small>사전에 없는 단어</small><b>{cur.word}</b><small>{({ title: '제목', text: '본문', subtext: '둘째 줄', notes: '슬라이드 노트', el: '텍스트 상자', cell: '표' } as const)[cur.field]} · 슬라이드 {(p?.slides.findIndex((x) => x.id === cur.slideId) ?? 0) + 1}</small></div>
          <div className="spell-row">
            <button type="button" onClick={() => setIgnoreOnce(new Set([...ignoreOnce, keyOf(cur)]))}>건너뛰기</button>
            <button type="button" onClick={() => setIgnoreAll(new Set([...ignoreAll, cur.word.toLowerCase()]))}>모두 건너뛰기</button>
            <button type="button" onClick={() => { addToDictionary(cur.word); setIgnoreAll(new Set([...ignoreAll, cur.word.toLowerCase()])); }}>사전에 추가</button>
          </div>
          <div className="dlg-list spell-suggestions">
            {suggestions.length ? suggestions.map((sg, i) => <button key={sg} type="button" className={pick === i ? 'on' : ''} onClick={() => setPick(i)} onDoubleClick={() => change(false)}>{sg}</button>) : <span className="dlg-note">추천 단어가 없습니다.</span>}
          </div>
          <div className="spell-row">
            <button type="button" className="primary" disabled={!to || !ed.canEdit} onClick={() => change(false)}>변경</button>
            <button type="button" disabled={!to || !ed.canEdit} onClick={() => change(true)}>모두 변경</button>
          </div>
          {synonyms.length > 0 && <div className="spell-syn"><small>“{to}”의 동의어</small>{synonyms.map((w) => <span key={w}>{w}</span>)}</div>}
          <p className="dlg-note">남은 단어 {hits.length}개</p>
        </>
      )}
    </div>
  );
}

export const LANGUAGES: [string, string][] = [['ko-KR', '한국어'], ['en-US', '영어(미국)'], ['en-GB', '영어(영국)'], ['ja-JP', '일본어'], ['zh-CN', '중국어(간체)'], ['zh-TW', '중국어(번체)'], ['es-ES', '스페인어'], ['fr-FR', '프랑스어'], ['de-DE', '독일어']];

/** Review › Language › Set Proofing Language: for the selected text boxes, or for all text. */
export function LanguageDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const texty = ed.selEls.filter((e) => e.kind === 'text' || e.kind === 'shape' || e.kind === 'table');
  const first = texty[0];
  const [lang, setLang] = useState(first?.lang ?? ed.slide?.lang ?? 'ko-KR');
  const [noProof, setNoProof] = useState(!!(first?.noProof ?? ed.slide?.noProof));
  const [all, setAll] = useState(!texty.length);
  const ok = () => {
    const p = ed.p;
    if (!p) return;
    const patch = { lang, noProof: noProof || undefined };
    if (all) ed.updatePres({ slides: p.slides.map((s) => ({ ...s, ...patch, elements: s.elements?.map((e) => (e.kind === 'text' || e.kind === 'shape' || e.kind === 'table' ? { ...e, ...patch } : e)) })) });
    else ed.setElements((els) => els.map((e) => (texty.some((t) => t.id === e.id) ? { ...e, ...patch } : e)));
    onClose();
  };
  return (
    <Dialog title="언어" onClose={onClose} onOk={ok} okDisabled={!ed.canEdit}>
      <Field label="선택한 텍스트를 다음 언어로 표시">
        <select value={lang} onChange={(e) => setLang(e.target.value)}>{LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <Check label="맞춤법 또는 문법 검사 안 함" checked={noProof} onChange={setNoProof} />
      <Check label="모든 텍스트에 적용 (프레젠테이션 전체)" checked={all} onChange={setAll} />
    </Dialog>
  );
}

// ── Review › Compare ────────────────────────────────────────────────────────────────────────────
let compareTarget: Presentation | null = null;

/** Review › Compare: choose the other version (a presentation in the library, or a .pptx file). */
export function CompareDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const others = ed.state.library.presentations.filter((x) => x.id !== ed.p?.id);
  const [pick, setPick] = useState(others[0]?.id ?? '');
  const file = useRef<HTMLInputElement>(null);
  const start = (other: Presentation) => { compareTarget = other; ed.setPane('revisions'); onClose(); };
  const fromFile = async (f: File | undefined) => {
    if (!f || !ed.p) return;
    const imported = await importPptx(f).catch(() => []);
    if (!imported.length) return ed.cmd.notify('이 파일에서 슬라이드를 읽지 못했습니다');
    // A file brings text only: compared slide by slide by position (title, body, notes).
    start({ ...ed.p, id: '__file', title: f.name, slides: imported.map((s, i) => ({ ...(ed.p!.slides[i] ?? { id: `file-${i}`, group: 'Slide' }), id: ed.p!.slides[i]?.id ?? `file-${i}`, title: s.title, text: s.text, notes: s.notes })) as Slide[] });
  };
  return (
    <Dialog title="비교 — 이 프레젠테이션과 비교할 파일" onClose={onClose} onOk={() => { const o = others.find((x) => x.id === pick); if (o) start(o); }} okLabel="비교" okDisabled={!pick}>
      <Field label="라이브러리의 프레젠테이션"><select value={pick} onChange={(e) => setPick(e.target.value)}>{others.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>
      <div className="dlg-row"><button type="button" onClick={() => file.current?.click()}>PowerPoint 파일(.pptx)에서…</button><span className="dlg-note">파일은 텍스트(제목 · 본문 · 노트)를 비교합니다.</span></div>
      <input ref={file} type="file" accept=".pptx" hidden onChange={(e) => { void fromFile(e.target.files?.[0]); e.target.value = ''; }} />
    </Dialog>
  );
}

/** The Revisions pane: each change in the other version, to accept or reject. */
export function RevisionsPane({ ed }: { ed: Ed }) {
  const p = ed.p;
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const other = compareTarget;
  const revs = useMemo(() => (p && other ? compare(p, other).filter((r) => !rejected.has(r.id)) : []), [p, other, rejected]);
  const go = (r: Revision) => { const id = 'slideId' in r ? r.slideId : r.after; if (id) ed.cmd.setSlideId(id); };
  const end = () => { compareTarget = null; ed.setPane(null); };
  return (
    <div className="spell-pane">
      <div className="task-head"><span>수정 내용{other ? ` — ${other.title}` : ''}</span><button type="button" className="task-x" onClick={end}>✕</button></div>
      {!other ? <p className="dlg-note">검토 › 비교로 비교할 파일을 고르세요.</p> : !revs.length ? <p className="spell-done">✔ 남은 수정 내용이 없습니다.</p> : (
        <>
          <div className="spell-row">
            <button type="button" className="primary" disabled={!ed.canEdit} onClick={() => { if (p) ed.updatePres({ slides: revs.reduce((sl, r) => accept(sl, r), p.slides) }); }}>모두 적용</button>
            <button type="button" onClick={() => setRejected(new Set([...rejected, ...revs.map((r) => r.id)]))}>모두 거부</button>
            <button type="button" onClick={end}>비교 끝내기</button>
          </div>
          <div className="rev-list">
            {revs.map((r) => (
              <div key={r.id} className="rev-row" onClick={() => go(r)}>
                <span className="grow">{r.label}</span>
                <button type="button" title="적용" disabled={!ed.canEdit} onClick={(e) => { e.stopPropagation(); if (p) ed.updatePres({ slides: accept(p.slides, r) }); }}>✓</button>
                <button type="button" title="거부" onClick={(e) => { e.stopPropagation(); setRejected(new Set([...rejected, r.id])); }}>✕</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
