import { describe, expect, it } from 'vitest';
import {
  bps, decimal, errorMessage, formatMetric, formatMetricDelta, humanise, metricLabel, money, orderedMetricKeys,
  percent, signedPercent,
} from './format';

describe('number formatting', () => {
  it('formats percentages with a true minus sign and dash for missing values', () => {
    expect(percent(0.1234)).toBe('12.3%');
    expect(percent(-0.35)).toBe('−35.0%');
    expect(percent(0.05, 0)).toBe('5%');
    expect(percent(null)).toBe('–');
    expect(percent(undefined)).toBe('–');
    expect(percent(Number.NaN)).toBe('–');
    expect(percent(-0.00001)).toBe('0.0%');
  });

  it('formats signed percentages', () => {
    expect(signedPercent(0.021)).toBe('+2.1%');
    expect(signedPercent(-0.021)).toBe('−2.1%');
    expect(signedPercent(0)).toBe('0.0%');
  });

  it('formats decimals, basis points and money', () => {
    expect(decimal(0.5)).toBe('0.50');
    expect(decimal(-1.234, 1)).toBe('−1.2');
    expect(decimal(null)).toBe('–');
    expect(bps(0.002)).toBe('20 bps');
    expect(bps(null)).toBe('–');
    expect(money(38, 'EUR')).toBe('€38');
    expect(money(1234.5, 'USD')).toBe('$1,235');
    expect(money(42.126, 'EUR', 2)).toBe('€42.13');
  });

  it('humanises snake_case keys', () => {
    expect(humanise('n_funds')).toBe('N funds');
    expect(humanise('cvar_95')).toBe('Cvar 95');
  });
});

describe('errorMessage', () => {
  it('reads FastAPI domain errors, validation errors, Errors and strings', () => {
    expect(errorMessage({ error: 'NoEligibleFunds', detail: 'no funds left after filters' })).toBe('no funds left after filters');
    expect(
      errorMessage({ detail: [{ loc: ['body', 'backtest', 'transaction_cost_bps'], msg: 'Input should be <= 500' }] }),
    ).toBe('backtest.transaction_cost_bps: Input should be <= 500');
    expect(errorMessage(new Error('Failed to fetch'))).toBe('Failed to fetch');
    expect(errorMessage('boom')).toBe('boom');
  });

  it('explains empty error bodies (backend down behind the Vite proxy)', () => {
    expect(errorMessage('')).toContain('backend');
    expect(errorMessage(undefined)).toBe('Unknown error');
    expect(errorMessage({ foo: 1 })).toBe('Unexpected error response');
  });
});

describe('metrics', () => {
  it('formats each metric in its own unit', () => {
    expect(formatMetric('cagr', 0.051)).toBe('5.1%');
    expect(formatMetric('max_drawdown', -0.34)).toBe('−34.0%');
    expect(formatMetric('sharpe', 0.412)).toBe('0.41');
    expect(formatMetric('max_drawdown_duration', 64)).toBe('64 wks');
    expect(formatMetric('turnover', 0.08)).toBe('8.0%');
    expect(formatMetric('beta', null)).toBe('–');
    expect(formatMetric('mystery', 1.23456)).toBe('1.23');
  });

  it('labels known and unknown metrics', () => {
    expect(metricLabel('max_drawdown')).toBe('Worst fall');
    expect(metricLabel('cvar_95')).toBe('Average loss in the worst weeks');
    expect(metricLabel('some_new_metric')).toBe('Some new metric');
  });

  it('formats deltas (percentage points for percent metrics)', () => {
    expect(formatMetricDelta('cagr', 0.05, 0.062)).toBe('+1.2 pp');
    expect(formatMetricDelta('max_drawdown', -0.3, -0.35)).toBe('−5.0 pp');
    expect(formatMetricDelta('sharpe', 0.4, 0.5)).toBe('+0.10');
    expect(formatMetricDelta('max_drawdown_duration', 60, 52)).toBe('−8 wks');
    expect(formatMetricDelta('cagr', null, 0.1)).toBe('–');
  });

  it('orders known metrics first in registry order, unknown ones last', () => {
    expect(orderedMetricKeys({ sharpe: 1, cagr: 1, zzz: 1 }, { beta: 1 }, undefined)).toEqual(['cagr', 'sharpe', 'beta', 'zzz']);
  });
});
