// 글꼴 가져오기: the button (font picker, 글꼴 dialog, 디자인 › 글꼴, 설정), the list of imported fonts with
// remove / filter by source, the drop of font files onto the window, and the "this deck needs a font" notice.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  FONT_ACCEPT, groupFamilies, importFontFiles, importSummary, importedFonts, isFontFileName, missingFamilies, removeImportedFonts,
  subscribeImportedFonts, type ImportedFont,
} from '../../domain/importedFonts';
import { listEmbeddedFonts, removeEmbeddedFont } from '../../domain/embeddedFonts';
import { weightLabel } from '../../domain/fontWeight';
import { FONT_OPTIONS } from '../../domain/fonts';
import { usedFamilies } from '../../domain/io/pptxFonts';

/** The imported fonts of this window, re-rendering when they change. */
export function useImportedFonts(): ImportedFont[] {
  return useSyncExternalStore(subscribeImportedFonts, importedFonts, importedFonts);
}

/** Pick font files (several at once), import them and say what happened. */
export function FontImportButton({ onDone, label = '글꼴 가져오기…', className = 'ppt-item', style }: {
  onDone?: (message: string) => void;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const m = importSummary(await importFontFiles(files));
      setMsg(m);
      onDone?.(m);
    } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className={className} style={style} disabled={busy} title="내 컴퓨터의 글꼴 파일(.ttf .otf .ttc .woff .woff2)을 LightCast에 추가합니다"
        onClick={() => input.current?.click()}>{busy ? '가져오는 중…' : label}</button>
      <input ref={input} type="file" multiple accept={FONT_ACCEPT} hidden
        onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void run(files); }} />
      {msg && <div role="status" className="font-import-msg">{msg}</div>}
    </>
  );
}

type Source = 'all' | 'user' | 'pptx' | 'lcast';

/** The list of imported fonts by family: weights, size, where each came from; remove one face or a family. */
export function ImportedFontsManager({ onNotice }: { onNotice?: (m: string) => void }) {
  const mine = useImportedFonts();
  const [fromDecks, setFromDecks] = useState<ImportedFont[]>([]);
  const [filter, setFilter] = useState<Source>('all');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void listEmbeddedFonts().then((list) => live && setFromDecks(list.map((s) => ({
      id: s.id, family: s.family, subfamily: s.style, weight: s.style.startsWith('bold') ? 700 : 400, italic: /italic/i.test(s.style), format: 'truetype', bytes: s.bytes, fsType: 0, source: s.source, at: s.at,
    }))));
    return () => { live = false; };
  }, [tick]);
  const all = [...mine, ...fromDecks];
  const shown = all.filter((f) => filter === 'all' || (filter === 'user' ? f.source === 'user' : filter === 'lcast' ? f.source.startsWith('lcast:') : !f.source.startsWith('lcast:') && f.source !== 'user'));
  const groups = groupFamilies(shown);
  const remove = async (f: ImportedFont) => {
    if (f.id.startsWith('embfont:')) await removeEmbeddedFont(f.id); else await removeImportedFonts({ id: f.id });
    setTick((t) => t + 1);
    onNotice?.(`“${f.family}” 글꼴을 지웠습니다.`);
  };
  const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
  return (
    <div className="font-manager">
      <div className="row gap-xs wrap" style={{ alignItems: 'center', marginBottom: 6 }}>
        <FontImportButton className="btn" onDone={(m) => { setTick((t) => t + 1); onNotice?.(m); }} />
        <select value={filter} aria-label="글꼴 출처" onChange={(e) => setFilter(e.target.value as Source)}>
          <option value="all">모든 출처</option><option value="user">내가 가져온 글꼴 파일</option><option value="pptx">PPTX 파일에서 온 글꼴</option><option value="lcast">LightCast 파일에서 온 글꼴</option>
        </select>
      </div>
      {!groups.length && <p className="muted small">가져온 글꼴이 없습니다. 글꼴 파일(.ttf .otf .ttc .woff .woff2)을 여기에 끌어다 놓아도 됩니다.</p>}
      {groups.map((g) => (
        <div key={g.family} className="font-family-row" style={{ borderTop: '1px solid #e1dfdd', padding: '6px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontFamily: `"${g.family}", sans-serif`, fontSize: 17 }}>{g.family}</span>
            <small className="muted">{g.fonts.length}개 · {mb(g.bytes)}</small>
          </div>
          {g.fonts.map((f) => (
            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
              <span>{weightLabel(f.weight)}{f.weightRange ? ` (${f.weightRange[0]}–${f.weightRange[1]})` : ''}{f.italic ? ' · 기울임' : ''} · <span className="muted">{f.source === 'user' ? '파일' : f.source.startsWith('lcast:') ? `LightCast: ${f.source.slice(6)}` : `PPTX: ${f.source}`}</span></span>
              <button type="button" className="btn small" aria-label={`${f.family} 지우기`} onClick={() => void remove(f)}>지우기</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The families of a presentation that this computer cannot draw (computed on a microtask; fonts load first). */
export function useMissingFonts(deck: unknown, key: string | undefined): string[] {
  const [missing, setMissing] = useState<string[]>([]);
  const imported = useImportedFonts();
  useEffect(() => {
    if (!deck) return setMissing([]);
    let live = true;
    const t = setTimeout(() => {
      const own = FONT_OPTIONS.flatMap((o) => [o.label, o.pptx]);
      void (document.fonts?.ready ?? Promise.resolve()).then(() => { if (live) setMissing(missingFamilies(usedFamilies(deck), own)); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
    // The deck object changes on every edit; the check is for the opened presentation (its key) and the imported list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, imported]);
  return missing;
}

/** "이 프레젠테이션은 이 컴퓨터에 없는 글꼴을 씁니다" with 가져오기. Shows nothing when every font is available. */
export function MissingFontsNotice({ deck, deckKey }: { deck: unknown; deckKey?: string }) {
  const missing = useMissingFonts(deck, deckKey);
  const [hidden, setHidden] = useState<string>('');
  const sig = missing.join('|');
  if (!missing.length || hidden === sig) return null;
  return (
    <div role="status" className="font-missing-notice" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 12px', background: '#fff8d6', borderBottom: '1px solid #e6d27a', color: '#4d4200', fontSize: 13 }}>
      <span>이 컴퓨터에 없는 글꼴이 있습니다: <b>{missing.slice(0, 4).join(', ')}{missing.length > 4 ? ` 외 ${missing.length - 4}개` : ''}</b>. 다른 글꼴로 보일 수 있습니다.</span>
      <FontImportButton className="btn small" label="글꼴 가져오기…" />
      <button type="button" className="btn small" onClick={() => setHidden(sig)}>닫기</button>
    </div>
  );
}

/** Font files dropped anywhere on the window are imported (a drop of only font files; other drops go on as before). */
export function useFontFileDrop(notify: (message: string) => void) {
  const ref = useRef(notify);
  ref.current = notify;
  useEffect(() => {
    const fontsOnly = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      return files.length > 0 && files.every((f) => isFontFileName(f.name));
    };
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files') && fontsOnly(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!fontsOnly(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void importFontFiles(Array.from(e.dataTransfer?.files ?? [])).then((r) => ref.current(importSummary(r)));
    };
    // Capture phase: runs before the window's file drop that sends files to the 주일예배.
    window.addEventListener('dragover', over, true);
    window.addEventListener('drop', drop, true);
    return () => { window.removeEventListener('dragover', over, true); window.removeEventListener('drop', drop, true); };
  }, []);
}
