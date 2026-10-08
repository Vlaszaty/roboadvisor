/**
 * Pure helpers for the café method page (/cafe/method): a typed reader for the untyped order trace, the funnel
 * table, and the tables and worked examples of the seven steps. Every function takes a `Fmt` (language + number
 * formatting) so the page stays bilingual and the numbers in an example can be reproduced from the numbers next to it.
 */
import type { Schemas } from '../api/client';
import type { ChartTable } from '../components/charts/ChartFrame';
import { MINUS } from '../components/charts/format';
import type { CafeLanguage } from './language';

export type Order = Schemas['Recommendation'];
export type Frontier = Schemas['Frontier'];
export type Base = 'coffee' | 'matcha';

// ---------- formatting ----------

export interface Fmt {
  t: (nl: string, en: string) => string;
  /** 0.0803 -> "8.0%" */
  pct: (v: number, digits?: number) => string;
  /** 1.5945 -> "1.59" */
  num: (v: number, digits?: number) => string;
  /** whole numbers with a thousands separator */
  int: (v: number) => string;
}

export function makeFmt(language: CafeLanguage): Fmt {
  const locale = language === 'en' ? 'en-GB' : 'nl-NL';
  const fixed = (v: number, d: number) => {
    const body = new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false }).format(Math.abs(v));
    return `${v < 0 && Number(Math.abs(v).toFixed(d)) !== 0 ? MINUS : ''}${body}`;
  };
  return {
    t: (nl, en) => (language === 'en' ? en : nl),
    pct: (v, d = 1) => `${fixed(v * 100, d)}%`,
    num: (v, d = 2) => fixed(v, d),
    int: (v) => new Intl.NumberFormat(locale).format(v),
  };
}

// ---------- URL ----------

export const DEFAULT_BASE: Base = 'coffee';
export const DEFAULT_STRENGTH = 4;

/** `?base=matcha&strength=3`; anything invalid falls back to coffee 4 (each value on its own). */
export function parseMethodParams(search: string | URLSearchParams): { base: Base; strength: number } {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const base: Base = q.get('base') === 'matcha' ? 'matcha' : DEFAULT_BASE;
  const raw = q.get('strength');
  const n = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return { base, strength: n >= 1 && n <= 7 ? n : DEFAULT_STRENGTH };
}

export const methodPath = (base: Base, strength: number) => `/cafe/method?base=${base}&strength=${strength}`;

// ---------- typed trace ----------

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const num = (v: unknown, fallback = NaN): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(rec(v))) if (typeof x === 'number') out[k] = x;
  return out;
};

export interface MethodTrace {
  nFunds: number;
  removed: Record<string, number>;
  /** window of the weekly history the engine loaded */
  returns: {
    frequency: string; start: string; end: string; weeks: number; proxied: Record<string, string[]>;
    minHistoryYears: number; shortHistory: string[]; nCandidates: number; anchors: Record<string, string>;
  };
  /** shrinkage: Ledoit-Wolf intensity (0–1); unshrunk: cash funds, which keep their measured variance */
  covariance: { method: string; windowYears: number; weeksUsed: number; isins: string[]; matrix: number[][]; shrinkage: number; unshrunk: string[];
    /** per held fund over the window: total return, best week, worst week */
    windowReturns: Record<string, { total: number; best: number; worst: number }>;
  };
  expected: { rf: number; premium: number; market: Record<string, number>; beta: Record<string, number>; expected: Record<string, number> };
  constraints: { targetVol: number; nCandidates: number; maxEtfs: number; minPosition: number; maxPosition: number; cashMax: number };
  /** free: the same problem without the fund-count and minimum-size rules (null when the engine did not report it) */
  optimize: { achievedVol: number; nHoldings: number; free: { nFunds: number; nBelowMin: number; netReturn: number; recipeNetReturn: number } | null };
}

/** Reads the trace of an order response. Returns null when a step the page needs is missing. */
export function readTrace(order: Order): MethodTrace | null {
  const steps: Record<string, Record<string, unknown>> = {};
  for (const s of order.trace ?? []) steps[s.step] = rec(s.summary);
  const { universe, returns, covariance, expected_returns: er, constraints, optimize } = steps;
  if (!universe || !returns || !covariance || !er || !constraints || !optimize) return null;
  const corr = rec(covariance.correlation);
  const proxied: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rec(returns.proxied))) proxied[k] = Array.isArray(v) ? v.map(String) : [];
  const anchors: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec(returns.anchors))) if (typeof v === 'string') anchors[k] = v;
  return {
    nFunds: num(universe.n_funds),
    removed: numMap(universe.removed),
    returns: {
      frequency: String(returns.frequency ?? ''), start: String(returns.start ?? ''), end: String(returns.end ?? ''),
      weeks: num(returns.weeks), proxied, minHistoryYears: num(returns.min_history_years, 0),
      shortHistory: Array.isArray(returns.short_history_excluded) ? returns.short_history_excluded.map(String) : [],
      nCandidates: num(returns.n_candidates), anchors,
    },
    covariance: {
      method: String(covariance.method ?? ''), windowYears: num(covariance.window_years), weeksUsed: num(covariance.weeks_used),
      isins: Array.isArray(corr.isins) ? corr.isins.map(String) : [],
      shrinkage: num(covariance.shrinkage), unshrunk: Array.isArray(covariance.unshrunk) ? covariance.unshrunk.map(String) : [],
      windowReturns: Object.fromEntries(Object.entries(rec(covariance.window_returns)).map(([k, v]) => [k, { total: num(rec(v).total), best: num(rec(v).best_week), worst: num(rec(v).worst_week) }])),
      matrix: Array.isArray(corr.matrix) ? (corr.matrix as unknown[]).map((row) => (Array.isArray(row) ? row.map((x) => num(x)) : [])) : [],
    },
    expected: { rf: num(er.rf), premium: num(er.premium), market: numMap(er.market), beta: numMap(er.beta), expected: numMap(er.expected) },
    constraints: {
      targetVol: num(constraints.target_vol), nCandidates: num(constraints.n_candidates), maxEtfs: num(constraints.max_etfs),
      minPosition: num(constraints.min_position), maxPosition: num(constraints.max_position), cashMax: num(constraints.cash_max),
    },
    optimize: {
      achievedVol: num(optimize.achieved_vol), nHoldings: num(optimize.n_holdings),
      free: optimize.without_count_rules ? {
        nFunds: num(rec(optimize.without_count_rules).n_funds), nBelowMin: num(rec(optimize.without_count_rules).n_below_min),
        netReturn: num(rec(optimize.without_count_rules).net_return), recipeNetReturn: num(rec(optimize.without_count_rules).recipe_net_return),
      } : null,
    },
  };
}

// ---------- context: names, volatilities, held funds ----------

export interface MethodData {
  order: Order;
  trace: MethodTrace;
  frontier: Frontier | undefined;
  /** held funds, largest weight first */
  held: Order['holdings'];
  name: (isin: string) => string;
  /** model volatility of a candidate fund, once the frontier has arrived */
  vol: (isin: string) => number | undefined;
}

export function buildMethod(order: Order, frontier?: Frontier): MethodData | null {
  const trace = readTrace(order);
  if (!trace) return null;
  const names = new Map<string, string>();
  const vols = new Map<string, number>();
  for (const m of frontier?.markers ?? []) {
    if (!m.key.startsWith('fund:')) continue;
    const isin = m.key.slice(5);
    names.set(isin, m.label);
    vols.set(isin, m.model.volatility);
  }
  for (const h of order.holdings) if (h.name) names.set(h.isin, h.name);
  return {
    order, trace, frontier,
    held: [...order.holdings].sort((a, b) => b.weight - a.weight),
    name: (isin) => names.get(isin) ?? isin,
    vol: (isin) => vols.get(isin),
  };
}

// ---------- step 1: the funnel ----------

const RULES: Array<[string, string, string]> = [
  ['esg', 'Fondsen zonder ESG-label', 'Funds without an ESG label'],
  ['regions_include', 'Fondsen buiten de gekozen regio’s', 'Funds outside the chosen regions'],
  ['regions_exclude', 'Fondsen in uitgesloten regio’s', 'Funds in excluded regions'],
  ['sectors_exclude', 'Fondsen in uitgesloten sectoren', 'Funds in excluded sectors'],
  ['max_ter', 'Te dure fondsen', 'Funds that cost too much'],
  ['distribution', 'Fondsen met een andere uitkeringsvorm', 'Funds with a different payout type'],
  ['crypto', 'Crypto', 'Crypto'],
  ['non_ucits', 'Amerikaanse fondsen die in Europa niet aan particulieren verkocht mogen worden', 'US funds that may not be sold to private investors in Europe'],
  ['not_etf', 'Producten die geen ETF zijn', 'Products that are not ETFs'],
  ['small_funds', 'Te kleine fondsen', 'Funds that are too small'],
  ['hedged_duplicates_and_unlisted', 'Dubbele obligatiefondsen zonder euro-afdekking, en fondsen zonder notering', 'Bond funds without euro hedging that have a hedged twin, and funds with no listing'],
  ['foreign_hedged_bonds', 'Obligatiefondsen afgedekt naar een andere valuta', 'Bond funds hedged to another currency'],
  ['same_index_duplicates', 'Fondsen die dezelfde index volgen als een goedkoper fonds', 'Funds that follow the same index as a cheaper fund'],
];

export const ruleLabel = (key: string, f: Fmt): string => {
  const r = RULES.find(([k]) => k === key);
  return r ? f.t(r[1], r[2]) : key;
};

/**
 * Rows [label, removed, left]: from all funds, through every filter that removed something, then the funds with
 * too little history, then the same-index duplicates (the engine's own order), to the candidates. `left` is the running total
 * computed from the counts; the last row shows the engine's own `n_candidates`.
 */
export function funnelTable(m: MethodData, f: Fmt): { table: ChartTable; left: number } {
  const { nFunds, removed, returns } = m.trace;
  const known = RULES.map(([k]) => k);
  const keys = [...known, ...Object.keys(removed).filter((k) => !known.includes(k)).sort()].filter((k) => k !== 'same_index_duplicates');
  const rows: ChartTable['rows'] = [[f.t('Alle fondsen in de database', 'All funds in the database'), '', f.int(nFunds)]];
  let left = nFunds;
  for (const k of keys) {
    const n = removed[k] ?? 0;
    if (n <= 0) continue;
    left -= n;
    rows.push([ruleLabel(k, f), `−${f.int(n)}`, f.int(left)]);
  }
  const short = returns.shortHistory.length;
  if (short > 0) {
    left -= short;
    rows.push([
      f.t(`Minder dan ${returns.minHistoryYears} jaar geschiedenis, ook met een invaller-index`, `Less than ${returns.minHistoryYears} years of history, even with a stand-in index`),
      `−${f.int(short)}`, f.int(left),
    ]);
  }
  const duplicates = removed.same_index_duplicates ?? 0;
  if (duplicates > 0) {
    left -= duplicates;
    rows.push([ruleLabel('same_index_duplicates', f), `−${f.int(duplicates)}`, f.int(left)]);
  }
  rows.push([f.t('Kandidaten voor de mix', 'Candidates for the mix'), '', f.int(returns.nCandidates)]);
  return { table: { head: [f.t('Filter', 'Filter'), f.t('Eruit', 'Removed'), f.t('Over', 'Left')], rows }, left };
}

export function exampleFunnel(m: MethodData, f: Fmt, base: Base): string {
  const { nFunds, returns } = m.trace;
  const removedTotal = nFunds - returns.nCandidates;
  const biggest = Object.entries(m.trace.removed).sort((a, b) => b[1] - a[1])[0];
  const lead = biggest && biggest[1] > 0
    ? f.t(`Het grootste filter is “${ruleLabel(biggest[0], f)}”: ${f.int(biggest[1])} fondsen eruit. `, `The biggest filter is “${ruleLabel(biggest[0], f)}”: ${f.int(biggest[1])} funds out. `)
    : '';
  return lead + f.t(
    `${f.int(nFunds)} fondsen min ${f.int(removedTotal)} afgevallen = ${f.int(returns.nCandidates)} kandidaten${base === 'matcha' ? ', waaronder het geldmarktfonds, dat geen ESG-label heeft maar toch mee mag' : ''}.`,
    `${f.int(nFunds)} funds minus ${f.int(removedTotal)} dropped = ${f.int(returns.nCandidates)} candidates${base === 'matcha' ? ', including the cash fund, which has no ESG label but may join anyway' : ''}.`,
  );
}

// ---------- step 2: weekly returns ----------

/** Signed percentage with a real minus sign, e.g. "+12.3%" / "−4.5%". */
const signed = (v: number, f: Fmt, digits = 1) => (Number.isFinite(v) ? `${v < 0 ? '−' : '+'}${f.pct(Math.abs(v), digits)}` : '…');

/** Step 2 table: what each held fund did over the window, and since when it has prices of its own. */
export function standInTable(m: MethodData, f: Fmt): ChartTable {
  const { proxied } = m.trace.returns;
  const { windowYears, windowReturns } = m.trace.covariance;
  return {
    head: [
      f.t('Fonds', 'Fund'), f.t(`${windowYears} jaar samen`, `${windowYears} years in total`), f.t('Beste week', 'Best week'),
      f.t('Slechtste week', 'Worst week'), f.t('Eigen koersen vanaf', 'Own prices from'),
    ],
    rows: m.held.map((h) => {
      const p = proxied[h.isin];
      const r = windowReturns[h.isin];
      return [
        m.name(h.isin), r ? signed(r.total, f) : '…', r ? signed(r.best, f) : '…', r ? signed(r.worst, f) : '…',
        p && p[1] ? p[1] : f.t('hele periode', 'whole period'),
      ];
    }),
  };
}

export function exampleReturns(m: MethodData, f: Fmt): string {
  const { windowYears, weeksUsed, windowReturns } = m.trace.covariance;
  const { end } = m.trace.returns;
  const calc = weeksUsed === windowYears * 52 ? `${windowYears} × 52 = ${weeksUsed}` : `${weeksUsed}`;
  // the largest risky holding: a cash fund barely moves, so it shows nothing
  const h = m.held.find((x) => windowReturns[x.isin] && x.asset_class !== 'cash') ?? m.held.find((x) => windowReturns[x.isin]);
  const r = h ? windowReturns[h.isin] : undefined;
  const one = h && r
    ? f.t(
      ` ${m.name(h.isin)} ging in die weken samen ${signed(r.total, f)}; de beste week was ${signed(r.best, f)}, de slechtste ${signed(r.worst, f)}.`,
      ` Over those weeks ${m.name(h.isin)} moved ${signed(r.total, f)} in total; its best week was ${signed(r.best, f)}, its worst ${signed(r.worst, f)}.`,
    )
    : '';
  return f.t(
    `We meten over de laatste ${windowYears} jaar: ${calc} weken, tot ${end}.${one}`,
    `We measure over the last ${windowYears} years: ${calc} weeks, up to ${end}.${one}`,
  );
}

/** First Friday of the measured window: `years` x 52 weeks back from its last Friday. */
export function windowStart(end: string, years: number): string {
  const d = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() - (years * 52 - 1) * 7);
  return d.toISOString().slice(0, 10);
}

/** Step 2 note: what the weekly returns are used for, and where a stand-in index does and does not play a part. */
export function returnsNote(m: MethodData, f: Fmt): string {
  const { proxied, minHistoryYears, end } = m.trace.returns;
  const { windowYears } = m.trace.covariance;
  const start = windowStart(end, windowYears);
  // own prices start after the window opens: the first part of the measured weeks is the stand-in
  const young = m.held.filter((h) => { const p = proxied[h.isin]; return !!p && !!p[1] && start !== '' && p[1] > start; }).length;
  const inWindow = young === 0
    ? f.t(
      `Alle ${m.held.length} fondsen in dit recept hebben over deze ${windowYears} jaar hun eigen koersen: hier speelt geen invaller mee.`,
      `All ${m.held.length} funds in this recipe have prices of their own for these ${windowYears} years: no stand-in is involved here.`,
    )
    : f.t(
      `${young} van de ${m.held.length} fondsen in dit recept ${young === 1 ? 'is' : 'zijn'} jonger dan deze ${windowYears} jaar; voor de eerste weken gebruiken we daar de index die het fonds volgt (de invaller).`,
      `${young} of the ${m.held.length} funds in this recipe ${young === 1 ? 'is' : 'are'} younger than these ${windowYears} years; for the first weeks we use the index the fund follows (the stand-in).`,
    );
  return f.t(
    `Met deze weekrendementen meten we hoe sterk een fonds schommelt en hoe fondsen samen bewegen (stap 3 en 4). Wat een fonds in deze jaren verdiende gebruiken we niet als voorspelling. ${inWindow} De kolom “Eigen koersen vanaf” gaat over iets anders: de slechtweer-simulatie bij je recept kijkt veel verder terug, en daarvoor moet een fonds minstens ${minHistoryYears} jaar geschiedenis hebben. Voor de jaren vóór die datum gebruikt de simulatie de index die het fonds volgt.`,
    `We use these weekly returns to measure how much a fund swings and how funds move together (steps 3 and 4). What a fund earned in these years is not used as a forecast. ${inWindow} The “Own prices from” column is about something else: the bad-weather simulation shown with your recipe looks much further back, and for that a fund needs at least ${minHistoryYears} years of history. For the years before that date the simulation uses the index the fund follows.`,
  );
}

// ---------- step 3: volatility and correlation ----------

export function volatilityTable(m: MethodData, f: Fmt): ChartTable {
  return {
    head: ['#', f.t('Fonds', 'Fund'), f.t('Schommeling per jaar', 'Swing per year')],
    rows: m.held.map((h, i) => {
      const v = m.vol(h.isin);
      return [i + 1, m.name(h.isin), v === undefined ? '…' : f.pct(v)];
    }),
  };
}

/** Correlation rows for the held funds, in the order of `m.held` (the trace lists them largest weight first). */
export function correlationGrid(m: MethodData): { head: string[]; rows: Array<{ label: string; cells: number[] }> } | null {
  const { isins, matrix } = m.trace.covariance;
  const idx = m.held.map((h) => isins.indexOf(h.isin));
  if (idx.some((i) => i < 0) || idx.some((i) => !matrix[i])) return null;
  return {
    head: m.held.map((_, i) => String(i + 1)),
    rows: m.held.map((h, i) => ({ label: `${i + 1} · ${m.name(h.isin)}`, cells: idx.map((j) => matrix[idx[i]][j]) })),
  };
}

export interface MixExample { a: string; b: string; volA: number; volB: number; rho: number; mix: number; average: number }

/** Half in each of the two largest holdings. Inputs are rounded to what is shown, so the result can be redone by hand. */
export function mixExample(m: MethodData): MixExample | null {
  const grid = correlationGrid(m);
  if (!grid || m.held.length < 2) return null;
  // the two largest risky holdings: mixing with cash dilutes the swing but shows nothing about moving differently
  const risky = m.held.map((h, i) => ({ h, i })).filter((x) => x.h.asset_class !== 'cash');
  const [a, b] = risky.length >= 2 ? risky : m.held.map((h, i) => ({ h, i }));
  const ha = a.h, hb = b.h;
  const va = m.vol(ha.isin), vb = m.vol(hb.isin);
  if (va === undefined || vb === undefined) return null;
  const volA = round(va, 3), volB = round(vb, 3), rho = round(grid.rows[a.i].cells[b.i], 2);
  const mix = Math.sqrt(0.25 * volA ** 2 + 0.25 * volB ** 2 + 0.5 * rho * volA * volB);
  return { a: m.name(ha.isin), b: m.name(hb.isin), volA, volB, rho, mix: round(mix, 3), average: round((volA + volB) / 2, 3) };
}

const round = (v: number, digits: number) => Number(v.toFixed(digits));

export function exampleMix(m: MethodData, f: Fmt): string {
  const x = mixExample(m);
  if (!x) {
    return f.t('Zodra de schommeling per fonds binnen is (de eerste keer kan dat even duren), rekenen we hier een voorbeeld uit.', 'As soon as the swing per fund has loaded (the first time can take a moment), a worked example appears here.');
  }
  return f.t(
    `Stel dat je de helft stopt in ${x.a} (schommeling ${f.pct(x.volA)}) en de helft in ${x.b} (${f.pct(x.volB)}), met een correlatie van ${f.num(x.rho)}. De mix schommelt dan ${f.pct(x.mix)}, tegen ${f.pct(x.average)} voor het gewone gemiddelde van de twee.`,
    `Say you put half in ${x.a} (swing ${f.pct(x.volA)}) and half in ${x.b} (${f.pct(x.volB)}), with a correlation of ${f.num(x.rho)}. The mix swings ${f.pct(x.mix)}, against ${f.pct(x.average)} for the plain average of the two.`,
  );
}

// ---------- step 4: expected returns ----------

const ROLE: Record<string, [string, string]> = {
  global_equity: ['wereldwijde aandelen', 'global equities'],
  global_bonds: ['wereldwijde obligaties', 'global bonds'],
};

/** "60% Name (global equities) and 40% Name (global bonds)" */
export function marketText(m: MethodData, f: Fmt): string {
  const { market } = m.trace.expected;
  const { anchors } = m.trace.returns;
  const parts = Object.entries(market).sort((a, b) => b[1] - a[1]).map(([isin, w]) => {
    const role = Object.entries(anchors).find(([, v]) => v === isin)?.[0];
    const r = role ? ROLE[role] : undefined;
    const name = m.name(isin);
    if (r && name === isin) return `${f.pct(w, 0)} ${f.t(r[0], r[1])}`;  // not a candidate, so no name: the role says enough
    return `${f.pct(w, 0)} ${name}${r ? ` (${f.t(r[0], r[1])})` : ''}`;
  });
  return parts.join(f.t(' en ', ' and '));
}

export function expectedTable(m: MethodData, f: Fmt): ChartTable {
  const { beta, expected } = m.trace.expected;
  return {
    head: [f.t('Fonds', 'Fund'), f.t('Beta', 'Beta'), f.t('Verwacht rendement', 'Expected return')],
    rows: m.held.map((h) => [m.name(h.isin), f.num(beta[h.isin] ?? h.beta, 2), f.pct(expected[h.isin] ?? h.expected_return)]),
  };
}

export interface ReturnExample { name: string; rf: number; beta: number; premium: number; extra: number; total: number; exact: number }

/** rf + beta × premium for the largest holding, with every part rounded to what is shown. */
export function returnExample(m: MethodData): ReturnExample | null {
  const h = m.held[0];
  if (!h) return null;
  const { rf, premium, beta, expected } = m.trace.expected;
  const b = beta[h.isin] ?? h.beta;
  const rfR = round(rf * 100, 2), premR = round(premium * 100, 1), betaR = round(b, 3);
  const extra = round(betaR * premR, 2);
  return { name: m.name(h.isin), rf: rfR, beta: betaR, premium: premR, extra, total: round(rfR + extra, 2), exact: (expected[h.isin] ?? h.expected_return) * 100 };
}

export function exampleExpected(m: MethodData, f: Fmt): string {
  const x = returnExample(m);
  if (!x) return '';
  const p = (v: number, d = 2) => f.pct(v / 100, d);
  return f.t(
    `${x.name}: ${p(x.rf)} spaarrente + beta ${f.num(x.beta, 3)} × ${p(x.premium, 1)} marktpremie = ${p(x.rf)} + ${p(x.extra)} = ${p(x.total)} verwacht per jaar.`,
    `${x.name}: ${p(x.rf)} risk-free rate + beta ${f.num(x.beta, 3)} × ${p(x.premium, 1)} market premium = ${p(x.rf)} + ${p(x.extra)} = ${p(x.total)} expected per year.`,
  );
}

// ---------- step 5: house rules ----------

export function rulesTable(m: MethodData, f: Fmt, strength: { id: number; name: string }): ChartTable {
  const c = m.trace.constraints;
  return {
    head: [f.t('Regel', 'Rule'), f.t('Waarde', 'Value')],
    rows: [
      [f.t(`Schommeling (sterkte ${strength.id}, ${strength.name})`, `Swing (strength ${strength.id}, ${strength.name})`), f.t(`hooguit ${f.pct(c.targetVol)} per jaar`, `at most ${f.pct(c.targetVol)} a year`)],
      [f.t('Aantal fondsen in de mix', 'Funds in the mix'), f.t(`hooguit ${c.maxEtfs}`, `at most ${c.maxEtfs}`)],
      [f.t('Deel per fonds', 'Share per fund'), `${f.pct(c.minPosition, 0)} – ${f.pct(c.maxPosition, 0)}`],
      [f.t('Geldmarktfonds (veilig deel)', 'Cash fund (the safe part)'), f.t(`mag tot ${f.pct(c.cashMax, 0)}`, `may go up to ${f.pct(c.cashMax, 0)}`)],
      [f.t('Kandidaten om uit te kiezen', 'Candidates to choose from'), f.int(c.nCandidates)],
    ],
  };
}

export function exampleRules(m: MethodData, f: Fmt, strength: { id: number; name: string }): string {
  const c = m.trace.constraints;
  return f.t(
    `Sterkte ${strength.id} (${strength.name}) betekent: de mix mag hooguit ${f.pct(c.targetVol)} per jaar schommelen. Uit ${f.int(c.nCandidates)} kandidaten kiezen we er hooguit ${c.maxEtfs}, elk tussen ${f.pct(c.minPosition, 0)} en ${f.pct(c.maxPosition, 0)}.`,
    `Strength ${strength.id} (${strength.name}) means the mix may swing at most ${f.pct(c.targetVol)} a year. From ${f.int(c.nCandidates)} candidates we pick at most ${c.maxEtfs}, each between ${f.pct(c.minPosition, 0)} and ${f.pct(c.maxPosition, 0)}.`,
  );
}

// ---------- step 6: the mix ----------

const pctPoints = (v: number) => round(v * 100, 4);

export function weightsTable(m: MethodData, f: Fmt): ChartTable {
  const { expected } = m.trace.expected;
  return {
    head: [f.t('Fonds', 'Fund'), f.t('Deel', 'Share'), f.t('Verwacht', 'Expected'), f.t('Kosten per jaar', 'Cost a year'), f.t('Verwacht na kosten', 'Expected after costs')],
    rows: m.held.map((h) => {
      const mu = expected[h.isin] ?? h.expected_return;
      return [m.name(h.isin), f.pct(h.weight), f.pct(mu, 2), h.ter == null ? f.t('onbekend', 'unknown') : f.pct(h.ter, 2), f.pct(mu - (h.ter ?? 0), 2)];
    }),
  };
}

export function examplePick(m: MethodData, f: Fmt): string {
  const h = m.held[0];
  if (!h) return '';
  const mu = round((m.trace.expected.expected[h.isin] ?? h.expected_return) * 100, 2);
  const ter = round((h.ter ?? 0) * 100, 2);
  const net = round(mu - ter, 2);
  const p = (v: number) => f.pct(v / 100, 2);
  const { achievedVol, nHoldings } = m.trace.optimize;
  const { targetVol } = m.trace.constraints;
  return f.t(
    `${m.name(h.isin)} levert verwacht ${p(mu)} op en kost ${p(ter)} per jaar: ${p(mu)} − ${p(ter)} = ${p(net)} na kosten. De gekozen mix van ${nHoldings} fondsen schommelt ${f.pct(achievedVol)}, bij een doel van ${f.pct(targetVol)}.`,
    `${m.name(h.isin)} is expected to earn ${p(mu)} and costs ${p(ter)} a year: ${p(mu)} − ${p(ter)} = ${p(net)} after costs. The chosen mix of ${nHoldings} funds swings ${f.pct(achievedVol)}, against a target of ${f.pct(targetVol)}.`,
  );
}

export interface ChartPoint { x: number; y: number; label: string }
export interface MethodChartData {
  candidates: ChartPoint[];
  held: ChartPoint[];
  frontier: ChartPoint[];
  recipe: ChartPoint;
  target: number;
}

/** Chart series in percent units; null until the frontier has arrived. */
export function chartData(m: MethodData, f: Fmt): MethodChartData | null {
  const fr = m.frontier;
  if (!fr) return null;
  const heldSet = new Set(m.held.map((h) => h.isin));
  const funds = fr.markers.filter((k) => k.key.startsWith('fund:'));
  const pt = (k: { key: string; label: string; model: { volatility: number; expected_return: number } }): ChartPoint =>
    ({ x: pctPoints(k.model.volatility), y: pctPoints(k.model.expected_return), label: m.name(k.key.slice(5)) });
  return {
    candidates: funds.filter((k) => !heldSet.has(k.key.slice(5))).map(pt),
    held: funds.filter((k) => heldSet.has(k.key.slice(5))).map(pt),
    frontier: fr.model_curve.map((p) => ({ x: pctPoints(p.volatility), y: pctPoints(p.expected_return), label: '' })).sort((a, b) => a.x - b.x || a.y - b.y),
    recipe: { x: pctPoints(m.order.summary.volatility), y: pctPoints(m.order.summary.expected_return), label: f.t('Jouw recept', 'Your recipe') },
    target: pctPoints(m.trace.constraints.targetVol),
  };
}

export function chartDescription(d: MethodChartData, f: Fmt): string {
  const p = (v: number) => f.pct(v / 100);
  return f.t(
    `Spreidingsdiagram van schommeling (horizontaal) tegen verwacht rendement (verticaal), in procenten. Met kleine stippen: ${d.candidates.length + d.held.length} kandidaat-fondsen, waarvan ${d.held.length} in jouw recept. Een lijn toont de beste mixen. Jouw recept ligt bij ${p(d.recipe.x)} schommeling en ${p(d.recipe.y)} verwacht rendement, op de verticale lijn van het doel: ${p(d.target)} schommeling.`,
    `Scatter chart of swing (horizontal) against expected return (vertical), in percent. Small dots: ${d.candidates.length + d.held.length} candidate funds, ${d.held.length} of them in your recipe. A line shows the best mixes. Your recipe sits at ${p(d.recipe.x)} swing and ${p(d.recipe.y)} expected return, on the vertical line of the target: ${p(d.target)} swing.`,
  );
}

// ---------- step 7: what you get ----------

export function shareTable(m: MethodData, f: Fmt): ChartTable {
  return {
    head: [f.t('Fonds', 'Fund'), f.t('Deel van het geld', 'Share of the money'), f.t('Deel van het risico', 'Share of the risk')],
    rows: m.held.map((h) => [m.name(h.isin), f.pct(h.weight), f.pct(h.risk_contribution)]),
  };
}

/** Summary expected_return is before fund costs (the sum of weight × expected return); costs are subtracted here. */
export function netReturn(m: MethodData) {
  const gross = round(m.order.summary.expected_return * 100, 2);
  const cost = round(m.order.summary.weighted_ter * 100, 2);
  return { gross, cost, net: round(gross - cost, 2) };
}

export function exampleResult(m: MethodData, f: Fmt): string {
  const { gross, cost, net } = netReturn(m);
  const p = (v: number) => f.pct(v / 100, 2);
  const top = [...m.held].sort((a, b) => b.risk_contribution - a.risk_contribution)[0];
  const risk = top ? f.t(
    ` ${m.name(top.isin)} is ${f.pct(top.weight, 0)} van het geld maar ${f.pct(top.risk_contribution, 0)} van het risico.`,
    ` ${m.name(top.isin)} is ${f.pct(top.weight, 0)} of the money but ${f.pct(top.risk_contribution, 0)} of the risk.`,
  ) : '';
  return f.t(
    `Verwacht ${p(gross)} per jaar, min ${p(cost)} fondskosten = ${p(net)} na kosten.${risk}`,
    `Expected ${p(gross)} a year, minus ${p(cost)} fund costs = ${p(net)} after costs.${risk}`,
  );
}

/** Step 3 note: how far the measured numbers were pulled, and that the cash fund is left out of it. */
export function shrinkageNote(m: MethodData, f: Fmt): string {
  const { shrinkage, unshrunk } = m.trace.covariance;
  const pulled = Number.isFinite(shrinkage)
    ? f.t(`De gemeten cijfers zijn ${f.pct(shrinkage, 1)} van de weg naar het gemiddelde getrokken (shrinkage). `, `The measured numbers were pulled ${f.pct(shrinkage, 1)} of the way towards the average (shrinkage). `)
    : '';
  if (unshrunk.length === 0) return pulled.trim();
  const held = unshrunk.find((i) => m.held.some((h) => h.isin === i));
  const vol = held === undefined ? undefined : m.vol(held);
  const own = vol === undefined ? '' : f.t(` (${f.pct(vol, 2)} per jaar)`, ` (${f.pct(vol, 2)} a year)`);
  return pulled + f.t(
    `Het geldmarktfonds doet daar niet aan mee: het houdt zijn eigen gemeten schommeling${own}. Het gemiddelde van alle fondsen ligt veel hoger, dus anders zou het veilige deel op papier 2 tot 3% per jaar schommelen, en dat doet het niet.`,
    `The cash fund is left out of that: it keeps its own measured swing${own}. The average of all funds is far higher, so otherwise the safe part would swing 2 to 3% a year on paper, which it does not.`,
  );
}

/** Step 6: why the recipe has so few funds, with what the fund-count rules cost. */
export function fewFundsNote(m: MethodData, f: Fmt): string {
  const { nHoldings, free } = m.trace.optimize;
  const { nCandidates, maxEtfs, minPosition } = m.trace.constraints;
  const lead = f.t(
    `Waarom ${nHoldings} van de ${f.int(nCandidates)} fondsen? Veel kandidaten lijken sterk op elkaar, dus een tweede fonds van dezelfde soort voegt weinig toe. En de huisregels houden het overzichtelijk: hooguit ${maxEtfs} fondsen, geen fonds kleiner dan ${f.pct(minPosition, 0)}.`,
    `Why ${nHoldings} of the ${f.int(nCandidates)} funds? Many candidates are much alike, so a second fund of the same kind adds little. And the house rules keep it manageable: at most ${maxEtfs} funds, none smaller than ${f.pct(minPosition, 0)}.`,
  );
  if (!free || !Number.isFinite(free.netReturn) || !Number.isFinite(free.recipeNetReturn)) return lead;
  const gap = Math.max(0, free.netReturn - free.recipeNetReturn);
  if (gap < 0.00005) {
    return lead + f.t(
      ` Zonder die twee regels zou de beste mix ${free.nFunds} fondsen tellen, waarvan ${free.nBelowMin} kleiner dan ${f.pct(minPosition, 0)}, en naar verwachting vrijwel hetzelfde opleveren (${f.pct(free.netReturn, 2)} per jaar na kosten).`,
      ` Without those two rules the best mix would hold ${free.nFunds} funds, ${free.nBelowMin} of them smaller than ${f.pct(minPosition, 0)}, and be expected to earn practically the same (${f.pct(free.netReturn, 2)} a year after costs).`,
    );
  }
  return lead + f.t(
    ` Zonder die twee regels zou de beste mix ${free.nFunds} fondsen tellen, waarvan ${free.nBelowMin} kleiner dan ${f.pct(minPosition, 0)}, en naar verwachting ${f.pct(gap, 2)} per jaar meer opleveren (${f.pct(free.netReturn, 2)} tegen ${f.pct(free.recipeNetReturn, 2)} na kosten).`,
    ` Without those two rules the best mix would hold ${free.nFunds} funds, ${free.nBelowMin} of them smaller than ${f.pct(minPosition, 0)}, and be expected to earn ${f.pct(gap, 2)} a year more (${f.pct(free.netReturn, 2)} against ${f.pct(free.recipeNetReturn, 2)} after costs).`,
  );
}

/** Step 6: how to read the chart. Single funds above the recipe all swing more than the target allows. */
export function chartReading(d: MethodChartData, f: Fmt): string {
  const higher = [...d.candidates, ...d.held].filter((p) => p.y > d.recipe.y);
  const lead = f.t(
    'Zo lees je de grafiek: elke stip is één fonds in zijn eentje, de ster is jouw mix. Vergelijk de ster met de lijn, niet met de stippen. Binnen de huisregels ligt geen enkele mix boven de lijn.',
    'How to read the chart: each dot is one fund on its own, the star is your mix. Compare the star with the line, not with the dots. Within the house rules no mix lies above the line.',
  );
  if (higher.length === 0) return lead;
  const calmest = Math.min(...higher.map((p) => p.x));
  return lead + f.t(
    ` ${higher.length} fondsen hebben een hoger verwacht rendement dan jouw recept, maar het rustigste daarvan schommelt ${f.pct(calmest / 100)} per jaar${calmest > d.target ? `, meer dan jouw doel van ${f.pct(d.target / 100)}` : ''}. Door fondsen te mixen die verschillend bewegen, komt de ster links van die stippen uit: hetzelfde soort rendement met minder schommeling.`,
    ` ${higher.length} funds have a higher expected return than your recipe, but the calmest of them swings ${f.pct(calmest / 100)} a year${calmest > d.target ? `, more than your target of ${f.pct(d.target / 100)}` : ''}. Mixing funds that move differently puts the star to the left of those dots: the same kind of return with less swing.`,
  );
}

/** Steps 2-4, under the table: the step is calculated for every candidate, the table shows only the picked funds. */
export function shownFundsNote(m: MethodData, f: Fmt): string {
  const n = m.held.length, all = f.int(m.trace.returns.nCandidates);
  return f.t(
    `We rekenen dit uit voor alle ${all} kandidaten. De tabel toont alleen de ${n} fondsen die in jouw recept komen; waarom juist die, lees je in stap 6.`,
    `We calculate this for all ${all} candidates. The table shows only the ${n} funds that end up in your recipe; step 6 explains why those.`,
  );
}
