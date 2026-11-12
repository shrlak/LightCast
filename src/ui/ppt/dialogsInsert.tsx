// Dialogs behind Picture Format (Compress Pictures, Alt Text) and Insert (Hyperlink, Date & Time,
// Equation, Insert Table), after DeckCraft's (crates/ui-egui/src/dialogs, MIT OR Apache-2.0).
import { useState } from 'react';
import type { SlideElement } from '../../domain/types';
import { COMPRESS_RESOLUTIONS } from '../../domain/pictureFormat';
import { compressElement } from './pictureTools';
import { Check, Dialog, Field } from './dialogs';
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

/** The dialogs this file holds, or null for another kind. */
export function InsertDialogs({ ed, kind, onClose }: { ed: Ed; kind: DialogKind; onClose: () => void }) {
  switch (kind) {
    case 'compress': return <CompressDialog ed={ed} onClose={onClose} />;
    case 'altText': return <AltTextDialog ed={ed} onClose={onClose} />;
    default: return null;
  }
}
