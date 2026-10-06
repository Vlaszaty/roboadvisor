import { describe, expect, it } from 'vitest';
import { cafeCopy, parseLanguage } from './language';
import { BUFFER, EXPERIENCE, MILK, PROFILES, SUGAR } from './recipe';

describe('café language', () => {
  it('defaults to Dutch and validates saved language values', () => {
    expect(parseLanguage(null)).toBe('nl');
    expect(parseLanguage('en')).toBe('en');
    expect(parseLanguage('nl')).toBe('nl');
    expect(parseLanguage('anything')).toBe('nl');
  });
  it('localizes text, numbers, euros, assets and singular/plural years', () => {
    const en = cafeCopy('en'), nl = cafeCopy('nl');
    expect(en.t('Melk', 'Milk')).toBe('Milk');
    expect(nl.t('Melk', 'Milk')).toBe('Melk');
    expect(en.pct(.056)).toBe('5.6%');
    expect(nl.pct(.056)).toBe('5,6%');
    expect(en.eur(10000)).toBe('€10,000');
    expect(en.years(1)).toBe('1 year');
    expect(en.years(10)).toBe('10 years');
    expect(nl.years(1)).toBe('1 jaar');
    expect(en.assetName('equity')).toBe('Equities');
    expect(en.assetName('bond')).toBe('Bonds');
    expect(en.assetName('unknown')).toBe('unknown');
  });
  it('keeps every score and covers every new choice and profile in both languages', () => {
    const en = cafeCopy('en'), nl = cafeCopy('nl');
    expect(en.milk.map(p => p.score)).toEqual(MILK.map(p => p.score));
    expect(en.sugar.map(p => p.score)).toEqual(SUGAR.map(p => p.score));
    expect(en.buffer.map(p => p.score)).toEqual(BUFFER.map(p => p.score));
    for (const copy of [en, nl]) for (const p of [...copy.buffer, ...copy.milk]) expect(p.key).toBeTruthy();
    expect(en.buffer[0].key).toContain('6 months');
    expect(en.brew).toHaveLength(5);
    expect(en.experience.map(p => p.score)).toEqual(EXPERIENCE.map(p => p.score));
    expect(en.profiles.map(p => p.id)).toEqual(PROFILES.map(p => p.id));
    for (const copy of [en, nl]) for (const p of copy.profiles) expect(p.name && p.plain).toBeTruthy();
    expect(en.profiles[3].name).toBe('Balanced');
    expect(nl.profiles[6].name).toBe('Extra sterk');
    expect(en.sugar[4].description).toContain('can lose money');
  });
});
