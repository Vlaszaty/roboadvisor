import type { Schemas } from '../../api/client';

export interface BacktestForm {
  mode: 'static' | 'walk_forward';
  rebalanceType: 'none' | 'periodic' | 'threshold';
  frequency: 'monthly' | 'quarterly' | 'annual';
  /** percentage points of weight drift, e.g. '5' = 5% */
  thresholdPct: string;
  /** ISO date or '' for the API default (last 15 years) */
  start: string;
  end: string;
  costBps: string;
}

export const defaultBacktestForm: BacktestForm = {
  mode: 'static',
  rebalanceType: 'none',
  frequency: 'quarterly',
  thresholdPct: '5',
  start: '',
  end: '',
  costBps: '10',
};

/** Spec §5.8: walk_forward needs rebalancing, so choosing it switches 'none' to quarterly. */
export function withMode(form: BacktestForm, mode: BacktestForm['mode']): BacktestForm {
  if (mode === 'walk_forward' && form.rebalanceType === 'none') {
    return { ...form, mode, rebalanceType: 'periodic', frequency: 'quarterly' };
  }
  return { ...form, mode };
}

export function validateBacktestForm(f: BacktestForm): string | null {
  const cost = Number(f.costBps);
  if (f.costBps.trim() === '' || !Number.isFinite(cost) || cost < 0 || cost > 500) {
    return 'Transaction cost must be between 0 and 500 bps.';
  }
  if (f.rebalanceType === 'threshold') {
    const t = Number(f.thresholdPct);
    if (f.thresholdPct.trim() === '' || !Number.isFinite(t) || t <= 0 || t > 50) {
      return 'Rebalance drift must be more than 0% and at most 50%.';
    }
  }
  if (f.mode === 'walk_forward' && f.rebalanceType === 'none') {
    return 'Walk-forward needs rebalancing: choose periodic or threshold.';
  }
  if (f.start && f.end && f.start >= f.end) return 'The start date must be before the end date.';
  return null;
}

export function toBacktestSettings(f: BacktestForm): Schemas['BacktestSettings'] {
  return {
    mode: f.mode,
    start: f.start || null,
    end: f.end || null,
    rebalance: {
      type: f.rebalanceType,
      frequency: f.frequency,
      threshold: f.rebalanceType === 'threshold' ? Number(f.thresholdPct) / 100 : 0.05,
    },
    transaction_cost_bps: Number(f.costBps),
    benchmark: 'auto',
  };
}

export function describeRun(f: BacktestForm): string {
  const rebalance =
    f.rebalanceType === 'none'
      ? 'no rebalancing'
      : f.rebalanceType === 'periodic'
        ? `${f.frequency} rebalancing`
        : `rebalance at ${f.thresholdPct}% drift`;
  return [
    f.mode === 'static' ? 'Static' : 'Walk-forward',
    rebalance,
    `${f.costBps} bps costs`,
    `${f.start || 'default start'} to ${f.end || 'latest'}`,
  ].join(' · ');
}
