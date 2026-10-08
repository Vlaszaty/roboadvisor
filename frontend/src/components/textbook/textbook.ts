/** Pure transforms from the /api/textbook response to tables, chart series and worked-example text. */
import type { Schemas } from '../../api/client';
import type { ChartTable } from '../charts/ChartFrame';
import { decimal, percent } from '../charts/format';
import type { MixSlice } from '../charts/transforms';
import { makeFmt } from '../../cafe/method';

export type Textbook = Schemas['TextbookPortfolio'];
export type ReturnModel = NonNullable<Schemas['TextbookRequest']['return_model']>;
export type Layer = 'frontier' | 'tangent' | 'split';
export interface XY { x: number; y: number; label?: string }

export type Language = 'nl' | 'en';

/** Language and number formatting of the lesson text. English keeps the main app's formatters (decimal point); Dutch uses a decimal comma. */
export interface TextFmt {
  t: (nl: string, en: string) => string;
  pct: (v: number | null | undefined, digits?: number) => string;
  num: (v: number | null | undefined, digits?: number) => string;
}

export function textFmt(language: Language = 'en'): TextFmt {
  if (language === 'en') return { t: (_nl, en) => en, pct: percent, num: decimal };
  const f = makeFmt('nl');
  const ok = (v: number | null | undefined): v is number => v != null && !Number.isNaN(v);
  return { t: f.t, pct: (v, d) => (ok(v) ? f.pct(v, d) : '–'), num: (v, d) => (ok(v) ? f.num(v, d) : '–') };
}

const BLOCKS_NL: Record<string, string> = {
  'US equities': 'Amerikaanse aandelen',
  'European equities': 'Europese aandelen',
  'Emerging market equities': 'Aandelen opkomende markten',
  'Developed ex-US equities': 'Aandelen ontwikkelde landen buiten de VS',
  'Government bonds': 'Staatsobligaties',
  'Corporate bonds': 'Bedrijfsobligaties',
  'Gold': 'Goud',
  'Real estate': 'Vastgoed',
};
/** The building-block names come from the backend in English; Dutch shows a translation when it knows one. */
export const blockName = (block: string, language: Language = 'en'): string => (language === 'nl' ? BLOCKS_NL[block] ?? block : block);
const riskFreeName = (language: Language) => (language === 'nl' ? 'Geldmarktfonds' : RISK_FREE);

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

export function statsTable(t: Textbook, language: Language = 'en'): ChartTable {
  const f = textFmt(language);
  return {
    head: [f.t('Bouwsteen', 'Building block'), f.t('Fonds', 'Fund'), f.t('Gemiddeld rendement', 'Average return'), f.t('Schommeling', 'Volatility')],
    rows: t.funds.map((x) => [blockName(x.block, language), x.name, f.pct(x.mean_return), f.pct(x.volatility)]),
  };
}

export function correlationRows(t: Textbook, language: Language = 'en'): { head: string[]; rows: Array<{ label: string; cells: number[] }> } {
  const head = t.funds.map((f) => blockName(f.block, language));
  return { head, rows: t.correlation.matrix.map((cells, k) => ({ label: head[k], cells })) };
}

/** Cell background: blue for moving together, orange for moving apart, stronger the further from 0. */
export const corrShade = (v: number): string =>
  `color-mix(in srgb, var(${v >= 0 ? '--series-1' : '--series-2'}) ${Math.round(Math.min(Math.abs(v), 1) * 60)}%, transparent)`;

export function expectedTable(t: Textbook, language: Language = 'en'): ChartTable {
  const x = textFmt(language);
  return {
    head: [x.t('Bouwsteen', 'Building block'), 'Beta', x.t('CAPM-rendement', 'CAPM return'), x.t('Gemiddelde uit het verleden', 'Historical average')],
    rows: t.funds.map((f) => [blockName(f.block, language), x.num(f.beta), x.pct(f.capm_return), x.pct(f.mean_return)]),
  };
}

/** Column of expectedTable the optimiser used. */
export const usedColumn = (t: Textbook): number => (t.inputs.return_model === 'capm' ? 2 : 3);

export function tangentTable(t: Textbook, language: Language = 'en'): ChartTable {
  const w = t.tangent?.weights ?? {};
  const x = textFmt(language);
  return {
    head: [x.t('Bouwsteen', 'Building block'), x.t('Gewicht in de raakportefeuille', 'Weight in the tangent portfolio')],
    rows: t.funds.filter((f) => (w[f.isin] ?? 0) > 0).map((f) => [blockName(f.block, language), x.pct(w[f.isin])]),
  };
}

export function weightSlices(t: Textbook, language: Language = 'en'): MixSlice[] {
  const w = t.portfolio.weights;
  const risky = t.funds.map((f, k) => ({ key: f.isin, label: blockName(f.block, language), value: w[f.isin] ?? 0, color: BLOCK_COLORS[k % BLOCK_COLORS.length] }));
  const rf = t.risk_free_fund;
  return [...risky, { key: rf.isin, label: riskFreeName(language), value: w[rf.isin] ?? 0, color: RISK_FREE_COLOR }].filter((s) => s.value > 0);
}

export function weightsTable(t: Textbook, language: Language = 'en'): ChartTable {
  const x = textFmt(language);
  const names: Record<string, string> = { [t.risk_free_fund.isin]: t.risk_free_fund.name };
  for (const f of t.funds) names[f.isin] = f.name;
  return {
    head: [x.t('Positie', 'Holding'), x.t('Fonds', 'Fund'), x.t('Gewicht', 'Weight')],
    rows: weightSlices(t, language).map((s) => [s.label, names[s.key], x.pct(s.value)]),
  };
}

// ---------- chart series (percent units) ----------

/** Fraction -> percent without floating-point tails (0.07 * 100 is 7.000000000000001). */
const pc = (v: number): number => Number((v * 100).toFixed(4));
const xy = (p: { volatility: number; expected_return: number }, label?: string): XY => ({
  x: pc(p.volatility), y: pc(p.expected_return), ...(label ? { label } : {}),
});

export function chartSeries(t: Textbook, layer: Layer, language: Language = 'en') {
  const x = textFmt(language);
  const tangent = layer !== 'frontier' ? t.tangent : null;
  return {
    funds: t.funds.map((f) => xy({ volatility: f.volatility, expected_return: f.expected_return }, blockName(f.block, language))),
    frontier: t.frontier.map((p) => xy(p)).sort((a, b) => a.x - b.x || a.y - b.y),
    riskFree: layer === 'frontier' ? [] : [{ x: 0, y: pc(t.inputs.rf), label: riskFreeName(language) }],
    cml: tangent ? t.capital_market_line.map((p) => xy(p)) : [],
    tangent: tangent ? [xy(tangent, x.t('Raakportefeuille', 'Tangent portfolio'))] : [],
    investor: layer === 'split' ? [xy(t.portfolio, x.t('Jouw portefeuille', 'Your portfolio'))] : [],
  };
}

export function chartTable(t: Textbook, layer: Layer, language: Language = 'en'): ChartTable {
  const s = chartSeries(t, layer, language);
  const x = textFmt(language);
  const one = (v: number) => (language === 'en' ? v.toFixed(1) : x.num(v, 1));
  const points = [...s.funds, ...s.riskFree, ...s.tangent, ...s.investor];
  return {
    head: [x.t('Punt', 'Point'), x.t('Schommeling', 'Volatility'), x.t('Verwacht rendement', 'Expected return')],
    rows: points.map((p) => [p.label ?? '', `${one(p.x)}%`, `${one(p.y)}%`]),
  };
}

export function chartDescription(t: Textbook, layer: Layer, language: Language = 'en'): string {
  if (language === 'nl') {
    const nl = `Spreidingsgrafiek van schommeling tegen verwacht rendement, in procenten: de ${t.funds.length} fondsen en de efficiënte grens van hun mixen`;
    if (layer === 'frontier') return `${nl}.`;
    if (!t.tangent) {
      const line = `${nl}, en het geldmarktfonds`;
      return layer === 'tangent' ? `${line}.` : `${line}, met jouw eigen mix bij het geldmarktfonds.`;
    }
    const line = `${nl}, het geldmarktfonds, de kapitaalmarktlijn en de raakportefeuille`;
    return layer === 'tangent' ? `${line}.` : `${line}, en jouw eigen mix op die lijn.`;
  }
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
export function smlSeries(t: Textbook, language: Language = 'en') {
  const { rf, premium } = t.inputs;
  const betas = t.funds.map((f) => f.beta);
  const at = (beta: number): XY => ({ x: beta, y: pc(rf + beta * premium) });
  return {
    line: [at(Math.min(0, ...betas)), at(Math.max(1, ...betas))],
    funds: t.funds.map((f) => ({ x: f.beta, y: pc(f.capm_return), label: blockName(f.block, language) })),
  };
}

// ---------- worked examples ----------

export function exampleStats(t: Textbook, language: Language = 'en'): string {
  const f = t.funds[0];
  const x = textFmt(language);
  const b = blockName(f.block, language);
  if (language === 'nl') {
    return `${b}: het gemiddelde weekrendement is ${x.pct(f.mean_return / WEEKS, 3)}, keer 52 geeft ${x.pct(f.mean_return)} `
      + `per jaar. De standaarddeviatie per week is ${x.pct(f.volatility / Math.sqrt(WEEKS), 3)}, keer √52 geeft ${x.pct(f.volatility)} per jaar.`;
  }
  return `${f.block}: the average weekly return is ${percent(f.mean_return / WEEKS, 3)}, times 52 gives ${percent(f.mean_return)} `
    + `a year. The weekly standard deviation is ${percent(f.volatility / Math.sqrt(WEEKS), 3)}, times √52 gives ${percent(f.volatility)} a year.`;
}

/** Half in each of the first two funds: the mix is less volatile than the average of the two. */
export function exampleCorrelation(t: Textbook, language: Language = 'en'): string {
  const [a, b] = t.funds;
  const x = textFmt(language);
  const [an, bn] = [blockName(a.block, language), blockName(b.block, language)];
  const rho = t.correlation.matrix[0][1];
  const mix = Math.sqrt(0.25 * a.volatility ** 2 + 0.25 * b.volatility ** 2 + 0.5 * rho * a.volatility * b.volatility);
  if (language === 'nl') {
    return `De helft in ${an} (schommeling ${x.pct(a.volatility)}) en de helft in ${bn} (${x.pct(b.volatility)}), met een `
      + `correlatie van ${x.num(rho)}: de mix schommelt ${x.pct(mix)}, tegenover ${x.pct((a.volatility + b.volatility) / 2)} `
      + 'voor het gewone gemiddelde van de twee.';
  }
  return `Half in ${a.block} (volatility ${percent(a.volatility)}) and half in ${b.block} (${percent(b.volatility)}), with a `
    + `correlation of ${decimal(rho)}: the mix has a volatility of ${percent(mix)}, against ${percent((a.volatility + b.volatility) / 2)} `
    + 'for the plain average of the two.';
}

export function exampleExpected(t: Textbook, language: Language = 'en'): string {
  const f = t.funds[0];
  const x = textFmt(language);
  const b = blockName(f.block, language);
  const { rf, premium, return_model } = t.inputs;
  if (return_model === 'capm') return `${b}: ${x.pct(rf)} + ${x.num(f.beta)} × ${x.pct(premium)} = ${x.pct(f.capm_return)}.`;
  return x.t(
    `${b}: het gemiddelde rendement over de periode is ${x.pct(f.mean_return)}; volgens het CAPM zou het ${x.pct(f.capm_return)} zijn.`,
    `${b}: the average return over the window is ${x.pct(f.mean_return)}; the CAPM would say ${x.pct(f.capm_return)}.`,
  );
}

export function exampleFrontier(t: Textbook, language: Language = 'en'): string {
  const x = textFmt(language);
  if (t.frontier.length === 0) return x.t('Voor deze fondsen kon geen grens worden getekend.', 'No frontier could be drawn for these funds.');
  const lowest = Math.min(...t.frontier.map((p) => p.volatility));
  const calmest = t.funds.reduce((a, b) => (b.volatility < a.volatility ? b : a));
  const name = blockName(calmest.block, language);
  return x.t(
    `De mix met het laagste risico schommelt ${x.pct(lowest)}; het rustigste losse fonds, ${name}, schommelt ${x.pct(calmest.volatility)}.`,
    `The lowest-risk mix has a volatility of ${x.pct(lowest)}; the calmest single fund, ${name}, has ${x.pct(calmest.volatility)}.`,
  );
}

export function exampleTangent(t: Textbook, language: Language = 'en'): string {
  const g = t.tangent;
  const x = textFmt(language);
  if (!g) {
    return x.t(
      `Geen enkel fonds levert naar verwachting meer op dan de rente zonder risico van ${x.pct(t.inputs.rf)}, dus er is geen raakportefeuille.`,
      `No fund is expected to earn more than the risk-free rate of ${x.pct(t.inputs.rf)}, so there is no tangent portfolio.`,
    );
  }
  return `(${x.pct(g.expected_return)} − ${x.pct(t.inputs.rf)}) / ${x.pct(g.volatility)} = ${x.num(g.sharpe)}`;
}

export function exampleSplit(t: Textbook, language: Language = 'en'): string {
  const g = t.tangent;
  const x = textFmt(language);
  if (!g) {
    return x.t(
      'Zonder raakportefeuille valt er niets te verdelen: alles gaat naar het geldmarktfonds.',
      'Without a tangent portfolio there is nothing to split: everything goes to the risk-free fund.',
    );
  }
  const { risk_aversion, risky_share_uncapped: raw } = t.split;
  const formula = `y = (${x.pct(g.expected_return)} − ${x.pct(t.inputs.rf)}) / (${x.num(risk_aversion, 1)} × ${x.pct(g.volatility)}²) = ${x.pct(raw, 0)}`;
  if (raw > 1) return x.t(`${formula}, begrensd op 100% omdat dit model niet leent.`, `${formula}, capped at 100% because this model does not borrow.`);
  return `${formula}.`;
}

export function examplePortfolio(t: Textbook, language: Language = 'en'): string {
  const g = t.tangent;
  const x = textFmt(language);
  const { rf } = t.inputs;
  if (!g) {
    return x.t(
      `Alles staat in het geldmarktfonds: het verwachte rendement is de rente zonder risico van ${x.pct(rf)}.`,
      `Everything is in the risk-free fund: the expected return is the risk-free rate of ${x.pct(rf)}.`,
    );
  }
  const y = x.pct(t.split.risky_share, 0);
  return x.t(
    `Verwacht rendement: ${x.pct(rf)} + ${y} × (${x.pct(g.expected_return)} − ${x.pct(rf)}) = ${x.pct(t.portfolio.expected_return)}. `
      + `Schommeling: ${y} × ${x.pct(g.volatility)} = ${x.pct(t.portfolio.volatility)}.`,
    `Expected return: ${x.pct(rf)} + ${y} × (${x.pct(g.expected_return)} − ${x.pct(rf)}) = ${x.pct(t.portfolio.expected_return)}. `
      + `Volatility: ${y} × ${x.pct(g.volatility)} = ${x.pct(t.portfolio.volatility)}.`,
  );
}
