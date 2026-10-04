/** Pure transforms from API shapes to chart/table rows (Lane H). */
import type { Schemas } from '../../api/client';
import { MINUS, humanise, percent } from './format';
import type { MetricColumn } from './MetricsTable';

type BacktestSeries = Schemas['BacktestSeries'];
type BacktestResult = Schemas['BacktestResult'];
type ReferenceResult = Schemas['ReferenceResult'];
type ProxiedPeriod = Schemas['ProxiedPeriod'];
type FanPoint = Schemas['FanPoint'];
type ProbabilityPoint = Schemas['ProbabilityPoint'];

// ---------- time axis ----------

/** 'YYYY-MM-DD' -> epoch ms at UTC midnight (numeric time axes let ReferenceArea use exact dates). */
export const dateMs = (iso: string): number => Date.parse(iso.slice(0, 10));
export const isoMonth = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
export const yearTick = (ms: number): string => String(new Date(ms).getUTCFullYear());

/** At most maxCount January-1st ticks between minT and maxT, spaced 1/2/5/10/20 years. */
export function yearTicks(minT: number, maxT: number, maxCount = 8): number[] {
  const startYear = new Date(minT).getUTCFullYear();
  const y0 = Date.UTC(startYear, 0, 1) < minT ? startYear + 1 : startYear;
  const y1 = new Date(maxT).getUTCFullYear();
  const span = y1 - y0 + 1;
  if (span <= 0) return [];
  const step = [1, 2, 5, 10, 20].find((s) => Math.ceil(span / s) <= maxCount) ?? 20;
  const out: number[] = [];
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) out.push(Date.UTC(y, 0, 1));
  return out;
}

export function sampleEvenly<T>(arr: T[], n: number): T[] {
  if (n < 2 || arr.length <= n) return arr.length === 0 ? [] : n < 2 ? [arr[0]] : arr;
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]);
}

// ---------- backtest ----------

export type BacktestRow = {
  t: number;
  portfolio: number;
  benchmark: number;
  drawdown: number;
  rollingVol: number | null;
  rollingSharpe: number | null;
};

export function backtestRows(s: BacktestSeries): BacktestRow[] {
  return s.dates.map((d, i) => ({
    t: dateMs(d),
    portfolio: s.portfolio[i],
    benchmark: s.benchmark[i],
    drawdown: s.drawdown[i],
    rollingVol: s.rolling_vol[i] ?? null,
    rollingSharpe: s.rolling_sharpe[i] ?? null,
  }));
}

/** TimeChart props for the drawdown area: must read the `drawdown` column (<= 0), never `portfolio` (growth). */
export function drawdownChart(color: string) {
  return {
    series: [{ key: 'drawdown' satisfies keyof BacktestRow, label: 'Drawdown', color, kind: 'area' as const }],
    yFormat: (v: number): string => percent(v, 0),
    yDomain: ['auto', 0] as [number | 'auto', number | 'auto'],
  };
}

export type GrowthRow = { t: number; portfolio: number; benchmark: number } & Partial<Record<string, number | null>>;

/** Growth-of-1 rows with one extra column per reference (keyed by its `key`), null before the reference starts. */
export function growthRows(result: Pick<BacktestResult, 'series' | 'references'>): GrowthRow[] {
  const { series, references = [] } = result;
  return series.dates.map((d, i) => {
    const row: GrowthRow = { t: dateMs(d), portfolio: series.portfolio[i], benchmark: series.benchmark[i] };
    for (const r of references) row[r.key] = r.values[i] ?? null;
    return row;
  });
}

/** Single source of truth for growth-chart colours (constraints: World series-2, S&P 500 series-3, benchmark series-4). */
export const SERIES_COLOR: Record<string, string> = {
  portfolio: 'var(--series-1)', world: 'var(--series-2)', sp500: 'var(--series-3)', benchmark: 'var(--series-4)',
};

const REFERENCE_TITLE: Record<string, string> = { world: 'World', sp500: 'S&P 500' };
export const referenceTitle = (r: Pick<ReferenceResult, 'key' | 'label'>): string => REFERENCE_TITLE[r.key] ?? r.label;

/** Growth-chart series in legend/table-column order: Portfolio, [Benchmark], then each reference present. */
export function growthSeries(result: Pick<BacktestResult, 'references'>, withBenchmark = false) {
  const mk = (key: string, label: string) => ({ key, label, color: SERIES_COLOR[key] ?? 'var(--ink-3)' });
  return [
    mk('portfolio', 'Portfolio'),
    ...(withBenchmark ? [mk('benchmark', 'Benchmark')] : []),
    ...(result.references ?? []).map((r) => mk(r.key, referenceTitle(r))),
  ];
}

/** Metric columns: Portfolio, [Benchmark], then each reference. */
export function comparisonColumns(result: Pick<BacktestResult, 'metrics' | 'references'>, withBenchmark = false): MetricColumn[] {
  return [
    { title: 'Portfolio', values: result.metrics.portfolio },
    ...(withBenchmark ? [{ title: 'Benchmark', values: result.metrics.benchmark }] : []),
    ...(result.references ?? []).map((r) => ({ title: referenceTitle(r), values: r.metrics })),
  ];
}

/** References whose data begins after the first date of the window. */
export function lateReferences(result: Pick<BacktestResult, 'series' | 'references'>): ReferenceResult[] {
  const first = result.series.dates[0];
  return (result.references ?? []).filter((r) => first !== undefined && r.start.slice(0, 10) > first.slice(0, 10));
}

/** 'YYYY-MM-DD' for `now` minus whole calendar years (UTC); Feb 29 clamps to Feb 28. */
export function yearsAgo(years: number, now: Date = new Date()): string {
  const y = now.getUTCFullYear() - years;
  const m = now.getUTCMonth();
  const day = Math.min(now.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
  return new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
}

export interface Span {
  x1: number;
  x2: number;
}

/** Proxied periods clipped to the chart domain and merged, ready for <ReferenceArea>. */
export function proxiedSpans(periods: readonly ProxiedPeriod[] | undefined, domain: [number, number]): Span[] {
  const clipped = (periods ?? [])
    .map((p) => ({ x1: Math.max(dateMs(p.start), domain[0]), x2: Math.min(dateMs(p.end), domain[1]) }))
    .filter((s) => s.x1 < s.x2)
    .sort((a, b) => a.x1 - b.x1);
  const out: Span[] = [];
  for (const s of clipped) {
    const last = out[out.length - 1];
    if (last && s.x1 <= last.x2) last.x2 = Math.max(last.x2, s.x2);
    else out.push({ ...s });
  }
  return out;
}

// ---------- downside ----------

export interface FanRow {
  year: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  /** stacked-area heights: base (transparent) + three bands */
  base: number;
  lower: number;
  mid: number;
  upper: number;
}

export function fanRows(fan: readonly FanPoint[]): FanRow[] {
  return fan.map((f) => ({
    ...f,
    base: f.p5,
    lower: f.p25 - f.p5,
    mid: f.p75 - f.p25,
    upper: f.p95 - f.p75,
  }));
}

export interface ProbabilityRow {
  threshold: number;
  label: string;
  monteCarlo: number;
  normal: number | null;
}

export const thresholdLabel = (t: number): string => `${MINUS}${Math.round(t * 100)}% or worse`;

export function probabilityRows(
  monteCarlo: readonly ProbabilityPoint[],
  normal: readonly ProbabilityPoint[] = [],
): ProbabilityRow[] {
  return monteCarlo.map((p) => ({
    threshold: p.threshold,
    label: thresholdLabel(p.threshold),
    monteCarlo: p.probability,
    normal: normal.find((n) => Math.abs(n.threshold - p.threshold) < 1e-9)?.probability ?? null,
  }));
}

// ---------- asset mix ----------

/** Fixed color per asset class (color follows the entity, never its rank). */
const ASSET_COLOR: Record<string, string> = {
  equity: 'var(--series-1)',
  bond: 'var(--series-2)',
  commodity: 'var(--series-3)',
  real_estate: 'var(--series-4)',
  crypto: 'var(--series-5)',
  cash: 'var(--series-6)',
};
const ASSET_LABEL: Record<string, string> = {
  equity: 'Shares', bond: 'Bonds', commodity: 'Gold and commodities', real_estate: 'Property', crypto: 'Crypto', cash: 'Cash',
};

export const assetClassColor = (cls: string): string => ASSET_COLOR[cls] ?? 'var(--ink-3)';
export const assetClassLabel = (cls: string): string => ASSET_LABEL[cls] ?? humanise(cls);

export interface MixSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function mixRows(mix: Record<string, number>): MixSlice[] {
  return Object.entries(mix)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, label: assetClassLabel(key), value, color: assetClassColor(key) }));
}

// ---------- trace ----------

const STEP_TITLES: Record<string, string> = {
  universe: 'Choosing eligible funds',
  returns: 'Building return histories',
  covariance: 'Estimating risk',
  expected_returns: 'Expected returns',
  constraints: 'Setting constraints',
  optimize: 'Optimising the portfolio',
  metrics: 'Computing portfolio metrics',
  downside: 'Simulating downside',
  backtest: 'Backtesting',
};

export const stepTitle = (step: string): string => STEP_TITLES[step] ?? humanise(step);

export function formatSummaryValue(v: unknown): string {
  if (v == null) return '–';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4)));
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(formatSummaryValue).join(', ');
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k.replace(/_/g, ' ')}: ${formatSummaryValue(x)}`)
      .join('; ');
  }
  return String(v);
}

export function summaryEntries(summary: Record<string, unknown> | undefined): Array<[string, string]> {
  return Object.entries(summary ?? {}).map(([k, v]) => [humanise(k), formatSummaryValue(v)]);
}

// ---------- store ----------

/**
 * The store has no "intake finished" flag, so a profile counts as present once an intake score exists
 * or the profile differs from the untouched default.
 */
export function isProfileTouched(profile: object, initialProfile: object, score: object | null): boolean {
  return score !== null || JSON.stringify(profile) !== JSON.stringify(initialProfile);
}
