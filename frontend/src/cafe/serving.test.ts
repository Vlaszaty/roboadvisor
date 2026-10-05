import { describe, expect, it } from 'vitest';
import type { Order } from './recipe';
import { servedSentence, tastePosition } from './serving';

const order: Order = { base: 'matcha', horizon: 10, milk: 2, sugar: 2, amount: '' };
describe('serving presentation', () => {
  it('turns the recipe into one conversational sentence', () => {
    expect(servedSentence(order)).toBe('Alsjeblieft, hier is je matcha met half melk en twee schepjes suiker.');
    expect(servedSentence({ ...order, base: 'coffee', milk: 0, sugar: 0 })).toBe('Alsjeblieft, hier is je koffie zonder melk en zonder suiker.');
    expect(servedSentence({ ...order, milk: 0, sugar: 1 })).toContain('zonder melk en met één schepje suiker');
    expect(servedSentence({ ...order, milk: 4, sugar: 4 })).toContain('met extra veel melk en extra suiker');
    for (let milk = 0; milk < 5; milk++) for (let sugar = 0; sugar < 5; sugar++) {
      expect(servedSentence({ ...order, milk, sugar })).not.toMatch(/undefined| en met zonder/);
    }
  });
  it('never attributes a fixed demo to the selected drink or ingredients', () => {
    expect(servedSentence(order, true)).toBe('Alsjeblieft, een koffie als vast voorbeeld.');
    expect(servedSentence({ ...order, milk: null })).toBe('Alsjeblieft, hier is je matcha.');
  });
  it('uses calculated volatility on the reference scale, clamping only the artwork', () => {
    expect(tastePosition(.02)).toBe(0);
    expect(tastePosition(.11)).toBeCloseTo(.5);
    expect(tastePosition(.20)).toBe(1);
    expect(tastePosition(.01)).toBe(0);
    expect(tastePosition(.35)).toBe(1);
    expect(tastePosition(.15)).toBeGreaterThan(tastePosition(.11));
  });
});
