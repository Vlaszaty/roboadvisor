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
