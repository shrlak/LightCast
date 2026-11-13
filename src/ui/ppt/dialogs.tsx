// PowerPoint's dialog boxes: Font, Paragraph, Replace Fonts (Home), and — from the other tabs —
// Header & Footer, Set Up Slide Show, Custom Shows, SmartArt, Photo Album, Action Settings, Reuse
// Slides, Slides from Outline, Guides, Thesaurus, Zoom and Audio. Each opens over the editor
// (not modal: the slide stays visible) and acts on the selection when it opens.
import { useMemo, useState, type ReactNode } from 'react';
import type { SlideElement } from '../../domain/types';
import { FONT_OPTIONS, officeFont } from '../../domain/fonts';
import { availableWeights, weightLabel, weightPatch } from '../../domain/fontWeight';
import { declaredFaces } from './FontWeightPicker';
import { FontImportButton, useImportedFonts } from './FontImport';
import { importedFamilies } from '../../domain/importedFonts';
import { SINGLE_SPACING } from '../../domain/textFormat';
import { autoFitMode, autoFitValue } from '../../domain/textFit';
import { formatAllRuns } from '../../domain/richText';
import { activeTextEditor } from '../RichTextEditor';
import { AutoCorrectDialog } from './autoCorrectDialog';
import { textTarget, type DialogKind, type Ed } from './editor';
import { MoreDialogs } from './dialogsMore';
import { MasterView } from './MasterView';
import { TabsDialog } from './dialogsTabs';
import { InspectDialog, PageMasterDialog } from './printing';
import { CompareDialog, LanguageDialog } from './reviewPanes';
import { VersionHistoryDialog } from './VersionHistory';

export function Dialog({ title, onClose, onOk, okLabel = '확인', okDisabled, wide, children }: { title: string; onClose: () => void; onOk?: () => void; okLabel?: string; okDisabled?: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`ppt-dialog center ${wide ? 'wide' : ''}`} role="dialog" aria-label={title} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="ppt-dialog-head"><b>{title}</b><button type="button" className="task-x" aria-label="닫기" onClick={onClose}>✕</button></div>
      <div className="ppt-dialog-body">{children}</div>
      <div className="ppt-dialog-buttons">
        {onOk && <button type="button" className="primary" disabled={okDisabled} onClick={onOk}>{okLabel}</button>}
        <button type="button" onClick={onClose}>{onOk ? '취소' : '닫기'}</button>
      </div>
    </div>
  );
}

export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="dlg-field"><span>{label}</span>{children}</label>;
export const Check = ({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <label className="rb-check"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
);
export const Num = ({ value, onChange, step = 1, min, max, disabled }: { value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; disabled?: boolean }) => (
  <input type="number" value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0} step={step} min={min} max={max} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
);

type Style = 'regular' | 'italic' | 'bold' | 'boldItalic';
const STYLES: [Style, string][] = [['regular', '보통'], ['italic', '기울임꼴'], ['bold', '굵게'], ['boldItalic', '굵은 기울임꼴']];

/** Home › Font ⤡: font, style, size, colour, underline, effects (strikethrough, super/subscript, caps) and character spacing. */
function FontDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const t = textTarget(ed);
  const editor = activeTextEditor();
  const sel = !!editor?.hasSelection();
  const cur = sel ? editor!.current() : null;
  const v = t?.value;
  const first = t?.els[0];
  const [family, setFamily] = useState(v?.fontFamily ?? '');
  const [style, setStyle] = useState<Style>(() => { const b = cur?.bold ?? v?.bold, i = cur?.italic ?? v?.italic; return b && i ? 'boldItalic' : b ? 'bold' : i ? 'italic' : 'regular'; });
  // 글꼴 굵기: blank follows 글꼴 스타일 (보통 / 굵게); a weight (가늘게 … 가장 굵게) replaces it.
  const [weight, setWeight] = useState<number | undefined>(cur?.weight ?? v?.weight);
  const [size, setSize] = useState((cur?.fontSize ?? v?.fontSize ?? 64) / 2);
  const [color, setColor] = useState((cur?.color ?? v?.color ?? '#ffffff').slice(0, 7));
  const [underline, setUnderline] = useState(!!(cur?.underline ?? v?.underline));
  const [strike, setStrike] = useState(!!(cur?.strike ?? v?.strike));
  const [baseline, setBaseline] = useState<'super' | 'sub' | undefined>(cur?.baseline);
  const [caps, setCaps] = useState(first?.caps);
  const [spacing, setSpacing] = useState((v?.letterSpacing ?? 0) / 2);
  const [tab, setTab] = useState<'font' | 'spacing'>('font');
  const importedNow = useImportedFonts();
  if (!t || !v) return <Dialog title="글꼴" onClose={onClose}><p>서식을 바꿀 텍스트를 고르세요.</p></Dialog>;
  const ok = () => {
    const italic = style === 'italic' || style === 'boldItalic';
    const { bold, weight: ownWeight } = weight === undefined ? { bold: style === 'bold' || style === 'boldItalic', weight: undefined } : weightPatch(weight);
    const fontSize = Math.max(2, Math.round(size * 2));
    if (sel && editor) {
      editor.apply({ fontSize, bold, weight: ownWeight, italic, underline: underline || undefined, color, strike: strike || undefined, baseline });
      t.patchEach(() => ({ fontFamily: family || undefined, caps, letterSpacing: spacing * 2 || undefined }));
    } else if (t.els.length) {
      t.patchEach((e) => ({
        fontFamily: family || undefined, fontSize, bold, weight: ownWeight, italic, underline: underline || undefined, strike: strike || undefined, color, caps, letterSpacing: spacing * 2 || undefined,
        ...(baseline !== cur?.baseline || baseline ? formatAllRuns({ ...e }, { baseline }) : {}),
      }));
    } else {
      t.onChange({ fontFamily: family || undefined, fontSize, bold, weight: ownWeight, italic, underline, strike, color, letterSpacing: spacing * 2 });
    }
    onClose();
  };
  // Superscript, subscript and caps need characters to act on: a text box, or selected slide text.
  const boxOnly = !t.els.length && !sel;
  return (
    <Dialog title="글꼴" onClose={onClose} onOk={ok} wide>
      <div className="dlg-tabs">
        <button type="button" className={tab === 'font' ? 'on' : ''} onClick={() => setTab('font')}>글꼴</button>
        <button type="button" className={tab === 'spacing' ? 'on' : ''} onClick={() => setTab('spacing')}>문자 간격</button>
      </div>
      {tab === 'font' ? (
        <>
          <div className="dlg-grid3">
            <Field label="한글/라틴 글꼴">
              <select value={family} onChange={(e) => setFamily(e.target.value)}>
                <option value="">테마 글꼴</option>
                {FONT_OPTIONS.map((o) => <option key={o.label} value={o.family}>{o.label}</option>)}
                {importedNow.length > 0 && <optgroup label="가져온 글꼴">{importedFamilies().map((n) => <option key={`imp-${n}`} value={officeFont(n)}>{n}</option>)}</optgroup>}
                {family && !FONT_OPTIONS.some((o) => o.family === family) && !importedFamilies().some((n) => officeFont(n) === family) && <option value={family}>{family.split(',')[0].replace(/"/g, '')}</option>}
              </select>
            </Field>
            <Field label="글꼴 스타일">
              <select value={style} onChange={(e) => setStyle(e.target.value as Style)}>{STYLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </Field>
            <Field label="크기 (pt)"><Num value={size} min={1} max={400} step={0.5} onChange={setSize} /></Field>
          </div>
          <div className="dlg-grid3"><FontImportButton className="btn small" label="글꼴 가져오기…" /></div>
          <div className="dlg-grid3">
            <Field label="글꼴 굵기">
              <select value={weight ?? ''} onChange={(e) => setWeight(e.target.value ? Number(e.target.value) : undefined)} aria-label="글꼴 굵기">
                <option value="">스타일에 따름</option>
                {availableWeights(family || v?.fontFamily, declaredFaces(), weight).map((w) => <option key={w} value={w}>{weightLabel(w)}</option>)}
              </select>
            </Field>
          </div>
          <div className="dlg-grid3">
            <Field label="글꼴 색"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
            <Field label="밑줄 스타일">
              <select value={underline ? 'single' : 'none'} onChange={(e) => setUnderline(e.target.value !== 'none')}><option value="none">(없음)</option><option value="single">단어</option></select>
            </Field>
          </div>
          <fieldset className="dlg-set">
            <legend>효과</legend>
            <div className="dlg-cols">
              <div>
                <Check label="취소선" checked={strike} onChange={setStrike} />
                <Check label="위 첨자" checked={baseline === 'super'} disabled={boxOnly} onChange={(on) => setBaseline(on ? 'super' : undefined)} />
                <Check label="아래 첨자" checked={baseline === 'sub'} disabled={boxOnly} onChange={(on) => setBaseline(on ? 'sub' : undefined)} />
              </div>
              <div>
                <Check label="소문자를 작은 대문자로" checked={caps === 'small'} disabled={boxOnly} onChange={(on) => setCaps(on ? 'small' : undefined)} />
                <Check label="모두 대문자로" checked={caps === 'all'} disabled={boxOnly} onChange={(on) => setCaps(on ? 'all' : undefined)} />
              </div>
            </div>
          </fieldset>
          <div className="dlg-preview" style={{
            fontFamily: family || undefined, fontWeight: weight ?? (style.startsWith('bold') ? 800 : 400), fontStyle: style.toLowerCase().includes('italic') ? 'italic' : 'normal',
            textDecoration: [underline && 'underline', strike && 'line-through'].filter(Boolean).join(' ') || undefined, color,
            textTransform: caps === 'all' ? 'uppercase' : undefined, fontVariant: caps === 'small' ? 'small-caps' : undefined, letterSpacing: spacing,
          }}>가나다 AaBbCc{baseline && <span style={{ verticalAlign: baseline, fontSize: '62%' }}>{baseline === 'super' ? '2' : '0'}</span>}</div>
          {sel && <p className="dlg-note">선택한 글자에 적용합니다 (글꼴과 대문자는 텍스트 상자 전체).</p>}
        </>
      ) : (
        <div className="dlg-grid3">
          <Field label="간격">
            <select value={spacing > 0 ? 'wide' : spacing < 0 ? 'narrow' : 'normal'} onChange={(e) => setSpacing(e.target.value === 'wide' ? 3 : e.target.value === 'narrow' ? -1.5 : 0)}>
              <option value="normal">보통</option><option value="wide">넓게</option><option value="narrow">좁게</option>
            </select>
          </Field>
          <Field label="값 (pt)"><Num value={spacing} step={0.1} min={-20} max={100} onChange={setSpacing} /></Field>
        </div>
      )}
    </Dialog>
  );
}

const pt = (px: number | undefined) => (px ?? 0) / 2;

/** Home › Paragraph ⤡: alignment, indentation, spacing, direction — and the text box's own options (Format Shape › Text Box). */
function ParagraphDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const t = textTarget(ed);
  const v = t?.value;
  const e = t?.els[0];
  const [align, setAlign] = useState(v?.align ?? 'center');
  const [level, setLevel] = useState(v?.indent ?? 0);
  const [special, setSpecial] = useState<'none' | 'first' | 'hanging'>(e?.firstIndent ? (e.firstIndent > 0 ? 'first' : 'hanging') : 'none');
  const [by, setBy] = useState(Math.abs(pt(e?.firstIndent)) || 18);
  const [before, setBefore] = useState(pt(e?.spaceBefore));
  const [after, setAfter] = useState(pt(e?.spaceAfter));
  const [line, setLine] = useState(Math.round(((v?.lineHeight ?? SINGLE_SPACING) / SINGLE_SPACING) * 100) / 100);
  // 줄 간격: 배수 is a multiple of single spacing; 최소 / 고정 are points (DeckCraft's "multiple" / "exactly").
  const [lineKind, setLineKind] = useState<'multiple' | 'min' | 'exact'>(e?.lineExact ? e.lineExact.mode === 'min' ? 'min' : 'exact' : 'multiple');
  const [lineAt, setLineAt] = useState(e?.lineExact ? e.lineExact.px / 2 : 18);
  const [rtl, setRtl] = useState(!!e?.rtl);
  const [vAlign, setVAlign] = useState(v?.vAlign ?? 'middle');
  const m = e?.margins ?? [14, 7, 14, 7];
  const [margins, setMargins] = useState<[number, number, number, number]>([pt(m[0]), pt(m[1]), pt(m[2]), pt(m[3])]);
  const [wrap, setWrap] = useState(e?.wrap !== false);
  const [fit, setFit] = useState(e ? autoFitMode(e) : 'legacy');
  const [columns, setColumns] = useState(v?.columns ?? 1);
  if (!t || !v) return <Dialog title="단락" onClose={onClose}><p>서식을 바꿀 텍스트를 고르세요.</p></Dialog>;
  const boxes = t.els.length > 0;
  const ok = () => {
    const lineHeight = Math.round(line * SINGLE_SPACING * 100) / 100;
    // Switching the reading direction mirrors left / right alignment (DeckCraft format.rtl).
    const mirrored = rtl !== !!e?.rtl && (align === 'left' || align === 'right') ? (align === 'left' ? 'right' : 'left') : align;
    const common = { align: mirrored, indent: level, lineHeight, vAlign, columns };
    // One patch for the boxes: two setElements calls in a row would each start from the same slide, the second undoing the first.
    if (boxes) {
      t.patchEach(() => ({
        ...common,
        ...(fit !== 'legacy' ? { autoFit: autoFitValue(fit), fontScale: undefined } : {}),
        lineExact: lineKind === 'multiple' ? undefined : { mode: lineKind, px: Math.max(1, lineAt) * 2 },
        firstIndent: special === 'none' ? undefined : (special === 'first' ? 1 : -1) * by * 2,
        spaceBefore: before ? before * 2 : undefined, spaceAfter: after ? after * 2 : undefined, rtl: rtl || undefined,
        margins: margins.map((x) => Math.max(0, x * 2)) as [number, number, number, number], wrap: wrap ? undefined : false,
      }));
    } else t.onChange(common);
    onClose();
  };
  const setMargin = (i: number, n: number) => setMargins((cur) => cur.map((x, j) => (j === i ? n : x)) as [number, number, number, number]);
  return (
    <Dialog title="단락" onClose={onClose} onOk={ok} wide>
      <fieldset className="dlg-set">
        <legend>일반</legend>
        <div className="dlg-grid3">
          <Field label="맞춤">
            <select value={align} onChange={(ev) => setAlign(ev.target.value as typeof align)}>
              <option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option><option value="justify">양쪽 맞춤</option><option value="justLow">양쪽 맞춤 (낮음)</option><option value="distributed">균등 분할</option>
            </select>
          </Field>
          <Field label="텍스트 방향">
            <select value={rtl ? 'rtl' : 'ltr'} disabled={!boxes} onChange={(ev) => setRtl(ev.target.value === 'rtl')}><option value="ltr">왼쪽에서 오른쪽</option><option value="rtl">오른쪽에서 왼쪽</option></select>
          </Field>
        </div>
      </fieldset>
      <fieldset className="dlg-set">
        <legend>들여쓰기</legend>
        <div className="dlg-grid3">
          <Field label="목록 수준"><Num value={level} min={0} max={8} onChange={setLevel} /></Field>
          <Field label="첫 줄">
            <select value={special} disabled={!boxes} onChange={(ev) => setSpecial(ev.target.value as typeof special)}><option value="none">(없음)</option><option value="first">첫 줄</option><option value="hanging">내어쓰기</option></select>
          </Field>
          <Field label="값 (pt)"><Num value={by} min={0} max={400} disabled={!boxes || special === 'none'} onChange={setBy} /></Field>
        </div>
      </fieldset>
      <fieldset className="dlg-set">
        <legend>간격</legend>
        <div className="dlg-grid3">
          <Field label="단락 앞 (pt)"><Num value={before} min={0} max={400} step={6} disabled={!boxes} onChange={setBefore} /></Field>
          <Field label="단락 뒤 (pt)"><Num value={after} min={0} max={400} step={6} disabled={!boxes} onChange={setAfter} /></Field>
          <Field label="줄 간격">
            <select value={lineKind === 'multiple' ? (line === 1 ? 'single' : line === 1.5 ? 'x1.5' : line === 2 ? 'double' : 'multiple') : lineKind} disabled={!boxes && lineKind === 'multiple' ? false : !boxes}
              onChange={(ev) => {
                const k = ev.target.value;
                if (k === 'single' || k === 'x1.5' || k === 'double') { setLineKind('multiple'); setLine(k === 'single' ? 1 : k === 'x1.5' ? 1.5 : 2); }
                else if (k === 'multiple') setLineKind('multiple');
                else setLineKind(k as 'min' | 'exact');
              }}>
              <option value="single">1줄</option><option value="x1.5">1.5줄</option><option value="double">2줄</option>
              <option value="min" disabled={!boxes}>최소</option><option value="exact" disabled={!boxes}>고정</option><option value="multiple">배수</option>
            </select>
          </Field>
          {lineKind === 'multiple'
            ? <Field label="값 (배수)"><Num value={line} min={0.5} max={5} step={0.05} onChange={setLine} /></Field>
            : <Field label="값 (pt)"><Num value={lineAt} min={1} max={792} step={1} onChange={setLineAt} /></Field>}
        </div>
      </fieldset>
      {boxes && (
        <fieldset className="dlg-set">
          <legend>텍스트 상자</legend>
          <div className="dlg-grid3">
            <Field label="세로 맞춤">
              <select value={vAlign} onChange={(ev) => setVAlign(ev.target.value as typeof vAlign)}><option value="top">위쪽</option><option value="middle">중간</option><option value="bottom">아래쪽</option></select>
            </Field>
            <Field label="단 (1–16)"><Num value={columns} min={1} max={16} onChange={(n) => setColumns(Math.max(1, Math.min(16, Math.round(n) || 1)))} /></Field>
          </div>
          <div className="dlg-grid4">
            {(['왼쪽 여백', '위쪽 여백', '오른쪽 여백', '아래쪽 여백'] as const).map((l, i) => <Field key={l} label={`${l} (pt)`}><Num value={margins[i]} min={0} max={200} step={0.5} onChange={(n) => setMargin(i, n)} /></Field>)}
          </div>
          <Check label="도형의 텍스트 배치 (자동 줄 바꿈)" checked={wrap} onChange={setWrap} />
          <Field label="자동 맞춤">
            <select value={fit} onChange={(ev) => setFit(ev.target.value as typeof fit)}>
              {fit === 'legacy' && <option value="legacy">LightCast 자동 맞춤</option>}
              <option value="none">자동 맞춤 안 함</option><option value="shrink">넘치면 텍스트 크기 조정</option><option value="resize">도형을 텍스트 크기에 맞춤</option>
            </select>
          </Field>
          <div className="dlg-row"><button type="button" onClick={() => ed.setDialog('tabs')}>탭…</button></div>
        </fieldset>
      )}
    </Dialog>
  );
}

const fontName = (f: string) => FONT_OPTIONS.find((o) => o.family === f)?.label ?? f.split(',')[0].replace(/"/g, '').trim();

/** Home › Replace ▾ › Replace Fonts: every use of one font in the presentation becomes another. */
function ReplaceFontsDialog({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  const p = ed.p;
  const used = useMemo(() => {
    const set = new Set<string>();
    if (ed.theme?.fontFamily) set.add(ed.theme.fontFamily);
    for (const s of p?.slides ?? []) {
      if (s.style?.fontFamily) set.add(s.style.fontFamily);
      for (const e of s.elements ?? []) if (e.fontFamily) set.add(e.fontFamily);
    }
    return [...set];
  }, [p, ed.theme]);
  const [from, setFrom] = useState(used[0] ?? '');
  const [to, setTo] = useState(FONT_OPTIONS[0].family);
  const [msg, setMsg] = useState('');
  const replace = () => {
    if (!p || !from || from === to) return;
    let n = 0;
    const theme = ed.theme?.fontFamily === from;
    const slides = p.slides.map((s) => {
      const els = s.elements?.map((e) => (e.fontFamily === from ? (n++, { ...e, fontFamily: to }) : e));
      const own = s.style?.fontFamily === from;
      if (own) n++;
      // Slides that use the theme's font get the new one on the slide itself.
      const viaTheme = theme && !s.style?.fontFamily && s.text.trim();
      if (viaTheme) n++;
      return { ...s, ...(els ? { elements: els } : {}), ...(own || viaTheme ? { style: { ...s.style, fontFamily: to } } : {}) };
    });
    ed.updatePres({ slides });
    setMsg(`${n}곳의 글꼴을 바꿨습니다.`);
  };
  return (
    <Dialog title="글꼴 바꾸기" onClose={onClose} onOk={replace} okLabel="바꾸기" okDisabled={!from || from === to || !ed.canEdit}>
      <Field label="현재 글꼴">
        <select value={from} onChange={(e) => setFrom(e.target.value)}>{used.map((f) => <option key={f} value={f}>{fontName(f)}</option>)}</select>
      </Field>
      <Field label="새 글꼴">
        <select value={to} onChange={(e) => setTo(e.target.value)}>{FONT_OPTIONS.map((o) => <option key={o.label} value={o.family}>{o.label}</option>)}</select>
      </Field>
      <div className="ppt-dialog-msg">{msg}</div>
    </Dialog>
  );
}

export function Dialogs({ ed, kind, onClose }: { ed: Ed; kind: DialogKind; onClose: () => void }) {
  if (kind === 'font') return <FontDialog ed={ed} onClose={onClose} />;
  if (kind === 'paragraph') return <ParagraphDialog ed={ed} onClose={onClose} />;
  if (kind === 'replaceFonts') return <ReplaceFontsDialog ed={ed} onClose={onClose} />;
  if (kind === 'master') return <MasterView ed={ed} onClose={onClose} />;
  if (kind === 'handoutMaster' || kind === 'notesMaster') return <PageMasterDialog ed={ed} kind={kind === 'handoutMaster' ? 'handout' : 'notes'} onClose={onClose} />;
  if (kind === 'inspect') return <InspectDialog ed={ed} onClose={onClose} />;
  if (kind === 'language') return <LanguageDialog ed={ed} onClose={onClose} />;
  if (kind === 'tabs') return <TabsDialog ed={ed} onClose={onClose} />;
  if (kind === 'autocorrect') return <AutoCorrectDialog onClose={onClose} />;
  if (kind === 'compare') return <CompareDialog ed={ed} onClose={onClose} />;
  if (kind === 'versionHistory') return <VersionHistoryDialog ed={ed} onClose={onClose} />;
  return <MoreDialogs ed={ed} kind={kind} onClose={onClose} />;
}

export type { SlideElement };
