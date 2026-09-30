import { describe, expect, it } from 'vitest';
import type { Schemas } from '../../api/client';
import { frontierSeries, frontierTable, markerColor } from './frontier';

const pt = (volatility: number, expected_return: number, sharpe: number | null = null) => ({ volatility, expected_return, sharpe });
const marker = (key: string, kind: 'portfolio' | 'reference' | 'strategy' | 'fund', m: [number, number], h: [number, number]) => ({
  key, label: key.toUpperCase(), kind, model: pt(...m), hindsight: pt(...h),
});
const f: Schemas['Frontier'] = {
  model_curve: [pt(0.1, 0.05), pt(0.05, 0.03)],
  hindsight_curve: [pt(0.2, 0.09), pt(0.04, 0.02)],
  capital_market_line: [pt(0, 0.01), pt(0.2, 0.08)],
  markers: [
    marker('portfolio', 'portfolio', [0.08, 0.04], [0.09, 0.07]),
    marker('world', 'reference', [0.15, 0.06], [0.16, 0.1]),
    marker('fund:X', 'fund', [0.3, 0.07], [0.31, 0.11]),
  ],
  rf: 0.01, lookback: { start: '2021-01-01', end: '2025-12-31' }, warnings: [], trace: [],
} as Schemas['Frontier'];

describe('frontierSeries', () => {
  it('converts to percent and sorts curves by volatility', () => {
    const s = frontierSeries(f, 'model', false);
    expect(s.modelCurve).toEqual([{ x: 5, y: 3 }, { x: 10, y: 5 }]);
    expect(s.hindsightCurve.map((p) => p.x)).toEqual([4, 20]);
    expect(s.cml).toEqual([{ x: 0, y: 1 }, { x: 20, y: 8 }]);
  });
  it('uses the chosen frame for markers', () => {
    const m = frontierSeries(f, 'model', false).markers.find((x) => x.key === 'portfolio')!;
    const h = frontierSeries(f, 'hindsight', false).markers.find((x) => x.key === 'portfolio')!;
    expect(m.x).toBeCloseTo(8);
    expect(m.y).toBeCloseTo(4);
    expect(h.x).toBeCloseTo(9);
    expect(h.y).toBeCloseTo(7);
    expect(m.label).toBe('PORTFOLIO');
  });
  it('excludes funds unless requested', () => {
    expect(frontierSeries(f, 'model', false).markers.map((x) => x.kind)).toEqual(['portfolio', 'reference']);
    expect(frontierSeries(f, 'model', true).markers.map((x) => x.kind)).toContain('fund');
  });
});

describe('markerColor', () => {
  it('follows the palette constraints', () => {
    expect(markerColor({ key: 'portfolio', kind: 'portfolio' })).toBe('var(--series-1)');
    expect(markerColor({ key: 'world', kind: 'reference' })).toBe('var(--series-2)');
    expect(markerColor({ key: 'sp500', kind: 'reference' })).toBe('var(--series-3)');
    expect(markerColor({ key: 'min_variance', kind: 'strategy' })).toBe('var(--series-4)');
    expect(markerColor({ key: 'max_sharpe', kind: 'strategy' })).toBe('var(--series-5)');
    expect(markerColor({ key: 'risk_parity', kind: 'strategy' })).toBe('var(--series-6)');
    expect(markerColor({ key: 'fund:X', kind: 'fund' })).toBe('var(--ink-3)');
  });
});

describe('frontierTable', () => {
  it('lists every marker (funds included) with both positions', () => {
    const t = frontierTable(f);
    expect(t.head).toEqual(['Point', 'Model vol.', 'Model return', 'Hindsight vol.', 'Hindsight return']);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0]).toEqual(['PORTFOLIO', '8.0%', '4.0%', '9.0%', '7.0%']);
  });
});
