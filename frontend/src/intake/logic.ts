import type { Schemas } from '../api/client';

export type Question = Schemas['Question'];
export type Preferences = Schemas['Preferences'];
export type IntakeScore = Schemas['IntakeScore'];
export type FundSummary = Schemas['FundSummary'];
export type InvestorProfile = Schemas['InvestorProfile'];

export type AnswerValue = string | number;
export type Answers = Record<string, AnswerValue>;

// ---------- questionnaire validation and navigation ----------

export function validateAnswer(q: Question, value: AnswerValue | undefined): string | null {
  if (value === undefined || value === '') {
    return q.type === 'single' ? 'Please choose an answer to continue.' : 'Please enter a number to continue.';
  }
  if (q.type === 'single') {
    return (q.options ?? []).some((o) => o.value === value) ? null : 'Please choose one of the options.';
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 'Enter a number.';
  if (q.min != null && n < q.min) return `Enter ${q.min} or more.`;
  if (q.max != null && n > q.max) return `Enter ${q.max} or less.`;
  return null;
}

export type Stage = 'questions' | 'risk' | 'preferences';
export interface Nav {
  stage: Stage;
  index: number;
}

export const START: Nav = { stage: 'questions', index: 0 };

export function next(nav: Nav, questions: Question[], answers: Answers): Nav {
  if (nav.stage === 'questions') {
    const q = questions[nav.index];
    if (!q || validateAnswer(q, answers[q.id]) !== null) return nav;
    return nav.index + 1 < questions.length ? { stage: 'questions', index: nav.index + 1 } : { stage: 'risk', index: 0 };
  }
  if (nav.stage === 'risk') return { stage: 'preferences', index: 0 };
  return nav;
}

export function back(nav: Nav, questionCount: number): Nav {
  if (nav.stage === 'preferences') return { stage: 'risk', index: 0 };
  if (nav.stage === 'risk') return { stage: 'questions', index: Math.max(0, questionCount - 1) };
  return nav.index > 0 ? { stage: 'questions', index: nav.index - 1 } : nav;
}

export function stageNumber(stage: Stage): 1 | 2 | 3 {
  return stage === 'questions' ? 1 : stage === 'risk' ? 2 : 3;
}

export function answersFor(questions: Question[], answers: Answers): Answers {
  const out: Answers = {};
  for (const q of questions) if (answers[q.id] !== undefined) out[q.id] = answers[q.id];
  return out;
}

export function answersKey(answers: Answers): string {
  return JSON.stringify(Object.entries(answers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ---------- risk maths ----------

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Same formula as the engine (spec §5.5): vmin + level/100 * (vmax - vmin). */
export function targetVol(level: number, volRange: readonly [number, number]): number {
  const [vmin, vmax] = volRange;
  return vmin + (clamp(level, 0, 100) / 100) * (vmax - vmin);
}

/** Rough "typical bad year": about a 1-in-20 outcome for a normal distribution (1.65 sigma). Ignores expected return. */
export const BAD_YEAR_Z = 1.65;
export const badYear = (vol: number): number => -BAD_YEAR_Z * vol;

/** Standard normal CDF, Abramowitz and Stegun 26.2.17 (error below 1e-7). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** Rough chance that one calendar year loses `threshold` or more (0.3 = 30%), zero drift, normal returns. */
export function lossProbability(vol: number, threshold: number): number {
  return vol <= 0 ? 0 : normalCdf(-threshold / vol);
}

export function riskLabel(level: number): string {
  if (level < 20) return 'Very cautious';
  if (level < 40) return 'Cautious';
  if (level < 60) return 'Balanced';
  if (level < 80) return 'Growth';
  return 'Aggressive';
}

const NOTICE_GAP = 10;
export function riskNotice(level: number, suggested: number): 'above' | 'below' | null {
  if (level - suggested >= NOTICE_GAP) return 'above';
  if (suggested - level >= NOTICE_GAP) return 'below';
  return null;
}

export function limitingText(factor: IntakeScore['limiting_factor']): string {
  switch (factor) {
    case 'capacity':
      return 'Your finances are the limit here, so the suggestion follows what you can afford to lose.';
    case 'tolerance':
      return 'Your comfort with losses is the limit here, so the suggestion follows how much swing you can stomach.';
    default:
      return 'What you can afford and what you are comfortable with agree.';
  }
}

export function profilePatchFromScore(score: IntakeScore): { risk_level: number; horizon_years: number } {
  return {
    risk_level: Math.round(clamp(score.suggested_risk_level, 0, 100)),
    horizon_years: Math.max(1, Math.round(score.horizon_years)),
  };
}

// ---------- preferences ----------

export const PREF_DEFAULTS = {
  hedge_bonds: true,
  esg_only: false,
  max_etfs: 10,
  distribution: 'any' as 'acc' | 'dist' | 'any',
  crypto_max: 0,
};

export type RegionMode = 'any' | 'include' | 'exclude';
type RegionPrefs = Pick<Preferences, 'regions_include' | 'regions_exclude'>;

export function regionMode(p: RegionPrefs, region: string): RegionMode {
  if ((p.regions_include ?? []).includes(region)) return 'include';
  if ((p.regions_exclude ?? []).includes(region)) return 'exclude';
  return 'any';
}

export function setRegionMode(p: RegionPrefs, region: string, mode: RegionMode): Required<RegionPrefs> {
  const inc = (p.regions_include ?? []).filter((r) => r !== region);
  const exc = (p.regions_exclude ?? []).filter((r) => r !== region);
  if (mode === 'include') inc.push(region);
  if (mode === 'exclude') exc.push(region);
  return { regions_include: inc, regions_exclude: exc };
}

export type SectorMode = 'neutral' | 'tilt5' | 'tilt10' | 'exclude';
type SectorPrefs = Pick<Preferences, 'sector_tilts' | 'sectors_exclude'>;
const TILT_WEIGHT = { tilt5: 0.05, tilt10: 0.1 } as const;

export function sectorMode(p: SectorPrefs, sector: string): SectorMode {
  if ((p.sectors_exclude ?? []).includes(sector)) return 'exclude';
  const w = (p.sector_tilts ?? {})[sector];
  if (w === undefined) return 'neutral';
  return w >= 0.075 ? 'tilt10' : 'tilt5';
}

export function setSectorMode(p: SectorPrefs, sector: string, mode: SectorMode): Required<SectorPrefs> {
  const tilts = { ...(p.sector_tilts ?? {}) };
  delete tilts[sector];
  const exc = (p.sectors_exclude ?? []).filter((s) => s !== sector);
  if (mode === 'tilt5' || mode === 'tilt10') tilts[sector] = TILT_WEIGHT[mode];
  if (mode === 'exclude') exc.push(sector);
  return { sector_tilts: tilts, sectors_exclude: exc };
}

export function deriveOptions(funds: FundSummary[]): { regions: string[]; sectors: string[] } {
  const regions = new Set<string>();
  const sectors = new Set<string>();
  for (const f of funds) {
    if (f.region && f.region !== 'global') regions.add(f.region);
    if (f.sector) sectors.add(f.sector);
  }
  return { regions: [...regions].sort(), sectors: [...sectors].sort() };
}

const LABELS: Record<string, string> = {
  us: 'United States', uk: 'United Kingdom', em: 'Emerging markets', europe: 'Europe', japan: 'Japan',
  pacific_ex_japan: 'Pacific ex-Japan', equity: 'Equities', bond: 'Bonds', commodity: 'Commodities',
  real_estate: 'Real estate', cash: 'Cash', crypto: 'Crypto',
};

export function labelFor(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const cryptoAvailable = (level: number, minLevel: number): boolean => level >= minLevel;

export function validatePreferences(p: Preferences): string[] {
  const errors: string[] = [];
  const tilts = Object.values(p.sector_tilts ?? {});
  const maxEtfs = p.max_etfs ?? PREF_DEFAULTS.max_etfs;
  if (tilts.length > maxEtfs) {
    errors.push(`You tilt toward ${tilts.length} sectors but allow only ${maxEtfs} funds. Raise the fund limit or remove a tilt.`);
  }
  const total = tilts.reduce((a, b) => a + b, 0);
  if (total > 0.5) {
    errors.push(`Sector tilts add up to ${Math.round(total * 100)}%, which leaves too little for the rest of the portfolio. Keep them at or below 50%.`);
  }
  if (p.max_ter != null && p.max_ter < 0.0005) {
    errors.push('The fee cap is below 0.05%, which almost no fund meets. Raise it or turn it off.');
  }
  return errors;
}

/** The form shows fees in percent (0.35), the API wants a fraction (0.0035). */
export const percentToFraction = (x: number): number => Math.round(x * 1e6) / 1e8;

// ---------- API errors ----------

export function errorMessage(error: unknown, status?: number): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object' && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail)) {
      const parts = detail.map((d) => {
        if (d && typeof d === 'object' && 'msg' in d) {
          const loc = (d as { loc?: unknown }).loc;
          const where = Array.isArray(loc) ? loc.filter((x) => x !== 'body').join('.') : '';
          const msg = String((d as { msg: unknown }).msg);
          return where ? `${where}: ${msg}` : msg;
        }
        return String(d);
      });
      if (parts.length) return parts.join('; ');
    }
  }
  return status ? `The request failed (HTTP ${status}).` : 'The request failed.';
}

// ---------- landing page ----------

export function mixRows(mix: Record<string, number>): { key: string; label: string; weight: number }[] {
  return Object.entries(mix)
    .filter(([, w]) => w > 0)
    .map(([key, weight]) => ({ key, label: labelFor(key), weight }))
    .sort((a, b) => b.weight - a.weight);
}

export const thresholdLabel = (t: number): string => `−${Math.round(t * 100)}% or worse`;

/** Profile behind the landing page example (a balanced ten-year investor). */
export const DEMO_PROFILE: InvestorProfile = {
  risk_level: 50,
  horizon_years: 10,
  base_currency: 'EUR',
  preferences: {},
};
