// Home › Font › 글꼴 box, as PowerPoint's (and DeckCraft's font menu): the theme fonts first
// (제목 / 본문), then every font — LightCast's own and the ones installed on this computer — each
// shown in its own face. A font name can be typed and applied with Enter.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FONT_OPTIONS, officeFont } from '../../domain/fonts';
import { fontLabel, fontEntries, type FontEntry } from '../../domain/fontList';
import { Icon } from './pptIcons';
import { useMenuPlacement } from './TextFormatPanel';
import { FontImportButton, useImportedFonts } from './FontImport';
import { groupFamilies } from '../../domain/importedFonts';

/** Fonts people commonly have on Windows, macOS and Korean systems; the ones really installed are listed. */
const CANDIDATES = [
  '맑은 고딕', '굴림', '굴림체', '돋움', '돋움체', '바탕', '바탕체', '궁서', '궁서체', '나눔명조', '나눔바른고딕', '나눔스퀘어', 'HY견고딕', 'HY헤드라인M',
  'Apple SD Gothic Neo', 'AppleMyungjo', 'AppleGothic', 'Noto Sans KR', 'Noto Serif KR', 'Pretendard', 'Spoqa Han Sans Neo',
  'Arial Black', 'Arial Narrow', 'Bahnschrift', 'Book Antiqua', 'Bookman Old Style', 'Calibri Light', 'Cambria', 'Candara', 'Century Gothic',
  'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Franklin Gothic Medium', 'Garamond', 'Georgia', 'Gill Sans', 'Helvetica', 'Helvetica Neue',
  'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Tahoma', 'Times New Roman',
  'Trebuchet MS', 'Verdana', 'Menlo', 'Monaco', 'Optima', 'Futura', 'Avenir', 'Avenir Next', 'Baskerville', 'Didot', 'Rockwell',
];

let installed: string[] | null = null;
/** The candidate fonts this computer has: text drawn in one measures differently from all three generic fallbacks. */
function installedFonts(): string[] {
  if (installed) return installed;
  if (typeof document === 'undefined') return [];
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return (installed = []);
  const sample = 'mmmmmmmmmlli가나다WQ@';
  const width = (font: string) => { ctx.font = `32px ${font}`; return ctx.measureText(sample).width; };
  const generic = ['monospace', 'serif', 'sans-serif'].map((g) => [g, width(g)] as const);
  installed = CANDIDATES.filter((f) => generic.some(([g, w]) => width(`"${f}", ${g}`) !== w));
  return installed;
}

export function FontPicker({ value, mixed, theme, onChange }: {
  /** The CSS font stack of the selection (undefined: the theme's font). */
  value?: string;
  /** The selection mixes fonts: the box is blank, as in PowerPoint. */
  mixed?: boolean;
  /** The slide's theme font (its 제목 / 본문 font). */
  theme?: string;
  onChange: (family: string | undefined) => void;
}) {
  const shown = mixed ? '' : value ? fontLabel(value) : theme ? `${fontLabel(theme)}` : '';
  const [text, setText] = useState(shown);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const place = useMenuPlacement(open, ref, menu);
  useEffect(() => { setText(shown); setTyped(false); }, [shown]);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', off);
    return () => window.removeEventListener('pointerdown', off);
  }, [open]);
  const imported = useImportedFonts();
  const importedList = useMemo(() => groupFamilies(imported).map((g): FontEntry => ({ label: g.family, family: officeFont(g.family) })), [imported]);
  const all = useMemo(() => (open ? fontEntries(installedFonts()) : []), [open]);
  const q = typed ? text.trim().toLowerCase() : '';
  const list = q ? all.filter((f) => f.label.toLowerCase().includes(q)) : all;
  const importedShown = q ? importedList.filter((f) => f.label.toLowerCase().includes(q)) : importedList;
  const pick = (f: FontEntry | undefined) => { onChange(f?.family); setOpen(false); setTyped(false); };
  /** A typed name: one of the listed fonts, else that face (with LightCast's Korean fallbacks behind it). */
  const commit = () => {
    const name = text.trim();
    if (!name || name === shown) return setText(shown);
    const hit = all.find((f) => f.label.toLowerCase() === name.toLowerCase()) ?? fontEntries(installedFonts()).find((f) => f.label.toLowerCase() === name.toLowerCase());
    onChange(hit ? hit.family : officeFont(name));
    setOpen(false);
    setTyped(false);
  };
  const themeName = theme ? fontLabel(theme) : FONT_OPTIONS[0].label;
  return (
    <span ref={ref} className="ppt-drop ppt-font-picker" title="글꼴">
      <input className="ppt-font" value={text} aria-label="글꼴" placeholder={mixed ? '' : undefined} style={{ fontFamily: mixed ? undefined : value ?? theme }}
        onChange={(e) => { setText(e.target.value); setTyped(true); setOpen(true); }} onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setText(shown); setTyped(false); setOpen(false); }
        }} />
      <button type="button" className="ppt-btn ppt-caret-btn" aria-label="글꼴 목록" onClick={() => { setTyped(false); setOpen(!open); }}>{Icon.caret}</button>
      {open && (
        <div ref={menu} className="ppt-menu font-menu" role="listbox" style={place}>
          {!q && <>
            <div className="ppt-menu-head">테마 글꼴</div>
            <button type="button" className={`ppt-item font-item ${!value && !mixed ? 'on' : ''}`} style={{ fontFamily: theme }} onClick={() => pick(undefined)}>{themeName}<span className="font-role">제목</span></button>
            <button type="button" className="ppt-item font-item" style={{ fontFamily: theme }} onClick={() => pick(undefined)}>{themeName}<span className="font-role">본문</span></button>
          </>}
          {!!importedShown.length && <div className="ppt-menu-head">가져온 글꼴</div>}
          {importedShown.map((f) => (
            <button key={`imp-${f.label}`} type="button" role="option" aria-selected={f.family === value} className={`ppt-item font-item ${f.family === value ? 'on' : ''}`} style={{ fontFamily: f.family }} onClick={() => pick(f)}>{f.label}</button>
          ))}
          {!q && <div className="ppt-menu-head">모든 글꼴</div>}
          {list.map((f) => (
            <button key={f.label} type="button" role="option" aria-selected={f.family === value} className={`ppt-item font-item ${f.family === value ? 'on' : ''}`} style={{ fontFamily: f.family }} onClick={() => pick(f)}>{f.label}</button>
          ))}
          {q && !list.length && !importedShown.length && <div className="ppt-item muted">Enter: “{text.trim()}” 글꼴 사용</div>}
          <FontImportButton className="ppt-item font-item font-import" label="글꼴 가져오기…" />
        </div>
      )}
    </span>
  );
}
