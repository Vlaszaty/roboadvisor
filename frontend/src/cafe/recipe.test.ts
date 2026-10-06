import { describe, expect, it } from 'vitest';
import menuMock from '../mocks/menu.json';
import { amountValue, brewStage, BUFFER, CAFE_STORAGE_KEY, complete, EMPTY_ORDER, EXPERIENCE, horizonPoints, HORIZON_STOPS, MILK, nearestStop, nudges, orderRequest, parseOrder, PROFILES, profileFor, scores, SUGAR, type Order } from './recipe';

const order: Order = { base: 'matcha', horizon: 10, buffer: 1, experience: 2, milk: 2, sugar: 2, amount: '10000', monthly: '' };
describe('café recipe', () => {
  it('requires explicit choices, with no silently filled answers', () => {
    expect(complete(EMPTY_ORDER)).toBe(false);
    expect(scores(EMPTY_ORDER)).toBeNull();
    expect(() => orderRequest(EMPTY_ORDER)).toThrow();
    expect(complete({ ...order, experience: null })).toBe(false);
    expect(CAFE_STORAGE_KEY).not.toBe('roboadvisor.state.v1');
  });
  it('mirrors the backend menu profiles exactly', () => {
    expect(menuMock.profiles).toEqual(PROFILES);
    for (let score = 0; score <= 100; score++) {
      const p = profileFor(score);
      expect(score).toBeGreaterThanOrEqual(p.score_min);
      expect(score).toBeLessThanOrEqual(p.score_max);
    }
    expect(profileFor(14.5).id).toBe(1);
  });
  it('scores like the classic questionnaire: capacity and tolerance means, the lower one wins', () => {
    const s = scores(order)!;
    expect(s.capacity).toBeCloseTo((MILK[2].score + horizonPoints(10) + BUFFER[1].score) / 3);
    expect(s.tolerance).toBeCloseTo((SUGAR[2].score + EXPERIENCE[2].score) / 2);
    expect(s.score).toBeCloseTo(Math.min(s.capacity, s.tolerance));
    expect(s.limiting).toBe('capacity'); // capacity 50, tolerance 67.5
    expect(scores({ ...order, buffer: 0, experience: 1 })!.limiting).toBe('tolerance');
    expect(s.profile).toEqual(profileFor(s.score));
    expect(horizonPoints(2)).toBe(0);
    expect(horizonPoints(25)).toBe(100);
  });
  it('never gives a stronger recipe for a more careful answer', () => {
    const fields: [keyof Order, number][] = [['buffer', 2], ['experience', 3], ['milk', 4], ['sugar', 4]];
    for (const [field, max] of fields) for (let i = 0; i < max; i++) {
      const more = scores({ ...order, [field]: i })!.score, less = scores({ ...order, [field]: i + 1 })!.score;
      if (field === 'experience') expect(less).toBeGreaterThanOrEqual(more); // more experience: more tolerance
      else expect(less).toBeLessThanOrEqual(more);
    }
  });
  it('gives the mildest recipe when no loss is accepted', () => {
    const sweet = { ...order, sugar: 4, milk: 0, buffer: 0, experience: 3, horizon: 30 };
    expect(scores(sweet)!.profile.id).toBe(1);
    expect(scores(sweet)!.capped).toBe(true);
    expect(orderRequest(sweet).profile_id).toBe(1);
  });
  it('sends only the menu item and amounts; amounts never change the profile', () => {
    const request = orderRequest(order);
    expect(request).toEqual({ base: 'matcha', profile_id: scores(order)!.profile.id, horizon_years: 10, initial_amount: 10000, monthly_amount: 0 });
    expect(orderRequest({ ...order, amount: '250000', monthly: '300' }).profile_id).toBe(request.profile_id);
    expect(orderRequest({ ...order, monthly: '300' }).monthly_amount).toBe(300);
    expect(orderRequest({ ...order, base: 'coffee' }).base).toBe('coffee');
  });
  it('flags no buffer and short horizons', () => {
    expect(nudges(order)).toEqual([]);
    expect(nudges({ ...order, buffer: 2, horizon: 2 })).toEqual(['buffer', 'short']);
  });
  it('maps the brewing slider onto every horizon from 1 to 40 years', () => {
    expect(HORIZON_STOPS[0]).toBe(1);
    expect(HORIZON_STOPS.at(-1)).toBe(40);
    for (let i = 1; i < HORIZON_STOPS.length; i++) expect(HORIZON_STOPS[i]).toBeGreaterThan(HORIZON_STOPS[i - 1]);
    expect(HORIZON_STOPS[nearestStop(10)]).toBe(10);
    expect(HORIZON_STOPS[nearestStop(27)]).toBe(25);
    expect([1, 2, 3, 5, 6, 10, 11, 20, 21, 40].map(brewStage)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    for (const y of [2, 5, 10, 20, 21]) expect(brewStage(y)).toBe([0, 25, 50, 75, 100].indexOf(horizonPoints(y)));
  });
  it('validates persisted values and amounts', () => {
    expect(parseOrder(JSON.stringify(order))).toEqual(order);
    expect(parseOrder(JSON.stringify({ base: 'coffee', milk: 1 }))).toEqual({ ...EMPTY_ORDER, base: 'coffee', milk: 1 });
    expect(parseOrder('null')).toEqual(EMPTY_ORDER);
    expect(parseOrder('{')).toEqual(EMPTY_ORDER);
    expect(parseOrder(JSON.stringify({ base: 'anything', milk: -1, sugar: 5, buffer: 3, debt: 2, experience: 9, horizon: 0, amount: 'Infinity', monthly: '-5' }))).toEqual(EMPTY_ORDER);
    expect(amountValue('10000,5')).toBe(10000.5);
    expect(amountValue('10.000,50')).toBe(10000.5);
    expect(amountValue('10,000.50')).toBe(10000.5);
    expect(amountValue('1.000.000,50')).toBe(1000000.5);
    for (const malformed of ['10,00.50', '10.00,50', '1,00,000', '1.00.000', '1,000.000,50']) expect(amountValue(malformed)).toBeNull();
    for (const raw of ['', '-20', 'NaN', 'Infinity', '0', '1000000001', '1e6']) expect(amountValue(raw)).toBeNull();
    expect(amountValue('2000000', 1_000_000)).toBeNull();
    expect(complete({ ...order, horizon: 40.5 })).toBe(false);
  });
});
