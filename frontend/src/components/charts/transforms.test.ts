import { describe, expect, it } from 'vitest';
import type { Schemas } from '../../api/client';
import { percent } from './format';
import {
  assetClassColor, assetClassLabel, backtestRows, dateMs, fanRows, isProfileTouched, isoMonth, mixRows, probabilityRows,
  drawdownChart, growthRows, comparisonColumns, lateReferences, yearsAgo, proxiedSpans, sampleEvenly, stepTitle, summaryEntries, thresholdLabel, yearTicks,
} from './transforms';

describe('backtestRows', () => {
  it('zips the parallel arrays into rows with numeric time and null-safe rolling values', () => {
    const rows = backtestRows({
      dates: ['2011-03-04', '2011-03-11'],
      portfolio: [1, 1.01],
      benchmark: [1, 0.99],
      drawdown: [0, -0.01],
      rolling_vol: [null, 0.08],
      rolling_sharpe: [null, 0.5],
    });
    expect(rows).toEqual([
      { t: Date.UTC(2011, 2, 4), portfolio: 1, benchmark: 1, drawdown: 0, rollingVol: null, rollingSharpe: null },
      { t: Date.UTC(2011, 2, 11), portfolio: 1.01, benchmark: 0.99, drawdown: -0.01, rollingVol: 0.08, rollingSharpe: 0.5 },
    ]);
    expect(isoMonth(rows[0].t)).toBe('2011-03');
    expect(dateMs('2011-03-04')).toBe(Date.UTC(2011, 2, 4));
  });
});

describe('proxiedSpans', () => {
  const domain: [number, number] = [dateMs('2012-01-01'), dateMs('2020-01-01')];
  it('clips to the domain, drops empty spans and merges overlaps', () => {
    const spans = proxiedSpans(
      [
        { isin: 'A', start: '2010-01-01', end: '2014-01-01' },
        { isin: 'B', start: '2013-06-01', end: '2016-01-01' },
        { isin: 'C', start: '2005-01-01', end: '2006-01-01' },
        { isin: 'D', start: '2018-01-01', end: '2025-01-01' },
      ],
      domain,
    );
    expect(spans).toEqual([
      { x1: dateMs('2012-01-01'), x2: dateMs('2016-01-01') },
      { x1: dateMs('2018-01-01'), x2: dateMs('2020-01-01') },
    ]);
  });
  it('handles undefined', () => {
    expect(proxiedSpans(undefined, domain)).toEqual([]);
  });
});

describe('fanRows', () => {
  it('adds stacked band heights', () => {
    const rows = fanRows([
      { year: 0, p5: 1, p25: 1, p50: 1, p75: 1, p95: 1 },
      { year: 1, p5: 0.8, p25: 0.95, p50: 1.05, p75: 1.15, p95: 1.3 },
    ]);
    expect(rows[1].base).toBe(0.8);
    expect(rows[1].lower).toBeCloseTo(0.15);
    expect(rows[1].mid).toBeCloseTo(0.2);
    expect(rows[1].upper).toBeCloseTo(0.15);
    expect(rows[0].mid).toBe(0);
  });
});

describe('probability rows', () => {
  it('labels thresholds and pairs simulated with normal values by threshold', () => {
    expect(thresholdLabel(0.3)).toBe('−30% or worse');
    const rows = probabilityRows(
      [{ threshold: 0.3, probability: 0.18 }, { threshold: 0.4, probability: 0.06 }],
      [{ threshold: 0.3, probability: 0.09 }],
    );
    expect(rows).toEqual([
      { threshold: 0.3, label: '−30% or worse', monteCarlo: 0.18, normal: 0.09 },
      { threshold: 0.4, label: '−40% or worse', monteCarlo: 0.06, normal: null },
    ]);
  });
});

describe('sampleEvenly and yearTicks', () => {
  it('keeps first and last and spreads the rest', () => {
    expect(sampleEvenly([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4)).toEqual([0, 3, 6, 9]);
    expect(sampleEvenly([1, 2], 5)).toEqual([1, 2]);
    expect(sampleEvenly([], 5)).toEqual([]);
  });
  it('picks at most maxCount nice January ticks', () => {
    const ticks = yearTicks(Date.UTC(2011, 2, 4), Date.UTC(2026, 2, 6), 8);
    expect(ticks).toHaveLength(8);
    expect(ticks[0]).toBe(Date.UTC(2012, 0, 1));
    expect(ticks[7]).toBe(Date.UTC(2026, 0, 1));
    expect(yearTicks(Date.UTC(2020, 5, 1), Date.UTC(2020, 6, 1))).toEqual([]);
  });
});

describe('asset mix', () => {
  it('sorts by weight, drops zeros, and colors by entity', () => {
    const rows = mixRows({ bond: 0.3, equity: 0.6, cash: 0, other: 0.1 });
    expect(rows.map((r) => r.key)).toEqual(['equity', 'bond', 'other']);
    expect(rows[0].color).toBe('var(--series-1)');
    expect(rows[1].color).toBe('var(--series-2)');
    expect(rows[2].color).toBe('var(--ink-3)');
    expect(assetClassLabel('real_estate')).toBe('Property');
    expect(assetClassLabel('other')).toBe('Other');
    expect(assetClassColor('crypto')).toBe('var(--series-5)');
  });
});

describe('trace formatting', () => {
  it('titles the stable step keys and formats summary values', () => {
    expect(stepTitle('expected_returns')).toBe('Expected returns');
    expect(stepTitle('something_new')).toBe('Something new');
    expect(
      summaryEntries({ n_funds: 12, ratio: 0.123456, excluded: { non_ucits: 6 }, ok: true, list: ['a', 'b'], nothing: null }),
    ).toEqual([
      ['N funds', '12'],
      ['Ratio', '0.1235'],
      ['Excluded', 'non ucits: 6'],
      ['Ok', 'yes'],
      ['List', 'a, b'],
      ['Nothing', '–'],
    ]);
    expect(summaryEntries(undefined)).toEqual([]);
  });
});

describe('isProfileTouched', () => {
  const initial = { risk_level: 50, horizon_years: 10, base_currency: 'EUR', preferences: {} };
  it('is false for the untouched default profile without a score', () => {
    expect(isProfileTouched({ ...initial }, initial, null)).toBe(false);
  });
  it('is true once a score exists or the profile differs', () => {
    expect(isProfileTouched({ ...initial }, initial, { capacity: 1 })).toBe(true);
    expect(isProfileTouched({ ...initial, risk_level: 72 }, initial, null)).toBe(true);
  });
});

describe('drawdownChart', () => {
  const series = {
    dates: ['2011-03-04', '2011-03-11', '2011-03-18'],
    portfolio: [1, 1.6, 1.8],
    benchmark: [1, 1, 1],
    drawdown: [0, -0.1, -0.02],
    rolling_vol: [null, null, null],
    rolling_sharpe: [null, null, null],
  };
  it('plots the drawdown series, not portfolio growth, with negative percent axis labels', () => {
    const rows = backtestRows(series);
    const spec = drawdownChart('var(--series-1)');
    expect(spec.series[0].key).toBe('drawdown');
    const plotted = rows.map((r) => (r as unknown as Record<string, number>)[spec.series[0].key]);
    expect(plotted).toEqual(series.drawdown);
    expect(plotted.every((v) => v <= 0)).toBe(true);
    expect(spec.yFormat(-0.1)).toBe(percent(-0.1, 0));
    expect(spec.yFormat(-0.1)).toMatch(/^[−-]10%$/);
  });
});

describe('growthRows / comparisonColumns / lateReferences', () => {
  const result = {
    series: {
      dates: ['2020-01-03', '2020-01-10', '2020-01-17'],
      portfolio: [1, 1.1, 1.2], benchmark: [1, 1.05, 1.1], drawdown: [0, 0, 0], rolling_vol: [null, null, null], rolling_sharpe: [null, null, null],
    },
    metrics: { portfolio: { cagr: 0.1 }, benchmark: { cagr: 0.05 } },
    references: [
      { key: 'world', label: 'MSCI World', isin: 'X', ticker: 'W', start: '2020-01-03', values: [1, 1.02, 1.03], metrics: { cagr: 0.03 } },
      { key: 'sp500', label: 'S&P 500', isin: 'Y', ticker: 'S', start: '2020-01-10', values: [null, 1, 1.04], metrics: { cagr: 0.04 } },
    ],
  } as unknown as Schemas['BacktestResult'];

  it('puts references on each row with null before their start', () => {
    const rows = growthRows(result);
    expect(rows.map((r) => r.world)).toEqual([1, 1.02, 1.03]);
    expect(rows.map((r) => r.sp500)).toEqual([null, 1, 1.04]);
    expect(rows[2]).toMatchObject({ t: dateMs('2020-01-17'), portfolio: 1.2, benchmark: 1.1 });
  });
  it('tolerates a result without references', () => {
    const rows = growthRows({ ...result, references: undefined });
    expect(rows[0].world).toBeUndefined();
  });
  it('builds metric columns, benchmark only on request', () => {
    expect(comparisonColumns(result).map((c) => c.title)).toEqual(['Portfolio', 'World', 'S&P 500']);
    expect(comparisonColumns(result, true).map((c) => c.title)).toEqual(['Portfolio', 'Benchmark', 'World', 'S&P 500']);
    expect(comparisonColumns(result)[2].values).toEqual({ cagr: 0.04 });
  });
  it('lists references that start after the window start', () => {
    expect(lateReferences(result).map((r) => r.key)).toEqual(['sp500']);
    expect(lateReferences({ ...result, references: undefined })).toEqual([]);
  });
  it('yearsAgo subtracts calendar years (Feb 29 clamps)', () => {
    expect(yearsAgo(5, new Date('2026-09-30T12:00:00Z'))).toBe('2021-09-30');
    expect(yearsAgo(1, new Date('2024-02-29T00:00:00Z'))).toBe('2023-02-28');
  });
});
