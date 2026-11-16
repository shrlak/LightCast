// View › Arrange All: where n editor windows go on one display (plain ESM, no Electron imports, so tests can load it).

/** Grid cells for `n` windows inside `area` ({ x, y, width, height }): 1 fills it, 2 side by side, 3–4 in a 2×2 grid, and so on. */
export function tileRects(area, n) {
  const count = Math.max(0, Math.floor(n));
  if (!count) return [];
  const cols = count === 1 ? 1 : count <= 2 ? 2 : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const rects = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    // The last row shares its width among the windows it holds.
    const inRow = row === rows - 1 ? count - row * cols : cols;
    const w = Math.floor(area.width / inRow), h = Math.floor(area.height / rows);
    const c = row === rows - 1 ? i - row * cols : col;
    rects.push({ x: area.x + c * w, y: area.y + row * h, width: c === inRow - 1 ? area.width - w * (inRow - 1) : w, height: row === rows - 1 ? area.height - h * (rows - 1) : h });
  }
  return rects;
}
