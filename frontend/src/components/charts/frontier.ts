/** Pure transforms from the /api/frontier response to chart and table rows (percent units). */
import type { Schemas } from '../../api/client';
import { percent } from './format';
import type { ChartTable } from './ChartFrame';
import { SERIES_COLOR } from './transforms';

type Frontier = Schemas['Frontier'];
type FrontierPoint = Schemas['FrontierPoint'];
export type Frame = 'model' | 'hindsight';
export type MarkerKind = Schemas['FrontierMarker']['kind'];

export interface XY { x: number; y: number }
export interface MarkerPoint extends XY { key: string; label: string; kind: MarkerKind }

const toXY = (p: FrontierPoint): XY => ({ x: p.volatility * 100, y: p.expected_return * 100 });
const curve = (pts: readonly FrontierPoint[]): XY[] => pts.map(toXY).sort((a, b) => a.x - b.x || a.y - b.y);

export function frontierSeries(f: Frontier, frame: Frame, showFunds: boolean) {
  return {
    modelCurve: curve(f.model_curve),
    hindsightCurve: curve(f.hindsight_curve),
    cml: curve(f.capital_market_line),
    markers: f.markers
      .filter((m) => showFunds || m.kind !== 'fund')
      .map((m): MarkerPoint => ({ ...toXY(m[frame]), key: m.key, label: m.label, kind: m.kind })),
  };
}

const STRATEGY_COLORS = ['var(--series-4)', 'var(--series-5)', 'var(--series-6)'];
const STRATEGY_ORDER = ['min_variance', 'max_sharpe', 'risk_parity', 'hrp'];

/** Portfolio series-1, World series-2, S&P 500 series-3, strategies series-4..6 (cycled), funds ink-3. */
export function markerColor(m: Pick<MarkerPoint, 'key' | 'kind'>): string {
  if (m.kind === 'fund') return 'var(--ink-3)';
  if (m.kind === 'strategy') {
    const i = STRATEGY_ORDER.indexOf(m.key);
    return STRATEGY_COLORS[(i === -1 ? STRATEGY_ORDER.length : i) % STRATEGY_COLORS.length];
  }
  return SERIES_COLOR[m.key] ?? 'var(--ink-2)';
}

export function frontierTable(f: Frontier): ChartTable {
  return {
    head: ['Point', 'Model vol.', 'Model return', 'Hindsight vol.', 'Hindsight return'],
    rows: f.markers.map((m) => [
      m.label, percent(m.model.volatility), percent(m.model.expected_return),
      percent(m.hindsight.volatility), percent(m.hindsight.expected_return),
    ]),
  };
}
