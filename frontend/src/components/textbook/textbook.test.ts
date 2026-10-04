import { describe, expect, it } from 'vitest';
import {
  chartSeries, chartTable, corrShade, correlationRows, exampleCorrelation, exampleExpected, examplePortfolio,
  exampleSplit, exampleStats, exampleTangent, expectedTable, smlSeries, statsTable, tangentTable, textbookRequest,
  usedColumn, weightSlices, weightsTable, type Textbook,
} from './textbook';

const fund = (isin: string, block: string, mean: number, vol: number, beta: number, capm: number) => ({
  isin, name: `${block} fund`, ticker: isin, block, asset_class: 'equity',
  mean_return: mean, volatility: vol, beta, capm_return: capm, expected_return: capm,
});
const pt = (volatility: number, expected_return: number, sharpe: number | null = null) => ({ volatility, expected_return, sharpe });

const base = {
  inputs: {
    window: { start: '2021-01-01', end: '2025-12-26' }, weeks: 260, frequency: 'weekly', rf: 0.02, premium: 0.05,
    return_model: 'capm', market: { isin: 'M', name: 'World' }, risk_aversion: 6,
  },
  funds: [fund('A', 'US equities', 0.104, 0.16, 1.0, 0.07), fund('B', 'Government bonds', 0.01, 0.06, 0.1, 0.025)],
  risk_free_fund: { isin: 'RF', name: 'Overnight fund', ticker: 'RF', volatility: 0.002 },
  correlation: { isins: ['A', 'B'], matrix: [[1, -0.2], [-0.2, 1]] },
  frontier: [pt(0.1, 0.05, 0.3), pt(0.055, 0.03, 0.18)],
  capital_market_line: [pt(0, 0.02), pt(0.1, 0.05, 0.3)],
  tangent: { weights: { A: 0.6, B: 0.4 }, expected_return: 0.05, volatility: 0.1, sharpe: 0.3 },
  split: { risk_aversion: 6, risky_share_uncapped: 0.5, risky_share: 0.5 },
  portfolio: { weights: { A: 0.3, B: 0.2, RF: 0.5 }, expected_return: 0.035, volatility: 0.05, sharpe: 0.3 },
  warnings: [],
} as unknown as Textbook;

const noTangent = {
  ...base, tangent: null, capital_market_line: [],
  split: { risk_aversion: 6, risky_share_uncapped: 0, risky_share: 0 },
  portfolio: { weights: { RF: 1 }, expected_return: 0.02, volatility: 0, sharpe: null },
} as unknown as Textbook;

const capped = {
  ...base, split: { risk_aversion: 2, risky_share_uncapped: 1.5, risky_share: 1 },
  portfolio: { weights: { A: 0.6, B: 0.4 }, expected_return: 0.05, volatility: 0.1, sharpe: 0.3 },
} as unknown as Textbook;

describe('textbookRequest', () => {
  it('sends the premium as a fraction', () => {
    expect(textbookRequest('EUR', 40, 'capm', 4.5)).toEqual({ base_currency: 'EUR', risk_level: 40, return_model: 'capm', market_premium: 0.045 });
  });
  it('omits an invalid premium so the backend default applies', () => {
    expect(textbookRequest('EUR', 40, 'capm', Number.NaN)).not.toHaveProperty('market_premium');
    expect(textbookRequest('EUR', 40, 'capm', Number('abc'))).not.toHaveProperty('market_premium');
  });
  it('clamps the premium to the allowed range', () => {
    expect(textbookRequest('USD', 40, 'historical', 40).market_premium).toBe(0.15);
    expect(textbookRequest('USD', 40, 'historical', -3).market_premium).toBe(0);
  });
});

describe('tables', () => {
  it('stats: one row per fund', () => {
    expect(statsTable(base).rows[0]).toEqual(['US equities', 'US equities fund', '10.4%', '16.0%']);
  });
  it('correlation: labelled rows and shading by sign', () => {
    const c = correlationRows(base);
    expect(c.head).toEqual(['US equities', 'Government bonds']);
    expect(c.rows[1]).toEqual({ label: 'Government bonds', cells: [-0.2, 1] });
    expect(corrShade(0.5)).toContain('--series-1');
    expect(corrShade(-0.5)).toContain('--series-2');
  });
  it('expected returns: the used column follows the model', () => {
    expect(expectedTable(base).rows[0]).toEqual(['US equities', '1.00', '7.0%', '10.4%']);
    expect(usedColumn(base)).toBe(2);
    expect(usedColumn({ ...base, inputs: { ...base.inputs, return_model: 'historical' } } as Textbook)).toBe(3);
  });
  it('tangent and final weights', () => {
    expect(tangentTable(base).rows).toEqual([['US equities', '60.0%'], ['Government bonds', '40.0%']]);
    expect(weightsTable(base).rows).toEqual([
      ['US equities', 'US equities fund', '30.0%'], ['Government bonds', 'Government bonds fund', '20.0%'],
      ['Risk-free fund', 'Overnight fund', '50.0%'],
    ]);
    expect(weightSlices(base).map((s) => s.value)).toEqual([0.3, 0.2, 0.5]);
    expect(weightsTable(noTangent).rows).toEqual([['Risk-free fund', 'Overnight fund', '100.0%']]);
    expect(tangentTable(noTangent).rows).toEqual([]);
  });
});

describe('chartSeries', () => {
  it('adds one layer per step', () => {
    const frontier = chartSeries(base, 'frontier');
    expect(frontier.funds).toHaveLength(2);
    expect(frontier.frontier.map((p) => p.x)).toEqual([5.5, 10]); // sorted, percent
    expect(frontier.tangent).toEqual([]);
    expect(frontier.riskFree).toEqual([]);
    const tangent = chartSeries(base, 'tangent');
    expect(tangent.tangent[0]).toMatchObject({ x: 10, y: 5, label: 'Tangent portfolio' });
    expect(tangent.riskFree[0]).toMatchObject({ x: 0, y: 2 });
    expect(tangent.cml).toHaveLength(2);
    expect(tangent.investor).toEqual([]);
    expect(chartSeries(base, 'split').investor[0]).toMatchObject({ x: 5, y: 3.5, label: 'Your portfolio' });
  });
  it('survives a missing tangent portfolio', () => {
    const s = chartSeries(noTangent, 'split');
    expect(s.tangent).toEqual([]);
    expect(s.cml).toEqual([]);
    expect(s.investor[0]).toMatchObject({ x: 0, y: 2 });
    expect(chartTable(noTangent, 'split').rows.at(-1)?.[0]).toBe('Your portfolio');
  });
  it('security market line runs through rf at beta 0', () => {
    const s = smlSeries(base);
    expect(s.line[0]).toEqual({ x: 0, y: 2 });
    expect(s.funds[0]).toMatchObject({ x: 1, y: 7, label: 'US equities' });
  });
});

describe('worked examples', () => {
  it('fill the formulas with the numbers', () => {
    expect(exampleStats(base)).toContain('0.20%');
    expect(exampleStats(base)).toContain('10.4%');
    expect(exampleCorrelation(base)).toContain('−0.20');
    expect(exampleExpected(base)).toBe('US equities: 2.0% + 1.00 × 5.0% = 7.0%.');
    expect(exampleTangent(base)).toBe('(5.0% − 2.0%) / 10.0% = 0.30');
    expect(exampleSplit(base)).toBe('y = (5.0% − 2.0%) / (6.0 × 10.0%²) = 50%.');
    expect(examplePortfolio(base)).toContain('2.0% + 50% × (5.0% − 2.0%) = 3.5%');
  });
  it('say when the share was capped', () => {
    expect(exampleSplit(capped)).toContain('150%');
    expect(exampleSplit(capped)).toContain('capped at 100%');
  });
  it('explain a missing tangent portfolio', () => {
    expect(exampleTangent(noTangent)).toContain('no tangent portfolio');
    expect(exampleSplit(noTangent)).toContain('risk-free fund');
    expect(examplePortfolio(noTangent)).toContain('2.0%');
  });
  it('historical model: the example shows the average, with the CAPM for comparison', () => {
    const h = { ...base, inputs: { ...base.inputs, return_model: 'historical' } } as Textbook;
    expect(exampleExpected(h)).toContain('10.4%');
    expect(exampleExpected(h)).toContain('7.0%');
  });
});
