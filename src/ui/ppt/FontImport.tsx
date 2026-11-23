// 글꼴 가져오기: the button (font picker, 글꼴 dialog, 디자인 › 글꼴, 설정), the list of imported fonts with
// remove / filter by source, the drop of font files onto the window, and the "this deck needs a font" notice, which
// finds the missing fonts on the internet and downloads them by itself (webFonts.ts).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  FONT_ACCEPT, groupFamilies, importFontFiles, importSummary, importedFonts, isFontFileName, missingFamilies, removeImportedFonts,
  subscribeImportedFonts, updateImportedFont, type ImportedFont,
} from '../../domain/importedFonts';
import { loadFontSyncSettings, saveFontSyncSettings, type FontSyncSettings } from '../../domain/fontSync';
import { embeddingForbidden } from '../../domain/fontFile';
import { listEmbeddedFonts, removeEmbeddedFont, updateEmbeddedFont, embeddedAsFont } from '../../domain/embeddedFonts';
import { FontConflictsPanel } from '../FontConflicts';
import { weightLabel } from '../../domain/fontWeight';
import { FONT_OPTIONS } from '../../domain/fonts';
import { usedFamilies } from '../../domain/io/pptxFonts';
import { fetchMissingWebFonts, fetchWebFont, isWebSource, loadAutoWebFonts, saveAutoWebFonts, webFontSummary, webFontTried } from '../../domain/webFonts';
import { familiesToShare, loadShareInstalledFonts, saveShareInstalledFonts, shareInstalledFonts } from '../../domain/installedFonts';

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

type Source = 'all' | 'user' | 'web' | 'pptx' | 'lcast';

/** Type a font's name, find it on the internet (Google Fonts · Fontsource · Pretendard) and add it. */
export function WebFontSearch({ onDone }: { onDone?: (message: string) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [auto, setAuto] = useState(loadAutoWebFonts);
  const [share, setShare] = useState(loadShareInstalledFonts);
  const run = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setMsg(`“${n}” 찾는 중…`);
    try {
      const m = webFontSummary([await fetchWebFont(n)]);
      setMsg(m);
      onDone?.(m);
    } finally { setBusy(false); }
  };
  return (
    <div className="web-font-search" style={{ borderLeft: '3px solid #1565c0', background: '#e8f1fb', padding: '4px 8px', marginBottom: 6, fontSize: 12 }}>
      <form className="row gap-xs wrap" style={{ alignItems: 'center' }} onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <input type="text" value={name} placeholder="글꼴 이름 (예: 나눔명조, Noto Sans KR, Pretendard)" aria-label="인터넷에서 찾을 글꼴 이름"
          onChange={(e) => setName(e.target.value)} style={{ flex: '1 1 180px', minWidth: 0 }} />
        <button type="submit" className="btn small" disabled={busy || !name.trim()}>{busy ? '받는 중…' : '인터넷에서 찾아 받기'}</button>
      </form>
      <label style={{ display: 'block', marginTop: 4 }}><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); saveAutoWebFonts(e.target.checked); }} /> 프레젠테이션에 없는 글꼴은 인터넷에서 자동으로 찾아 받기</label>
      <label style={{ display: 'block', marginTop: 4 }}><input type="checkbox" checked={share} onChange={(e) => { setShare(e.target.checked); saveShareInstalledFonts(e.target.checked); }} /> 프레젠테이션이 쓰는 글꼴이 이 컴퓨터에 설치되어 있으면 다른 컴퓨터와 같은 글꼴로 보이도록 함께 동기화하기</label>
      <span className="muted">무료 글꼴(Google Fonts · Fontsource · Pretendard)만 받습니다. 받은 글꼴은 교회 서버와 동기화되어 다른 컴퓨터에서도 쓸 수 있습니다.</span>
      {msg && <div role="status" className="font-import-msg">{msg}</div>}
    </div>
  );
}

const sourceLabel = (source: string) =>
  source === 'user' ? '파일' : source.startsWith('lcast:') ? `LightCast: ${source.slice(6)}` : isWebSource(source) ? `인터넷: ${source.slice(4)}` : `PPTX: ${source}`;

/** The list of imported fonts by family: weights, size, where each came from; remove one face or a family. */
export function ImportedFontsManager({ onNotice }: { onNotice?: (m: string) => void }) {
  const mine = useImportedFonts();
  const [fromDecks, setFromDecks] = useState<ImportedFont[]>([]);
  const [filter, setFilter] = useState<Source>('all');
  const [tick, setTick] = useState(0);
  const [sync, setSync] = useState<FontSyncSettings>(loadFontSyncSettings);
  const change = (patch: Partial<FontSyncSettings>) => { const next = { ...sync, ...patch }; setSync(next); saveFontSyncSettings(next); };
  const setFontSync = (f: ImportedFont, v: string) => {
    if (v === 'on' && embeddingForbidden(f.fsType) && !f.allowRestricted && !confirm(`“${f.family}”은(는) 저작권상 문서에 포함하거나 공유할 수 없는 글꼴입니다. 그래도 교회 서버에 올려 다른 컴퓨터와 공유할까요? (라이선스를 확인하세요)`)) return;
    const at = Date.now(); // the later change wins on every computer (the switch follows the account)
    const patch = v === 'auto' ? { sync: undefined, syncAt: at } : v === 'on' ? { sync: true, syncAt: at, ...(embeddingForbidden(f.fsType) ? { allowRestricted: true } : {}) } : { sync: false, syncAt: at };
    void (f.id.startsWith('embfont:') ? updateEmbeddedFont(f.id, patch) : updateImportedFont(f.id, patch)).then(() => setTick((t) => t + 1));
    window.dispatchEvent(new Event('lightcast-fontsync'));
  };
  useEffect(() => {
    let live = true;
    void listEmbeddedFonts().then((list) => live && setFromDecks(list.map(embeddedAsFont)));
    return () => { live = false; };
  }, [tick]);
  const all = [...mine, ...fromDecks];
  const shown = all.filter((f) => filter === 'all' || (filter === 'user' ? f.source === 'user' : filter === 'web' ? isWebSource(f.source) : filter === 'lcast' ? f.source.startsWith('lcast:') : !f.source.startsWith('lcast:') && f.source !== 'user' && !isWebSource(f.source)));
  const groups = groupFamilies(shown);
  const remove = async (f: ImportedFont) => {
    if (f.id.startsWith('embfont:')) await removeEmbeddedFont(f.id); else await removeImportedFonts({ id: f.id });
    setTick((t) => t + 1);
    onNotice?.(`“${f.family}” 글꼴을 지웠습니다.${f.sync !== false ? ' 동기화 중이면 다른 기기에서도 지워지고, 서버에는 30일간 휴지통(서버 글꼴)에 보관됩니다.' : ''}`);
  };
  const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
  return (
    <div className="font-manager">
      <div className="row gap-xs wrap" style={{ alignItems: 'center', marginBottom: 6 }}>
        <FontImportButton className="btn" onDone={(m) => { setTick((t) => t + 1); onNotice?.(m); }} />
        <select value={filter} aria-label="글꼴 출처" onChange={(e) => setFilter(e.target.value as Source)}>
          <option value="all">모든 출처</option><option value="user">내가 가져온 글꼴 파일</option><option value="web">인터넷에서 받은 글꼴</option><option value="pptx">PPTX 파일에서 온 글꼴</option><option value="lcast">LightCast 파일에서 온 글꼴</option>
        </select>
      </div>
      <WebFontSearch onDone={(m) => { setTick((t) => t + 1); onNotice?.(m); }} />
      <div className="font-sync-settings" style={{ borderLeft: '3px solid #2e7d32', background: '#f1f8e9', padding: '4px 8px', marginBottom: 6, fontSize: 12 }}>
        <label style={{ display: 'block' }}><input type="checkbox" checked={sync.enabled} onChange={(e) => change({ enabled: e.target.checked })} /> 교회 서버와 글꼴 동기화 (로그인했을 때)</label>
        <label style={{ display: 'block', opacity: sync.enabled ? 1 : 0.5 }}><input type="checkbox" disabled={!sync.enabled} checked={sync.includeDeckFonts} onChange={(e) => change({ includeDeckFonts: e.target.checked })} /> PPTX · LightCast 파일에서 온 글꼴도 동기화 (끄면 동기화되는 프레젠테이션이 쓰는 글꼴만)</label>
        <span className="muted">내가 직접 가져온 글꼴은 기본으로 동기화됩니다. 저작권상 공유할 수 없는 글꼴은 확인 없이는 올리지 않습니다.</span>
      </div>
      <FontConflictsPanel />
      {!groups.length && <p className="muted small">가져온 글꼴이 없습니다. 글꼴 파일(.ttf .otf .ttc .woff .woff2)을 여기에 끌어다 놓아도 됩니다.</p>}
      {groups.map((g) => (
        <div key={g.family} className="font-family-row" style={{ borderTop: '1px solid #e1dfdd', padding: '6px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontFamily: `"${g.family}", sans-serif`, fontSize: 17 }}>{g.family}</span>
            <small className="muted">{g.fonts.length}개 · {mb(g.bytes)}</small>
          </div>
          {g.fonts.map((f) => (
            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
              <span>{weightLabel(f.weight)}{f.weightRange ? ` (${f.weightRange[0]}–${f.weightRange[1]})` : ''}{f.italic ? ' · 기울임' : ''} · <span className="muted">{sourceLabel(f.source)}</span></span>
              {<select aria-label={`${f.family} 동기화`} value={f.sync === true ? 'on' : f.sync === false ? 'off' : 'auto'} onChange={(e) => setFontSync(f, e.target.value)} style={{ fontSize: 11 }}>
                <option value="auto">동기화: 자동</option><option value="on">동기화: 켬</option><option value="off">동기화: 끔</option></select>}
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

/**
 * "이 프레젠테이션은 이 컴퓨터에 없는 글꼴을 씁니다": the missing fonts are looked up on the internet and downloaded by
 * themselves (unless switched off), then synced to the church server like imported ones. What the internet does not
 * have stays listed with 가져오기. Shows nothing when every font is available.
 */
export function MissingFontsNotice({ deck, deckKey }: { deck: unknown; deckKey?: string }) {
  const missing = useMissingFonts(deck, deckKey);
  const [hidden, setHidden] = useState<string>('');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');
  const running = useRef(false);
  const sig = missing.join('|');
  const fetchFonts = async (names: string[], again: boolean) => {
    if (running.current || !names.length) return;
    running.current = true;
    try {
      const results = await fetchMissingWebFonts(names, { again, onProgress: (i, n, name) => setBusy(`인터넷에서 “${name}” 글꼴을 찾는 중… (${i + 1}/${n})`) });
      if (results.length) setDone(webFontSummary(results));
    } finally { running.current = false; setBusy(''); }
  };
  // The fonts this presentation uses that are installed here go to LightCast's own fonts (and the church cloud), so
  // every other computer draws it in the same font files instead of its own stand-ins.
  useEffect(() => {
    if (!deck) return;
    const t = setTimeout(() => {
      const name = (deck as { title?: string }).title?.trim() || '프레젠테이션';
      void shareInstalledFonts(familiesToShare(usedFamilies(deck)), name).then((added) => {
        if (added.length) setDone(`이 컴퓨터의 글꼴 ${[...new Set(added.map((f) => f.family))].join(', ')}을(를) 다른 컴퓨터에서도 같은 글꼴로 보이도록 교회 서버와 동기화합니다.`);
      });
    }, 1500);
    return () => clearTimeout(t);
    // Once per opened presentation (its key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckKey]);
  useEffect(() => {
    if (!missing.length || !loadAutoWebFonts()) return;
    const fresh = missing.filter((m) => !webFontTried(m));
    if (fresh.length) void fetchFonts(fresh, false);
    // Runs when the set of missing fonts changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  useEffect(() => {
    if (!done || missing.length) return;
    const t = setTimeout(() => setDone(''), 10_000);
    return () => clearTimeout(t);
  }, [done, missing.length]);
  if ((!missing.length && !done) || (hidden && hidden === sig + done)) return null;
  const ok = !missing.length;
  return (
    <div role="status" className="font-missing-notice" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 12px', background: ok ? '#edf7ed' : '#fff8d6', borderBottom: `1px solid ${ok ? '#a5d6a7' : '#e6d27a'}`, color: ok ? '#1e4620' : '#4d4200', fontSize: 13 }}>
      {missing.length > 0 && <span>이 컴퓨터에 없는 글꼴이 있습니다: <b>{missing.slice(0, 4).join(', ')}{missing.length > 4 ? ` 외 ${missing.length - 4}개` : ''}</b>. 다른 글꼴로 보일 수 있습니다.</span>}
      {busy ? <span>{busy}</span> : done && <span>{done}</span>}
      {missing.length > 0 && <button type="button" className="btn small" disabled={!!busy} onClick={() => void fetchFonts(missing, true)}>인터넷에서 찾기</button>}
      {missing.length > 0 && <FontImportButton className="btn small" label="글꼴 가져오기…" />}
      <button type="button" className="btn small" onClick={() => setHidden(sig + done)}>닫기</button>
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
