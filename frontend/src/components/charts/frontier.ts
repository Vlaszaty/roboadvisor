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
export interface MarkerPoint extends XY { key: string; label: string; kind: MarkerKind; sharpe: number | null }

const toXY = (p: FrontierPoint): XY => ({ x: p.volatility * 100, y: p.expected_return * 100 });
const sharpeOf = (p: FrontierPoint): number | null => p.sharpe ?? null;
const curve = (pts: readonly FrontierPoint[]): XY[] => pts.map(toXY).sort((a, b) => a.x - b.x || a.y - b.y);

export function frontierSeries(f: Frontier, frame: Frame, showFunds: boolean) {
  return {
    modelCurve: curve(f.model_curve),
    hindsightCurve: curve(f.hindsight_curve),
    cml: curve(f.capital_market_line),
    markers: f.markers
      .filter((m) => showFunds || m.kind !== 'fund')
      .map((m): MarkerPoint => ({ ...toXY(m[frame]), key: m.key, label: m.label, kind: m.kind, sharpe: sharpeOf(m[frame]) })),
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

export type Shape = 'circle' | 'square' | 'diamond' | 'triangle' | 'cross';
const STRATEGY_SHAPES: Shape[] = ['square', 'diamond', 'triangle', 'cross'];

/** Strategies get distinct shapes (they share three colours); everything else is a circle. */
export function markerShape(m: Pick<MarkerPoint, 'key' | 'kind'>): Shape {
  if (m.kind !== 'strategy') return 'circle';
  const i = STRATEGY_ORDER.indexOf(m.key);
  return STRATEGY_SHAPES[i === -1 ? 0 : i];
}

/** Text labels are drawn only for the portfolio and the World / S&P 500 references. */
export const hasTextLabel = (m: Pick<MarkerPoint, 'key' | 'kind'>): boolean =>
  m.kind === 'portfolio' || m.key === 'world' || m.key === 'sp500';

/** Short display name: drops a trailing parenthetical. */
export const shortLabel = (label: string): string => label.replace(/\s*\(.*\)/, '');

export interface LegendItem { key: string; label: string; color: string; shape: Shape }

/** Marker legend: portfolio, references, strategies (each with its shape), then one "Individual funds" entry if shown. */
export function markerLegend(markers: readonly MarkerPoint[]): LegendItem[] {
  const item = (m: MarkerPoint): LegendItem => ({ key: m.key, label: shortLabel(m.label), color: markerColor(m), shape: markerShape(m) });
  const items = markers.filter((m) => m.kind !== 'fund').map(item);
  if (markers.some((m) => m.kind === 'fund')) {
    items.push({ key: 'funds', label: 'Individual funds', color: 'var(--ink-3)', shape: 'circle' });
  }
  return items;
}

/** Caption under the frontier chart; follows the selected frame. */
export function frontierNote(frame: Frame, years: number): string {
  if (frame === 'model') {
    return 'Your portfolio sits on the model curve by construction: it is the best mix the model could find. The hindsight curve shows what would have been best with perfect knowledge of the past.';
  }
  const span = years === 1 ? 'year\'s' : `${years} years'`;
  return `Markers show where each portfolio would have landed with the last ${span} actual returns; the dashed curve is the best that was possible in hindsight.`;
}
