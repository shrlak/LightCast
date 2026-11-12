// Icons for the 글꼴 / 단락 controls, drawn after PowerPoint's ribbon icons (16 × 16, current colour).
import type { ReactNode } from 'react';

const Svg = ({ children, title }: { children: ReactNode; title?: string }) => (
  <svg className="ppt-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
    {title && <title>{title}</title>}
    {children}
  </svg>
);
const line = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', fill: 'none' } as const;
const text = (t: string, x: number, y: number, size = 11, extra: Record<string, string | number> = {}) => (
  <text x={x} y={y} fontSize={size} fontFamily="Segoe UI, Arial, sans-serif" fill="currentColor" {...extra}>{t}</text>
);
const lines = (rows: [number, number, number][]) => rows.map(([x1, x2, y], i) => <path key={i} d={`M${x1} ${y}H${x2}`} {...line} />);

export const Icon = {
  growFont: <Svg>{text('A', 1, 13.5, 13, { fontWeight: 600 })}<path d="M11.5 5.5l2-2.5 2 2.5" {...line} /></Svg>,
  shrinkFont: <Svg>{text('A', 1.5, 13.5, 10, { fontWeight: 600 })}<path d="M11.5 3l2 2.5 2-2.5" {...line} /></Svg>,
  clearFormat: <Svg>{text('A', 0.5, 11, 11, { fontWeight: 600 })}<path d="M8.5 13.8l4.6-4.6 2.4 2.4-2.2 2.2H8.5z" fill="#f4a6b8" stroke="#c2185b" strokeWidth="0.9" /></Svg>,
  bold: <Svg>{text('B', 3.5, 13, 13, { fontWeight: 800 })}</Svg>,
  italic: <Svg>{text('I', 5.5, 13, 13, { fontStyle: 'italic', fontFamily: 'Georgia, serif' })}</Svg>,
  underline: <Svg>{text('U', 3.5, 11.5, 11.5)}<path d="M3 14.5h10" {...line} /></Svg>,
  shadow: <Svg>{text('S', 5, 13.5, 13, { fill: '#a19f9d' })}{text('S', 3.5, 12, 13)}</Svg>,
  strike: <Svg>{text('abc', 0.5, 12, 9)}<path d="M0.5 8.6h15" {...line} /></Svg>,
  spacing: <Svg>{text('AV', 1.5, 9.5, 8.5, { fontWeight: 600 })}<path d="M1.5 13h13M3.5 11l-2 2 2 2M12.5 11l2 2-2 2" {...line} /></Svg>,
  changeCase: <Svg>{text('A', 0.5, 13, 13)}{text('a', 9, 13, 10)}</Svg>,
  fontColor: (color: string) => <Svg>{text('A', 3, 11, 11.5, { fontWeight: 600 })}<rect x="1.5" y="12.5" width="13" height="3" fill={color} stroke="rgba(0,0,0,.25)" strokeWidth="0.5" /></Svg>,
  highlight: (color: string | undefined) => (
    <Svg>
      <path d="M4 9.5l5.5-6.8 2.8 2.3-5.5 6.8-2.9.4z" fill="#fff" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M3.9 9.6l2.9 2.2" {...line} />
      <rect x="1.5" y="12.8" width="13" height="2.7" fill={color ?? 'transparent'} stroke="rgba(0,0,0,.35)" strokeWidth="0.5" strokeDasharray={color ? undefined : '1 1'} />
    </Svg>
  ),
  bullets: <Svg><circle cx="2.5" cy="3.5" r="1.2" fill="currentColor" /><circle cx="2.5" cy="8" r="1.2" fill="currentColor" /><circle cx="2.5" cy="12.5" r="1.2" fill="currentColor" />{lines([[6, 15, 3.5], [6, 15, 8], [6, 15, 12.5]])}</Svg>,
  numbering: <Svg>{text('1', 0.5, 5.5, 5.5)}{text('2', 0.5, 10, 5.5)}{text('3', 0.5, 14.5, 5.5)}{lines([[6, 15, 3.5], [6, 15, 8], [6, 15, 12.5]])}</Svg>,
  indentLess: <Svg>{lines([[1, 15, 2], [7, 15, 6], [7, 15, 10], [1, 15, 14]])}<path d="M4.5 5.5L2 8l2.5 2.5" {...line} /></Svg>,
  indentMore: <Svg>{lines([[1, 15, 2], [7, 15, 6], [7, 15, 10], [1, 15, 14]])}<path d="M2 5.5L4.5 8 2 10.5" {...line} /></Svg>,
  lineSpacing: <Svg>{lines([[7, 15, 3], [7, 15, 8], [7, 15, 13]])}<path d="M3 1.5v13M1.2 3.3L3 1.5l1.8 1.8M1.2 12.7L3 14.5l1.8-1.8" {...line} /></Svg>,
  alignLeft: <Svg>{lines([[1.5, 14.5, 2.5], [1.5, 10, 6.2], [1.5, 14.5, 9.8], [1.5, 10, 13.5]])}</Svg>,
  alignCenter: <Svg>{lines([[1.5, 14.5, 2.5], [4, 12, 6.2], [1.5, 14.5, 9.8], [4, 12, 13.5]])}</Svg>,
  alignRight: <Svg>{lines([[1.5, 14.5, 2.5], [6, 14.5, 6.2], [1.5, 14.5, 9.8], [6, 14.5, 13.5]])}</Svg>,
  distribute: <Svg>{lines([[1.5, 14.5, 2.5], [1.5, 14.5, 6.2], [1.5, 14.5, 9.8]])}<path d="M1.5 13.5h2M6 13.5h2M10 13.5h2M13.5 13.5h1" {...line} /></Svg>,
  justify: <Svg>{lines([[1.5, 14.5, 2.5], [1.5, 14.5, 6.2], [1.5, 14.5, 9.8], [1.5, 14.5, 13.5]])}</Svg>,
  columns: <Svg>{lines([[1, 7, 2.5], [1, 7, 6.2], [1, 7, 9.8], [1, 7, 13.5], [9, 15, 2.5], [9, 15, 6.2], [9, 15, 9.8], [9, 15, 13.5]])}</Svg>,
  textDirection: <Svg>{text('A', 1, 10, 10, { fontWeight: 600 })}<path d="M12.5 1.5v13M10.7 12.7l1.8 1.8 1.8-1.8" {...line} /></Svg>,
  alignTop: <Svg><rect x="1" y="1" width="14" height="14" rx="1" {...line} />{lines([[4, 12, 4.5], [4, 12, 7.5]])}</Svg>,
  alignMiddle: <Svg><rect x="1" y="1" width="14" height="14" rx="1" {...line} />{lines([[4, 12, 6.5], [4, 12, 9.5]])}</Svg>,
  alignBottom: <Svg><rect x="1" y="1" width="14" height="14" rx="1" {...line} />{lines([[4, 12, 8.5], [4, 12, 11.5]])}</Svg>,
  caret: <svg className="ppt-caret" viewBox="0 0 8 8" width="8" height="8" aria-hidden><path d="M1.5 3l2.5 2.5L6.5 3" stroke="currentColor" strokeWidth="1.1" fill="none" /></svg>,
};
