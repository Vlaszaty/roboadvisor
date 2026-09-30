/** Pure transforms from the /api/frontier response to chart and table rows (percent units). */
import type { Schemas } from '../../api/client';
import { decimal, percent } from './format';
import type { ChartTable } from './ChartFrame';
import { SERIES_COLOR } from './transforms';

type Frontier = Schemas['Frontier'];
type FrontierPoint = Schemas['FrontierPoint'];
export type MarkerKind = Schemas['FrontierMarker']['kind'];

export interface XY { x: number; y: number }
export interface MarkerPoint extends XY { key: string; label: string; kind: MarkerKind; sharpe: number | null }

const toXY = (p: FrontierPoint): XY => ({ x: p.volatility * 100, y: p.expected_return * 100 });
const sharpeOf = (p: FrontierPoint): number | null => p.sharpe ?? null;
const curve = (pts: readonly FrontierPoint[]): XY[] => pts.map(toXY).sort((a, b) => a.x - b.x || a.y - b.y);

export function frontierSeries(f: Frontier, showFunds: boolean) {
  return {
    modelCurve: curve(f.model_curve),
    cml: curve(f.capital_market_line),
    markers: f.markers
      .filter((m) => showFunds || m.kind !== 'fund')
      .map((m): MarkerPoint => ({ ...toXY(m.model), key: m.key, label: m.label, kind: m.kind, sharpe: sharpeOf(m.model) })),
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

const sharpeCell = (v: number | null | undefined): string => (v == null ? '–' : decimal(v, 2));

export function frontierTable(f: Frontier, showFunds: boolean): ChartTable {
  const markers = showFunds ? f.markers : f.markers.filter((m) => m.kind !== 'fund');
  return {
    head: ['Point', 'Volatility', 'Expected return', 'Sharpe'],
    rows: markers.map((m) => [
      m.label, percent(m.model.volatility), percent(m.model.expected_return), sharpeCell(m.model.sharpe),
    ]),
  };
}

/** Points per curve requested by the chart (the API default is 20; 12 keeps USD requests fast). */
export const FRONTIER_POINTS = 12;

export function frontierRequest(profile: Schemas['InvestorProfile'], settings: Schemas['EngineSettings']) {
  return { profile, settings, points: FRONTIER_POINTS };
}

const fmtPct = (v: number) => `${v.toFixed(1)}%`;

/** Screen-reader description: every big marker with its position; individual funds only as a count. */
export function frontierDescription(markers: readonly MarkerPoint[]): string {
  const big = markers.filter((m) => m.kind !== 'fund');
  const funds = markers.length - big.length;
  const listed = big.map((m) => `${m.label} at ${fmtPct(m.x)} volatility and ${fmtPct(m.y)} return`).join('; ');
  const fundText = funds > 0 ? ` Also shown: ${funds} individual ${funds === 1 ? 'fund' : 'funds'}.` : '';
  return `Scatter and line chart of volatility against expected return, in percent. Curves: model frontier, capital market line. Markers are placed using model estimates: ${listed}.${fundText}`;
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

const STRATEGY_NAMES: Record<string, string> = {
  min_variance: 'minimum variance',
  max_sharpe: 'maximum Sharpe',
  risk_parity: 'risk parity',
  hrp: 'hierarchical risk parity',
};

/** Caption under the frontier chart. */
export function frontierNote(strategy: string | undefined): string {
  const where = !strategy || strategy === 'target_vol'
    ? 'Your portfolio sits on the model curve by construction: it is the best mix the model could find.'
    : `Your portfolio uses the ${STRATEGY_NAMES[strategy] ?? strategy} strategy, which does not aim for the model curve.`;
  return `${where} These are forward-looking estimates, not results.`;
}
