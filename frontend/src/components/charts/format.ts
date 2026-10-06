/** Pure formatting helpers for the results pages (Lane H). */

export const MINUS = '−';

type Num = number | null | undefined;
const missing = (x: Num): x is null | undefined => x == null || Number.isNaN(x);

/** 0.1234 -> '12.3%'; negatives use a true minus; -0.00001 -> '0.0%' (no '-0.0%'). */
export function percent(x: Num, digits = 1): string {
  if (missing(x)) return '–';
  const body = Math.abs(x * 100).toFixed(digits);
  return `${x < 0 && Number(body) !== 0 ? MINUS : ''}${body}%`;
}

export function signedPercent(x: Num, digits = 1): string {
  if (missing(x)) return '–';
  const body = Math.abs(x * 100).toFixed(digits);
  if (Number(body) === 0) return `${body}%`;
  return `${x < 0 ? MINUS : '+'}${body}%`;
}

export function decimal(x: Num, digits = 2): string {
  if (missing(x)) return '–';
  const body = Math.abs(x).toFixed(digits);
  return `${x < 0 && Number(body) !== 0 ? MINUS : ''}${body}`;
}

function signedDecimal(x: number, digits: number): string {
  const body = Math.abs(x).toFixed(digits);
  if (Number(body) === 0) return body;
  return `${x < 0 ? MINUS : '+'}${body}`;
}

/** 0.002 -> '20 bps'. */
export function bps(x: Num, digits = 0): string {
  if (missing(x)) return '–';
  return `${(x * 10_000).toFixed(digits)} bps`;
}

export function money(x: Num, currency: string = 'EUR', digits = 0): string {
  if (missing(x)) return '–';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(x);
}

/** 'n_funds' -> 'N funds'. */
export function humanise(key: string): string {
  const t = key.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** One readable line from whatever an API call (or a failed fetch) produced. */
export function errorMessage(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') {
    return err.trim() || 'The server returned an error with no details. Is the backend running on port 8740?';
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const detail = (err as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((d) => {
          const item = d as { msg?: unknown; loc?: unknown };
          const where = Array.isArray(item.loc) ? item.loc.filter((p) => p !== 'body').join('.') : '';
          const msg = typeof item.msg === 'string' ? item.msg : JSON.stringify(d);
          return where ? `${where}: ${msg}` : msg;
        })
        .join('; ');
    }
  }
  return 'Unexpected error response';
}

export type MetricUnit = 'percent' | 'ratio' | 'weeks';

/** Labels/units/help for the backtest metric registry keys (spec §5.6). Unknown keys fall back to humanise(). */
export const METRICS: Record<string, { label: string; unit: MetricUnit; help: string }> = {
  cagr: { label: 'Average yearly growth', unit: 'percent', help: 'The steady yearly growth that gives the same result (CAGR).' },
  volatility: { label: 'Typical ups and downs', unit: 'percent', help: 'How much the value swings in a year (volatility).' },
  sharpe: { label: 'Reward for the risk', unit: 'ratio', help: 'Extra growth over cash for each unit of ups and downs (Sharpe ratio). Higher is better.' },
  sortino: { label: 'Reward for the bad swings', unit: 'ratio', help: 'Like the reward for the risk, but only counts downward swings (Sortino ratio).' },
  max_drawdown: { label: 'Worst fall', unit: 'percent', help: 'The biggest drop from a high point (max drawdown).' },
  max_drawdown_duration: { label: 'Longest time below the high', unit: 'weeks', help: 'The longest stretch spent below an earlier high point.' },
  cvar_95: { label: 'Average loss in the worst weeks', unit: 'percent', help: 'The average result across the worst 5% of weeks (CVaR 95%).' },
  calmar: { label: 'Growth versus worst fall', unit: 'ratio', help: 'Yearly growth divided by the worst fall (Calmar ratio).' },
  beta: { label: 'Follows the comparison mix', unit: 'ratio', help: 'If the comparison moves 10%, 1.0 means this moves about 10% too (beta).' },
  turnover: { label: 'Bought and sold per year', unit: 'percent', help: 'Share of the portfolio traded each year (turnover).' },
};

export const METRIC_ORDER = [
  'cagr', 'volatility', 'sharpe', 'sortino', 'max_drawdown', 'max_drawdown_duration', 'cvar_95', 'calmar', 'beta',
  'turnover',
];

export function metricLabel(key: string): string {
  return METRICS[key]?.label ?? humanise(key);
}

export function formatMetric(key: string, v: Num): string {
  if (missing(v)) return '–';
  switch (METRICS[key]?.unit) {
    case 'percent': return percent(v, 1);
    case 'weeks': return `${Math.round(v)} wks`;
    default: return decimal(v, 2);
  }
}

/** B minus A in the metric's own unit. */
export function formatMetricDelta(key: string, a: Num, b: Num): string {
  if (missing(a) || missing(b)) return '–';
  const d = b - a;
  switch (METRICS[key]?.unit) {
    case 'percent': {
      const body = Math.abs(d * 100).toFixed(1);
      return Number(body) === 0 ? '0.0 pp' : `${d < 0 ? MINUS : '+'}${body} pp`;
    }
    case 'weeks': {
      const r = Math.round(d);
      return r === 0 ? '0 wks' : `${r < 0 ? MINUS : '+'}${Math.abs(r)} wks`;
    }
    default: return signedDecimal(d, 2);
  }
}

export function orderedMetricKeys(...records: Array<Record<string, unknown> | undefined>): string[] {
  const keys = new Set<string>();
  for (const r of records) for (const k of Object.keys(r ?? {})) keys.add(k);
  const rank = (k: string) => {
    const i = METRIC_ORDER.indexOf(k);
    return i === -1 ? METRIC_ORDER.length : i;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** 12,500 becomes "€12.5K": short labels for chart axes. */
export function moneyCompact(x: Num, currency: string = 'EUR'): string {
  if (missing(x)) return '–';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1,
  }).format(x);
}
