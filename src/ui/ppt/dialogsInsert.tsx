// Dialogs behind Picture Format (Compress Pictures, Alt Text) and Insert (Hyperlink, Date & Time,
// Equation, Insert Table), after DeckCraft's (crates/ui-egui/src/dialogs, MIT OR Apache-2.0).
import { useState } from 'react';
import type { SlideElement } from '../../domain/types';
import { DATE_FORMATS, dateFieldText, linkDisplay, linkPatch, linkSeed, prettyEquation, type LinkMode } from '../../domain/insertTools';
import { makeTable } from '../../domain/editOps';
import { uid } from '../../domain/lyrics';
import { COMPRESS_RESOLUTIONS } from '../../domain/pictureFormat';
import { compressElement } from './pictureTools';
import { Check, Dialog, Field, Num } from './dialogs';
import type { DialogKind, Ed } from './editor';

// ── Picture Format › Compress Pictures ────────────────────────────────────────────────────────
let lastCompress = { ppi: 220, only: true, deleteCropped: true };

function CompressDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const picked = ed.selEls.filter((e) => e.kind === 'image');
  const [ppi, setPpi] = useState(lastCompress.ppi);
  const [only, setOnly] = useState(lastCompress.only && picked.length > 0);
  const [deleteCropped, setDeleteCropped] = useState(lastCompress.deleteCropped);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const p = ed.p;
    if (!p) return;
    lastCompress = { ppi, only, deleteCropped };
    setBusy(true);
    try {
      const ids = new Set(picked.map((e) => e.id));
      const patches = new Map<string, Partial<SlideElement>>();
      let before = 0, after = 0;
      // The same picture shown at the same size and crop compresses once.
      const done = new Map<string, Awaited<ReturnType<typeof compressElement>>>();
      for (const s of p.slides) for (const el of s.elements ?? []) {
        if (el.kind !== 'image' || (only && !ids.has(el.id))) continue;
        const key = `${el.picture?.original ?? el.mediaId}|${el.w}x${el.h}|${(el.crop ?? []).join(',')}`;
        let r = done.get(key);
        if (r === undefined) {
          r = await compressElement(el, ppi, deleteCropped, ed.dispatch, p.colorScheme);
          done.set(key, r);
          if (r) { before += r.before; after += r.after; }
        }
        if (r) patches.set(el.id, r.patch);
      }
      if (patches.size) {
        const latest = ed.p ?? p;
        ed.updatePres({ slides: latest.slides.map((s) => (s.elements?.some((e) => patches.has(e.id)) ? { ...s, elements: s.elements!.map((e) => (patches.has(e.id) ? { ...e, ...patches.get(e.id) } : e)) } : s)) });
      }
      const kb = (n: number) => Math.round(n / 1024);
      ed.cmd.notify(patches.size ? `그림 ${patches.size}개를 압축했습니다: ${kb(before)} KB → ${kb(after)} KB` : '그림이 이미 그 해상도 이하입니다');
      onClose();
    } finally { setBusy(false); }
  };
  return (
    <Dialog title="그림 압축" onClose={onClose} onOk={() => void run()} okLabel={busy ? '압축 중…' : '확인'} okDisabled={busy || !ed.canEdit || (only && !picked.length)}>
      <fieldset className="dlg-set">
        <legend>압축 옵션</legend>
        <Check label="이 그림에만 적용" checked={only} disabled={!picked.length} onChange={setOnly} />
        <Check label="잘려진 그림 영역 삭제" checked={deleteCropped} onChange={setDeleteCropped} />
      </fieldset>
      <fieldset className="dlg-set">
        <legend>해상도</legend>
        {COMPRESS_RESOLUTIONS.map(([v, label]) => <label key={v} className="rb-check"><input type="radio" name="compress-ppi" checked={ppi === v} onChange={() => setPpi(v)} /> {label}</label>)}
      </fieldset>
    </Dialog>
  );
}

// ── Picture Format › Alt Text ─────────────────────────────────────────────────────────────────
function AltTextDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const el = ed.selEls[0];
  const [text, setText] = useState(el?.alt ?? '');
  const [decorative, setDecorative] = useState(el?.alt === '');
  if (!el) return <Dialog title="대체 텍스트" onClose={onClose}><p>설명을 붙일 개체를 고르세요.</p></Dialog>;
  const ok = () => {
    // Decorative: an empty description, so screen readers skip it.
    const alt = decorative ? '' : text.trim() || undefined;
    ed.setElements((els) => els.map((e) => (ed.selEls.some((s) => s.id === e.id) ? { ...e, alt } : e)));
    onClose();
  };
  return (
    <Dialog title="대체 텍스트" onClose={onClose} onOk={ok} okDisabled={!ed.canEdit}>
      <p className="dlg-note">시각 장애가 있는 사람에게 이 개체와 그 내용을 어떻게 설명하시겠어요? (1~2문장 권장)</p>
      <Field label="설명"><textarea rows={4} value={text} disabled={decorative} onChange={(e) => setText(e.target.value)} /></Field>
      <Check label="장식용으로 표시" checked={decorative} onChange={setDecorative} />
    </Dialog>
  );
}

// ── Insert › Link ─────────────────────────────────────────────────────────────────────────────
function HyperlinkDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const el = ed.selEls[0];
  const slides = ed.p?.slides ?? [];
  const seed = linkSeed(el, ed.slide?.id ?? slides[0]?.id ?? '');
  const [mode, setMode] = useState<LinkMode>(seed.mode);
  const [f, setF] = useState(seed);
  const [text, setText] = useState('');
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const patch = linkPatch(mode, f);
  const ok = () => {
    if (!patch) return;
    if (el) ed.setElements((els) => els.map((e) => (ed.selEls.some((s) => s.id === e.id) ? { ...e, ...patch } : e)));
    else ed.addElement({ id: uid('el'), kind: 'text', text: text.trim() || linkDisplay(mode, f, slides), x: 420, y: 480, w: 600, h: 120, fontSize: 56, color: '#9ed0ff', underline: true, align: 'center', ...patch });
    onClose();
  };
  const remove = () => {
    ed.setElements((els) => els.map((e) => (ed.selEls.some((s) => s.id === e.id) ? { ...e, href: undefined, action: e.action?.kind === 'slide' || e.action?.kind === 'url' ? undefined : e.action, tooltip: undefined } : e)));
    onClose();
  };
  return (
    <Dialog title="하이퍼링크 삽입" onClose={onClose} onOk={ok} okDisabled={!patch || !ed.canEdit} wide>
      <div className="dlg-row">
        {([['web', '웹 페이지'], ['slide', '현재 문서'], ['email', '전자 메일 주소']] as const).map(([m, l]) => <label key={m} className="rb-check"><input type="radio" name="link-mode" checked={mode === m} onChange={() => setMode(m)} /> {l}</label>)}
      </div>
      {!el && <Field label="표시할 텍스트"><input value={text} placeholder={linkDisplay(mode, f, slides)} onChange={(e) => setText(e.target.value)} /></Field>}
      {mode === 'web' && <Field label="주소"><input value={f.url} onChange={(e) => set({ url: e.target.value })} /></Field>}
      {mode === 'email' && <>
        <Field label="전자 메일 주소"><input value={f.email} placeholder="name@example.com" onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="제목"><input value={f.subject} onChange={(e) => set({ subject: e.target.value })} /></Field>
      </>}
      {mode === 'slide' && <Field label="슬라이드"><select value={f.slideId} onChange={(e) => set({ slideId: e.target.value })}>{slides.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {(s.title || s.text.split('\n')[0] || s.group).slice(0, 40)}</option>)}</select></Field>}
      <Field label="화면 설명"><input value={f.tip} onChange={(e) => set({ tip: e.target.value })} /></Field>
      <div className="dlg-row"><button type="button" disabled={!el || !ed.canEdit} onClick={remove}>링크 제거</button></div>
    </Dialog>
  );
}

// ── Insert › Date & Time ──────────────────────────────────────────────────────────────────────
function DateTimeDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const now = new Date();
  const [lang, setLang] = useState<'ko' | 'en'>('ko');
  const [id, setId] = useState('ko1');
  const [update, setUpdate] = useState(true);
  const rows = DATE_FORMATS.filter((x) => x.lang === lang);
  const ok = () => {
    const text = dateFieldText(id, update, now);
    // At the caret of a text being edited, else a box of its own.
    if (document.activeElement?.classList.contains('ce-rich')) document.execCommand('insertText', false, text);
    else ed.addElement({ id: uid('el'), kind: 'text', text, x: 940, y: 980, w: 460, h: 70, fontSize: 36, color: '#ffffff', align: 'right' });
    onClose();
  };
  return (
    <Dialog title="날짜 및 시간" onClose={onClose} onOk={ok} okDisabled={!ed.slide || !ed.canEdit}>
      <Field label="언어"><select value={lang} onChange={(e) => { const l = e.target.value as 'ko' | 'en'; setLang(l); setId(`${l}1`); }}><option value="ko">한국어</option><option value="en">English (United States)</option></select></Field>
      <div className="dlg-list">{rows.map((r) => <button key={r.id} type="button" className={id === r.id ? 'on' : ''} onClick={() => setId(r.id)}>{r.format(now)}</button>)}</div>
      <Check label="자동으로 업데이트" checked={update} onChange={setUpdate} />
    </Dialog>
  );
}

// ── Insert › Equation ─────────────────────────────────────────────────────────────────────────
function EquationDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const [v, setV] = useState('');
  const ok = () => {
    ed.addElement({ id: uid('el'), kind: 'text', text: prettyEquation(v), x: 420, y: 470, w: 600, h: 140, fontSize: 84, italic: true, fontFamily: 'Cambria Math, Times New Roman, serif', color: '#ffffff', align: 'center' });
    onClose();
  };
  return (
    <Dialog title="수식" onClose={onClose} onOk={ok} okLabel="삽입" okDisabled={!v.trim() || !ed.slide || !ed.canEdit}>
      <p className="dlg-note">선형 형식으로 수식을 입력하세요. 예: a^2+b^2=c^2, sqrt, &lt;=, &gt;=, pi, +-</p>
      <Field label="수식"><input value={v} autoFocus onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) ok(); }} /></Field>
      <div className="dlg-note">미리 보기: <span style={{ fontStyle: 'italic', fontFamily: 'serif', fontSize: 20 }}>{prettyEquation(v)}</span></div>
    </Dialog>
  );
}

// ── Insert › Table ────────────────────────────────────────────────────────────────────────────
function InsertTableDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const [cols, setCols] = useState(5);
  const [rows, setRows] = useState(2);
  const clamp = (n: number, max: number) => Math.max(1, Math.min(max, Math.round(n) || 1));
  return (
    <Dialog title="표 삽입" onClose={onClose} onOk={() => { const t = makeTable(clamp(rows, 50), clamp(cols, 30)); if (t) ed.addElement(t); onClose(); }} okDisabled={!ed.slide || !ed.canEdit}>
      <div className="dlg-cols">
        <Field label="열 개수"><Num value={cols} min={1} max={30} onChange={setCols} /></Field>
        <Field label="행 개수"><Num value={rows} min={1} max={50} onChange={setRows} /></Field>
      </div>
    </Dialog>
  );
}

/** The dialogs this file holds, or null for another kind. */
export function InsertDialogs({ ed, kind, onClose }: { ed: Ed; kind: DialogKind; onClose: () => void }) {
  switch (kind) {
    case 'compress': return <CompressDialog ed={ed} onClose={onClose} />;
    case 'altText': return <AltTextDialog ed={ed} onClose={onClose} />;
    case 'hyperlink': return <HyperlinkDialog ed={ed} onClose={onClose} />;
    case 'dateTime': return <DateTimeDialog ed={ed} onClose={onClose} />;
    case 'equation': return <EquationDialog ed={ed} onClose={onClose} />;
    case 'insertTable': return <InsertTableDialog ed={ed} onClose={onClose} />;
    default: return null;
  }
}
