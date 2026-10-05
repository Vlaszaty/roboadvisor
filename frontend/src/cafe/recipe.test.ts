import { describe, expect, it } from 'vitest';
import { amountValue, CAFE_STORAGE_KEY, complete, EMPTY_ORDER, MILK, needsConsent, parseOrder, portfolioRequest, riskLevel, SUGAR, type Order } from './recipe';

const order: Order = { base: 'matcha', horizon: 10, milk: 2, sugar: 2, amount: '10000' };
describe('café recipe', () => {
  it('requires explicit choices, with no silently filled intake answers', () => {
    expect(complete(EMPTY_ORDER)).toBe(false);
    expect(riskLevel(EMPTY_ORDER)).toBeNull();
    expect(() => portfolioRequest(EMPTY_ORDER)).toThrow();
    expect(CAFE_STORAGE_KEY).not.toBe('roboadvisor.state.v1');
  });
  it('maps every combination and never increases risk with more milk or sugar', () => {
    for (let m = 0; m < 5; m++) for (let s = 0; s < 5; s++) {
      const r = riskLevel({ ...order, milk: m, sugar: s })!;
      expect(r).toBe(Math.min(MILK[m].score, SUGAR[s].score));
      if (m < 4) expect(riskLevel({ ...order, milk: m + 1, sugar: s })).toBeLessThanOrEqual(r);
      if (s < 4) expect(riskLevel({ ...order, milk: m, sugar: s + 1 })).toBeLessThanOrEqual(r);
    }
  });
  it('sends only real engine inputs, and keeps amount out of risk calculations', () => {
    const request = portfolioRequest(order);
    expect(request.profile.risk_level).toBe(50);
    expect(request.profile.horizon_years).toBe(10);
    expect(request.profile.preferences?.esg_only).toBe(true);
    expect(portfolioRequest({ ...order, base: 'coffee' }).profile.preferences?.esg_only).toBe(false);
    expect(portfolioRequest({ ...order, amount: '250000' })).toEqual(request);
    expect(request).not.toHaveProperty('answers');
  });
  it('requires explicit exploration consent for no-loss preferences', () => {
    const sweet = { ...order, sugar: 4 };
    expect(needsConsent(sweet)).toBe(true);
    expect(() => portfolioRequest(sweet)).toThrow(/mogelijk verlies/);
    expect(portfolioRequest(sweet, true).profile.risk_level).toBe(0);
  });
  it('validates persisted values and amounts', () => {
    expect(parseOrder(JSON.stringify(order))).toEqual(order);
    expect(parseOrder('null')).toEqual(EMPTY_ORDER);
    expect(parseOrder('{')).toEqual(EMPTY_ORDER);
    expect(parseOrder(JSON.stringify({ base: 'anything', milk: -1, sugar: 5, horizon: 0, amount: 'Infinity' }))).toEqual(EMPTY_ORDER);
    expect(amountValue('10000,5')).toBe(10000.5);
    expect(amountValue('10.000,50')).toBe(10000.5);
    expect(amountValue('10.000')).toBe(10000);
    expect(amountValue('10000.50')).toBe(10000.5);
    expect(amountValue('10,000.50')).toBeNull();
    expect(amountValue('1e6')).toBeNull();
    for (const raw of ['', '-20', 'NaN', 'Infinity', '0', '1000000001']) expect(amountValue(raw)).toBeNull();
    expect(complete({ ...order, horizon: 40.5 })).toBe(false);
  });
});
