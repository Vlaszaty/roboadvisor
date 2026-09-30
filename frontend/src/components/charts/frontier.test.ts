import { describe, expect, it } from 'vitest';
import type { Schemas } from '../../api/client';
import {
  FRONTIER_POINTS, frontierDescription, frontierNote, frontierRequest, frontierSeries, frontierTable, hasTextLabel, markerColor,
  markerLegend, markerShape,
} from './frontier';

const pt = (volatility: number, expected_return: number, sharpe: number | null = null) => ({ volatility, expected_return, sharpe });
const marker = (key: string, kind: 'portfolio' | 'reference' | 'strategy' | 'fund', m: [number, number]) => ({
  key, label: key.toUpperCase(), kind, model: pt(...m),
});
const f: Schemas['Frontier'] = {
  model_curve: [pt(0.1, 0.05), pt(0.05, 0.03)],
  capital_market_line: [pt(0, 0.01), pt(0.2, 0.08)],
  markers: [
    marker('portfolio', 'portfolio', [0.08, 0.04]),
    marker('world', 'reference', [0.15, 0.06]),
    marker('min_variance', 'strategy', [0.04, 0.03]),
    marker('fund:X', 'fund', [0.3, 0.07]),
  ],
  rf: 0.01, warnings: [], trace: [],
} as Schemas['Frontier'];

describe('frontierSeries', () => {
  it('converts to percent and sorts curves by volatility', () => {
    const s = frontierSeries(f, false);
    expect(s.modelCurve).toEqual([{ x: 5, y: 3 }, { x: 10, y: 5 }]);
    expect(s.cml).toEqual([{ x: 0, y: 1 }, { x: 20, y: 8 }]);
  });
  it('places markers at their model position', () => {
    const m = frontierSeries(f, false).markers.find((x) => x.key === 'portfolio')!;
    expect(m.x).toBeCloseTo(8);
    expect(m.y).toBeCloseTo(4);
    expect(m.label).toBe('PORTFOLIO');
  });
  it('excludes funds unless requested', () => {
    expect(frontierSeries(f, false).markers.map((x) => x.kind)).toEqual(['portfolio', 'reference', 'strategy']);
    expect(frontierSeries(f, true).markers.map((x) => x.kind)).toContain('fund');
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
  it('lists funds only when individual funds are shown', () => {
    const kinds = (show: boolean) => frontierTable(f, show).rows.map((r) => r[0]);
    expect(kinds(false)).not.toContain('FUND:X');
    expect(kinds(true)).toContain('FUND:X');
    expect(frontierTable(f, false).rows.length).toBe(frontierTable(f, true).rows.length - 1);
  });
  it('lists every marker (funds included) with its model position', () => {
    const t = frontierTable(f, true);
    expect(t.head).toEqual(['Point', 'Volatility', 'Expected return', 'Sharpe']);
    expect(t.rows).toHaveLength(4);
    expect(t.rows[0]).toEqual(['PORTFOLIO', '8.0%', '4.0%', '–']);
  });
  it('shows Sharpe to two decimals when present', () => {
    const g = { ...f, markers: [marker('world', 'reference', [0.15, 0.06])] } as Schemas['Frontier'];
    g.markers[0].model.sharpe = 0.4;
    expect(frontierTable(g, true).rows[0]).toEqual(['WORLD', '15.0%', '6.0%', '0.40']);
  });
});

describe('marker shapes, labels and legend', () => {
  it('gives each strategy a distinct shape', () => {
    const shapes = ['min_variance', 'max_sharpe', 'risk_parity', 'hrp'].map((key) => markerShape({ key, kind: 'strategy' }));
    expect(new Set(shapes).size).toBe(4);
    expect(markerShape({ key: 'world', kind: 'reference' })).toBe('circle');
  });
  it('labels only portfolio, World and S&P 500', () => {
    expect(hasTextLabel({ key: 'portfolio', kind: 'portfolio' })).toBe(true);
    expect(hasTextLabel({ key: 'sp500', kind: 'reference' })).toBe(true);
    expect(hasTextLabel({ key: 'hrp', kind: 'strategy' })).toBe(false);
    expect(hasTextLabel({ key: 'fund:X', kind: 'fund' })).toBe(false);
  });
  it('legend lists markers in order and funds only when shown', () => {
    const l = markerLegend(frontierSeries(f, false).markers);
    expect(l.map((i) => i.label)).toEqual(['PORTFOLIO', 'WORLD', 'MIN_VARIANCE']);
    expect(l[2]).toMatchObject({ shape: 'square', color: 'var(--series-4)' });
    const lf = markerLegend(frontierSeries(f, true).markers);
    expect(lf[lf.length - 1].label).toBe('Individual funds');
  });
  it('carries sharpe through, null when missing', () => {
    expect(frontierSeries(f, false).markers[0].sharpe).toBeNull();
  });
});

describe('frontierNote', () => {
  it('says the positions are estimates, not results', () => {
    expect(frontierNote('target_vol')).toMatch(/sits on the model curve by construction/);
    expect(frontierNote('target_vol')).toMatch(/forward-looking estimates, not results/);
    expect(frontierNote('hrp')).toMatch(/forward-looking estimates, not results/);
  });
  it('claims "by construction" only for the target-volatility strategy', () => {
    expect(frontierNote(undefined)).toMatch(/by construction/);
    const hrp = frontierNote('hrp');
    expect(hrp).not.toMatch(/by construction/);
    expect(hrp).toMatch(/Your portfolio uses the hierarchical risk parity strategy, which does not aim for the model curve/);
    expect(frontierNote('min_variance')).toMatch(/uses the minimum variance strategy/);
  });
});

describe('frontierRequest', () => {
  it('asks for 12 points per curve', () => {
    const profile = { risk_level: 50, horizon_years: 10, base_currency: 'EUR' } as Schemas['InvestorProfile'];
    const settings = { strategy: 'target_vol' } as Schemas['EngineSettings'];
    expect(FRONTIER_POINTS).toBe(12);
    expect(frontierRequest(profile, settings)).toEqual({ profile, settings, points: 12 });
  });
});

describe('frontierDescription', () => {
  it('lists the big markers and summarises funds as a count', () => {
    const d = frontierDescription(frontierSeries(f, true).markers);
    expect(d).toMatch(/PORTFOLIO at 8\.0% volatility and 4\.0% return/);
    expect(d).toMatch(/1 individual fund\b/);
    expect(d).not.toMatch(/FUND:X/);
    const g = { ...f, markers: [...f.markers, marker('fund:Y', 'fund', [0.2, 0.05])] } as Schemas['Frontier'];
    expect(frontierDescription(frontierSeries(g, true).markers)).toMatch(/2 individual funds/);
    expect(frontierDescription(frontierSeries(f, false).markers)).not.toMatch(/individual fund/);
  });
});
