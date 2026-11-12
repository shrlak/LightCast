// Format Shape pane sections for a shape (the 도형 서식 작업 창): 채우기 투명도 and gradient stops,
// 선 (dash, cap, join, compound) and 3차원 서식 (depth, contour, material, lighting, bevel sizes).
import type { GradientStop, SlideElement } from '../../domain/types';
import { BEVELS, CAPS, COMPOUNDS, DASHES, JOINS, gradientStopsOf, withGradientStops } from '../../domain/shapeEffects';
import { BEVEL_DEFAULT_PT, LIGHTINGS, LIGHT_DIRS, MATERIALS, patch3d } from '../../domain/shape3d';

type Change = (patch: Partial<SlideElement>) => void;
const pct = (v: number | undefined) => Math.round((v ?? 0) * 100);

/** A 0–100 % slider with a number box beside it. */
function Slider({ label, value, onChange, title }: { label: string; value: number; onChange: (v: number) => void; title?: string }) {
  const set = (v: number) => onChange(Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0)));
  return (
    <label className="ef-range" title={title}>{label}
      <input type="range" min={0} max={100} step={1} value={value} onChange={(e) => set(Number(e.target.value))} />
      <input className="ef-pct" type="number" min={0} max={100} value={value} onChange={(e) => set(Number(e.target.value))} />%
    </label>
  );
}

/** 채우기: transparency of the fill alone (the object's own opacity also fades the outline and text), and gradient stops. */
export function FillSection({ el, onChange }: { el: SlideElement; onChange: Change }) {
  const stops = gradientStopsOf(el);
  const setStops = (next: GradientStop[]) => onChange(withGradientStops(next));
  const edit = (i: number, patch: Partial<GradientStop>) => stops && setStops(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <fieldset className="ef-section" data-section="fill">
      <legend>채우기</legend>
      <Slider label="채우기 투명도" value={pct(el.fillTransparency)} title="채우기만 투명하게 합니다 (윤곽선과 글자는 그대로)" onChange={(v) => onChange({ fillTransparency: v ? v / 100 : undefined })} />
      {stops && (
        <div className="ef-stops">
          <div className="muted small">그라데이션 중지점</div>
          {stops.map((s, i) => (
            <div key={i} className="ef-stop">
              <input type="color" title="색" value={s.color.slice(0, 7)} onChange={(e) => edit(i, { color: e.target.value })} />
              <label className="ef-num" title="위치 (%)">위치<input type="number" min={0} max={100} value={Math.round(s.pos)} onChange={(e) => edit(i, { pos: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></label>
              <label className="ef-num" title="이 중지점의 투명도 (%)">투명<input type="number" min={0} max={100} value={pct(s.transparency)} onChange={(e) => edit(i, { transparency: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 || undefined })} /></label>
              <button type="button" className="mini-btn" disabled={stops.length <= 2} title="중지점 삭제" onClick={() => setStops(stops.filter((_, j) => j !== i))}>－</button>
            </div>
          ))}
          <button type="button" className="mini-btn" onClick={() => {
            // A new stop sits in the widest gap, coloured between its neighbours.
            let at = 0, best = -1;
            for (let i = 0; i < stops.length - 1; i++) if (stops[i + 1].pos - stops[i].pos > best) { best = stops[i + 1].pos - stops[i].pos; at = i; }
            const a = stops[at], b = stops[at + 1];
            setStops([...stops, { pos: Math.round((a.pos + b.pos) / 2), color: b.color, transparency: a.transparency }]);
          }}>＋ 중지점 추가</button>
        </div>
      )}
    </fieldset>
  );
}

/** 선: width, dash, cap, join and compound type. */
export function LineSection({ el, onChange }: { el: SlideElement; onChange: Change }) {
  const off = !el.stroke;
  const sel = <T extends string>(label: string, value: T, list: { id: T; label: string }[], key: keyof SlideElement, none?: T) => (
    <label className="ef-sel">{label}
      <select disabled={off} value={value} onChange={(e) => onChange({ [key]: e.target.value === none ? undefined : e.target.value } as Partial<SlideElement>)}>
        {list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
  return (
    <fieldset className="ef-section" data-section="line">
      <legend>선</legend>
      {off && <div className="muted small">윤곽선이 없습니다. 위에서 선 색을 고르면 켜집니다.</div>}
      {sel('대시 종류', el.dash ?? 'solid', DASHES, 'dash', 'solid')}
      {sel('끝 모양', el.cap ?? 'flat', CAPS, 'cap', 'flat')}
      {sel('연결 형식', el.join ?? 'round', JOINS, 'join', 'round')}
      {sel('복합 형식', el.compound ?? 'single', COMPOUNDS, 'compound', 'single')}
    </fieldset>
  );
}

/** 3차원 서식: depth, contour, material, lighting and the sizes of the bevels. */
export function Format3dSection({ el, onChange }: { el: SlideElement; onChange: Change }) {
  const f = el.format3d ?? {};
  const set = (patch: Partial<NonNullable<SlideElement['format3d']>>) => onChange({ format3d: patch3d(el.format3d, patch) });
  const num = (label: string, value: number | undefined, key: keyof NonNullable<SlideElement['format3d']>, fallback = 0) => (
    <label className="ef-num" title={`${label} (pt)`}>{label}
      <input type="number" min={0} max={1584} step={1} value={value ?? fallback} onChange={(e) => set({ [key]: Math.max(0, Math.min(1584, Number(e.target.value) || 0)) } as never)} />
    </label>
  );
  const bevelSel = (label: string, kind: string | undefined, on: (id: string | undefined) => void) => (
    <label className="ef-sel">{label}
      <select value={kind ?? 'none'} onChange={(e) => on(e.target.value === 'none' ? undefined : e.target.value)}>
        <option value="none">없음</option>
        {BEVELS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
      </select>
    </label>
  );
  const topKind = el.bevel ? el.bevelKind ?? 'circle' : undefined;
  return (
    <fieldset className="ef-section" data-section="3d">
      <legend>3차원 서식</legend>
      <div className="ef-row">
        {bevelSel('위쪽 입체', topKind, (id) => onChange(id ? { bevel: true, bevelKind: id } : { bevel: undefined, bevelKind: undefined, format3d: patch3d(el.format3d, { bevelW: undefined, bevelH: undefined }) }))}
        {topKind && <>{num('너비', f.bevelW, 'bevelW', BEVEL_DEFAULT_PT)}{num('높이', f.bevelH, 'bevelH', BEVEL_DEFAULT_PT)}</>}
      </div>
      <div className="ef-row">
        {bevelSel('아래쪽 입체', f.bevelBottom, (id) => set({ bevelBottom: id, ...(id ? {} : { bevelBottomW: undefined, bevelBottomH: undefined }) }))}
        {f.bevelBottom && <>{num('너비', f.bevelBottomW, 'bevelBottomW', BEVEL_DEFAULT_PT)}{num('높이', f.bevelBottomH, 'bevelBottomH', BEVEL_DEFAULT_PT)}</>}
      </div>
      <div className="ef-row">
        {num('깊이', f.depth, 'depth')}
        <input type="color" title="깊이 색" value={f.depthColor ?? '#808080'} onChange={(e) => set({ depthColor: e.target.value })} />
        {f.depthColor && <button type="button" className="mini-btn" title="깊이 색을 자동으로" onClick={() => set({ depthColor: undefined })}>자동</button>}
      </div>
      <div className="ef-row">
        {num('윤곽', f.contour, 'contour')}
        <input type="color" title="윤곽 색" value={f.contourColor ?? '#404040'} onChange={(e) => set({ contourColor: e.target.value })} />
        {f.contourColor && <button type="button" className="mini-btn" title="윤곽 색을 자동으로" onClick={() => set({ contourColor: undefined })}>자동</button>}
      </div>
      <label className="ef-sel">재질
        <select value={f.material ?? 'warmMatte'} onChange={(e) => set({ material: e.target.value === 'warmMatte' ? undefined : e.target.value })}>
          {MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <div className="ef-row">
        <label className="ef-sel">조명
          <select value={f.lighting ?? 'threePt'} onChange={(e) => set({ lighting: e.target.value === 'threePt' ? undefined : e.target.value })}>
            {LIGHTINGS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label className="ef-sel">방향
          <select value={f.lightDir ?? 't'} onChange={(e) => set({ lightDir: e.target.value === 't' ? undefined : e.target.value })}>
            {LIGHT_DIRS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      </div>
      <div className="muted small">깊이는 도형을 3차원 회전했을 때 옆면으로 보입니다. 모든 값은 .pptx로 내보낼 때 PowerPoint의 3차원 서식으로 저장됩니다.</div>
    </fieldset>
  );
}
