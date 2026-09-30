/** Pure transforms from the /api/universe/frontier response to chart and table rows (percent units). */
import type { Schemas } from '../../api/client';
import type { ChartTable } from './ChartFrame';
import { decimal, percent } from './format';
import { assetClassColor, assetClassLabel } from './transforms';
import { ASSET_CLASSES, filtersToQuery, type FundFilters } from './universe';

type UniverseFrontier = Schemas['UniverseFrontier'];
type FrontierPoint = Schemas['FrontierPoint'];
export type UFrame = 'model' | 'realised';

export interface XY { x: number; y: number }
export interface UPoint extends XY {
  isin: string; label: string; assetClass: string; sharpe: number | null; proxied: boolean;
}

const toXY = (p: FrontierPoint): XY => ({ x: p.volatility * 100, y: p.expected_return * 100 });
const curve = (pts: readonly FrontierPoint[]): XY[] => pts.map(toXY).sort((a, b) => a.x - b.x || a.y - b.y);
const position = (p: Schemas['UniversePoint'], frame: UFrame) => (frame === 'model' ? p.model : p.realised ?? null);

/** Realised frame: no curve (the best past mix is only known afterwards) and no point for funds without history. */
export function universeSeries(f: UniverseFrontier, frame: UFrame) {
  const points: UPoint[] = [];
  for (const p of f.points) {
    const pos = position(p, frame);
    if (pos) {
      points.push({ ...toXY(pos), isin: p.isin, label: p.name, assetClass: p.asset_class, sharpe: pos.sharpe ?? null, proxied: p.proxied });
    }
  }
  const model = frame === 'model';
  return {
    curve: model ? curve(f.curve) : [],
    cml: model ? curve(f.capital_market_line) : [],
    points,
    missing: f.points.length - points.length,
  };
}

export function universeTable(f: UniverseFrontier, frame: UFrame): ChartTable {
  return {
    head: ['Fund', 'Asset class', 'Volatility', 'Return', 'Sharpe'],
    rows: f.points.flatMap((p) => {
      const pos = position(p, frame);
      return pos
        ? [[p.name, assetClassLabel(p.asset_class), percent(pos.volatility), percent(pos.expected_return), pos.sharpe == null ? '–' : decimal(pos.sharpe, 2)]]
        : [];
    }),
  };
}

export function universeLegend(points: readonly UPoint[]) {
  const present = new Set(points.map((p) => p.assetClass));
  return ASSET_CLASSES.filter((c) => present.has(c)).map((c) => ({ key: c, label: assetClassLabel(c), color: assetClassColor(c) }));
}

export const UNIVERSE_POINTS = 12;

export function universeRequest(filters: FundFilters, years: number, base: Schemas['InvestorProfile']['base_currency']) {
  return { filters: filtersToQuery(filters), period_years: years, base_currency: base, points: UNIVERSE_POINTS };
}

export function universeNote(frame: UFrame, years: number): string {
  if (frame === 'model') {
    return 'Forward-looking estimates. The curve is the best mix of these ETFs the model expects; it is not a forecast of any single fund.';
  }
  const span = years === 1 ? 'year' : `${years} years`;
  return `What happened over the last ${span}. Not a forecast. No frontier is drawn: the best past mix is only known afterwards.`;
}
