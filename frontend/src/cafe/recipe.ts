import type { Schemas } from '../api/client';

export const CAFE_STORAGE_KEY = 'roboadvisor.cafe.v1';
export type Base = 'coffee' | 'matcha';
export interface Order {
  base: Base | null;
  horizon: number;
  milk: number | null;
  sugar: number | null;
  amount: string;
}
export interface Preset { name: string; description: string; score: number; }
export const MILK: readonly Preset[] = [
  { name: 'Zonder melk', description: 'Ik denk grote schommelingen en verliezen financieel te kunnen dragen.', score: 100 },
  { name: 'Een scheutje', description: 'Ik denk flinke schommelingen en verliezen financieel te kunnen dragen.', score: 75 },
  { name: 'Half melk', description: 'Ik heb enige financiële ruimte voor verlies, maar wil voorzichtig blijven.', score: 50 },
  { name: 'Veel melk', description: 'Mijn financiële ruimte voor verlies is beperkt.', score: 25 },
  { name: 'Extra veel', description: 'Ik wil een zeer voorzichtig voorbeeld; ik heb weinig ruimte voor verlies.', score: 0 },
];
export const SUGAR: readonly Preset[] = [
  { name: 'Zonder suiker', description: 'Een verlies van meer dan 30% over één jaar zou ik kunnen accepteren.', score: 100 },
  { name: 'Eén schepje', description: 'Een verlies tot 30% over één jaar zou ik kunnen accepteren.', score: 85 },
  { name: 'Twee schepjes', description: 'Een verlies tot 20% over één jaar zou ik kunnen accepteren.', score: 65 },
  { name: 'Drie schepjes', description: 'Een verlies tot 10% over één jaar zou ik kunnen accepteren.', score: 35 },
  { name: 'Extra zoet', description: 'Ik wil geen verlies accepteren. Ook een zacht beleggingsrecept kan verlies geven.', score: 0 },
];
export const EMPTY_ORDER: Order = { base: null, horizon: 10, milk: null, sugar: null, amount: '' };

const validPreset = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4;
export function parseOrder(raw: string | null): Order {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object') return { ...EMPTY_ORDER };
    const v = value as Record<string, unknown>;
    return {
      base: v.base === 'coffee' || v.base === 'matcha' ? v.base : null,
      horizon: typeof v.horizon === 'number' && Number.isInteger(v.horizon) && v.horizon >= 1 && v.horizon <= 40 ? v.horizon : 10,
      milk: validPreset(v.milk) ? v.milk : null,
      sugar: validPreset(v.sugar) ? v.sugar : null,
      amount: typeof v.amount === 'string' && (v.amount === '' || amountValue(v.amount) !== null) ? v.amount : '',
    };
  } catch { return { ...EMPTY_ORDER }; }
}

export function amountValue(raw: string): number | null {
  if (!raw.trim()) return null;
  const value = raw.trim().replace(/\s/g, '');
  const grouped = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value);
  if (!grouped && !/^\d+(?:[.,]\d{1,2})?$/.test(value)) return null;
  const amount = Number((grouped ? value.replace(/\./g, '') : value).replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000_000 ? amount : null;
}
export function complete(order: Order): boolean {
  return (order.base === 'coffee' || order.base === 'matcha') && validPreset(order.milk) && validPreset(order.sugar)
    && Number.isInteger(order.horizon) && order.horizon >= 1 && order.horizon <= 40;
}
export function riskLevel(order: Order): number | null {
  if (!validPreset(order.milk) || !validPreset(order.sugar)) return null;
  return Math.min(MILK[order.milk].score, SUGAR[order.sugar].score);
}
export function needsConsent(order: Order): boolean { return order.sugar === 4; }
export function recipeExplanation(order: Order): string {
  if (!validPreset(order.milk) || !validPreset(order.sugar)) return 'Kies melk en suiker; dan vinden we jouw receptniveau.';
  const m = MILK[order.milk].score, s = SUGAR[order.sugar].score;
  if (m < s) return 'Je melkkeuze vraagt om meer voorzichtigheid. Die bepaalt de sterkte van dit recept.';
  if (s < m) return 'Je suikerkeuze vraagt om meer zachtheid. Die bepaalt de sterkte van dit recept.';
  return 'Je melk- en suikerkeuze wijzen naar dezelfde sterkte. Een recept in balans.';
}
export function portfolioRequest(order: Order, consent = false): Schemas['PortfolioRequest'] {
  if (!complete(order)) throw new Error('Maak eerst de vier keuzes af.');
  if (needsConsent(order) && !consent) throw new Error('Bevestig dat je alleen een voorbeeld met mogelijk verlies wilt verkennen.');
  return {
    profile: {
      risk_level: riskLevel(order)!, horizon_years: order.horizon, base_currency: 'EUR',
      preferences: { esg_only: order.base === 'matcha', hedge_bonds: true, ucits_only: true, crypto_max: 0,
        regions_include: [], regions_exclude: [], sector_tilts: {}, sectors_exclude: [],
        max_etfs: 10, min_position: 0.03, max_position: 0.4, distribution: 'any', max_ter: null },
    },
    settings: { strategy: 'target_vol', expected_return_model: 'capm_multi_asset' },
  };
}
export const eur = (value: number): string => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
export const pct = (value: number, digits = 1): string => `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: digits }).format(value * 100)}%`;
export const ASSET_NAMES: Record<string, string> = { equity: 'Aandelen', bond: 'Obligaties', cash: 'Geldmarkt', commodity: 'Grondstoffen', real_estate: 'Vastgoed', crypto: 'Crypto' };
export const ASSET_COLORS: Record<string, string> = { equity: '#53714c', bond: '#bd7f55', cash: '#d5bd75', commodity: '#888162', real_estate: '#a8747b', crypto: '#736087' };
