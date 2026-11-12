// Review › 언어 교정 › 자동 고침 옵션 (DeckCraft's text.autocorrect, PowerPoint's AutoCorrect dialog):
// the case rules, the replacement list (your own entries and the built-in ones) and AutoFormat As
// You Type. The options are kept on this computer and apply to every presentation, as in PowerPoint.
import { useState } from 'react';
import { addEntry, autoCorrectPrefs, entryList, removeEntry, setAutoCorrectPrefs, type AutoCorrectPrefs } from '../../domain/autoCorrect';
import { Check, Dialog, Field } from './dialogs';

export function AutoCorrectDialog({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState<AutoCorrectPrefs>(autoCorrectPrefs);
  const [tab, setTab] = useState<'correct' | 'format'>('correct');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');
  const set = (patch: Partial<AutoCorrectPrefs>) => setP({ ...p, ...patch });
  const list = entryList(p);
  const q = from.trim().toLowerCase();
  const shown = q ? list.filter(([k]) => k.toLowerCase().startsWith(q)) : list;
  const add = () => {
    const r = addEntry(p, from, to);
    if (typeof r === 'string') { setMsg(r); return; }
    setP(r); setFrom(''); setTo(''); setMsg('');
  };
  const exact = list.find(([k]) => k === from.trim());
  return (
    <Dialog title="자동 고침" wide onClose={onClose} onOk={() => { setAutoCorrectPrefs(p); onClose(); }}>
      <div className="dlg-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'correct'} className={tab === 'correct' ? 'on' : ''} onClick={() => setTab('correct')}>자동 고침</button>
        <button type="button" role="tab" aria-selected={tab === 'format'} className={tab === 'format' ? 'on' : ''} onClick={() => setTab('format')}>입력할 때 자동 서식</button>
      </div>
      {tab === 'correct' ? <>
        <Check label="두 개의 첫 대문자를 소문자로 (TWo INitial CApitals)" checked={p.twoInitials} onChange={(v) => set({ twoInitials: v })} />
        <Check label="문장의 첫 글자를 대문자로" checked={p.sentenceCaps} onChange={(v) => set({ sentenceCaps: v })} />
        <Check label="요일의 첫 글자를 대문자로" checked={p.days} onChange={(v) => set({ days: v })} />
        <Check label="Caps Lock 키를 잘못 눌러 생긴 대/소문자 고치기 (cAPS LOCK)" checked={p.capsLock} onChange={(v) => set({ capsLock: v })} />
        <Check label="입력할 때 자동으로 바꾸기" checked={p.on} onChange={(v) => set({ on: v })} />
        <div className="dlg-cols">
          <Field label="입력"><input value={from} disabled={!p.on} onChange={(e) => { setFrom(e.target.value); setMsg(''); }} onKeyDown={(e) => { if (e.key === 'Enter' && from.trim()) add(); }} /></Field>
          <Field label="결과"><input value={to} disabled={!p.on} onChange={(e) => { setTo(e.target.value); setMsg(''); }} onKeyDown={(e) => { if (e.key === 'Enter' && from.trim()) add(); }} /></Field>
        </div>
        <div className="dlg-list ac-list" aria-label="자동 고침 목록">
          {shown.map(([k, v]) => (
            <button key={k} type="button" className={exact?.[0] === k ? 'on' : ''} onClick={() => { setFrom(k); setTo(v); }}><span>{k}</span><span>{v}</span></button>
          ))}
        </div>
        <div className="dlg-row">
          <button type="button" disabled={!p.on || !from.trim()} onClick={add}>{exact ? '바꾸기' : '추가'}</button>
          <button type="button" disabled={!exact} onClick={() => { setP(removeEntry(p, exact![0])); setFrom(''); setTo(''); }}>삭제</button>
        </div>
        <div className="ppt-dialog-msg">{msg}</div>
      </> : <>
        <fieldset className="dlg-set"><legend>입력할 때 자동으로 바꾸기</legend>
          <Check label="곧은 따옴표(&quot;)를 둥근 따옴표(“ ”)로" checked={p.smartQuotes} onChange={(v) => set({ smartQuotes: v })} />
          <Check label="분수(1/2)를 분수 문자(½)로" checked={p.fractions} onChange={(v) => set({ fractions: v })} />
          <Check label="서수(1st)를 위 첨자로" checked={p.ordinals} onChange={(v) => set({ ordinals: v })} />
        </fieldset>
        <fieldset className="dlg-set"><legend>입력할 때 자동으로 적용</legend>
          <Check label="자동 글머리 기호 및 번호 매기기 목록" checked={p.lists} onChange={(v) => set({ lists: v })} />
          <p className="dlg-note">줄 처음에 * · - · &gt; · 1. · 1) · a. · i. 을 입력하고 스페이스를 누르면 목록이 시작됩니다. 바로 Backspace를 누르면 입력한 대로 돌아갑니다.</p>
        </fieldset>
      </>}
    </Dialog>
  );
}
