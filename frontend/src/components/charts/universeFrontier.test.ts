import { describe, expect, it } from 'vitest';
import type { Schemas } from '../../api/client';
import { emptyFilters } from './universe';
import { universeLegend, universeNote, universeRequest, universeSeries, universeTable } from './universeFrontier';

const pt = (volatility: number, expected_return: number, sharpe: number | null = null) => ({ volatility, expected_return, sharpe });
const f = {
  curve: [pt(0.2, 0.08), pt(0.05, 0.03)], capital_market_line: [pt(0, 0.02), pt(0.2, 0.09)],
  points: [
    { isin: 'A', name: 'Alpha', asset_class: 'equity', model: pt(0.15, 0.07, 0.33), realised: pt(0.16, 0.1, 0.5), proxied: false },
    { isin: 'B', name: 'Beta', asset_class: 'bond', model: pt(0.05, 0.03), realised: null, proxied: true },
  ],
  rf: 0.02, period: { start: '2021-01-01', end: '2025-12-31' }, warnings: [],
} as unknown as Schemas['UniverseFrontier'];

describe('universeSeries', () => {
  it('model frame: curve sorted, every point in percent', () => {
    const s = universeSeries(f, 'model');
    expect(s.curve.map((p) => p.x)).toEqual([5, 20]);
    expect(s.points).toHaveLength(2);
    expect(s.points[0]).toMatchObject({ isin: 'A', label: 'Alpha', assetClass: 'equity', sharpe: 0.33 });
    expect(s.points[0].x).toBeCloseTo(15);
    expect(s.points[0].y).toBeCloseTo(7);
  });
  it('realised frame: no curve, missing points counted', () => {
    const s = universeSeries(f, 'realised');
    expect(s.curve).toEqual([]);
    expect(s.cml).toEqual([]);
    expect(s.points.map((p) => p.isin)).toEqual(['A']);
    expect(s.missing).toBe(1);
  });
});

it('universeTable follows the frame', () => {
  expect(universeTable(f, 'model').head).toEqual(['Fund', 'Asset class', 'Volatility', 'Return', 'Sharpe']);
  expect(universeTable(f, 'realised').rows).toHaveLength(1);
});

it('universeLegend lists present asset classes in the standard order', () => {
  expect(universeLegend(universeSeries(f, 'model').points).map((l) => l.key)).toEqual(['equity', 'bond']);
});

it('universeRequest maps filters, period and currency', () => {
  expect(universeRequest({ ...emptyFilters, asset_class: 'bond' }, 3, 'USD'))
    .toEqual({ filters: { asset_class: 'bond' }, period_years: 3, base_currency: 'USD', points: 12 });
});

it('universeNote says realised is not a forecast and draws no frontier', () => {
  expect(universeNote('realised', 1)).toMatch(/last year\. Not a forecast\. No frontier is drawn/);
  expect(universeNote('realised', 5)).toMatch(/last 5 years/);
  expect(universeNote('model', 5)).toMatch(/Forward-looking estimates/);
});
