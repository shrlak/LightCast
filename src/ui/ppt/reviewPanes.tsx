// Review › Proofing › Spelling pane and Review › Language (DeckCraft review.spellingChange,
// review.replaceWord, format.language / languageAll).
import { useEffect, useMemo, useState } from 'react';
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
