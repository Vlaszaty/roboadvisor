# Lane H — Results Pages and Settings Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/portfolio`, `/backtest`, `/universe`, `/universe/:isin` pages and the advanced-settings drawer, all working against the mock API (`npm run dev:mock`) and unchanged against the real backend.

**Architecture:** Pure, vitest-tested helper modules (formatting, API-shape to Recharts-row transforms, form/draft logic) sit under `frontend/src/components/charts/`. Thin presentational components (chart frame, time chart, donut, bars, fan chart, tables) consume those helpers. Pages own only data fetching (`useRequest` around the typed `api` client), page state and composition. Chart colors are read from CSS tokens (`var(--series-1)` etc.), so light/dark themes work without JS.

**Tech Stack:** React 19, TypeScript, react-router-dom, Recharts, openapi-fetch (typed client `api`, alias `Schemas`), vitest (node environment, pure-function tests only), plain CSS with the Phase 0 tokens. **No new npm dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-29-roboadvisor-design.md` (§7 API, §8 frontend). Builds on `docs/superpowers/plans/2026-09-29-phase0-contracts.md` as merged (git tag `phase0-contracts`).

## Global Constraints

Copied verbatim from Phase 0:

- Python tooling is **uv** only: `uv sync`, `uv add`, `uv run pytest`, `uv run python -m ...`. Python pinned to **3.12**. Never use pip or a hand-made venv.
- Backend port **8740**, frontend port **5740** with Vite `strictPort: true`; Vite proxies `/api` → `http://localhost:8740`.
- All API routes live under `/api`. The API is stateless.
- Engine modules (`app/engine/*`) never import FastAPI, sqlite3 or `app.data`.
- All engine return series are **weekly (W-FRI)**, simple returns, base currency, columns = ISIN. Annualisation factor 52.
- Base currencies: `EUR`, `USD`.
- Drawdowns and losses are **negative numbers** (−0.35 = −35%). Thresholds are positive (0.3 means "−30% or worse").
- No network access in tests.
- Only Phase 0 adds Python/npm dependencies. Lanes that need one must escalate.
- Contract files created here (`config.py` structure, `engine/types.py`, `engine/errors.py`, `api/schemas.py`, `data/schema.sql`, route signatures, stub signatures) are frozen after Phase 0; changes go through the integrator.

Lane H additions:

- Only touch files this lane owns: `frontend/src/pages/{Portfolio,Backtest,Universe,UniverseFund}.tsx`, `frontend/src/components/SettingsDrawer.tsx`, `frontend/src/components/charts/**`. Do not edit `ui.tsx`, `store.tsx`, `tokens.css`, `base.css`, `Layout.tsx`, `App.tsx`, `client.ts`, mocks or `schema.d.ts`. If a contract problem blocks you, stop and escalate to the integrator.
- Use only CSS variables defined in `tokens.css` (`--series-1..6`, `--pos`, `--neg`, `--warn`, `--band`, `--ink*`, `--line`, `--surface*`, `--space-*`, `--radius*`, `--shadow`, `--font-*`). Never hard-code a color in a component or chart.
- Chart colors are assigned by entity, never by rank: portfolio = `--series-1`, benchmark = `--series-2` everywhere; asset classes have a fixed color map (Task 2). Text never wears a series color.
- Every chart has a title, an accessible description, a legend when it has 2+ series (no legend box for one series), and a "View as table" fallback.
- Drawdowns/losses are negative numbers; display them with the true minus sign `−` (U+2212) via `format.ts`, and thresholds as "−30% or worse".
- Response models with Pydantic defaults may be **optional** in the generated TypeScript (`warnings?`, `trace?`, `proxied_periods?`, `rebalance_dates?`, `summary?`, `notes?`): always read them with `?? []` / `?? {}`.
- Tests: vitest runs in the node environment and no DOM testing library is installed. Only pure functions are unit-tested; components are verified by `npm run typecheck` and the manual checklist in Task 10.
- Commands (run from `frontend/`): `npm test`, `npm run typecheck`, `npm run dev:mock` (port 5740). Single test file: `npx vitest run <path>`.

## File structure

All new files live in `frontend/src/components/charts/` unless noted.

| File | Responsibility |
|---|---|
| `format.ts` (+`format.test.ts`) | percent/bps/money/decimal formatting, `errorMessage`, metric labels/units/formatting/delta |
| `transforms.ts` (+`transforms.test.ts`) | series → Recharts rows, proxied spans, fan/probability rows, year ticks, sampling, asset-mix slices, trace entry formatting, `isProfileTouched` |
| `backtestForm.ts` (+`backtestForm.test.ts`) | backtest form state, walk-forward rule, validation, mapping to `BacktestSettings`, run description |
| `universe.ts` (+`universe.test.ts`) | universe filter state → query, sorting, label maps |
| `settingsDraft.ts` (+`settingsDraft.test.ts`) | drawer draft ↔ `EngineSettings` mapping and validation |
| `hooks.ts` | `useRequest`, `useDebounced` |
| `results.css` | styles for everything in this lane (tokens only) |
| `Status.tsx` | `Loading`, `ErrorBox`, `EmptyState`, `Async` |
| `ChartFrame.tsx` | `ChartFrame`, `ChartTip`, `TableScroll`, `Field` |
| `TimeChart.tsx` | line/area chart over a time axis with shaded spans |
| `Donut.tsx`, `BarCharts.tsx`, `FanChart.tsx` | portfolio charts |
| `HoldingsTable.tsx`, `DownsidePanel.tsx`, `TraceList.tsx`, `PortfolioView.tsx` | portfolio page sections |
| `MetricsTable.tsx` | metrics table with optional A/B delta |
| `pages/Portfolio.tsx`, `pages/Backtest.tsx`, `pages/Universe.tsx`, `pages/UniverseFund.tsx`, `components/SettingsDrawer.tsx` | replaced stubs |

## Phase 0 facts this plan relies on

- `api.POST('/api/portfolio', { body: { profile, settings }, signal })`, `api.POST('/api/backtest', { body: { profile, settings, backtest }, signal })`, `api.GET('/api/universe', { params: { query } })`, `api.GET('/api/universe/{isin}', { params: { path, query: { base_currency } } })`, `api.GET('/api/defaults')`.
- Store: `useStore(): [State, Dispatch<Action>]`, `State = { profile, settings, answers, score }`, `initialState`, actions `setSettings` (merge patch) and `load` (replace whole state).
- Mock backtest metric keys: `cagr, volatility, sharpe, sortino, max_drawdown, max_drawdown_duration (weeks), cvar_95, calmar, beta, turnover` (benchmark has no `beta`/`turnover`).
- Mock dates are `YYYY-MM-DD` strings; mock `defaults.json` carries `vol_range`, `estimation_window_years`, `markets.{model}.premium`, `mc_paths`, `transaction_cost_bps`.

---

### Task 1: Formatting helpers

**Files:**
- Create: `frontend/src/components/charts/format.ts`
- Test: `frontend/src/components/charts/format.test.ts`

**Interfaces:**
- Produces (all exported from `format.ts`):
  - `MINUS: string`
  - `percent(x, digits=1)`, `signedPercent(x, digits=1)`, `decimal(x, digits=2)`, `bps(x, digits=0)`, `money(x, currency='EUR', digits=0)` — all take `number | null | undefined` and return `'–'` for null/NaN
  - `humanise(key: string): string`
  - `errorMessage(err: unknown): string`
  - `METRICS: Record<string, { label: string; unit: 'percent'|'ratio'|'weeks'; help: string }>`, `metricLabel(key)`, `formatMetric(key, v)`, `formatMetricDelta(key, a, b)`, `orderedMetricKeys(...records)`

- [ ] **Step 1: Write the failing test**

`frontend/src/components/charts/format.test.ts`:

```ts
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
    expect(metricLabel('max_drawdown')).toBe('Max drawdown');
    expect(metricLabel('cvar_95')).toBe('CVaR (95%)');
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/charts/format.test.ts`
Expected: FAIL (`Failed to resolve import "./format"`).

- [ ] **Step 3: Write `format.ts`**

```ts
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
  cagr: { label: 'Annual return (CAGR)', unit: 'percent', help: 'Compound growth rate per year.' },
  volatility: { label: 'Volatility', unit: 'percent', help: 'Annualised standard deviation of weekly returns.' },
  sharpe: { label: 'Sharpe ratio', unit: 'ratio', help: 'Excess return over cash per unit of volatility.' },
  sortino: { label: 'Sortino ratio', unit: 'ratio', help: 'Like Sharpe, but only penalises downside volatility.' },
  max_drawdown: { label: 'Max drawdown', unit: 'percent', help: 'Worst peak-to-trough fall.' },
  max_drawdown_duration: { label: 'Longest drawdown', unit: 'weeks', help: 'Longest stretch below a previous peak.' },
  cvar_95: { label: 'CVaR (95%)', unit: 'percent', help: 'Average weekly return in the worst 5% of weeks.' },
  cvar: { label: 'CVaR (95%)', unit: 'percent', help: 'Average weekly return in the worst 5% of weeks.' },
  calmar: { label: 'Calmar ratio', unit: 'ratio', help: 'Annual return divided by max drawdown.' },
  beta: { label: 'Beta to benchmark', unit: 'ratio', help: 'Sensitivity to benchmark moves (1.0 = moves with it).' },
  turnover: { label: 'Turnover (per year)', unit: 'percent', help: 'Share of the portfolio traded per year, one way.' },
};

export const METRIC_ORDER = [
  'cagr', 'volatility', 'sharpe', 'sortino', 'max_drawdown', 'max_drawdown_duration', 'cvar_95', 'cvar', 'calmar', 'beta',
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/charts/format.test.ts`
Expected: PASS (all tests in `format.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/charts/format.ts frontend/src/components/charts/format.test.ts
git commit -m "feat(frontend): results formatting helpers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Series and table transforms

**Files:**
- Create: `frontend/src/components/charts/transforms.ts`
- Test: `frontend/src/components/charts/transforms.test.ts`

**Interfaces:**
- Consumes: `MINUS`, `humanise` from `./format`; `Schemas` from `../../api/client` (type-only import).
- Produces (exported from `transforms.ts`):
  - `dateMs(iso: string): number` (UTC midnight), `isoMonth(ms: number): string` (`'2011-03'`), `yearTick(ms): string`, `yearTicks(minT, maxT, maxCount=8): number[]`
  - `type BacktestRow = { t: number; portfolio: number; benchmark: number; drawdown: number; rollingVol: number | null; rollingSharpe: number | null }`; `backtestRows(series: Schemas['BacktestSeries']): BacktestRow[]`
  - `interface Span { x1: number; x2: number }`; `proxiedSpans(periods, domain: [number, number]): Span[]`
  - `interface FanRow { year; p5; p25; p50; p75; p95; base; lower; mid; upper }`; `fanRows(fan): FanRow[]`
  - `interface ProbabilityRow { threshold: number; label: string; monteCarlo: number; normal: number | null }`; `thresholdLabel(t)`, `probabilityRows(mc, normal)`
  - `sampleEvenly<T>(arr: T[], n: number): T[]`
  - `interface MixSlice { key; label; value; color }`; `assetClassColor(cls)`, `assetClassLabel(cls)`, `mixRows(mix)`
  - `stepTitle(step)`, `formatSummaryValue(v: unknown): string`, `summaryEntries(summary): Array<[string, string]>`
  - `isProfileTouched(profile: object, initialProfile: object, score: object | null): boolean`

- [ ] **Step 1: Write the failing test**

`frontend/src/components/charts/transforms.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  assetClassColor, assetClassLabel, backtestRows, dateMs, fanRows, isProfileTouched, isoMonth, mixRows, probabilityRows,
  proxiedSpans, sampleEvenly, stepTitle, summaryEntries, thresholdLabel, yearTicks,
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
    expect(assetClassLabel('real_estate')).toBe('Real estate');
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/charts/transforms.test.ts`
Expected: FAIL (`Failed to resolve import "./transforms"`).

- [ ] **Step 3: Write `transforms.ts`**

```ts
/** Pure transforms from API shapes to chart/table rows (Lane H). */
import type { Schemas } from '../../api/client';
import { MINUS, humanise } from './format';

type BacktestSeries = Schemas['BacktestSeries'];
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
  equity: 'Equities', bond: 'Bonds', commodity: 'Commodities', real_estate: 'Real estate', crypto: 'Crypto', cash: 'Cash',
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/charts/transforms.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/charts/transforms.ts frontend/src/components/charts/transforms.test.ts
git commit -m "feat(frontend): series and table transforms for results pages" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared UI building blocks (styles, hooks, status, chart frame, time chart)

**Files:**
- Create: `frontend/src/components/charts/results.css`, `hooks.ts`, `Status.tsx`, `ChartFrame.tsx`, `TimeChart.tsx`

**Interfaces:**
- Consumes: `errorMessage` (Task 1); `yearTick`, `yearTicks`, `isoMonth`, `Span` (Task 2); `Button` from `../ui`.
- Produces:
  - `hooks.ts`: `useRequest<T>(run: (signal: AbortSignal) => Promise<{ data?: T; error?: unknown }>, key: string, enabled?: boolean): { state: RequestState<T>; reload: () => void }`, `type RequestState<T> = { status: 'idle' | 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: T }`, `useDebounced<T>(value: T, ms: number): T`
  - `Status.tsx`: `Loading({ label? })`, `ErrorBox({ message, onRetry? })`, `EmptyState({ title, children, action? })`, `Async<T>({ state, onRetry?, children: (data: T) => ReactNode })`
  - `ChartFrame.tsx`: `ChartFrame({ title, description, note?, table?, children })`, `ChartTip`, `TableScroll({ label, children })`, `Field({ label, hint?, children })`
  - `TimeChart.tsx`: `TimeChart<T extends { t: number }>({ rows, series, yFormat, spans?, yDomain?, height? })`, `interface TimeSeriesSpec { key: string; label: string; color: string; kind?: 'line' | 'area' }`

- [ ] **Step 1: Write `results.css`**

```css
/* Styles for Lane H (results pages, charts, drawer). Tokens only. */
.stack { display: grid; gap: var(--space-5); }
.results-grid { display: grid; gap: var(--space-4); }
.grid-stats { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
.grid-2 { grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr)); }
.form-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); align-items: end; }
.row { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
.small { font-size: 13px; }
.pos { color: var(--pos); }
.neg { color: var(--neg); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.field { display: grid; gap: var(--space-1); min-width: 0; }
.field label { font-size: 13px; color: var(--ink-2); }
.input { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); width: 100%; min-width: 0; }
.check { display: inline-flex; gap: var(--space-2); align-items: center; font-size: 15px; }

.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th, .table td { padding: var(--space-2) var(--space-3); text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
.table td { white-space: nowrap; }
.table th { font-weight: 600; color: var(--ink-2); font-size: 13px; white-space: nowrap; }
.table .num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.table tfoot td { font-weight: 600; }
.table tr.clickable { cursor: pointer; }
.table tr.clickable:hover { background: var(--surface-2); }
.sort-btn { background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; }
.sort-btn:hover { color: var(--ink); }

.banner { border: 1px solid var(--line); border-left: 4px solid var(--warn); background: var(--surface-2); padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm); }
.banner-error { border-left-color: var(--neg); }
.banner ul { margin: 0; padding-left: var(--space-5); }
.badge { display: inline-block; font-size: 12px; padding: 1px 8px; border: 1px solid var(--line); border-radius: 999px; color: var(--ink-2); background: var(--surface-2); }

.chart-frame { margin: 0; display: grid; gap: var(--space-2); }
.chart-title { font: 600 1rem var(--font-sans); margin: 0; }
.chart-box { width: 100%; height: 280px; }
.chart-note { font-size: 13px; color: var(--ink-2); margin: 0; }
.chart-table summary { cursor: pointer; font-size: 13px; color: var(--ink-2); }
.swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px; vertical-align: -1px; margin-right: 6px; }
.swatch-proxy { background: var(--band); border: 1px solid var(--ink-3); }
.legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); list-style: none; margin: 0; padding: 0; font-size: 13px; color: var(--ink-2); }
.tip { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); box-shadow: var(--shadow); font-size: 13px; color: var(--ink); }
.tip-title { font-weight: 600; margin-bottom: var(--space-1); }
.donut-wrap { display: grid; gap: var(--space-3); }

.kv { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-1) var(--space-4); margin: 0; font-size: 14px; }
.kv dt { color: var(--ink-2); }
.kv dd { margin: 0; overflow-wrap: anywhere; }
.trace { display: grid; gap: var(--space-4); padding-left: var(--space-5); }
.trace h4 { margin: 0 0 var(--space-2); font: 600 1rem var(--font-sans); }
.trace code { font-family: var(--font-mono); font-size: 12px; color: var(--ink-3); margin-left: var(--space-2); }
details > summary { cursor: pointer; }

dialog.drawer { margin: 0 0 0 auto; padding: 0; height: 100dvh; max-height: 100dvh; width: min(440px, 100vw); border: 0; border-left: 1px solid var(--line); background: var(--surface); color: var(--ink); }
dialog.drawer::backdrop { background: rgb(20 32 46 / 0.45); }
.drawer-body { padding: var(--space-5); display: grid; gap: var(--space-4); }
.drawer-body h2 { font-size: 1.5rem; margin: 0; }
```

- [ ] **Step 2: Write `hooks.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from './format';

export type RequestState<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: T };

type Result<T> = { data?: T; error?: unknown };

/**
 * Runs `run` whenever `key` (a stable string describing the inputs) or `enabled` changes and cancels the
 * previous request. `run` should return the openapi-fetch result directly.
 */
export function useRequest<T>(
  run: (signal: AbortSignal) => Promise<Result<T>>,
  key: string,
  enabled = true,
): { state: RequestState<T>; reload: () => void } {
  const [state, setState] = useState<RequestState<T>>({ status: enabled ? 'loading' : 'idle' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' });
      return;
    }
    const ctl = new AbortController();
    setState({ status: 'loading' });
    run(ctl.signal)
      .then((res) => {
        if (ctl.signal.aborted) return;
        if (res.error !== undefined || res.data === undefined) setState({ status: 'error', message: errorMessage(res.error) });
        else setState({ status: 'ok', data: res.data });
      })
      .catch((err: unknown) => {
        if (!ctl.signal.aborted) setState({ status: 'error', message: errorMessage(err) });
      });
    return () => ctl.abort();
    // `run` is intentionally not a dependency: `key` describes its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
```

- [ ] **Step 3: Write `Status.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Button } from '../ui';
import type { RequestState } from './hooks';
import './results.css';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div role="status" className="muted">{label}</div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="banner banner-error stack" style={{ gap: 'var(--space-2)' }}>
      <div><strong>Something went wrong.</strong> {message}</div>
      {onRetry && <div><Button type="button" onClick={onRetry}>Try again</Button></div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="card stack" style={{ gap: 'var(--space-3)' }}>
      <h2 style={{ marginBottom: 0 }}>{title}</h2>
      {children && <p className="muted" style={{ margin: 0 }}>{children}</p>}
      {action && <div>{action}</div>}
    </section>
  );
}

/** Renders loading / error states, then `children(data)` once the request succeeded. */
export function Async<T>({
  state, onRetry, children,
}: {
  state: RequestState<T>;
  onRetry?: () => void;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') return <ErrorBox message={state.message} onRetry={onRetry} />;
  return <>{children(state.data)}</>;
}
```

- [ ] **Step 4: Write `ChartFrame.tsx`**

```tsx
import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import './results.css';

export interface ChartTable {
  head: string[];
  rows: Array<Array<string | number>>;
}

/**
 * Title + accessible description + chart + optional visible note + "View as table" fallback.
 * The chart itself is exposed to assistive tech as a single image described by `description`.
 */
export function ChartFrame({
  title, description, note, table, children,
}: {
  title: string;
  description: string;
  note?: ReactNode;
  table?: ChartTable;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <figure className="chart-frame">
      <h4 className="chart-title" id={`${id}-t`}>{title}</h4>
      <p className="sr-only" id={`${id}-d`}>{description}</p>
      <div className="chart-box" role="img" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>{children}</div>
      {note && <p className="chart-note">{note}</p>}
      {table && (
        <details className="chart-table">
          <summary>View as table</summary>
          <TableScroll label={`${title}, data table`}>
            <table className="table">
              <thead>
                <tr>{table.head.map((h, i) => <th key={h} scope="col" className={i > 0 ? 'num' : undefined}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((r, ri) => (
                  <tr key={ri}>{r.map((c, ci) => <td key={ci} className={ci > 0 ? 'num' : undefined}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </details>
      )}
    </figure>
  );
}

/** Horizontal scroll container for wide tables (keyboard focusable so it can be scrolled without a mouse). */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

/** Label + control pair; injects the generated id into the single child control. */
export function Field({
  label, hint, children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}

export interface TipEntry {
  name?: unknown;
  value?: unknown;
  color?: string;
  dataKey?: unknown;
}

/** Tooltip body shared by charts. Used as `<Tooltip content={<ChartTip ... />} />`; Recharts injects the props. */
export function ChartTip({
  active, payload, label, labelFormat, valueFormat,
}: {
  active?: boolean;
  payload?: readonly TipEntry[];
  label?: unknown;
  labelFormat?: (label: unknown) => string;
  valueFormat?: (value: number, name: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const items = payload.filter((p) => typeof p.value === 'number');
  if (items.length === 0) return null;
  const title = label == null || label === '' ? null : labelFormat ? labelFormat(label) : String(label);
  return (
    <div className="tip">
      {title && <div className="tip-title">{title}</div>}
      {items.map((p) => (
        <div key={String(p.dataKey ?? p.name)}>
          {p.color && <span className="swatch" style={{ background: p.color }} />}
          {String(p.name)}: <span className="num">{valueFormat ? valueFormat(p.value as number, String(p.name)) : String(p.value)}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Write `TimeChart.tsx`**

```tsx
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ChartTip } from './ChartFrame';
import { isoMonth, yearTick, yearTicks, type Span } from './transforms';

export interface TimeSeriesSpec {
  key: string;
  label: string;
  /** a CSS variable such as 'var(--series-1)' */
  color: string;
  kind?: 'line' | 'area';
}

const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 12 };

/**
 * Line/area chart over a numeric time axis (`t` = epoch ms). Fixed marks: 2px lines, no dots, faint horizontal grid.
 * `spans` are shaded with the --band token (used for proxied history). Legend appears for 2+ series only.
 */
export function TimeChart<T extends { t: number }>({
  rows, series, yFormat, spans = [], yDomain = ['auto', 'auto'], height = 280,
}: {
  rows: T[];
  series: TimeSeriesSpec[];
  yFormat: (v: number) => string;
  spans?: Span[];
  yDomain?: [number | 'auto', number | 'auto'];
  height?: number;
}) {
  if (rows.length < 2) return <div className="muted">Not enough data to draw this chart.</div>;
  const ticks = yearTicks(rows[0].t, rows[rows.length - 1].t);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={ticks}
          tickFormatter={yearTick} tick={AXIS_TICK} stroke="var(--line)"
        />
        <YAxis tickFormatter={yFormat} tick={AXIS_TICK} stroke="var(--line)" width={60} domain={yDomain} />
        <Tooltip
          content={<ChartTip labelFormat={(l) => isoMonth(Number(l))} valueFormat={(v) => yFormat(v)} />}
          cursor={{ stroke: 'var(--ink-3)' }}
        />
        {series.length > 1 && (
          <Legend
            verticalAlign="top" height={28}
            formatter={(value: unknown) => <span style={{ color: 'var(--ink-2)' }}>{String(value)}</span>}
          />
        )}
        {spans.map((s) => (
          <ReferenceArea key={`${s.x1}-${s.x2}`} x1={s.x1} x2={s.x2} fill="var(--band)" stroke="none" ifOverflow="hidden" />
        ))}
        {series.map((s) =>
          s.kind === 'area' ? (
            <Area
              key={s.key} dataKey={s.key} name={s.label} type="linear" stroke={s.color} strokeWidth={2}
              fill={s.color} fillOpacity={0.15} dot={false} isAnimationActive={false} connectNulls={false}
            />
          ) : (
            <Line
              key={s.key} dataKey={s.key} name={s.label} type="linear" stroke={s.color} strokeWidth={2}
              dot={false} isAnimationActive={false} connectNulls={false}
            />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If Recharts' typings reject a prop such as `ifOverflow` or `Legend.formatter`, keep the behaviour and adapt only the type of that one prop; do not add `any` casts anywhere else.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/charts
git commit -m "feat(frontend): shared chart frame, time chart, request hooks and status components" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Portfolio charts (donut, probability bars, fan chart)

**Files:**
- Create: `frontend/src/components/charts/Donut.tsx`, `BarCharts.tsx`, `FanChart.tsx`

**Interfaces:**
- Consumes: `MixSlice`, `ProbabilityRow`, `FanRow`, `fanRows` (Task 2); `ChartTip` (Task 3); `percent`, `decimal` (Task 1).
- Produces:
  - `AssetMixDonut({ slices }: { slices: MixSlice[] })` (chart + HTML legend with values)
  - `interface BarSeries { key: 'monteCarlo' | 'normal'; label: string; color: string }`; `PairedBars({ rows, series }: { rows: ProbabilityRow[]; series: BarSeries[] })`
  - `FanChart({ fan }: { fan: Schemas['FanPoint'][] })` (chart + HTML legend)

- [ ] **Step 1: Write `Donut.tsx`**

```tsx
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ChartTip } from './ChartFrame';
import { percent } from './format';
import type { MixSlice } from './transforms';
import './results.css';

/** Asset-mix donut. Color is never the only identity: the legend lists every class with its weight. */
export function AssetMixDonut({ slices }: { slices: MixSlice[] }) {
  return (
    <div className="donut-wrap">
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices} dataKey="value" nameKey="label" innerRadius="60%" outerRadius="90%"
              stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}
            >
              {slices.map((s) => <Cell key={s.key} fill={s.color} />)}
            </Pie>
            <Tooltip content={<ChartTip valueFormat={(v) => percent(v)} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="legend">
        {slices.map((s) => (
          <li key={s.key}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label} <span className="num">{percent(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Write `BarCharts.tsx`**

```tsx
import { Bar, BarChart, CartesianGrid, Legend, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTip } from './ChartFrame';
import { percent } from './format';
import type { ProbabilityRow } from './transforms';

export interface BarSeries {
  key: 'monteCarlo' | 'normal';
  label: string;
  /** a CSS variable such as 'var(--series-1)' */
  color: string;
}

const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 12 };

/**
 * One or two bars per threshold (e.g. simulated vs normal). 4px rounded data ends on the baseline, a 2px surface
 * gap around each bar, direct value labels (at most 3 thresholds x 2 series), legend only for 2+ series.
 */
export function PairedBars({ rows, series }: { rows: ProbabilityRow[]; series: BarSeries[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 20, right: 12, bottom: 0, left: 0 }} barGap={4}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} stroke="var(--line)" />
        <YAxis tickFormatter={(v: number) => percent(v, 0)} tick={AXIS_TICK} stroke="var(--line)" width={48} domain={[0, 'auto']} />
        <Tooltip content={<ChartTip valueFormat={(v) => percent(v, 2)} />} cursor={{ fill: 'var(--band)' }} />
        {series.length > 1 && (
          <Legend
            verticalAlign="top" height={28}
            formatter={(value: unknown) => <span style={{ color: 'var(--ink-2)' }}>{String(value)}</span>}
          />
        )}
        {series.map((s) => (
          <Bar
            key={s.key} dataKey={s.key} name={s.label} fill={s.color} stroke="var(--surface)" strokeWidth={2}
            radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}
          >
            <LabelList
              dataKey={s.key} position="top" fill="var(--ink-2)" fontSize={12}
              formatter={(v: unknown) => percent(typeof v === 'number' ? v : null, 1)}
            />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Write `FanChart.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Schemas } from '../../api/client';
import { decimal } from './format';
import { fanRows, type FanRow } from './transforms';
import './results.css';

const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 12 };

function FanTip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: FanRow }> }): ReactNode {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const lines: Array<[string, number]> = [
    ['95th percentile', row.p95], ['75th percentile', row.p75], ['Median', row.p50], ['25th percentile', row.p25], ['5th percentile', row.p5],
  ];
  return (
    <div className="tip">
      <div className="tip-title">After {row.year} {row.year === 1 ? 'year' : 'years'}</div>
      {lines.map(([label, v]) => (
        <div key={label}>{label}: <span className="num">{decimal(v, 2)}×</span></div>
      ))}
    </div>
  );
}

/**
 * Fan chart of the value of 1.00 invested: stacked areas (transparent base under three bands) plus a median line.
 * Outer band = 5th–95th percentile, inner band = 25th–75th.
 */
export function FanChart({ fan }: { fan: Schemas['FanPoint'][] }) {
  const rows = fanRows(fan);
  return (
    <div className="donut-wrap">
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="year" type="number" domain={[0, 'dataMax']} allowDecimals={false} tickFormatter={(y: number) => `${y}y`} tick={AXIS_TICK} stroke="var(--line)" />
            <YAxis tickFormatter={(v: number) => `${decimal(v, 1)}×`} tick={AXIS_TICK} stroke="var(--line)" width={52} domain={[0, 'auto']} />
            <Tooltip content={<FanTip />} cursor={{ stroke: 'var(--ink-3)' }} />
            <Area dataKey="base" stackId="fan" stroke="none" fill="none" isAnimationActive={false} />
            <Area dataKey="lower" stackId="fan" stroke="none" fill="var(--series-1)" fillOpacity={0.15} isAnimationActive={false} />
            <Area dataKey="mid" stackId="fan" stroke="none" fill="var(--series-1)" fillOpacity={0.3} isAnimationActive={false} />
            <Area dataKey="upper" stackId="fan" stroke="none" fill="var(--series-1)" fillOpacity={0.15} isAnimationActive={false} />
            <Line dataKey="p50" name="Median" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="legend">
        <li><span className="swatch" style={{ background: 'var(--series-1)' }} />Median</li>
        <li><span className="swatch" style={{ background: 'var(--series-1)', opacity: 0.3 }} />Middle 50% of outcomes (25th–75th percentile)</li>
        <li><span className="swatch" style={{ background: 'var(--series-1)', opacity: 0.15 }} />90% range (5th–95th percentile)</li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/charts
git commit -m "feat(frontend): donut, probability bar and fan charts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Portfolio page

**Files:**
- Create: `frontend/src/components/charts/HoldingsTable.tsx`, `DownsidePanel.tsx`, `TraceList.tsx`, `PortfolioView.tsx`
- Modify (replace stub): `frontend/src/pages/Portfolio.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–4; store (`useStore`, `initialState`); `api`, `Schemas`; `Card`, `Stat`, `PageHeader`, `LinkButton` from `../components/ui`.
- Produces: default export `Portfolio` page component; `PortfolioView({ rec, currency, horizonYears })`.

- [ ] **Step 1: Write `HoldingsTable.tsx`**

```tsx
import { Link } from 'react-router-dom';
import type { Schemas } from '../../api/client';
import { TableScroll } from './ChartFrame';
import { decimal, percent } from './format';
import { assetClassColor, assetClassLabel } from './transforms';
import './results.css';

export function HoldingsTable({ holdings }: { holdings: Schemas['Holding'][] }) {
  const rows = [...holdings].sort((a, b) => b.weight - a.weight);
  const total = rows.reduce((s, h) => s + h.weight, 0);
  return (
    <TableScroll label="Holdings, scrolls horizontally on small screens">
      <table className="table">
        <caption className="sr-only">Recommended ETFs with weight, cost, beta and share of portfolio risk</caption>
        <thead>
          <tr>
            <th scope="col">Fund</th>
            <th scope="col">Asset class</th>
            <th scope="col" className="num">Weight</th>
            <th scope="col" className="num">TER</th>
            <th scope="col" className="num">Beta</th>
            <th scope="col" className="num">Risk share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.isin}>
              <td>
                <Link to={`/universe/${h.isin}`}>{h.name}</Link>{' '}
                {h.proxied && (
                  <span className="badge" title="Part of this fund's history is filled in from a proxy series">proxied history</span>
                )}
                <div className="small muted num">{h.ticker} · {h.isin}</div>
              </td>
              <td>
                <span className="swatch" style={{ background: assetClassColor(h.asset_class) }} />
                {assetClassLabel(h.asset_class)}
              </td>
              <td className="num">{percent(h.weight)}</td>
              <td className="num">{percent(h.ter, 2)}</td>
              <td className="num">{decimal(h.beta, 2)}</td>
              <td className="num">{percent(h.risk_contribution)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Total</td>
            <td className="num">{percent(total)}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </TableScroll>
  );
}
```

- [ ] **Step 2: Write `DownsidePanel.tsx`**

```tsx
import type { Schemas } from '../../api/client';
import { PairedBars, type BarSeries } from './BarCharts';
import { ChartFrame, TableScroll } from './ChartFrame';
import { FanChart } from './FanChart';
import { decimal, percent } from './format';
import { probabilityRows, sampleEvenly, thresholdLabel } from './transforms';
import { Card } from '../ui';
import './results.css';

type Downside = Schemas['Downside'];

const MC: BarSeries = { key: 'monteCarlo', label: 'Simulated from history', color: 'var(--series-1)' };
const NORMAL: BarSeries = { key: 'normal', label: 'Normal-distribution model', color: 'var(--series-2)' };

export function DownsidePanel({ downside, horizonYears }: { downside: Downside; horizonYears: number }) {
  const drawdown = probabilityRows(downside.drawdown_probs, downside.normal_comparison.drawdown_probs);
  const annual = probabilityRows(downside.annual_loss_probs, downside.normal_comparison.annual_loss_probs);
  const fanTable = sampleEvenly(downside.fan, 6).map((f) => [`Year ${f.year}`, decimal(f.p5), decimal(f.p50), decimal(f.p95)]);

  return (
    <div className="stack">
      <div className="results-grid grid-2">
        <Card title="Chance of a large fall">
          <ChartFrame
            title={`Probability of a peak-to-trough fall within ${horizonYears} years`}
            description={`Bar chart. ${drawdown.map((r) => `${r.label}: ${percent(r.monteCarlo)}`).join('; ')}.`}
            table={{ head: ['Fall', 'Probability'], rows: drawdown.map((r) => [r.label, percent(r.monteCarlo, 2)]) }}
          >
            <PairedBars rows={drawdown} series={[MC]} />
          </ChartFrame>
          <p style={{ marginBottom: 'var(--space-2)' }}>
            Chance of ending below what you put in after {horizonYears} years:{' '}
            <strong className="num">{percent(downside.p_below_invested)}</strong>
          </p>
          <TableScroll label="Chance of a losing calendar year">
            <table className="table">
              <caption className="sr-only">Chance of at least one calendar year with a loss this large</caption>
              <thead>
                <tr><th scope="col">A single year of</th><th scope="col" className="num">Happens at least once</th></tr>
              </thead>
              <tbody>
                {annual.map((r) => (
                  <tr key={r.threshold}><td>{thresholdLabel(r.threshold)}</td><td className="num">{percent(r.monteCarlo, 1)}</td></tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>

        <Card title="Where your money could end up">
          <ChartFrame
            title={`Value of 1.00 invested, ${horizonYears}-year simulation`}
            description="Fan chart. The line is the median outcome; shaded bands show the middle 50% and the 90% range of simulated outcomes."
            table={{ head: ['Point in time', '5th pct', 'Median', '95th pct'], rows: fanTable }}
          >
            <FanChart fan={downside.fan} />
          </ChartFrame>
        </Card>
      </div>

      <Card title="Historical stress tests">
        <p className="muted" style={{ marginTop: 0 }}>What this portfolio would have lost in past crises. A dash means there is not enough history.</p>
        <TableScroll label="Stress tests, scrolls horizontally on small screens">
          <table className="table">
            <caption className="sr-only">Portfolio loss during each stress event</caption>
            <thead>
              <tr>
                <th scope="col">Event</th><th scope="col">Period</th>
                <th scope="col" className="num">Loss</th><th scope="col">Data</th>
              </tr>
            </thead>
            <tbody>
              {downside.stress.map((s) => (
                <tr key={s.event}>
                  <td>{s.event}</td>
                  <td className="num">{s.start} to {s.end}</td>
                  <td className={`num ${s.loss != null && s.loss < 0 ? 'neg' : ''}`}>{percent(s.loss)}</td>
                  <td>{s.loss == null ? 'no data' : s.proxied ? <span className="badge">proxy data</span> : 'actual'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      <Card title="Why not just assume a bell curve?">
        <p className="muted" style={{ marginTop: 0 }}>
          The normal-distribution model usually understates the chance of large losses, because real markets have fatter tails and volatility that clusters.
        </p>
        <div className="results-grid grid-2">
          <ChartFrame
            title="Peak-to-trough fall within the horizon"
            description={`Paired bars comparing simulated and normal-model probabilities. ${drawdown.map((r) => `${r.label}: simulated ${percent(r.monteCarlo)}, normal ${percent(r.normal)}`).join('; ')}.`}
            table={{ head: ['Fall', 'Simulated', 'Normal'], rows: drawdown.map((r) => [r.label, percent(r.monteCarlo, 2), percent(r.normal, 2)]) }}
          >
            <PairedBars rows={drawdown} series={[MC, NORMAL]} />
          </ChartFrame>
          <ChartFrame
            title="At least one losing calendar year"
            description={`Paired bars comparing simulated and normal-model probabilities. ${annual.map((r) => `${r.label}: simulated ${percent(r.monteCarlo)}, normal ${percent(r.normal)}`).join('; ')}.`}
            table={{ head: ['Loss in a year', 'Simulated', 'Normal'], rows: annual.map((r) => [r.label, percent(r.monteCarlo, 2), percent(r.normal, 2)]) }}
          >
            <PairedBars rows={annual} series={[MC, NORMAL]} />
          </ChartFrame>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Write `TraceList.tsx`**

```tsx
import { Fragment } from 'react';
import type { Schemas } from '../../api/client';
import { stepTitle, summaryEntries } from './transforms';
import './results.css';

export function TraceList({ trace }: { trace: Schemas['StepResult'][] }) {
  if (trace.length === 0) return <p className="muted">No calculation trace was returned.</p>;
  return (
    <details>
      <summary>Show the {trace.length} calculation steps</summary>
      <ol className="trace" style={{ marginTop: 'var(--space-4)' }}>
        {trace.map((step) => {
          const entries = summaryEntries(step.summary);
          const notes = step.notes ?? [];
          return (
            <li key={step.step}>
              <h4>{stepTitle(step.step)}<code>{step.step}</code></h4>
              {entries.length > 0 && (
                <dl className="kv">
                  {entries.map(([k, v]) => (
                    <Fragment key={k}><dt>{k}</dt><dd className="num">{v}</dd></Fragment>
                  ))}
                </dl>
              )}
              {notes.length > 0 && <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
```

- [ ] **Step 4: Write `PortfolioView.tsx`**

```tsx
import type { Schemas } from '../../api/client';
import { Card, LinkButton, Stat } from '../ui';
import { AssetMixDonut } from './Donut';
import { ChartFrame } from './ChartFrame';
import { DownsidePanel } from './DownsidePanel';
import { HoldingsTable } from './HoldingsTable';
import { TraceList } from './TraceList';
import { decimal, money, percent } from './format';
import { mixRows } from './transforms';
import './results.css';

export function PortfolioView({
  rec, currency, horizonYears,
}: {
  rec: Schemas['Recommendation'];
  currency: string;
  horizonYears: number;
}) {
  const s = rec.summary;
  const warnings = rec.warnings ?? [];
  const slices = mixRows(s.mix);
  const volGap = s.volatility - s.target_volatility;
  const volHint =
    Math.abs(volGap) < 0.005
      ? `on target (${percent(s.target_volatility)})`
      : `${volGap < 0 ? 'below' : 'above'} the ${percent(s.target_volatility)} target`;

  return (
    <div className="stack">
      {warnings.length > 0 && (
        <div className="banner" role="status">
          <strong>Heads up</strong>
          <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="results-grid grid-stats">
        <Card><Stat label="Expected return" value={percent(s.expected_return)} hint="per year, model estimate" /></Card>
        <Card><Stat label="Volatility" value={percent(s.volatility)} hint={volHint} /></Card>
        <Card><Stat label="Sharpe ratio" value={decimal(s.sharpe, 2)} hint="return per unit of risk" /></Card>
        <Card><Stat label="Beta" value={decimal(s.beta, 2)} hint="vs. the market portfolio" /></Card>
        <Card>
          <Stat
            label={`Cost per ${money(10_000, currency)}`}
            value={money(s.annual_cost_per_10k, currency)}
            hint={`per year, weighted TER ${percent(s.weighted_ter, 2)}`}
          />
        </Card>
      </div>

      <div className="results-grid grid-2">
        <Card title="Asset mix">
          <ChartFrame
            title="Portfolio split by asset class"
            description={`Donut chart. ${slices.map((x) => `${x.label} ${percent(x.value)}`).join(', ')}.`}
            table={{ head: ['Asset class', 'Weight'], rows: slices.map((x) => [x.label, percent(x.value)]) }}
          >
            <AssetMixDonut slices={slices} />
          </ChartFrame>
        </Card>
        <Card title="Holdings">
          <HoldingsTable holdings={rec.holdings} />
        </Card>
      </div>

      <h2 style={{ marginBottom: 0 }}>Downside: what could go wrong</h2>
      <DownsidePanel downside={rec.downside} horizonYears={horizonYears} />

      <Card title="How was this built?">
        <TraceList trace={rec.trace ?? []} />
      </Card>

      <div className="row">
        <LinkButton to="/backtest" variant="primary">Test it historically</LinkButton>
        <span className="muted">See how this portfolio would have behaved in the past.</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Replace `pages/Portfolio.tsx`**

```tsx
import { api, type Schemas } from '../api/client';
import { PortfolioView } from '../components/charts/PortfolioView';
import { useRequest } from '../components/charts/hooks';
import { isProfileTouched } from '../components/charts/transforms';
import { Async, EmptyState } from '../components/charts/Status';
import { LinkButton, PageHeader } from '../components/ui';
import { initialState, useStore } from '../state/store';

export default function Portfolio() {
  const [{ profile, settings, score }] = useStore();
  const touched = isProfileTouched(profile, initialState.profile, score);
  const { state, reload } = useRequest<Schemas['Recommendation']>(
    (signal) => api.POST('/api/portfolio', { body: { profile, settings }, signal }),
    JSON.stringify({ profile, settings }),
    touched,
  );

  if (!touched) {
    return (
      <EmptyState
        title="No portfolio yet"
        action={<LinkButton to="/start" variant="primary">Build my portfolio</LinkButton>}
      >
        Answer a few questions and we will build a portfolio around your risk level and preferences.
      </EmptyState>
    );
  }

  return (
    <>
      <PageHeader
        title="Your portfolio"
        lead={`Risk level ${Math.round(profile.risk_level)} of 100 · ${profile.horizon_years}-year horizon · ${profile.base_currency}`}
      />
      <Async state={state} onRetry={reload}>
        {(rec) => <PortfolioView rec={rec} currency={profile.base_currency} horizonYears={profile.horizon_years} />}
      </Async>
    </>
  );
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test`
Expected: no type errors; all tests pass.

Run: `npm run dev:mock`, open `http://localhost:5740/portfolio`.
Expected with a fresh browser profile: the "No portfolio yet" empty state and a link to `/start`. In the browser console run `localStorage.setItem('roboadvisor.state.v1', JSON.stringify({profile:{risk_level:60,horizon_years:10,base_currency:'EUR',preferences:{}},settings:{},answers:{},score:null}))` and reload: after a short "Loading…", the page shows warnings banner, five summary cards, donut + holdings, downside cards, trace (collapsed) and the "Test it historically" button. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/charts frontend/src/pages/Portfolio.tsx
git commit -m "feat(frontend): portfolio page with holdings, downside panel and trace" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Backtest form logic

**Files:**
- Create: `frontend/src/components/charts/backtestForm.ts`
- Test: `frontend/src/components/charts/backtestForm.test.ts`

**Interfaces:**
- Consumes: `Schemas` (type only).
- Produces:
  - `interface BacktestForm { mode: 'static' | 'walk_forward'; rebalanceType: 'none' | 'periodic' | 'threshold'; frequency: 'monthly' | 'quarterly' | 'annual'; thresholdPct: string; start: string; end: string; costBps: string }`
  - `defaultBacktestForm: BacktestForm`
  - `withMode(form, mode): BacktestForm` (walk_forward + `none` → `periodic` + `quarterly`)
  - `validateBacktestForm(form): string | null`
  - `toBacktestSettings(form): Schemas['BacktestSettings']`
  - `describeRun(form): string`

- [ ] **Step 1: Write the failing test**

`frontend/src/components/charts/backtestForm.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/charts/backtestForm.test.ts`
Expected: FAIL (`Failed to resolve import "./backtestForm"`).

- [ ] **Step 3: Write `backtestForm.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/charts/backtestForm.test.ts && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/charts/backtestForm.ts frontend/src/components/charts/backtestForm.test.ts
git commit -m "feat(frontend): backtest form logic" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Backtest page (charts, metrics table, compare mode)

**Files:**
- Create: `frontend/src/components/charts/MetricsTable.tsx`
- Modify (replace stub): `frontend/src/pages/Backtest.tsx`

**Interfaces:**
- Consumes: Tasks 1–3 and 6; store; `api`, `Schemas`.
- Produces: `MetricsTable({ columns, showDelta?, caption })`, `interface MetricColumn { title: string; subtitle?: string; values: Record<string, number | null | undefined> | undefined }`; default export `Backtest`.

- [ ] **Step 1: Write `MetricsTable.tsx`**

```tsx
import { TableScroll } from './ChartFrame';
import { METRICS, formatMetric, formatMetricDelta, metricLabel, orderedMetricKeys } from './format';
import './results.css';

export interface MetricColumn {
  title: string;
  subtitle?: string;
  values: Record<string, number | null | undefined> | undefined;
}

/** Metrics as rows, runs as columns. With exactly two columns and `showDelta`, a "B − A" column is added. */
export function MetricsTable({
  columns, showDelta = false, caption,
}: {
  columns: MetricColumn[];
  showDelta?: boolean;
  caption: string;
}) {
  const keys = orderedMetricKeys(...columns.map((c) => c.values));
  const delta = showDelta && columns.length === 2;
  return (
    <TableScroll label={`${caption}, scrolls horizontally on small screens`}>
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            {columns.map((c) => (
              <th key={c.title} scope="col" className="num">
                {c.title}
                {c.subtitle && <div className="small muted" style={{ fontWeight: 400 }}>{c.subtitle}</div>}
              </th>
            ))}
            {delta && <th scope="col" className="num">B − A</th>}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <th scope="row">
                {metricLabel(k)}
                {METRICS[k] && <div className="small muted" style={{ fontWeight: 400, whiteSpace: 'normal' }}>{METRICS[k].help}</div>}
              </th>
              {columns.map((c) => <td key={c.title} className="num">{formatMetric(k, c.values?.[k])}</td>)}
              {delta && <td className="num">{formatMetricDelta(k, columns[0].values?.[k], columns[1].values?.[k])}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
```

- [ ] **Step 2: Replace `pages/Backtest.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Schemas } from '../api/client';
import { ChartFrame, Field } from '../components/charts/ChartFrame';
import { MetricsTable } from '../components/charts/MetricsTable';
import { EmptyState, ErrorBox, Loading } from '../components/charts/Status';
import { TimeChart } from '../components/charts/TimeChart';
import {
  defaultBacktestForm, describeRun, toBacktestSettings, validateBacktestForm, withMode, type BacktestForm,
} from '../components/charts/backtestForm';
import { decimal, errorMessage, percent } from '../components/charts/format';
import { backtestRows, isProfileTouched, isoMonth, proxiedSpans, sampleEvenly } from '../components/charts/transforms';
import { Button, Card, LinkButton, PageHeader } from '../components/ui';
import { initialState, useStore } from '../state/store';
import '../components/charts/results.css';

type BacktestResult = Schemas['BacktestResult'];
interface Run {
  label: string;
  mode: BacktestForm['mode'];
  result: BacktestResult;
}

const PORTFOLIO = { key: 'portfolio', label: 'Portfolio', color: 'var(--series-1)' };
const BENCHMARK = { key: 'benchmark', label: 'Benchmark', color: 'var(--series-2)' };

export default function Backtest() {
  const [{ profile, settings, score }] = useStore();
  const touched = isProfileTouched(profile, initialState.profile, score);

  const [form, setForm] = useState<BacktestForm>(defaultBacktestForm);
  const [current, setCurrent] = useState<Run | null>(null);
  const [previous, setPrevious] = useState<Run | null>(null);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const patch = (p: Partial<BacktestForm>) => setForm((f) => ({ ...f, ...p }));

  async function run() {
    const problem = validateBacktestForm(form);
    if (problem) {
      setError(problem);
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setError(null);
    try {
      const res = await api.POST('/api/backtest', {
        body: { profile, settings, backtest: toBacktestSettings(form) },
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) return;
      if (res.data === undefined) {
        setError(errorMessage(res.error));
        return;
      }
      setPrevious(current);
      setCurrent({ label: describeRun(form), mode: form.mode, result: res.data });
    } catch (e) {
      if (!ctl.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  }

  if (!touched) {
    return (
      <EmptyState
        title="Nothing to test yet"
        action={<LinkButton to="/start" variant="primary">Build my portfolio</LinkButton>}
      >
        Build a portfolio first, then test how it would have behaved in the past.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Test it historically"
        lead="Replay your portfolio through past markets. Past performance is no guarantee of future results."
      />

      <Card title="Settings">
        <form
          className="stack" style={{ gap: 'var(--space-4)' }}
          onSubmit={(e) => { e.preventDefault(); void run(); }}
        >
          <div className="form-grid">
            <Field
              label="Mode"
              hint={form.mode === 'static'
                ? "Uses today's recommended weights for the whole period."
                : 'Re-runs the engine at each rebalance date using only data available then.'}
            >
              <select className="input" value={form.mode} onChange={(e) => setForm((f) => withMode(f, e.target.value as BacktestForm['mode']))}>
                <option value="static">Static weights</option>
                <option value="walk_forward">Walk-forward</option>
              </select>
            </Field>
            <Field label="Rebalancing" hint={form.mode === 'walk_forward' ? 'Required for walk-forward.' : undefined}>
              <select className="input" value={form.rebalanceType} onChange={(e) => patch({ rebalanceType: e.target.value as BacktestForm['rebalanceType'] })}>
                <option value="none" disabled={form.mode === 'walk_forward'}>None (buy and hold)</option>
                <option value="periodic">Periodic</option>
                <option value="threshold">When weights drift</option>
              </select>
            </Field>
            {form.rebalanceType === 'periodic' && (
              <Field label="Frequency">
                <select className="input" value={form.frequency} onChange={(e) => patch({ frequency: e.target.value as BacktestForm['frequency'] })}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </Field>
            )}
            {form.rebalanceType === 'threshold' && (
              <Field label="Drift threshold (%)" hint="Rebalance when any weight is this far from target.">
                <input className="input" type="number" min="0.5" max="50" step="0.5" value={form.thresholdPct} onChange={(e) => patch({ thresholdPct: e.target.value })} />
              </Field>
            )}
            <Field label="Start date" hint="Blank = 15 years back.">
              <input className="input" type="date" value={form.start} onChange={(e) => patch({ start: e.target.value })} />
            </Field>
            <Field label="End date" hint="Blank = latest data.">
              <input className="input" type="date" value={form.end} onChange={(e) => patch({ end: e.target.value })} />
            </Field>
            <Field label="Transaction cost (bps)" hint="Charged on every trade, including the first purchase.">
              <input className="input" type="number" min="0" max="500" step="1" value={form.costBps} onChange={(e) => patch({ costBps: e.target.value })} />
            </Field>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Benchmark: automatic mix of global equities and bonds, matched to your portfolio&apos;s volatility.
          </p>
          <div className="row">
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Running…' : 'Run backtest'}</Button>
            {previous && current && (
              <label className="check">
                <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
                Compare with previous run
              </label>
            )}
          </div>
        </form>
      </Card>

      {error && <ErrorBox message={error} />}
      {busy && <Loading label="Running backtest…" />}
      {!current && !busy && !error && (
        <p className="muted">Choose your settings and press &ldquo;Run backtest&rdquo;.</p>
      )}
      {current && <BacktestResults run={current} />}
      {current && previous && compare && <CompareCard a={previous} b={current} />}
    </div>
  );
}

function BacktestResults({ run }: { run: Run }) {
  const { result } = run;
  const rows = useMemo(() => backtestRows(result.series), [result]);
  const domain: [number, number] = rows.length > 0 ? [rows[0].t, rows[rows.length - 1].t] : [0, 0];
  const spans = proxiedSpans(result.proxied_periods, domain);
  const rebalances = result.rebalance_dates ?? [];
  const warnings = (result.warnings ?? []).filter((w) => run.mode !== 'static' || !/look-ahead/i.test(w));
  const proxyNote = spans.length > 0
    ? <><span className="swatch swatch-proxy" />Shaded: part of the history comes from proxy series, not the funds themselves.</>
    : undefined;
  const money = (v: number) => `${decimal(v, 2)}×`;
  const sample = sampleEvenly(rows, 12);

  return (
    <div className="stack">
      {run.mode === 'static' && (
        <div className="banner" role="status">
          <strong>Look-ahead bias.</strong> Static mode uses weights chosen with today&apos;s knowledge, so the past looks
          better than it could have been in real time. Use walk-forward for an honest test.
        </div>
      )}
      {warnings.length > 0 && (
        <div className="banner" role="status"><ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>
      )}
      <p className="muted" style={{ margin: 0 }}>
        {run.label}. {rebalances.length === 0 ? 'No rebalancing trades.' : `Rebalanced ${rebalances.length} times.`}
      </p>

      <div className="results-grid grid-2">
        <Card title="Growth of 1.00">
          <ChartFrame
            title="Portfolio value vs benchmark"
            description="Line chart of the value of 1.00 invested in the portfolio and in the benchmark over the backtest period."
            note={proxyNote}
            table={{ head: ['Month', 'Portfolio', 'Benchmark'], rows: sample.map((r) => [isoMonth(r.t), money(r.portfolio), money(r.benchmark)]) }}
          >
            <TimeChart rows={rows} series={[PORTFOLIO, BENCHMARK]} yFormat={money} spans={spans} />
          </ChartFrame>
        </Card>
        <Card title="Falls from the peak">
          <ChartFrame
            title="Portfolio drawdown"
            description="Area chart of how far the portfolio was below its previous peak at each point in time."
            note={proxyNote}
            table={{ head: ['Month', 'Drawdown'], rows: sample.map((r) => [isoMonth(r.t), percent(r.drawdown)]) }}
          >
            <TimeChart rows={rows} series={[{ ...PORTFOLIO, label: 'Drawdown', kind: 'area' }]} yFormat={(v) => percent(v, 0)} yDomain={['auto', 0]} spans={spans} />
          </ChartFrame>
        </Card>
        <Card title="Risk over time">
          <ChartFrame
            title="Rolling volatility (3 years)"
            description="Line chart of annualised volatility over a rolling three-year window."
            note={proxyNote}
            table={{ head: ['Month', 'Volatility'], rows: sample.map((r) => [isoMonth(r.t), percent(r.rollingVol)]) }}
          >
            <TimeChart rows={rows} series={[{ ...PORTFOLIO, key: 'rollingVol', label: 'Rolling volatility' }]} yFormat={(v) => percent(v, 0)} spans={spans} />
          </ChartFrame>
        </Card>
        <Card title="Return per unit of risk over time">
          <ChartFrame
            title="Rolling Sharpe ratio (3 years)"
            description="Line chart of the Sharpe ratio over a rolling three-year window."
            note={proxyNote}
            table={{ head: ['Month', 'Sharpe'], rows: sample.map((r) => [isoMonth(r.t), decimal(r.rollingSharpe)]) }}
          >
            <TimeChart rows={rows} series={[{ ...PORTFOLIO, key: 'rollingSharpe', label: 'Rolling Sharpe' }]} yFormat={(v) => decimal(v, 1)} spans={spans} />
          </ChartFrame>
        </Card>
      </div>

      <Card title="Key numbers">
        <MetricsTable
          caption="Backtest metrics for the portfolio and its benchmark"
          columns={[
            { title: 'Portfolio', values: result.metrics.portfolio },
            { title: 'Benchmark', values: result.metrics.benchmark },
          ]}
        />
      </Card>
    </div>
  );
}

function CompareCard({ a, b }: { a: Run; b: Run }) {
  return (
    <Card title="Run A vs Run B">
      <MetricsTable
        caption="Portfolio metrics for the previous run (A) and the latest run (B)"
        showDelta
        columns={[
          { title: 'Run A', subtitle: a.label, values: a.result.metrics.portfolio },
          { title: 'Run B', subtitle: b.label, values: b.result.metrics.portfolio },
        ]}
      />
    </Card>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test`
Expected: no type errors; all tests pass.

Run: `npm run dev:mock`, seed the profile as in Task 5 Step 6, open `/backtest`.
Expected: settings card; "Run backtest" shows "Running…" for ~200 ms, then the look-ahead banner, four charts (value chart has a two-entry legend and shaded early years), and the metrics table with `–` for benchmark beta and turnover. Switching Mode to Walk-forward switches Rebalancing to "Periodic"/Quarterly and disables "None". Stop the server.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/charts/MetricsTable.tsx frontend/src/pages/Backtest.tsx
git commit -m "feat(frontend): backtest page with charts, metrics table and run comparison" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Universe list and fund detail pages

**Files:**
- Create: `frontend/src/components/charts/universe.ts`
- Test: `frontend/src/components/charts/universe.test.ts`
- Modify (replace stubs): `frontend/src/pages/Universe.tsx`, `frontend/src/pages/UniverseFund.tsx`

**Interfaces:**
- Consumes: Tasks 1–3; store; `api`, `Schemas`.
- Produces:
  - `interface FundFilters { asset_class: string; region: string; esg: boolean; ucits: boolean; max_ter: string; q: string }`, `emptyFilters`, `filtersToQuery(f)`, `type SortKey = 'name' | 'asset_class' | 'region' | 'ter' | 'inception_date'`, `type SortDir = 'asc' | 'desc'`, `sortFunds(funds, key, dir)`, `ASSET_CLASSES: string[]`, `REGIONS: Array<{ value: string; label: string }>`

- [ ] **Step 1: Write the failing test**

`frontend/src/components/charts/universe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Schemas } from '../../api/client';
import { emptyFilters, filtersToQuery, sortFunds } from './universe';

const fund = (over: Partial<Schemas['FundSummary']>): Schemas['FundSummary'] => ({
  isin: 'X', name: 'X', issuer: null, asset_class: 'equity', sub_class: null, region: null, sector: null, esg: false,
  ter: null, domicile: null, ucits: true, wrapper: 'etf', distribution: null, hedged_to: null, duration: null,
  index_name: null, inception_date: null, has_proxy: false, tickers: [], ...over,
});

describe('filtersToQuery', () => {
  it('omits empty filters', () => {
    expect(filtersToQuery(emptyFilters)).toEqual({});
  });
  it('converts percent TER to a fraction, trims the search and only sends true flags', () => {
    expect(filtersToQuery({ ...emptyFilters, asset_class: 'bond', max_ter: '0.25', esg: true, q: ' msci ' })).toEqual({
      asset_class: 'bond', esg: true, max_ter: 0.0025, q: 'msci',
    });
  });
  it('ignores an unparsable TER', () => {
    expect(filtersToQuery({ ...emptyFilters, max_ter: 'abc' })).toEqual({});
  });
});

describe('sortFunds', () => {
  const funds = [
    fund({ isin: 'A', name: 'beta fund', ter: 0.002 }),
    fund({ isin: 'B', name: 'Alpha fund', ter: null }),
    fund({ isin: 'C', name: 'Gamma fund', ter: 0.001 }),
  ];
  it('sorts strings case-insensitively', () => {
    expect(sortFunds(funds, 'name', 'asc').map((f) => f.isin)).toEqual(['B', 'A', 'C']);
    expect(sortFunds(funds, 'name', 'desc').map((f) => f.isin)).toEqual(['C', 'A', 'B']);
  });
  it('keeps missing values last in both directions and does not mutate the input', () => {
    expect(sortFunds(funds, 'ter', 'asc').map((f) => f.isin)).toEqual(['C', 'A', 'B']);
    expect(sortFunds(funds, 'ter', 'desc').map((f) => f.isin)).toEqual(['A', 'C', 'B']);
    expect(funds.map((f) => f.isin)).toEqual(['A', 'B', 'C']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/charts/universe.test.ts`
Expected: FAIL (`Failed to resolve import "./universe"`).

- [ ] **Step 3: Write `universe.ts`**

```ts
import type { Schemas } from '../../api/client';

type Fund = Schemas['FundSummary'];

export interface FundFilters {
  asset_class: string;
  region: string;
  esg: boolean;
  ucits: boolean;
  /** percent per year as typed by the user, e.g. '0.25' */
  max_ter: string;
  q: string;
}

export const emptyFilters: FundFilters = { asset_class: '', region: '', esg: false, ucits: false, max_ter: '', q: '' };

export const ASSET_CLASSES = ['equity', 'bond', 'commodity', 'real_estate', 'cash', 'crypto'];

export const REGIONS: Array<{ value: string; label: string }> = [
  { value: 'global', label: 'Global' },
  { value: 'us', label: 'US' },
  { value: 'europe', label: 'Europe' },
  { value: 'uk', label: 'UK' },
  { value: 'japan', label: 'Japan' },
  { value: 'pacific_ex_japan', label: 'Pacific ex-Japan' },
  { value: 'em', label: 'Emerging markets' },
];

/** Query for GET /api/universe: empty values are omitted (openapi-fetch drops undefined). */
export function filtersToQuery(f: FundFilters): {
  asset_class?: string; region?: string; esg?: boolean; ucits?: boolean; max_ter?: number; q?: string;
} {
  const out: ReturnType<typeof filtersToQuery> = {};
  if (f.asset_class) out.asset_class = f.asset_class;
  if (f.region) out.region = f.region;
  if (f.esg) out.esg = true;
  if (f.ucits) out.ucits = true;
  const ter = Number(f.max_ter);
  if (f.max_ter.trim() !== '' && Number.isFinite(ter) && ter >= 0) out.max_ter = Number((ter / 100).toFixed(6));
  if (f.q.trim()) out.q = f.q.trim();
  return out;
}

export type SortKey = 'name' | 'asset_class' | 'region' | 'ter' | 'inception_date';
export type SortDir = 'asc' | 'desc';

export function sortFunds(funds: readonly Fund[], key: SortKey, dir: SortDir): Fund[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...funds].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1; // missing values last regardless of direction
    if (y == null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return sign * (x - y);
    return sign * String(x).localeCompare(String(y), undefined, { sensitivity: 'base' });
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/charts/universe.test.ts && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Replace `pages/Universe.tsx`**

```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Schemas } from '../api/client';
import { Field, TableScroll } from '../components/charts/ChartFrame';
import { percent } from '../components/charts/format';
import { useDebounced, useRequest } from '../components/charts/hooks';
import { Async } from '../components/charts/Status';
import { assetClassLabel } from '../components/charts/transforms';
import {
  ASSET_CLASSES, REGIONS, emptyFilters, filtersToQuery, sortFunds, type FundFilters, type SortDir, type SortKey,
} from '../components/charts/universe';
import { Button, Card, PageHeader } from '../components/ui';
import '../components/charts/results.css';

const COLUMNS: Array<{ key: SortKey; label: string; num?: boolean }> = [
  { key: 'name', label: 'Fund' },
  { key: 'asset_class', label: 'Asset class' },
  { key: 'region', label: 'Region' },
  { key: 'ter', label: 'TER', num: true },
];

export default function Universe() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FundFilters>(emptyFilters);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const q = useDebounced(filters.q, 300);
  const query = filtersToQuery({ ...filters, q });
  const { state, reload } = useRequest<Schemas['FundSummary'][]>(
    (signal) => api.GET('/api/universe', { params: { query }, signal }),
    JSON.stringify(query),
  );
  const patch = (p: Partial<FundFilters>) => setFilters((f) => ({ ...f, ...p }));
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  return (
    <div className="stack">
      <PageHeader title="ETF universe" lead="Every fund the engine can choose from. Select a fund for its details and price history." />

      <Card title="Filters">
        <div className="form-grid">
          <Field label="Asset class">
            <select className="input" value={filters.asset_class} onChange={(e) => patch({ asset_class: e.target.value })}>
              <option value="">All</option>
              {ASSET_CLASSES.map((c) => <option key={c} value={c}>{assetClassLabel(c)}</option>)}
            </select>
          </Field>
          <Field label="Region">
            <select className="input" value={filters.region} onChange={(e) => patch({ region: e.target.value })}>
              <option value="">All</option>
              {REGIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Max TER (% per year)">
            <input className="input" type="number" min="0" step="0.05" placeholder="e.g. 0.30" value={filters.max_ter} onChange={(e) => patch({ max_ter: e.target.value })} />
          </Field>
          <Field label="Search">
            <input className="input" type="search" placeholder="Name, ISIN, ticker, index" value={filters.q} onChange={(e) => patch({ q: e.target.value })} />
          </Field>
          <label className="check"><input type="checkbox" checked={filters.esg} onChange={(e) => patch({ esg: e.target.checked })} />ESG only</label>
          <label className="check"><input type="checkbox" checked={filters.ucits} onChange={(e) => patch({ ucits: e.target.checked })} />UCITS only</label>
          <div><Button type="button" onClick={() => setFilters(emptyFilters)}>Clear filters</Button></div>
        </div>
      </Card>

      <Async state={state} onRetry={reload}>
        {(funds) => {
          const rows = sortFunds(funds, sort.key, sort.dir);
          return (
            <Card title={`${rows.length} ${rows.length === 1 ? 'fund' : 'funds'}`}>
              {rows.length === 0 ? (
                <p className="muted">No funds match these filters.</p>
              ) : (
                <TableScroll label="Funds, scrolls horizontally on small screens">
                  <table className="table">
                    <caption className="sr-only">Funds in the universe, sortable by column</caption>
                    <thead>
                      <tr>
                        {COLUMNS.map((c) => (
                          <th
                            key={c.key} scope="col" className={c.num ? 'num' : undefined}
                            aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                          >
                            <button type="button" className="sort-btn" onClick={() => toggleSort(c.key)}>
                              {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                            </button>
                          </th>
                        ))}
                        <th scope="col">Hedged</th>
                        <th scope="col">ESG</th>
                        <th scope="col">UCITS</th>
                        <th scope="col">Dist.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((f) => (
                        <tr key={f.isin} className="clickable" onClick={() => navigate(`/universe/${f.isin}`)}>
                          <td>
                            <Link to={`/universe/${f.isin}`} onClick={(e) => e.stopPropagation()}>{f.name}</Link>
                            <div className="small muted num">{f.isin}{f.tickers.length > 0 ? ` · ${f.tickers.join(', ')}` : ''}</div>
                          </td>
                          <td>{assetClassLabel(f.asset_class)}</td>
                          <td>{f.region ?? '–'}</td>
                          <td className="num">{percent(f.ter, 2)}</td>
                          <td>{f.hedged_to ?? '–'}</td>
                          <td>{f.esg ? 'Yes' : '–'}</td>
                          <td>{f.ucits ? 'Yes' : '–'}</td>
                          <td>{f.distribution ?? '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </Card>
          );
        }}
      </Async>
    </div>
  );
}
```

- [ ] **Step 6: Replace `pages/UniverseFund.tsx`**

```tsx
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Schemas } from '../api/client';
import { ChartFrame, TableScroll } from '../components/charts/ChartFrame';
import { decimal, humanise, money, percent } from '../components/charts/format';
import { useRequest } from '../components/charts/hooks';
import { Async } from '../components/charts/Status';
import { TimeChart } from '../components/charts/TimeChart';
import { assetClassLabel, dateMs, isoMonth, sampleEvenly } from '../components/charts/transforms';
import { Card, PageHeader } from '../components/ui';
import { useStore } from '../state/store';
import '../components/charts/results.css';

export default function UniverseFund() {
  const { isin = '' } = useParams();
  const [{ profile }] = useStore();
  const base = profile.base_currency;
  const { state, reload } = useRequest<Schemas['FundDetail']>(
    (signal) => api.GET('/api/universe/{isin}', { params: { path: { isin }, query: { base_currency: base } }, signal }),
    `${isin}|${base}`,
  );

  return (
    <div className="stack">
      <p style={{ margin: 0 }}><Link to="/universe">← All funds</Link></p>
      <Async state={state} onRetry={reload}>{(detail) => <FundView detail={detail} base={base} />}</Async>
    </div>
  );
}

function FundView({ detail, base }: { detail: Schemas['FundDetail']; base: string }) {
  const f = detail.fund;
  const rows = useMemo(() => detail.history.map((p) => ({ t: dateMs(p.date), price: p.value })), [detail]);
  const price = (v: number) => money(v, base, 2);
  const facts: Array<[string, string]> = [
    ['ISIN', f.isin],
    ['Asset class', assetClassLabel(f.asset_class)],
    ['Sub-class', f.sub_class ? humanise(f.sub_class) : '–'],
    ['Region', f.region ? humanise(f.region) : '–'],
    ['Sector', f.sector ? humanise(f.sector) : '–'],
    ['TER', percent(f.ter, 2)],
    ['Distribution', f.distribution === 'acc' ? 'Accumulating' : f.distribution === 'dist' ? 'Distributing' : '–'],
    ['Domicile', f.domicile ?? '–'],
    ['Wrapper', f.wrapper.toUpperCase()],
    ['UCITS', f.ucits ? 'Yes' : 'No'],
    ['ESG', f.esg ? 'Yes' : 'No'],
    ['Currency hedged to', f.hedged_to ?? '–'],
    ['Duration', f.duration == null ? '–' : `${decimal(f.duration, 1)} years`],
    ['Index', f.index_name ?? '–'],
    ['Launched', f.inception_date ?? '–'],
  ];

  return (
    <>
      <PageHeader title={f.name} lead={f.issuer ?? undefined} />
      <div className="results-grid grid-2">
        <Card title="Key facts">
          <dl className="kv">
            {facts.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          {f.has_proxy && (
            <p className="muted small">History before launch is filled in from a proxy series when this fund is used in simulations.</p>
          )}
        </Card>
        <Card title="Listings">
          <TableScroll label="Listings, scrolls horizontally on small screens">
            <table className="table">
              <caption className="sr-only">Exchange listings of this fund</caption>
              <thead>
                <tr><th scope="col">Ticker</th><th scope="col">Exchange</th><th scope="col">Currency</th><th scope="col">Primary</th></tr>
              </thead>
              <tbody>
                {detail.listings.map((l) => (
                  <tr key={l.ticker}>
                    <td className="num">{l.ticker}</td><td>{l.exchange}</td><td>{l.currency}</td><td>{l.is_primary ? 'Yes' : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      </div>
      <Card title="Price history">
        <ChartFrame
          title={`Weekly price in ${base}`}
          description={`Line chart of the fund's weekly price in ${base}, from ${rows[0] ? isoMonth(rows[0].t) : 'the start'} to ${rows.length ? isoMonth(rows[rows.length - 1].t) : 'now'}.`}
          table={{ head: ['Month', `Price (${base})`], rows: sampleEvenly(rows, 12).map((r) => [isoMonth(r.t), price(r.price)]) }}
        >
          <TimeChart rows={rows} series={[{ key: 'price', label: 'Price', color: 'var(--series-1)' }]} yFormat={price} />
        </ChartFrame>
      </Card>
    </>
  );
}
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm test`
Expected: no type errors; all tests pass.

Run: `npm run dev:mock`, open `/universe`.
Expected: about 20 funds after "Loading…"; clicking the TER header sorts ascending then descending with the arrow and `aria-sort` changing; clicking a row opens `/universe/<isin>` with facts, listings and a price line chart. (Mock mode ignores the filter parameters: only the request query is verified, by the unit test.) Stop the server.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/charts/universe.ts frontend/src/components/charts/universe.test.ts frontend/src/pages/Universe.tsx frontend/src/pages/UniverseFund.tsx
git commit -m "feat(frontend): universe list and fund detail pages" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Settings drawer

**Files:**
- Create: `frontend/src/components/charts/settingsDraft.ts`
- Test: `frontend/src/components/charts/settingsDraft.test.ts`
- Modify (replace stub): `frontend/src/components/SettingsDrawer.tsx`

**Interfaces:**
- Consumes: `Field` (Task 3), `useRequest`, `Async`-style states, store actions `setSettings` and `load`, `Schemas`.
- Produces:
  - `interface SettingsDraft { model: string; strategy: string; windowYears: string; premiumPct: string; volMinPct: string; volMaxPct: string; mcPaths: string }`
  - `DEFAULT_MODEL = 'capm_multi_asset'`, `DEFAULT_STRATEGY = 'target_vol'`
  - `draftFromSettings(settings: Schemas['EngineSettings'], defaults: Schemas['Defaults']): SettingsDraft`, `validateDraft(d): string | null`, `patchFromDraft(d): Schemas['EngineSettings']`
  - `SettingsDrawer()` (named export, unchanged name, already rendered by `Layout`)

- [ ] **Step 1: Write the failing test**

`frontend/src/components/charts/settingsDraft.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Schemas } from '../../api/client';
import { draftFromSettings, patchFromDraft, validateDraft } from './settingsDraft';

const defaults = {
  vol_range: [0.02, 0.2],
  estimation_window_years: 5,
  mc_paths: 10000,
  markets: { capm_equity: { weights: {}, premium: 0.05 }, capm_multi_asset: { weights: {}, premium: 0.035 } },
} as unknown as Schemas['Defaults'];

describe('draftFromSettings', () => {
  it('falls back to the server defaults for unset settings', () => {
    expect(draftFromSettings({}, defaults)).toEqual({
      model: 'capm_multi_asset', strategy: 'target_vol', windowYears: '5', premiumPct: '', volMinPct: '2', volMaxPct: '20', mcPaths: '10000',
    });
  });
  it('shows explicit settings in percent', () => {
    const d = draftFromSettings(
      { strategy: 'hrp', estimation_window_years: 7, market_premium: 0.04, vol_range: [0.03, 0.15], mc_paths: 5000, expected_return_model: 'capm_equity' },
      defaults,
    );
    expect(d).toEqual({
      model: 'capm_equity', strategy: 'hrp', windowYears: '7', premiumPct: '4', volMinPct: '3', volMaxPct: '15', mcPaths: '5000',
    });
  });
});

describe('patchFromDraft', () => {
  it('converts percent fields back to fractions and a blank premium to null', () => {
    expect(patchFromDraft(draftFromSettings({}, defaults))).toEqual({
      expected_return_model: 'capm_multi_asset',
      strategy: 'target_vol',
      estimation_window_years: 5,
      market_premium: null,
      vol_range: [0.02, 0.2],
      mc_paths: 10000,
    });
    expect(patchFromDraft({ ...draftFromSettings({}, defaults), premiumPct: '3.5' }).market_premium).toBe(0.035);
  });
});

describe('validateDraft', () => {
  const ok = draftFromSettings({}, defaults);
  it('accepts a valid draft', () => {
    expect(validateDraft(ok)).toBeNull();
  });
  it('rejects bad values', () => {
    expect(validateDraft({ ...ok, windowYears: '0' })).toMatch(/window/i);
    expect(validateDraft({ ...ok, windowYears: '2.5' })).toMatch(/window/i);
    expect(validateDraft({ ...ok, premiumPct: '50' })).toMatch(/premium/i);
    expect(validateDraft({ ...ok, volMinPct: '10', volMaxPct: '5' })).toMatch(/volatility/i);
    expect(validateDraft({ ...ok, volMinPct: '0' })).toMatch(/volatility/i);
    expect(validateDraft({ ...ok, mcPaths: '100' })).toMatch(/paths/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/charts/settingsDraft.test.ts`
Expected: FAIL (`Failed to resolve import "./settingsDraft"`).

- [ ] **Step 3: Write `settingsDraft.ts`**

```ts
import type { Schemas } from '../../api/client';

type EngineSettings = Schemas['EngineSettings'];
type Defaults = Schemas['Defaults'];

/** Mirrors the EngineSettings defaults in engine/types.py (GET /api/defaults does not expose these two). */
export const DEFAULT_MODEL = 'capm_multi_asset';
export const DEFAULT_STRATEGY = 'target_vol';

/** Text-field state of the drawer: everything as strings, percentages as typed by the user. */
export interface SettingsDraft {
  model: string;
  strategy: string;
  windowYears: string;
  /** blank = use the model's default premium */
  premiumPct: string;
  volMinPct: string;
  volMaxPct: string;
  mcPaths: string;
}

const pctText = (x: number): string => String(Number((x * 100).toFixed(2)));
const fraction = (pct: string): number => Number((Number(pct) / 100).toFixed(6));

export function draftFromSettings(s: EngineSettings, d: Defaults): SettingsDraft {
  const [vmin, vmax] = s.vol_range ?? d.vol_range;
  return {
    model: s.expected_return_model ?? DEFAULT_MODEL,
    strategy: s.strategy ?? DEFAULT_STRATEGY,
    windowYears: String(s.estimation_window_years ?? d.estimation_window_years),
    premiumPct: s.market_premium == null ? '' : pctText(s.market_premium),
    volMinPct: pctText(vmin),
    volMaxPct: pctText(vmax),
    mcPaths: String(s.mc_paths ?? d.mc_paths),
  };
}

export function validateDraft(d: SettingsDraft): string | null {
  const years = Number(d.windowYears);
  if (!Number.isInteger(years) || years < 1 || years > 20) return 'Estimation window must be a whole number of years from 1 to 20.';
  if (d.premiumPct.trim() !== '') {
    const p = Number(d.premiumPct);
    if (!Number.isFinite(p) || p < 0 || p > 20) return 'Market premium must be between 0% and 20%, or blank for the default.';
  }
  const vmin = Number(d.volMinPct);
  const vmax = Number(d.volMaxPct);
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmin <= 0 || vmax > 100 || vmin >= vmax) {
    return 'Volatility range needs 0% < minimum < maximum ≤ 100%.';
  }
  const paths = Number(d.mcPaths);
  if (!Number.isInteger(paths) || paths < 500 || paths > 100_000) return 'Monte Carlo paths must be a whole number from 500 to 100000.';
  return null;
}

export function patchFromDraft(d: SettingsDraft): EngineSettings {
  return {
    expected_return_model: d.model as EngineSettings['expected_return_model'],
    strategy: d.strategy as EngineSettings['strategy'],
    estimation_window_years: Number(d.windowYears),
    market_premium: d.premiumPct.trim() === '' ? null : fraction(d.premiumPct),
    vol_range: [fraction(d.volMinPct), fraction(d.volMaxPct)],
    mc_paths: Number(d.mcPaths),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/charts/settingsDraft.test.ts && npm run typecheck`
Expected: PASS; no type errors. (If `typecheck` complains that `market_premium: null` or the `as` casts do not match the generated type, adjust only those lines to the generated `EngineSettings` shape.)

- [ ] **Step 5: Replace `components/SettingsDrawer.tsx`**

```tsx
import { useRef, useState } from 'react';
import { api, type Schemas } from '../api/client';
import { Field } from './charts/ChartFrame';
import { useRequest } from './charts/hooks';
import { ErrorBox, Loading } from './charts/Status';
import {
  draftFromSettings, patchFromDraft, validateDraft, type SettingsDraft,
} from './charts/settingsDraft';
import { percent } from './charts/format';
import { useStore } from '../state/store';
import { Button } from './ui';
import './charts/results.css';

const MODELS = [
  { value: 'capm_multi_asset', label: 'Multi-asset CAPM (stocks and bonds market)' },
  { value: 'capm_equity', label: 'Equity-only CAPM' },
];
const STRATEGIES = [
  { value: 'target_vol', label: 'Target volatility (default)' },
  { value: 'min_variance', label: 'Minimum variance' },
  { value: 'max_sharpe', label: 'Maximum Sharpe ratio' },
  { value: 'risk_parity', label: 'Risk parity' },
  { value: 'hrp', label: 'Hierarchical risk parity' },
];

/** Nav button + modal <dialog> with the advanced EngineSettings. Applying dispatches `setSettings`. */
export function SettingsDrawer() {
  const [state, dispatch] = useStore();
  const ref = useRef<HTMLDialogElement>(null);
  const { state: defs, reload } = useRequest<Schemas['Defaults']>((signal) => api.GET('/api/defaults', { signal }), 'defaults');
  const [edited, setEdited] = useState<SettingsDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defaults = defs.status === 'ok' ? defs.data : null;
  const draft = edited ?? (defaults ? draftFromSettings(state.settings, defaults) : null);
  const patch = (p: Partial<SettingsDraft>) => draft && setEdited({ ...draft, ...p });
  const modelPremium = defaults?.markets[draft?.model ?? '']?.premium;

  const open = () => {
    setEdited(null);
    setError(null);
    ref.current?.showModal();
  };
  const close = () => ref.current?.close();
  const apply = () => {
    if (!draft) return;
    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    dispatch({ type: 'setSettings', patch: patchFromDraft(draft) });
    close();
  };
  const reset = () => {
    dispatch({ type: 'load', state: { ...state, settings: {} } });
    setEdited(null);
    setError(null);
  };

  return (
    <>
      <Button type="button" onClick={open} aria-haspopup="dialog">Settings</Button>
      <dialog
        ref={ref} className="drawer" aria-labelledby="settings-title"
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      >
        <form className="drawer-body" onSubmit={(e) => { e.preventDefault(); apply(); }}>
          <h2 id="settings-title">Advanced settings</h2>
          <p className="muted small" style={{ margin: 0 }}>
            These change how the engine builds and tests portfolios. The defaults suit most people.
          </p>

          {defs.status === 'loading' && <Loading />}
          {defs.status === 'error' && <ErrorBox message={defs.message} onRetry={reload} />}

          {draft && (
            <>
              <Field label="Expected return model">
                <select className="input" value={draft.model} onChange={(e) => patch({ model: e.target.value })}>
                  {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
              <Field label="Strategy">
                <select className="input" value={draft.strategy} onChange={(e) => patch({ strategy: e.target.value })}>
                  {STRATEGIES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
              <Field label="Estimation window (years)" hint="How much history is used to estimate risk.">
                <input className="input" type="number" min="1" max="20" step="1" value={draft.windowYears} onChange={(e) => patch({ windowYears: e.target.value })} />
              </Field>
              <Field
                label="Market premium override (% per year)"
                hint={`Leave blank to use the model default${modelPremium == null ? '' : ` (${percent(modelPremium, 1)})`}.`}
              >
                <input className="input" type="number" min="0" max="20" step="0.1" value={draft.premiumPct} onChange={(e) => patch({ premiumPct: e.target.value })} />
              </Field>
              <div className="form-grid">
                <Field label="Volatility at risk 0 (%)">
                  <input className="input" type="number" min="0.5" max="100" step="0.5" value={draft.volMinPct} onChange={(e) => patch({ volMinPct: e.target.value })} />
                </Field>
                <Field label="Volatility at risk 100 (%)">
                  <input className="input" type="number" min="1" max="100" step="0.5" value={draft.volMaxPct} onChange={(e) => patch({ volMaxPct: e.target.value })} />
                </Field>
              </div>
              <Field label="Monte Carlo paths" hint="More paths are smoother but slower (500 to 100000).">
                <input className="input" type="number" min="500" max="100000" step="500" value={draft.mcPaths} onChange={(e) => patch({ mcPaths: e.target.value })} />
              </Field>
            </>
          )}

          {error && <div role="alert" className="banner banner-error">{error}</div>}

          <div className="row">
            <Button type="submit" variant="primary" disabled={!draft}>Apply</Button>
            <Button type="button" onClick={reset}>Reset to defaults</Button>
            <Button type="button" onClick={close}>Close</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test`
Expected: no type errors; all tests pass.

Run: `npm run dev:mock`, open any page.
Expected: a "Settings" button in the nav; clicking it opens the drawer from the right with fields filled from the mock defaults (window 5, volatility 2 and 20, paths 10000, premium blank with hint "(3.5%)"); Escape and the backdrop close it; the form is not reachable behind the backdrop with Tab. Set paths to 100 and Apply: the red error appears and the dialog stays open. Set paths to 5000, Apply: it closes; on `/portfolio` the page reloads. Reopen: the value 5000 persists (also after a browser reload); "Reset to defaults" restores 10000. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/charts/settingsDraft.ts frontend/src/components/charts/settingsDraft.test.ts frontend/src/components/SettingsDrawer.tsx
git commit -m "feat(frontend): advanced settings drawer" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Manual verification in mock mode

**Files:** none (verification only; fix defects in the files that own them, and commit each fix separately).

- [ ] **Step 1: Automated checks**

Run: `cd frontend && npm run typecheck && npm test && npm run build`
Expected: no type errors; every test file passes (`format`, `transforms`, `backtestForm`, `universe`, `settingsDraft`, plus Phase 0's `store`); build succeeds.

- [ ] **Step 2: Start the mock app**

Run: `npm run dev:mock` and open `http://localhost:5740/`.
Seed a profile in the browser console, then reload:

```js
localStorage.setItem('roboadvisor.state.v1', JSON.stringify({ profile: { risk_level: 60, horizon_years: 10, base_currency: 'EUR', preferences: {} }, settings: {}, answers: {}, score: null }));
```

- [ ] **Step 3: Work through this checklist (tick each only after seeing it)**

Portfolio (`/portfolio`):
- [ ] With `localStorage.clear()` and reload: empty state with a "Build my portfolio" button to `/start`.
- [ ] With the seeded profile: "Loading…" then the page; the warning banner shows the mock warning.
- [ ] Five stat cards; volatility hint says how it compares with the 8.3% target; cost card reads "Cost per €10,000".
- [ ] Donut legend lists asset classes with weights that sum to 100%; hover shows a tooltip; "View as table" expands.
- [ ] Holdings table: sorted by weight, total row 100.0%, "proxied history" badge on the equity fund, fund name links to `/universe/<isin>`.
- [ ] Downside: bars for −30/−40/−50% with value labels; fan chart shows a median line and two shaded bands with a legend; stress table shows three events, colored negative losses; the paired charts have a two-entry legend and the caption under "Why not just assume a bell curve?" is visible.
- [ ] "How was this built?" is collapsed; expanding shows 8 numbered steps with keys, key/value lists and notes.
- [ ] "Test it historically" navigates to `/backtest`.

Backtest (`/backtest`):
- [ ] Default form: static, none, blank dates, 10 bps. Run: button shows "Running…", then the look-ahead banner, four charts, metrics table (benchmark beta/turnover show `–`; max drawdown shows a true minus).
- [ ] Shaded proxy region is visible on the left of each chart with the note under the chart.
- [ ] Choose Walk-forward: Rebalancing becomes Periodic + Frequency Quarterly and "None" is disabled; run: the look-ahead banner is gone.
- [ ] Set cost to 600 and run: inline red error, no request. Set drift threshold 0 with "When weights drift": inline error.
- [ ] Run a second time: "Compare with previous run" checkbox appears; ticking it shows "Run A vs Run B" with both run descriptions and a "B − A" column.
- [ ] "View as table" on each chart lists about 12 sampled rows.

Universe (`/universe`, `/universe/<isin>`):
- [ ] About 20 rows; TER header toggles ascending, descending, with the arrow and missing TERs always last.
- [ ] Typing in Search does not fire a request per keystroke (network panel is not applicable in mock mode; confirm the table does not flicker while typing).
- [ ] Row click and name link both open the fund page once (Back returns to the list in one step).
- [ ] Fund page: key facts, listings table, price chart titled "Weekly price in EUR"; switch to USD by seeding `base_currency: 'USD'` and reload: title says USD.

Settings drawer:
- [ ] Opens from the nav on every page, closes with Escape, backdrop click and Close; focus stays inside while open; Apply with invalid data shows an error; valid Apply re-fetches `/portfolio`; Reset restores defaults.

Responsive and theme:
- [ ] Browser devtools at 360 px width: no horizontal page scroll on any page; the holdings, stress, metrics, universe and listings tables scroll horizontally inside their card; charts shrink to the card width; the drawer fills the screen.
- [ ] Toggle the OS/browser to dark mode: chart lines, bands and text stay readable (colors come from tokens); repeat with `document.documentElement.dataset.theme='dark'` and `'light'`.
- [ ] Console has no errors or React key warnings on any page.

Error handling (real proxy, no backend):
- [ ] Stop the mock server, run `npm run dev` (backend not running), open `/portfolio` with the seeded profile: a red "Something went wrong" box mentions the backend on port 8740 and "Try again" retries. Same for `/universe` and the Settings drawer. Stop the server.

- [ ] **Step 4: Commit any fixes, then finish**

Run: `git status`
Expected: clean tree after fixes are committed (each fix in its own commit, message `fix(frontend): <what>`).

---

## Self-review notes (completed)

- Spec §8.2 coverage: portfolio (summary cards, donut, holdings, drawdown bars, fan, stress, MC vs normal with caption, trace, warnings, empty state, link to backtest) → Task 5; backtest (all controls, walk-forward rule, four charts, proxied shading, look-ahead banner, metrics, compare) → Tasks 6–7; universe and fund detail → Task 8; settings drawer with reset → Task 9; loading/error states → `Async`/`ErrorBox` in Tasks 3, 5, 7, 8, 9; helpers with tests → Tasks 1, 2, 6, 8, 9; manual verification → Task 10.
- Names used across tasks match their definitions: `percent`, `decimal`, `money`, `errorMessage`, `orderedMetricKeys`, `backtestRows`, `proxiedSpans`, `probabilityRows`, `fanRows`, `mixRows`, `sampleEvenly`, `useRequest`, `Async`, `ChartFrame`, `TableScroll`, `Field`, `ChartTip`, `TimeChart`, `PairedBars`, `MetricsTable`, `withMode`, `toBacktestSettings`, `filtersToQuery`, `sortFunds`, `draftFromSettings`.
- Known limits: the mock API ignores filter query parameters and always returns the same backtest/portfolio, so filter behavior and walk-forward differences are only verifiable against the real backend after Phase 2.
