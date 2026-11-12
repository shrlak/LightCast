/** Find the largest half-pixel font size that fits; layout must be measured at the requested size. */
export function largestFittingFont(fits: (size: number) => boolean, upper: number): number {
  let lo = 2, hi = Math.max(2, Math.ceil(upper * 2)), best = 2;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid / 2)) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best / 2;
}

/** Clone the real styled content, retaining mixed sizes, margins, fonts and explicit line breaks. */
export function maximumFontFromNode(node: HTMLElement, width: number, height: number, upper?: number): number {
  const base = parseFloat(getComputedStyle(node).fontSize) || 64;
  if (!node.textContent?.trim()) return base;
  const clone = node.cloneNode(true) as HTMLElement;
  const originals = [node, ...node.querySelectorAll<HTMLElement>('*')];
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
  const values = originals.map((n) => {
    const style = getComputedStyle(n);
    return { font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight), top: parseFloat(style.marginTop), bottom: parseFloat(style.marginBottom) };
  });
  Object.assign(clone.style, { position: 'fixed', left: '-100000px', top: '0', width: `${width}px`, height: 'max-content', minHeight: '0', visibility: 'hidden', pointerEvents: 'none', margin: '0', whiteSpace: getComputedStyle(node).whiteSpace === 'pre' ? 'pre' : 'pre-wrap', overflowWrap: 'anywhere', display: 'block' });
  if (/^(vertical|sideways)/.test(getComputedStyle(node).writingMode)) { clone.style.width = 'max-content'; clone.style.height = `${height}px`; }
  document.body.append(clone);
  try {
    return largestFittingFont((size) => {
      const ratio = size / base;
      copies.forEach((copy, i) => {
        const v = values[i]; copy.style.fontSize = `${v.font * ratio}px`;
        if (Number.isFinite(v.line)) copy.style.lineHeight = `${v.line * ratio}px`;
        if (i) { copy.style.marginTop = `${v.top * ratio}px`; copy.style.marginBottom = `${v.bottom * ratio}px`; }
        
      });
      return clone.scrollHeight <= height && clone.scrollWidth <= width;
    }, upper ?? Math.max(width, height, base) * 4);
  } finally { clone.remove(); }
}
