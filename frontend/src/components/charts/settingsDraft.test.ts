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
