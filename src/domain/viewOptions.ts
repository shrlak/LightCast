// View › Zoom (DeckCraft view.zoom / zoomIn / zoomOut / zoomDialog) and File › Print's slide range
// (DeckCraft parse_slide_range).

/** DeckCraft's zoom steps (Zoom In / Zoom Out go to the next one). */
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.25, 1.5, 2, 3, 4];
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

/** A zoom typed as a percentage, kept between 10 % and 400 %. */
export const clampZoom = (percent: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (Number.isFinite(percent) ? percent : 100) / 100));

/** The zoom after Zoom In / Zoom Out from `cur` (the fitted scale when the view fits the window). */
export function zoomStep(cur: number, zoomIn: boolean): number {
  return zoomIn ? ZOOM_STEPS.find((s) => s > cur + 0.01) ?? ZOOM_MAX : [...ZOOM_STEPS].reverse().find((s) => s < cur - 0.01) ?? ZOOM_MIN;
}

/**
 * A slide range as typed in Print's 슬라이드 box ("1-3, 5"; 1-based, `,` or `;` between parts, ranges
 * either way round) → 0-based indices in order without repeats; or an error, as in PowerPoint.
 */
export function parseSlideRange(text: string, count: number): { slides: number[] } | { error: string } {
  const invalid = { error: `“${text}”은(는) 올바른 슬라이드 범위가 아닙니다. 1-3, 5처럼 번호와 범위를 입력하세요.` };
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of text.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
    const [a, b = a] = part.split('-').map((x) => x.trim());
    if (part.split('-').length > 2 || !/^\d+$/.test(a) || !/^\d+$/.test(b)) return invalid;
    const lo = Math.min(Number(a), Number(b)), hi = Math.max(Number(a), Number(b));
    if (lo === 0 || hi > count) return { error: `프레젠테이션의 슬라이드는 ${count}장입니다. “${part}”은(는) 범위를 벗어납니다.` };
    for (let i = lo - 1; i < hi; i++) if (!seen.has(i)) { seen.add(i); out.push(i); }
  }
  return out.length ? { slides: out } : invalid;
}
