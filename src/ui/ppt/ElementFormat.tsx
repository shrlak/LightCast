import { useRef } from 'react';
import type { MediaFit, SlideElement } from '../../domain/types';
import { putMedia } from '../../domain/media';
import { uid } from '../../domain/lyrics';
import { CANVAS_H, CANVAS_W } from '../../domain/canvas';
import { TextFormatPanel, type TextFormatValue } from './TextFormatPanel';
import { changeCase, clearTextFormat } from '../../domain/textFormat';
import { autoFitMode, autoFitValue } from '../../domain/textFit';
import { AutoTextarea } from '../AutoTextarea';
import type { ChartData as ChartModel, TableData } from '../../engine';

export interface TableRange { r: number; c: number; r1: number; c1: number }

/** The table's cells to type in; click picks a cell, Shift+click a range (for merge, shading, insert). */
function TableGrid({ el, onChange, cell, onCell }: { el: SlideElement; onChange: (p: Partial<SlideElement>) => void; cell?: TableRange; onCell?: (r: TableRange) => void }) {
  const t = el.table as TableData;
  const inRange = (r: number, c: number) => !!cell && r >= Math.min(cell.r, cell.r1) && r <= Math.max(cell.r, cell.r1) && c >= Math.min(cell.c, cell.c1) && c <= Math.max(cell.c, cell.c1);
  const setText = (r: number, c: number, text: string) => onChange({ table: { ...t, rows: t.rows.map((row, ri) => row.map((x, ci) => (ri === r && ci === c ? { ...x, text } : x))) } });
  return (
    <div className="table-grid-edit">
      <div className="muted small">셀을 클릭해 고르고(Shift+클릭: 범위) 리본의 테이블 디자인 · 레이아웃으로 병합 · 삽입 · 음영을 바꿉니다.</div>
      <table><tbody>
        {t.rows.map((row, r) => (
          <tr key={r}>{row.map((x, c) => (x.hMerge || x.vMerge ? null : (
            <td key={c} colSpan={x.span ?? 1} rowSpan={x.rowSpan ?? 1} className={inRange(r, c) ? 'on' : ''}
              onMouseDown={(e) => onCell?.(e.shiftKey && cell ? { ...cell, r1: r, c1: c } : { r, c, r1: r, c1: c })}>
              <textarea rows={1} value={x.text} onChange={(e) => setText(r, c, e.target.value)} />
            </td>
          )))}</tr>
        ))}
      </tbody></table>
      <label className="ef-num">글자 크기<input type="number" min={8} max={200} value={el.fontSize ?? 32} onChange={(e) => onChange({ fontSize: Number(e.target.value) || 32 })} /></label>
    </div>
  );
}

/** The chart's data as a small sheet: categories down, series across. */
function ChartData({ el, onChange }: { el: SlideElement; onChange: (p: Partial<SlideElement>) => void }) {
  const ch = el.chart as ChartModel;
  const set = (patch: Partial<ChartModel>) => onChange({ chart: { ...ch, ...patch } });
  const n = ch.categories.length;
  return (
    <div className="chart-data-edit">
      <label className="stack">차트 제목<input value={ch.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></label>
      <table><thead><tr><th />{ch.series.map((s, i) => (
        <th key={i}><input value={s.name} onChange={(e) => set({ series: ch.series.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></th>
      ))}</tr></thead>
      <tbody>{ch.categories.map((cat, r) => (
        <tr key={r}><th><input value={cat} onChange={(e) => set({ categories: ch.categories.map((x, j) => (j === r ? e.target.value : x)) })} /></th>
          {ch.series.map((s, i) => <td key={i}><input type="number" value={s.values[r] ?? 0} onChange={(e) => set({ series: ch.series.map((x, j) => (j === i ? { ...x, values: Array.from({ length: n }, (_, k) => (k === r ? Number(e.target.value) : x.values[k] ?? 0)) } : x)) })} /></td>)}
        </tr>
      ))}</tbody></table>
      <div className="row gap-xs wrap">
        <button className="mini-btn" onClick={() => set({ categories: [...ch.categories, `항목 ${n + 1}`], series: ch.series.map((s) => ({ ...s, values: [...s.values, 0] })) })}>＋ 항목</button>
        <button className="mini-btn" disabled={n < 2} onClick={() => set({ categories: ch.categories.slice(0, -1), series: ch.series.map((s) => ({ ...s, values: s.values.slice(0, n - 1) })) })}>－ 항목</button>
        <button className="mini-btn" onClick={() => set({ series: [...ch.series, { name: `계열 ${ch.series.length + 1}`, values: ch.categories.map(() => 0) }] })}>＋ 계열</button>
        <button className="mini-btn" disabled={ch.series.length < 2} onClick={() => set({ series: ch.series.slice(0, -1) })}>－ 계열</button>
      </div>
    </div>
  );
}

const KIND: Record<string, string> = { text: '텍스트 상자', image: '그림', shape: '도형', video: '동영상', camera: '카메라', qr: 'QR 코드', table: '표', chart: '차트', icon: '아이콘', ink: '잉크' };

/** The size a text box shows (its first real line's size when lines are styled one by one). */
export const sizeOf = (el: SlideElement) => el.paragraphs?.find((p) => p.text.trim())?.fontSize ?? el.fontSize ?? 64;

/** What the format panel shows for a text box. */
export const textValue = (el: SlideElement): TextFormatValue => ({
  fontFamily: el.fontFamily, fontSize: sizeOf(el), bold: !!el.bold, italic: !!el.italic, underline: !!el.underline, strike: !!el.strike,
  shadow: !!el.shadow, letterSpacing: el.letterSpacing ?? 0, color: (el.paragraphs?.find((p) => p.text.trim())?.color ?? el.color ?? '#ffffff').slice(0, 7),
  highlight: el.highlight, align: el.align ?? 'center', vAlign: el.vAlign ?? 'middle', lineHeight: el.lineHeight ?? (el.paragraphs ? 1.2 : 1.25),
  list: el.list, indent: el.indent ?? 0, columns: el.columns ?? 1, vertical: !!el.vertical, autoFit: el.autoFit !== false,
});

/** A chosen size applies equally to every paragraph in this box. */
export const elementPatch = (_el: SlideElement, { fontSize, ...rest }: Partial<TextFormatValue>): Partial<SlideElement> =>
  ({ ...rest, ...(fontSize === undefined ? {} : { fontSize }) });

export const CLEAR_TEXT_FORMAT: Partial<SlideElement> = { bold: false, italic: false, underline: undefined, strike: undefined, shadow: false, letterSpacing: undefined, highlight: undefined, list: undefined, indent: undefined, columns: undefined, vertical: undefined, lineHeight: undefined };

const FIT_LABELS: [Exclude<ReturnType<typeof autoFitMode>, 'legacy'>, string][] = [['none', '자동 맞춤 안 함'], ['shrink', '넘치면 텍스트 크기 조정'], ['resize', '도형을 텍스트 크기에 맞춤']];

/**
 * Format Shape › 텍스트 옵션 › 텍스트 상자: PowerPoint's three autofit choices and 도형의 텍스트 배치
 * (DeckCraft format.autofit / format.wrap). A template box LightCast fits itself shows none chosen.
 */
export function AutoFitOptions({ el, onChange }: { el: SlideElement; onChange: (p: Partial<SlideElement>) => void }) {
  const mode = autoFitMode(el);
  return (
    <fieldset className="dlg-set autofit-options">
      <legend>텍스트 상자</legend>
      {FIT_LABELS.map(([m, label]) => (
        <label key={m} className="rb-check"><input type="radio" name={`autofit-${el.id}`} checked={mode === m} onChange={() => onChange({ autoFit: autoFitValue(m), fontScale: undefined, maximizeFont: false, preferredFontSize: undefined })} /> {label}</label>
      ))}
      {mode === 'legacy' && <div className="muted small">LightCast 자동 맞춤 (슬라이드 안에서 상자를 늘림)</div>}
      <label className="rb-check"><input type="checkbox" checked={el.wrap !== false} onChange={(e) => onChange({ wrap: e.target.checked ? undefined : false })} /> 도형의 텍스트 배치</label>
    </fieldset>
  );
}

/**
 * Settings of the object selected on the slide, in the right-hand panel: its text, font, size,
 * colours, alignment, position and size, order on the slide — changes show at once.
 */
export function ElementFormat({ el, onChange, onDelete, onOrder, addMedia, cell, onCell }: {
  /** Table cells picked (Table Layout acts on them). */
  cell?: TableRange;
  onCell?: (r: TableRange) => void;
  el: SlideElement;
  onChange: (patch: Partial<SlideElement>) => void;
  onDelete: () => void;
  onOrder: (where: 'front' | 'back') => void;
  addMedia: (m: { id: string; name: string; type: 'image' }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const num = (k: 'x' | 'y' | 'w' | 'h') => (
    <label className="ef-num">{({ x: 'X', y: 'Y', w: '너비', h: '높이' })[k]}
      <input type="number" step={1} value={Math.round(el[k])} onChange={(e) => onChange({ [k]: Number(e.target.value) } as Partial<SlideElement>)} />
    </label>
  );
  const replaceImage = async (file: File | undefined) => {
    if (!file) return;
    const id = uid('m');
    await putMedia(id, file);
    addMedia({ id, name: file.name, type: 'image' });
    onChange({ mediaId: id });
  };

  return (
    <div className="element-format">
      <div className="ef-head">
        <b>선택한 개체 · {KIND[el.kind] ?? el.kind}</b>
        <span className="grow" />
        <button className="mini-btn" title="맨 앞으로" onClick={() => onOrder('front')}>⬆ 앞</button>
        <button className="mini-btn" title="맨 뒤로" onClick={() => onOrder('back')}>⬇ 뒤</button>
        <button className="mini-btn danger" title="삭제 (Delete)" onClick={onDelete}>🗑</button>
      </div>

      {el.kind === 'text' && (
        <>
          <label className="stack">텍스트<AutoTextarea rows={Math.min(8, Math.max(2, (el.text ?? '').split('\n').length))} value={el.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} /></label>
          <button title="원래 글자 크기로 상자를 늘리고, 슬라이드 안에 들어가지 않을 때만 글자를 줄입니다." onClick={() => onChange({ autoFit: true, maximizeFont: false })}>넘친 내용 맞추기</button>
          <button onClick={() => onChange({ fontSize: sizeOf(el), x: el.x, y: el.y, w: el.w, h: el.h })}>글자 크기 통일</button>
          <TextFormatPanel
            value={textValue(el)}
            onChange={(patch) => onChange(elementPatch(el, patch))}
            onChangeCase={(kind) => onChange({ text: changeCase(el.text ?? '', kind) })}
            onClear={() => onChange(clearTextFormat(el))}
            autoFitOption={false}
          />
          <AutoFitOptions el={el} onChange={onChange} />
        </>
      )}

      {(el.kind === 'image' || el.kind === 'video') && (
        <div className="row gap-xs wrap">
          <select value={el.fit ?? 'contain'} onChange={(e) => onChange({ fit: e.target.value as MediaFit })} title="맞춤">
            <option value="fill">늘려서 채우기</option>
            <option value="contain">비율 유지 (전체)</option>
            <option value="cover">비율 유지 (꽉 차게)</option>
          </select>
          {el.kind === 'image' && <button onClick={() => fileRef.current?.click()}>그림 바꾸기…</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { replaceImage(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}

      {el.kind === 'qr' && (
        <>
          <label className="stack">QR 코드 링크
            <input value={el.link ?? ''} placeholder="https://forms.gle/…" onChange={(e) => onChange({ link: e.target.value.trim() || undefined })} />
          </label>
          <p className="hint">휴대폰으로 찍으면 이 주소가 열립니다. 모서리를 끌어 크기를, 가운데를 끌어 위치를 바꾸고, 🗑 또는 Delete 키로 지웁니다.</p>
        </>
      )}

      {(el.kind === 'shape' || el.kind === 'icon' || el.kind === 'ink') && (
        <>
          <div className="row gap-xs wrap">
            {el.kind === 'shape' && <label className="fmt-color" title="채우기"><input type="color" value={(el.fill ?? '#ffffff').slice(0, 7)} onChange={(e) => onChange({ fill: e.target.value, gradient: undefined })} />채우기</label>}
            {el.kind === 'shape' && <label className="check small" title="그라데이션 채우기"><input type="checkbox" checked={!!el.gradient} onChange={(e) => onChange({ gradient: e.target.checked ? [el.fill?.startsWith('#') ? el.fill : '#2e6fd8', '#0b1f3a'] : undefined })} /> 그라데이션</label>}
            {el.gradient && <><input type="color" value={el.gradient[0].slice(0, 7)} onChange={(e) => onChange({ gradient: [e.target.value, el.gradient![1]] })} /><input type="color" value={el.gradient[1].slice(0, 7)} onChange={(e) => onChange({ gradient: [el.gradient![0], e.target.value] })} /><label className="ef-num">각도<input type="number" step={15} value={el.gradientAngle ?? 90} onChange={(e) => onChange({ gradientAngle: Number(e.target.value) })} /></label></>}
            <label className="fmt-color" title="선"><input type="color" value={(el.stroke ?? el.color ?? '#000000').slice(0, 7)} onChange={(e) => onChange(el.kind === 'icon' ? { color: e.target.value } : { stroke: e.target.value })} />선</label>
            {el.kind === 'shape' && <button className="mini-btn" onClick={() => onChange({ stroke: undefined, strokeWidth: undefined })}>선 없음</button>}
            <label className="ef-num">두께<input type="number" min={0} max={80} value={el.strokeWidth ?? (el.stroke ? 4 : 0)} onChange={(e) => onChange({ strokeWidth: Number(e.target.value) || undefined })} /></label>
          </div>
          {el.kind === 'shape' && (
            <label className="stack">도형 안 텍스트<AutoTextarea rows={2} value={el.text ?? ''} onChange={(e) => onChange({ text: e.target.value || undefined, runs: undefined, color: el.color ?? '#ffffff' })} /></label>
          )}
        </>
      )}

      {el.kind === 'table' && el.table && <TableGrid el={el} onChange={onChange} cell={cell} onCell={onCell} />}
      {el.kind === 'chart' && el.chart && <ChartData el={el} onChange={onChange} />}

      <details className="ef-more">
        <summary>대체 텍스트 · 링크 · 이름</summary>
        <label className="stack">대체 텍스트 (화면 낭독용 설명)<AutoTextarea rows={2} value={el.alt ?? ''} onChange={(e) => onChange({ alt: e.target.value || undefined })} /></label>
        <label className="stack">링크 (슬라이드 쇼에서 클릭하면 열림)<input value={el.href ?? ''} placeholder="https://" onChange={(e) => onChange({ href: e.target.value.trim() || undefined })} /></label>
        <label className="stack">이름 (선택 창)<input value={el.name ?? ''} onChange={(e) => onChange({ name: e.target.value || undefined })} /></label>
      </details>

      <label className="ef-range">투명도<input type="range" min={0.1} max={1} step={0.05} value={el.opacity ?? 1} onChange={(e) => onChange({ opacity: Number(e.target.value) })} /></label>
      <div className="ef-grid">{num('x')}{num('y')}{num('w')}{num('h')}</div>
      <div className="row gap-xs">
        <button className="mini-btn" onClick={() => onChange({ x: Math.round((CANVAS_W - el.w) / 2) })}>가로 가운데</button>
        <button className="mini-btn" onClick={() => onChange({ y: Math.round((CANVAS_H - el.h) / 2) })}>세로 가운데</button>
      </div>
    </div>
  );
}
