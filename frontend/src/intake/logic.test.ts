import { describe, expect, it } from 'vitest';
import {
  answersFor, answersKey, back, badYear, cryptoAvailable, deriveOptions, errorMessage, labelFor, limitingText,
  lossProbability, mixRows, next, normalCdf, percentToFraction, profilePatchFromScore, regionMode, riskKey, riskLabel, riskTitle,
  riskNotice, sectorMode, setRegionMode, setSectorMode, stageNumber, START, targetVol, thresholdLabel,
  validateAnswer, validatePreferences, type FundSummary, type Question,
} from './logic';

const single: Question = {
  id: 'drop', text: 'Drop?', type: 'single', feeds: 'tolerance',
  options: [{ label: 'Sell', value: 'sell', points: 0 }, { label: 'Hold', value: 'hold', points: 60 }],
};
const num: Question = { id: 'horizon', text: 'When?', type: 'number', feeds: 'horizon', min: 1, max: 40 };
const qs = [num, single];

describe('validateAnswer', () => {
  it('requires an answer', () => {
    expect(validateAnswer(single, undefined)).toMatch(/choose/i);
    expect(validateAnswer(num, '')).toMatch(/choose|enter/i);
  });
  it('accepts a listed option and rejects an unknown one', () => {
    expect(validateAnswer(single, 'hold')).toBeNull();
    expect(validateAnswer(single, 'nope')).not.toBeNull();
  });
  it('checks number bounds', () => {
    expect(validateAnswer(num, 10)).toBeNull();
    expect(validateAnswer(num, 0)).toMatch(/1 or more/);
    expect(validateAnswer(num, 41)).toMatch(/40 or less/);
    expect(validateAnswer(num, Number.NaN)).toMatch(/number/i);
  });
});

describe('navigation', () => {
  it('stays put when the current answer is invalid', () => {
    expect(next(START, qs, {})).toEqual(START);
  });
  it('walks questions then risk then preferences', () => {
    let nav = next(START, qs, { horizon: 10 });
    expect(nav).toEqual({ stage: 'questions', index: 1 });
    nav = next(nav, qs, { horizon: 10, drop: 'hold' });
    expect(nav).toEqual({ stage: 'risk', index: 0 });
    nav = next(nav, qs, {});
    expect(nav).toEqual({ stage: 'preferences', index: 0 });
    expect(next(nav, qs, {})).toEqual(nav);
  });
  it('walks back the same way', () => {
    expect(back({ stage: 'preferences', index: 0 }, 2)).toEqual({ stage: 'risk', index: 0 });
    expect(back({ stage: 'risk', index: 0 }, 2)).toEqual({ stage: 'questions', index: 1 });
    expect(back({ stage: 'questions', index: 1 }, 2)).toEqual({ stage: 'questions', index: 0 });
    expect(back(START, 2)).toEqual(START);
  });
  it('numbers the stages', () => {
    expect([stageNumber('questions'), stageNumber('risk'), stageNumber('preferences')]).toEqual([1, 2, 3]);
  });
});

describe('answers', () => {
  it('keeps only answers to known questions', () => {
    expect(answersFor(qs, { horizon: 5, stray: 'x' })).toEqual({ horizon: 5 });
  });
  it('builds an order-independent key', () => {
    expect(answersKey({ a: 1, b: 'x' })).toBe(answersKey({ b: 'x', a: 1 }));
    expect(answersKey({ a: 1 })).not.toBe(answersKey({ a: 2 }));
  });
});

describe('risk maths (same formula as the engine)', () => {
  const range: [number, number] = [0.02, 0.2];
  it('maps level linearly onto the volatility range', () => {
    expect(targetVol(0, range)).toBeCloseTo(0.02, 10);
    expect(targetVol(50, range)).toBeCloseTo(0.11, 10);
    expect(targetVol(100, range)).toBeCloseTo(0.2, 10);
    expect(targetVol(150, range)).toBeCloseTo(0.2, 10);
    expect(targetVol(-5, range)).toBeCloseTo(0.02, 10);
  });
  it('estimates a bad year as -1.65 volatilities', () => {
    expect(badYear(0.1)).toBeCloseTo(-0.165, 10);
  });
  it('has a sane normal CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.5)).toBeCloseTo(0.0668, 3);
  });
  it('gives a rough chance of a loss of a given size', () => {
    expect(lossProbability(0.2, 0.3)).toBeCloseTo(0.0668, 3);
    expect(lossProbability(0, 0.3)).toBe(0);
  });
  it('labels levels', () => {
    expect([0, 25, 50, 70, 95].map(riskLabel)).toEqual(['Safe Start', 'Steady Saver', 'Smart Builder', 'Growth Seeker', 'Bold Mover']);
  });
  it('gives each level a key from 1 to 5', () => {
    expect([0, 19, 20, 39, 40, 59, 60, 79, 80, 100].map(riskKey)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(riskKey(-5)).toBe(1);
    expect(riskTitle(59)).toBe('Key 3 \u00b7 Smart Builder');
  });
  it('flags a level far from the suggestion', () => {
    expect(riskNotice(70, 48)).toBe('above');
    expect(riskNotice(30, 48)).toBe('below');
    expect(riskNotice(52, 48)).toBeNull();
  });
  it('explains the limiting factor', () => {
    expect(limitingText('capacity')).toMatch(/finances/i);
    expect(limitingText('tolerance')).toMatch(/comfort/i);
    expect(limitingText('none')).toMatch(/agree/i);
  });
  it('turns a score into a profile patch', () => {
    const score = { capacity: 72, tolerance: 48.4, suggested_risk_level: 48.4, limiting_factor: 'tolerance', mismatch: true, explanation: '', horizon_years: 0 } as const;
    expect(profilePatchFromScore(score)).toEqual({ risk_level: 48, horizon_years: 1 });
  });
});

describe('preference helpers', () => {
  it('reads and writes region modes', () => {
    const p = { regions_include: ['us'], regions_exclude: ['japan'] };
    expect(regionMode(p, 'us')).toBe('include');
    expect(regionMode(p, 'japan')).toBe('exclude');
    expect(regionMode(p, 'em')).toBe('any');
    expect(setRegionMode(p, 'em', 'include')).toEqual({ regions_include: ['us', 'em'], regions_exclude: ['japan'] });
    expect(setRegionMode(p, 'us', 'exclude')).toEqual({ regions_include: [], regions_exclude: ['japan', 'us'] });
    expect(setRegionMode(p, 'japan', 'any')).toEqual({ regions_include: ['us'], regions_exclude: [] });
  });
  it('reads and writes sector modes', () => {
    const p = { sector_tilts: { technology: 0.1, healthcare: 0.05 }, sectors_exclude: ['energy'] };
    expect(sectorMode(p, 'technology')).toBe('tilt10');
    expect(sectorMode(p, 'healthcare')).toBe('tilt5');
    expect(sectorMode(p, 'energy')).toBe('exclude');
    expect(sectorMode(p, 'utilities')).toBe('neutral');
    expect(setSectorMode(p, 'energy', 'tilt5')).toEqual({
      sector_tilts: { technology: 0.1, healthcare: 0.05, energy: 0.05 }, sectors_exclude: [],
    });
    expect(setSectorMode(p, 'technology', 'exclude')).toEqual({
      sector_tilts: { healthcare: 0.05 }, sectors_exclude: ['energy', 'technology'],
    });
    expect(setSectorMode(p, 'healthcare', 'neutral').sector_tilts).toEqual({ technology: 0.1 });
  });
  it('derives options from the universe, leaving out global', () => {
    const funds = [
      { region: 'us', sector: null }, { region: 'global', sector: null }, { region: 'em', sector: 'healthcare' },
      { region: 'us', sector: 'technology' }, { region: null, sector: null },
    ] as unknown as FundSummary[];
    expect(deriveOptions(funds)).toEqual({ regions: ['em', 'us'], sectors: ['healthcare', 'technology'] });
  });
  it('labels keys', () => {
    expect(labelFor('pacific_ex_japan')).toBe('Pacific ex-Japan');
    expect(labelFor('us')).toBe('United States');
    expect(labelFor('real_estate')).toBe('Real estate');
    expect(labelFor('healthcare')).toBe('Healthcare');
  });
  it('gates crypto on the risk level', () => {
    expect(cryptoAvailable(40, 40)).toBe(true);
    expect(cryptoAvailable(39, 40)).toBe(false);
  });
  it('validates preferences', () => {
    expect(validatePreferences({})).toEqual([]);
    expect(validatePreferences({ max_etfs: 2, sector_tilts: { a: 0.05, b: 0.05, c: 0.05 } })[0]).toMatch(/3 sectors/);
    expect(validatePreferences({ sector_tilts: { a: 0.3, b: 0.3 } })[0]).toMatch(/60%/);
    expect(validatePreferences({ max_ter: 0.0001 })[0]).toMatch(/fee cap/i);
  });
  it('converts percent input to a fraction', () => {
    expect(percentToFraction(0.35)).toBe(0.0035);
    expect(percentToFraction(1)).toBe(0.01);
  });
});

describe('errorMessage', () => {
  it('prefers a string detail', () => {
    expect(errorMessage({ error: 'NoData', detail: 'run the ingest' }, 503)).toBe('run the ingest');
  });
  it('flattens FastAPI validation errors', () => {
    const err = { detail: [{ loc: ['body', 'profile', 'risk_level'], msg: 'must be <= 100' }] };
    expect(errorMessage(err, 422)).toBe('profile.risk_level: must be <= 100');
  });
  it('falls back to the status', () => {
    expect(errorMessage('', 500)).toBe('The request failed (HTTP 500).');
    expect(errorMessage(undefined)).toBe('The request failed.');
    expect(errorMessage('boom')).toBe('boom');
  });
});

describe('landing helpers', () => {
  it('sorts mix rows and drops zeros', () => {
    expect(mixRows({ bond: 0.4, equity: 0.55, cash: 0, real_estate: 0.05 })).toEqual([
      { key: 'equity', label: 'Equities', weight: 0.55 },
      { key: 'bond', label: 'Bonds', weight: 0.4 },
      { key: 'real_estate', label: 'Real estate', weight: 0.05 },
    ]);
  });
  it('formats thresholds with a true minus', () => {
    expect(thresholdLabel(0.3)).toBe('−30% or worse');
  });
});
