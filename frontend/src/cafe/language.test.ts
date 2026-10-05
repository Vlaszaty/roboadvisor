import { describe, expect, it } from 'vitest';
import { cafeCopy, parseLanguage } from './language';
import { MILK, SUGAR, portfolioRequest, recipeExplanation, type Order } from './recipe';

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
  it('preserves every preset score, request and caution explanation across languages', () => {
    const en = cafeCopy('en');
    expect(en.milk.map(p => p.score)).toEqual(MILK.map(p => p.score));
    expect(en.sugar.map(p => p.score)).toEqual(SUGAR.map(p => p.score));
    const order: Order = { base: 'matcha', horizon: 10, milk: 2, sugar: 2, amount: '10000' };
    const before = portfolioRequest(order);
    expect(recipeExplanation({ ...order, milk: 0, sugar: 0 }, 'en')).toContain('balanced recipe');
    expect(recipeExplanation({ ...order, milk: 4 }, 'en')).toContain('milk choice');
    expect(recipeExplanation({ ...order, sugar: 4 }, 'en')).toContain('sugar choice');
    expect(portfolioRequest(order)).toEqual(before);
    expect(en.sugar[4].description).toContain('can lose money');
  });
});
