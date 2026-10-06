import { complete, parseOrder, type Order } from './recipe';

/** Past café recipes, kept only in this browser (localStorage), newest first, at most HISTORY_MAX. */
export const HISTORY_KEY = 'roboadvisor.cafe.history.v1';
export const HISTORY_MAX = 12;

export interface PastRecipe {
  id: string;
  at: string; // ISO time it was served
  order: Order;
  base: 'coffee' | 'matcha';
  profileId: number;
  horizon: number;
  paidIn: number; // what goes in over the horizon (one-off plus monthly), or the EUR 500 example
  middle: number; // middle-case outcome in euros after the horizon
  expectedReturn: number;
  volatility: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function valid(v: unknown): PastRecipe | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const order = parseOrder(JSON.stringify(r.order ?? null));
  if (typeof r.id !== 'string' || typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at)) || !complete(order)) return null;
  if (r.base !== 'coffee' && r.base !== 'matcha') return null;
  if (!isNum(r.profileId) || r.profileId < 1 || r.profileId > 7 || !isNum(r.horizon)) return null;
  if (![r.paidIn, r.middle, r.expectedReturn, r.volatility].every(isNum)) return null;
  return { id: r.id, at: r.at, order, base: r.base, profileId: r.profileId, horizon: r.horizon, paidIn: r.paidIn as number,
    middle: r.middle as number, expectedReturn: r.expectedReturn as number, volatility: r.volatility as number };
}

export function parseHistory(raw: string | null): PastRecipe[] {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(valid).filter((r): r is PastRecipe => r !== null).slice(0, HISTORY_MAX) : [];
  } catch { return []; }
}
export function loadHistory(): PastRecipe[] {
  try { return parseHistory(localStorage.getItem(HISTORY_KEY)); } catch { return []; }
}
function save(list: PastRecipe[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* history is a convenience; ignore */ }
}
/** Adds a recipe at the top. The same order served again replaces its older copy. */
export function addToHistory(entry: PastRecipe, list = loadHistory()): PastRecipe[] {
  const same = (a: Order, b: Order) => JSON.stringify(a) === JSON.stringify(b);
  const next = [entry, ...list.filter(r => !same(r.order, entry.order))].slice(0, HISTORY_MAX);
  save(next);
  return next;
}
export function removeFromHistory(id: string, list = loadHistory()): PastRecipe[] {
  const next = list.filter(r => r.id !== id);
  save(next);
  return next;
}
export function clearHistory(): void { save([]); }
