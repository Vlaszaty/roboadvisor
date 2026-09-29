import { describe, expect, it } from 'vitest';
import { defaultBacktestForm, describeRun, toBacktestSettings, validateBacktestForm, withMode } from './backtestForm';

describe('withMode', () => {
  it('switches rebalancing from none to quarterly when walk_forward is chosen', () => {
    const f = withMode(defaultBacktestForm, 'walk_forward');
    expect(f.mode).toBe('walk_forward');
    expect(f.rebalanceType).toBe('periodic');
    expect(f.frequency).toBe('quarterly');
  });
  it('keeps an existing rebalancing choice', () => {
    const f = withMode({ ...defaultBacktestForm, rebalanceType: 'threshold' }, 'walk_forward');
    expect(f.rebalanceType).toBe('threshold');
  });
  it('leaves rebalancing alone when going back to static', () => {
    const wf = withMode(defaultBacktestForm, 'walk_forward');
    expect(withMode(wf, 'static').rebalanceType).toBe('periodic');
  });
});

describe('toBacktestSettings', () => {
  it('maps the defaults to the API shape (blank dates omitted, percent -> fraction)', () => {
    expect(toBacktestSettings(defaultBacktestForm)).toEqual({
      mode: 'static',
      start: null,
      end: null,
      rebalance: { type: 'none', frequency: 'quarterly', threshold: 0.05 },
      transaction_cost_bps: 10,
      benchmark: 'auto',
    });
  });
  it('sends the threshold only for threshold rebalancing', () => {
    const s = toBacktestSettings({ ...defaultBacktestForm, rebalanceType: 'threshold', thresholdPct: '7.5', start: '2012-01-06' });
    expect(s.rebalance?.type).toBe('threshold');
    expect(s.rebalance?.threshold).toBeCloseTo(0.075);
    expect(s.start).toBe('2012-01-06');
  });
});

describe('validateBacktestForm', () => {
  it('accepts the defaults', () => {
    expect(validateBacktestForm(defaultBacktestForm)).toBeNull();
  });
  it('rejects out-of-range costs, bad thresholds and reversed dates', () => {
    expect(validateBacktestForm({ ...defaultBacktestForm, costBps: '-1' })).toMatch(/cost/i);
    expect(validateBacktestForm({ ...defaultBacktestForm, costBps: '600' })).toMatch(/cost/i);
    expect(validateBacktestForm({ ...defaultBacktestForm, costBps: '' })).toMatch(/cost/i);
    expect(validateBacktestForm({ ...defaultBacktestForm, rebalanceType: 'threshold', thresholdPct: '0' })).toMatch(/drift/i);
    expect(validateBacktestForm({ ...defaultBacktestForm, start: '2020-01-01', end: '2019-01-01' })).toMatch(/before/i);
  });
  it('rejects walk_forward without rebalancing', () => {
    expect(validateBacktestForm({ ...defaultBacktestForm, mode: 'walk_forward' })).toMatch(/rebalanc/i);
  });
});

describe('describeRun', () => {
  it('summarises a run in one line', () => {
    expect(describeRun(defaultBacktestForm)).toBe('Static · no rebalancing · 10 bps costs · default start to latest');
    expect(
      describeRun({ ...withMode(defaultBacktestForm, 'walk_forward'), start: '2012-01-06', end: '2024-12-27', costBps: '5' }),
    ).toBe('Walk-forward · quarterly rebalancing · 5 bps costs · 2012-01-06 to 2024-12-27');
    expect(describeRun({ ...defaultBacktestForm, rebalanceType: 'threshold', thresholdPct: '10' })).toContain('rebalance at 10% drift');
  });
});
