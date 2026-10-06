import { describe, expect, it } from 'vitest';
import { cafeCopy } from './language';
import { servedSentence, tastePosition } from './serving';

describe('café serving', () => {
  it('names the drink and its menu strength in both languages', () => {
    expect(servedSentence({ source: 'live', profileId: 4, base: 'matcha' }, cafeCopy('en'))).toBe('Here you go: your matcha, balanced (4 of 7).');
    expect(servedSentence({ source: 'live', profileId: 7, base: 'coffee' }, cafeCopy('nl'))).toBe('Alsjeblieft: je koffie, extra sterk (7 van 7).');
    expect(servedSentence({ source: 'fixed', profileId: 4, base: 'coffee' }, cafeCopy('en'))).toContain('fixed example');
  });
  it('places the taste pointer on the 2–20% reference scale', () => {
    expect(tastePosition(.02)).toBe(0);
    expect(tastePosition(.2)).toBe(1);
    expect(tastePosition(.5)).toBe(1);
  });
});
