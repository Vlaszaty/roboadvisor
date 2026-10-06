import { beforeEach, describe, expect, it } from 'vitest';
import { addToHistory, HISTORY_KEY, HISTORY_MAX, loadHistory, parseHistory, removeFromHistory, type PastRecipe } from './history';

const order = { base: 'matcha' as const, horizon: 10, buffer: 1, experience: 2, milk: 2, sugar: 2, amount: '', monthly: '' };
const entry = (id: string, o = order): PastRecipe => ({ id, at: '2026-10-06T10:00:00Z', order: o, base: 'matcha', profileId: 4, horizon: 10, paidIn: 10000, middle: 18000, expectedReturn: .06, volatility: .09 });
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); }, removeItem: k => { store.delete(k); }, clear: () => store.clear(), key: () => null, length: 0 } as Storage;
});

describe('café history', () => {
  it('keeps the newest first, replaces the same order and caps the list', () => {
    addToHistory(entry('a'));
    addToHistory(entry('b', { ...order, milk: 1 }));
    expect(loadHistory().map(r => r.id)).toEqual(['b', 'a']);
    addToHistory(entry('c'));
    expect(loadHistory().map(r => r.id)).toEqual(['c', 'b']);
    for (let i = 0; i < HISTORY_MAX + 3; i++) addToHistory(entry(`x${i}`, { ...order, horizon: i + 1 }));
    expect(loadHistory()).toHaveLength(HISTORY_MAX);
    expect(removeFromHistory(loadHistory()[0].id)).toHaveLength(HISTORY_MAX - 1);
  });
  it('drops broken or tampered entries', () => {
    expect(parseHistory('{')).toEqual([]);
    expect(parseHistory(JSON.stringify([{ ...entry('a'), profileId: 9 }, { ...entry('b'), order: { base: 'tea' } }, entry('ok')]))).toHaveLength(1);
    store.set(HISTORY_KEY, 'null');
    expect(loadHistory()).toEqual([]);
  });
});
