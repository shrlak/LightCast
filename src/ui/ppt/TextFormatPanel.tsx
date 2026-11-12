import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { HAlign, ListStyle, VAlign } from '../../domain/types';
import { FONT_OPTIONS } from '../../domain/fonts';
import { LINE_SPACINGS, SINGLE_SPACING, listMarker, stepFontSize, type CaseKind } from '../../domain/textFormat';
import { FontSize } from './FontSize';
import { Icon } from './pptIcons';
import { ColorGrid } from './ribbonParts';

/** The text formatting PowerPoint's 홈 → 글꼴 / 단락 groups set, for slide text or a text box. */
export interface TextFormatValue {
  fontFamily?: string;
  /** Canvas pixels (shown in points, as PowerPoint does). */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  shadow: boolean;
  letterSpacing: number;
  color: string;
  highlight?: string;
  align: HAlign;
  vAlign: VAlign;
  /** CSS line-height multiple. */
  lineHeight: number;
  list?: ListStyle;
  indent: number;
  columns: number;
  vertical: boolean;
  autoFit: boolean;
}

const HIGHLIGHTS = ['#FFFF00', '#00FF00', '#00FFFF', '#FF00FF', '#0000FF', '#FF0000', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#C0C0C0', '#000000'];
const SPACINGS: [string, number][] = [['매우 좁게', -6], ['좁게', -3], ['보통', 0], ['넓게', 6], ['매우 넓게', 12]];
const CASES: [CaseKind, string][] = [['sentence', '문장의 첫 글자를 대문자로.'], ['lower', '모두 소문자로'], ['upper', '모두 대문자로'], ['title', '각 단어를 대문자로'], ['toggle', '대/소문자 전환']];
const BULLETS: ListStyle[] = ['bullet', 'circle', 'square', 'arrow', 'check'];
const NUMBERS: ListStyle[] = ['number', 'number-paren', 'roman', 'alpha', 'hangul'];

/** Places an open menu under its button, kept inside the window (the format pane is narrow). */
export function useMenuPlacement(open: boolean, anchor: RefObject<HTMLElement | null>, menu: RefObject<HTMLElement | null>): CSSProperties {
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!open || !anchor.current || !menu.current) return setPos({ visibility: 'hidden' });
    const a = anchor.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.left, window.innerWidth - m.width - 8));
    const below = a.bottom + 2 + m.height <= window.innerHeight - 8;
    setPos({ position: 'fixed', left, top: below ? a.bottom + 2 : Math.max(8, a.top - 2 - m.height) });
  }, [open, anchor, menu]);
  return pos;
}

/** A ribbon button with a menu (PowerPoint's split / drop-down buttons). */
function Drop({ icon, title, active, onMain, children }: { icon: ReactNode; title: string; active?: boolean; onMain?: () => void; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const place = useMenuPlacement(open, ref, menu);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', off);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', off);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <span ref={ref} className={`ppt-drop ${onMain ? 'split' : ''}`}>
      <button type="button" className={`ppt-btn ${active ? 'on' : ''}`} title={title} aria-label={title} onClick={() => (onMain ? onMain() : setOpen(!open))}>
        {icon}{!onMain && Icon.caret}
      </button>
      {onMain && <button type="button" className="ppt-btn ppt-caret-btn" title={`${title} 옵션`} aria-label={`${title} 옵션`} onClick={() => setOpen(!open)}>{Icon.caret}</button>}
      {open && <div ref={menu} className="ppt-menu" role="menu" style={place}>{children(() => setOpen(false))}</div>}
    </span>
  );
}

function Tog({ icon, title, on, onClick }: { icon: ReactNode; title: string; on?: boolean; onClick: () => void }) {
  return <button type="button" className={`ppt-btn ${on ? 'on' : ''}`} title={title} aria-label={title} aria-pressed={on} onClick={onClick}>{icon}</button>;
}

function Palette({ colors, value, onPick }: { colors: string[]; value?: string; onPick: (c: string) => void }) {
  return (
    <div className="ppt-palette">
      {colors.map((c) => <button key={c} type="button" className={`ppt-chip ${value?.toUpperCase() === c ? 'on' : ''}`} style={{ background: c }} title={c} onClick={() => onPick(c)} />)}
    </div>
  );
}

/**
 * PowerPoint's 홈 → 글꼴 and 단락 groups, same buttons in the same order: font and size, 글꼴 크기
 * 크게 / 작게, 모든 서식 지우기; 굵게, 기울임꼴, 밑줄, 텍스트 그림자, 취소선, 문자 간격, 대/소문자
 * 바꾸기, 텍스트 강조 색, 글꼴 색; 글머리 기호, 번호 매기기, 목록 수준 줄임 / 늘림, 줄 간격, 단;
 * 왼쪽 / 가운데 / 오른쪽 / 양쪽 맞춤, 텍스트 방향, 텍스트 맞춤 — plus 자동 맞춤.
 */
export function TextFormatPanel({ value: f, onChange, onChangeCase, onClear, shortcuts = true, part }: {
  /** Only the 글꼴 or the 단락 group (the ribbon shows them as two groups). */
  part?: 'font' | 'paragraph';
  value: TextFormatValue;
  onChange: (patch: Partial<TextFormatValue>) => void;
  onChangeCase: (kind: CaseKind) => void;
  onClear: () => void;
  /** PowerPoint's keyboard shortcuts (Ctrl+B/I/U, Ctrl+L/E/R/J, Ctrl+] / Ctrl+[) act on this text. */
  shortcuts?: boolean;
}) {
  const colorRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ f, onChange });
  latest.current = { f, onChange };
  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || document.querySelector('.modal-backdrop')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) && !t.closest('[data-ime-sink]')) return;
      const { f: cur, onChange: set } = latest.current;
      const k = e.key.toLowerCase();
      const patch: Partial<TextFormatValue> | null =
        k === 'b' ? { bold: !cur.bold } : k === 'i' ? { italic: !cur.italic } : k === 'u' ? { underline: !cur.underline }
          : k === 'l' ? { align: 'left' } : k === 'e' ? { align: 'center' } : k === 'r' ? { align: 'right' } : k === 'j' ? { align: 'justify' }
            : k === ']' ? { fontSize: stepFontSize(cur.fontSize, 1) } : k === '[' ? { fontSize: stepFontSize(cur.fontSize, -1) } : null;
      if (!patch || e.shiftKey) return;
      e.preventDefault();
      set(patch);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts]);
  const spacing = Math.round((f.lineHeight / SINGLE_SPACING) * 100) / 100;
  return (
    <div className={`ppt-text-format ${part ? `part-${part}` : ''}`}>
      {part !== 'paragraph' && <>
      {!part && <div className="ppt-group-label">글꼴</div>}
      <div className="ppt-row">
        <select className="ppt-font" title="글꼴" value={FONT_OPTIONS.find((o) => o.family === f.fontFamily)?.family ?? ''} onChange={(e) => onChange({ fontFamily: e.target.value || undefined })}>
          {!FONT_OPTIONS.some((o) => o.family === f.fontFamily) && <option value="">{f.fontFamily ? f.fontFamily.split(',')[0].replace(/"/g, '') : '테마 글꼴'}</option>}
          {FONT_OPTIONS.map((o) => <option key={o.label} value={o.family} style={{ fontFamily: o.family }}>{o.label}</option>)}
        </select>
        <FontSize value={f.fontSize} onChange={(n) => onChange({ fontSize: n })} />
        <Tog icon={Icon.growFont} title="글꼴 크기 크게 (Ctrl+])" onClick={() => onChange({ fontSize: stepFontSize(f.fontSize, 1) })} />
        <Tog icon={Icon.shrinkFont} title="글꼴 크기 작게 (Ctrl+[)" onClick={() => onChange({ fontSize: stepFontSize(f.fontSize, -1) })} />
        <Tog icon={Icon.clearFormat} title="모든 서식 지우기" onClick={onClear} />
      </div>
      <div className="ppt-row">
        <Tog icon={Icon.bold} title="굵게 (Ctrl+B)" on={f.bold} onClick={() => onChange({ bold: !f.bold })} />
        <Tog icon={Icon.italic} title="기울임꼴 (Ctrl+I)" on={f.italic} onClick={() => onChange({ italic: !f.italic })} />
        <Tog icon={Icon.underline} title="밑줄 (Ctrl+U)" on={f.underline} onClick={() => onChange({ underline: !f.underline })} />
        <Tog icon={Icon.shadow} title="텍스트 그림자" on={f.shadow} onClick={() => onChange({ shadow: !f.shadow })} />
        <Tog icon={Icon.strike} title="취소선" on={f.strike} onClick={() => onChange({ strike: !f.strike })} />
        <Drop icon={Icon.spacing} title="문자 간격" active={!!f.letterSpacing}>
          {(close) => SPACINGS.map(([label, v]) => (
            <button key={label} type="button" className={`ppt-item ${f.letterSpacing === v ? 'on' : ''}`} onClick={() => { onChange({ letterSpacing: v }); close(); }}>
              <span style={{ letterSpacing: v / 2 }}>AV</span> {label}
            </button>
          ))}
        </Drop>
        <Drop icon={Icon.changeCase} title="대/소문자 바꾸기">
          {(close) => CASES.map(([k, label]) => <button key={k} type="button" className="ppt-item" onClick={() => { onChangeCase(k); close(); }}>{label}</button>)}
        </Drop>
        <Drop icon={Icon.highlight(f.highlight)} title="텍스트 강조 색" onMain={() => onChange({ highlight: f.highlight ? undefined : '#FFFF00' })}>
          {(close) => (
            <>
              <Palette colors={HIGHLIGHTS} value={f.highlight} onPick={(c) => { onChange({ highlight: c }); close(); }} />
              <button type="button" className="ppt-item" onClick={() => { onChange({ highlight: undefined }); close(); }}>강조 표시 없음</button>
            </>
          )}
        </Drop>
        <Drop icon={Icon.fontColor(f.color)} title="글꼴 색" onMain={() => colorRef.current?.click()}>
          {(close) => (
            <>
              <ColorGrid value={f.color} onPick={(c) => { onChange({ color: c }); close(); }} />
            </>
          )}
        </Drop>
        <input ref={colorRef} type="color" hidden value={f.color.slice(0, 7)} onChange={(e) => onChange({ color: e.target.value })} />
      </div>
      </>}

      {part !== 'font' && <>
      {!part && <div className="ppt-group-label">단락</div>}
      <div className="ppt-row">
        <Drop icon={Icon.bullets} title="글머리 기호" active={!!f.list && BULLETS.includes(f.list)} onMain={() => onChange({ list: f.list && BULLETS.includes(f.list) ? undefined : 'bullet' })}>
          {(close) => (
            <div className="ppt-list-grid">
              <button type="button" className={`ppt-list-cell ${!f.list ? 'on' : ''}`} onClick={() => { onChange({ list: undefined }); close(); }}>없음</button>
              {BULLETS.map((b) => <button key={b} type="button" className={`ppt-list-cell ${f.list === b ? 'on' : ''}`} onClick={() => { onChange({ list: b }); close(); }}>{[1, 2, 3].map((n) => <span key={n}>{listMarker(b, n)} ―</span>)}</button>)}
            </div>
          )}
        </Drop>
        <Drop icon={Icon.numbering} title="번호 매기기" active={!!f.list && NUMBERS.includes(f.list)} onMain={() => onChange({ list: f.list && NUMBERS.includes(f.list) ? undefined : 'number' })}>
          {(close) => (
            <div className="ppt-list-grid">
              <button type="button" className={`ppt-list-cell ${!f.list ? 'on' : ''}`} onClick={() => { onChange({ list: undefined }); close(); }}>없음</button>
              {NUMBERS.map((b) => <button key={b} type="button" className={`ppt-list-cell ${f.list === b ? 'on' : ''}`} onClick={() => { onChange({ list: b }); close(); }}>{[1, 2, 3].map((n) => <span key={n}>{listMarker(b, n)} ―</span>)}</button>)}
            </div>
          )}
        </Drop>
        <Tog icon={Icon.indentLess} title="목록 수준 줄임" onClick={() => onChange({ indent: Math.max(0, f.indent - 1) })} />
        <Tog icon={Icon.indentMore} title="목록 수준 늘림" onClick={() => onChange({ indent: Math.min(8, f.indent + 1) })} />
        <Drop icon={Icon.lineSpacing} title="줄 간격">
          {(close) => (
            <>
              {LINE_SPACINGS.map((v) => (
                <button key={v} type="button" className={`ppt-item ${Math.abs(spacing - v) < 0.03 ? 'on' : ''}`} onClick={() => { onChange({ lineHeight: Math.round(v * SINGLE_SPACING * 100) / 100 }); close(); }}>{v.toFixed(v === 1.15 ? 2 : 1)}</button>
              ))}
              <label className="ppt-item ppt-slider">줄 간격 옵션 <span>{spacing.toFixed(2)}</span>
                <input type="range" min={0.7} max={3} step={0.05} value={spacing} onChange={(e) => onChange({ lineHeight: Math.round(Number(e.target.value) * SINGLE_SPACING * 100) / 100 })} />
              </label>
            </>
          )}
        </Drop>
        <Drop icon={Icon.columns} title="단" active={f.columns > 1}>
          {(close) => [1, 2, 3].map((n) => <button key={n} type="button" className={`ppt-item ${f.columns === n ? 'on' : ''}`} onClick={() => { onChange({ columns: n }); close(); }}>{['한 단', '두 단', '세 단'][n - 1]}</button>)}
        </Drop>
      </div>
      <div className="ppt-row">
        <Tog icon={Icon.alignLeft} title="왼쪽 맞춤 (Ctrl+L)" on={f.align === 'left'} onClick={() => onChange({ align: 'left' })} />
        <Tog icon={Icon.alignCenter} title="가운데 맞춤 (Ctrl+E)" on={f.align === 'center'} onClick={() => onChange({ align: 'center' })} />
        <Tog icon={Icon.alignRight} title="오른쪽 맞춤 (Ctrl+R)" on={f.align === 'right'} onClick={() => onChange({ align: 'right' })} />
        <Tog icon={Icon.justify} title="양쪽 맞춤 (Ctrl+J)" on={f.align === 'justify'} onClick={() => onChange({ align: 'justify' })} />
        <span className="ppt-sep" />
        <Drop icon={Icon.textDirection} title="텍스트 방향" active={f.vertical}>
          {(close) => (
            <>
              <button type="button" className={`ppt-item ${!f.vertical ? 'on' : ''}`} onClick={() => { onChange({ vertical: false }); close(); }}>가로</button>
              <button type="button" className={`ppt-item ${f.vertical ? 'on' : ''}`} onClick={() => { onChange({ vertical: true }); close(); }}>세로 쓰기</button>
            </>
          )}
        </Drop>
        <Drop icon={{ top: Icon.alignTop, middle: Icon.alignMiddle, bottom: Icon.alignBottom }[f.vAlign]} title="텍스트 맞춤">
          {(close) => ([['top', '위쪽', Icon.alignTop], ['middle', '중간', Icon.alignMiddle], ['bottom', '아래쪽', Icon.alignBottom]] as const).map(([v, label, icon]) => (
            <button key={v} type="button" className={`ppt-item ${f.vAlign === v ? 'on' : ''}`} onClick={() => { onChange({ vAlign: v }); close(); }}>{icon} {label}</button>
          ))}
        </Drop>
      </div>
      {!part && <label className="check small ppt-autofit"><input type="checkbox" checked={f.autoFit} onChange={(e) => onChange({ autoFit: e.target.checked })} /> 넘치면 텍스트 상자 크기 조정</label>}
      </>}
    </div>
  );
}
