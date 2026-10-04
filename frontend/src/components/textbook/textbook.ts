/** Pure transforms from the /api/textbook response to tables, chart series and worked-example text. */
import type { Schemas } from '../../api/client';
import type { ChartTable } from '../charts/ChartFrame';
import { decimal, percent } from '../charts/format';
import type { MixSlice } from '../charts/transforms';

export type Textbook = Schemas['TextbookPortfolio'];
export type ReturnModel = NonNullable<Schemas['TextbookRequest']['return_model']>;
export type Layer = 'frontier' | 'tangent' | 'split';
export interface XY { x: number; y: number; label?: string }

const WEEKS = 52;
const MAX_PREMIUM_PCT = 15;
const RISK_FREE = 'Risk-free fund';
const BLOCK_COLORS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)',
  'var(--accent)',
];
const RISK_FREE_COLOR = 'var(--ink-3)';

/** premiumPct is the percent typed by the user; NaN (empty or invalid input) leaves the field out. */
export function textbookRequest(
  base: Schemas['InvestorProfile']['base_currency'], riskLevel: number, model: ReturnModel, premiumPct: number,
): Schemas['TextbookRequest'] {
  const body: Schemas['TextbookRequest'] = { base_currency: base, risk_level: riskLevel, return_model: model };
  if (!Number.isNaN(premiumPct)) body.market_premium = Math.min(Math.max(premiumPct, 0), MAX_PREMIUM_PCT) / 100;
  return body;
}

// ---------- tables ----------

export function statsTable(t: Textbook): ChartTable {
  return {
    head: ['Building block', 'Fund', 'Average return', 'Volatility'],
    rows: t.funds.map((f) => [f.block, f.name, percent(f.mean_return), percent(f.volatility)]),
  };
}

export function correlationRows(t: Textbook): { head: string[]; rows: Array<{ label: string; cells: number[] }> } {
  const head = t.funds.map((f) => f.block);
  return { head, rows: t.correlation.matrix.map((cells, k) => ({ label: head[k], cells })) };
}

/** Cell background: blue for moving together, orange for moving apart, stronger the further from 0. */
export const corrShade = (v: number): string =>
  `color-mix(in srgb, var(${v >= 0 ? '--series-1' : '--series-2'}) ${Math.round(Math.min(Math.abs(v), 1) * 60)}%, transparent)`;

export function expectedTable(t: Textbook): ChartTable {
  return {
    head: ['Building block', 'Beta', 'CAPM return', 'Historical average'],
    rows: t.funds.map((f) => [f.block, decimal(f.beta), percent(f.capm_return), percent(f.mean_return)]),
  };
}

/** Column of expectedTable the optimiser used. */
export const usedColumn = (t: Textbook): number => (t.inputs.return_model === 'capm' ? 2 : 3);

export function tangentTable(t: Textbook): ChartTable {
  const w = t.tangent?.weights ?? {};
  return {
    head: ['Building block', 'Weight in the tangent portfolio'],
    rows: t.funds.filter((f) => (w[f.isin] ?? 0) > 0).map((f) => [f.block, percent(w[f.isin])]),
  };
}

export function weightSlices(t: Textbook): MixSlice[] {
  const w = t.portfolio.weights;
  const risky = t.funds.map((f, k) => ({ key: f.isin, label: f.block, value: w[f.isin] ?? 0, color: BLOCK_COLORS[k % BLOCK_COLORS.length] }));
  const rf = t.risk_free_fund;
  return [...risky, { key: rf.isin, label: RISK_FREE, value: w[rf.isin] ?? 0, color: RISK_FREE_COLOR }].filter((s) => s.value > 0);
}

export function weightsTable(t: Textbook): ChartTable {
  const names: Record<string, string> = { [t.risk_free_fund.isin]: t.risk_free_fund.name };
  for (const f of t.funds) names[f.isin] = f.name;
  return {
    head: ['Holding', 'Fund', 'Weight'],
    rows: weightSlices(t).map((s) => [s.label, names[s.key], percent(s.value)]),
  };
}

// ---------- chart series (percent units) ----------

/** Fraction -> percent without floating-point tails (0.07 * 100 is 7.000000000000001). */
const pc = (v: number): number => Number((v * 100).toFixed(4));
const xy = (p: { volatility: number; expected_return: number }, label?: string): XY => ({
  x: pc(p.volatility), y: pc(p.expected_return), ...(label ? { label } : {}),
});

export function chartSeries(t: Textbook, layer: Layer) {
  const tangent = layer !== 'frontier' ? t.tangent : null;
  return {
    funds: t.funds.map((f) => xy({ volatility: f.volatility, expected_return: f.expected_return }, f.block)),
    frontier: t.frontier.map((p) => xy(p)).sort((a, b) => a.x - b.x || a.y - b.y),
    riskFree: layer === 'frontier' ? [] : [{ x: 0, y: pc(t.inputs.rf), label: RISK_FREE }],
    cml: tangent ? t.capital_market_line.map((p) => xy(p)) : [],
    tangent: tangent ? [xy(tangent, 'Tangent portfolio')] : [],
    investor: layer === 'split' ? [xy(t.portfolio, 'Your portfolio')] : [],
  };
}

export function chartTable(t: Textbook, layer: Layer): ChartTable {
  const s = chartSeries(t, layer);
  const points = [...s.funds, ...s.riskFree, ...s.tangent, ...s.investor];
  return {
    head: ['Point', 'Volatility', 'Expected return'],
    rows: points.map((p) => [p.label ?? '', `${p.x.toFixed(1)}%`, `${p.y.toFixed(1)}%`]),
  };
}

export function chartDescription(t: Textbook, layer: Layer): string {
  const base = `Scatter chart of volatility against expected return, in percent: the ${t.funds.length} funds and the efficient frontier of their mixes`;
  if (layer === 'frontier') return `${base}.`;
  if (!t.tangent) {
    const line = `${base}, and the risk-free fund`;
    return layer === 'tangent' ? `${line}.` : `${line}, with your own portfolio at the risk-free fund.`;
  }
  const line = `${base}, the risk-free fund, the capital market line and the tangent portfolio`;
  return layer === 'tangent' ? `${line}.` : `${line}, and your own portfolio on that line.`;
}

/** Security market line: beta against CAPM return, from the lowest to the highest beta shown (at least 0 to 1). */
export function smlSeries(t: Textbook) {
  const { rf, premium } = t.inputs;
  const betas = t.funds.map((f) => f.beta);
  const at = (beta: number): XY => ({ x: beta, y: pc(rf + beta * premium) });
  return {
    line: [at(Math.min(0, ...betas)), at(Math.max(1, ...betas))],
    funds: t.funds.map((f) => ({ x: f.beta, y: pc(f.capm_return), label: f.block })),
  };
}

// ---------- worked examples ----------

export function exampleStats(t: Textbook): string {
  const f = t.funds[0];
  return `${f.block}: the average weekly return is ${percent(f.mean_return / WEEKS, 3)}, times 52 gives ${percent(f.mean_return)} `
    + `a year. The weekly standard deviation is ${percent(f.volatility / Math.sqrt(WEEKS), 3)}, times √52 gives ${percent(f.volatility)} a year.`;
}

/** Half in each of the first two funds: the mix is less volatile than the average of the two. */
export function exampleCorrelation(t: Textbook): string {
  const [a, b] = t.funds;
  const rho = t.correlation.matrix[0][1];
  const mix = Math.sqrt(0.25 * a.volatility ** 2 + 0.25 * b.volatility ** 2 + 0.5 * rho * a.volatility * b.volatility);
  return `Half in ${a.block} (volatility ${percent(a.volatility)}) and half in ${b.block} (${percent(b.volatility)}), with a `
    + `correlation of ${decimal(rho)}: the mix has a volatility of ${percent(mix)}, against ${percent((a.volatility + b.volatility) / 2)} `
    + 'for the plain average of the two.';
}

export function exampleExpected(t: Textbook): string {
  const f = t.funds[0];
  const { rf, premium, return_model } = t.inputs;
  if (return_model === 'capm') return `${f.block}: ${percent(rf)} + ${decimal(f.beta)} × ${percent(premium)} = ${percent(f.capm_return)}.`;
  return `${f.block}: the average return over the window is ${percent(f.mean_return)}; the CAPM would say ${percent(f.capm_return)}.`;
}

export function exampleFrontier(t: Textbook): string {
  if (t.frontier.length === 0) return 'No frontier could be drawn for these funds.';
  const lowest = Math.min(...t.frontier.map((p) => p.volatility));
  const calmest = t.funds.reduce((a, b) => (b.volatility < a.volatility ? b : a));
  return `The lowest-risk mix has a volatility of ${percent(lowest)}; the calmest single fund, ${calmest.block}, has ${percent(calmest.volatility)}.`;
}

export function exampleTangent(t: Textbook): string {
  const g = t.tangent;
  if (!g) return `No fund is expected to earn more than the risk-free rate of ${percent(t.inputs.rf)}, so there is no tangent portfolio.`;
  return `(${percent(g.expected_return)} − ${percent(t.inputs.rf)}) / ${percent(g.volatility)} = ${decimal(g.sharpe)}`;
}

export function exampleSplit(t: Textbook): string {
  const g = t.tangent;
  if (!g) return 'Without a tangent portfolio there is nothing to split: everything goes to the risk-free fund.';
  const { risk_aversion, risky_share_uncapped: raw } = t.split;
  const formula = `y = (${percent(g.expected_return)} − ${percent(t.inputs.rf)}) / (${decimal(risk_aversion, 1)} × ${percent(g.volatility)}²) = ${percent(raw, 0)}`;
  if (raw > 1) return `${formula}, capped at 100% because this model does not borrow.`;
  return `${formula}.`;
}

export function examplePortfolio(t: Textbook): string {
  const g = t.tangent;
  const { rf } = t.inputs;
  if (!g) return `Everything is in the risk-free fund: the expected return is the risk-free rate of ${percent(rf)}.`;
  const y = percent(t.split.risky_share, 0);
  return `Expected return: ${percent(rf)} + ${y} × (${percent(g.expected_return)} − ${percent(rf)}) = ${percent(t.portfolio.expected_return)}. `
    + `Volatility: ${y} × ${percent(g.volatility)} = ${percent(t.portfolio.volatility)}.`;
}
