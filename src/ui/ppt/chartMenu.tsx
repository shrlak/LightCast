// The chart gallery of Insert › Chart and Chart Design › 차트 종류 변경: every chart type with a
// thumbnail drawn by the engine from the type's own sample data, grouped as PowerPoint groups them.
import { chartSvg, type ChartKind } from '../../engine';
import { CHART_GROUPS, CHART_LABEL, sampleChart } from '../../domain/chartTypes';
import { useEngineEpoch } from '../EngineElements';
import { MenuHead } from './ribbonParts';

const thumbs = new Map<ChartKind, string>();

function ChartThumb({ kind }: { kind: ChartKind }) {
  useEngineEpoch();
  let svg = thumbs.get(kind);
  if (!svg) {
    const s = chartSvg({ ...sampleChart(kind), title: '', legend: false, dataLabels: false, textColor: '#605e5c' }, 240, 150);
    if (s) thumbs.set(kind, (svg = s));
  }
  return svg ? <span className="chart-thumb" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="chart-thumb" />;
}

export function ChartMenu({ onPick, current }: { onPick: (kind: ChartKind) => void; current?: ChartKind }) {
  return (
    <div className="chart-gal">
      {CHART_GROUPS.map((g) => (
        <section key={g.label}>
          <MenuHead>{g.label}</MenuHead>
          <div className="chart-gal-row">
            {g.kinds.map((k) => (
              <button key={k} type="button" className={`chart-gal-item ${current === k ? 'on' : ''}`} title={CHART_LABEL[k]} onClick={() => onPick(k)}>
                <ChartThumb kind={k} />
                <span>{CHART_LABEL[k]}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
