import type { Schemas } from '../api/client';

export const CAFE_STORAGE_KEY = 'roboadvisor.cafe.v1';
export type Base = 'coffee' | 'matcha';
export interface Order {
  base: Base | null;
  horizon: number;
  buffer: number | null; // index into BUFFER: something set aside for a surprise bill
  experience: number | null; // index into EXPERIENCE
  milk: number | null;
  sugar: number | null;
  amount: string; // one-off starting amount, optional
  monthly: string; // monthly amount, optional
}
export interface Preset { name: string; description: string; score: number; }

/** Capacity: can your finances carry losses? Tolerance: are you comfortable with them? Same split as the
 * classic questionnaire (backend/app/intake). Dutch is the source text; English lives in language.tsx. */
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
/** One-year loss each sugar setting accepts (null: more than 30%, or none for extra sweet). */
export const SUGAR_LOSS: readonly (number | null)[] = [null, .3, .2, .1, 0];
/** "Iets achter de hand": could a surprise bill be paid without selling? One light question, no amounts asked. */
export const BUFFER: readonly Preset[] = [
  { name: 'Ruim', description: 'Een onverwachte rekening betaal ik makkelijk.', score: 100 },
  { name: 'Een beetje', description: 'Lukt wel, maar dan is mijn buffer zo goed als op.', score: 50 },
  { name: 'Niets', description: 'Dan zou ik moeten verkopen of lenen.', score: 0 },
];
export const EXPERIENCE: readonly Preset[] = [
  { name: 'Eerste bezoek', description: 'Ik heb nog nooit belegd.', score: 0 },
  { name: 'Een paar keer', description: 'Minder dan 3 jaar ervaring met aandelen, fondsen of ETF’s.', score: 35 },
  { name: 'Vaste gast', description: '3 tot 10 jaar ervaring.', score: 70 },
  { name: 'Stamgast', description: 'Meer dan 10 jaar ervaring, ook door slechte jaren heen.', score: 100 },
];

/** Mirrors backend/app/engine/menu.py PROFILES (checked against the exported menu mock in recipe.test.ts). */
export interface MenuProfile { id: number; key: string; target_volatility: number; score_min: number; score_max: number; }
export const PROFILES: readonly MenuProfile[] = [
  { id: 1, key: 'very_mild', target_volatility: .03, score_min: 0, score_max: 14 },
  { id: 2, key: 'mild', target_volatility: .05, score_min: 15, score_max: 28 },
  { id: 3, key: 'smooth', target_volatility: .07, score_min: 29, score_max: 42 },
  { id: 4, key: 'balanced', target_volatility: .09, score_min: 43, score_max: 57 },
  { id: 5, key: 'rich', target_volatility: .11, score_min: 58, score_max: 71 },
  { id: 6, key: 'strong', target_volatility: .13, score_min: 72, score_max: 85 },
  { id: 7, key: 'extra_strong', target_volatility: .145, score_min: 86, score_max: 100 },
];
export function profileFor(score: number): MenuProfile {
  for (let i = PROFILES.length - 1; i >= 0; i--) if (score >= PROFILES[i].score_min) return PROFILES[i];
  return PROFILES[0];
}

/** Slider stops: every year up to 20, then larger steps, so short horizons get most of the track. */
export const HORIZON_STOPS: readonly number[] = [...Array.from({ length: 20 }, (_, i) => i + 1), 22, 25, 30, 35, 40];
export const nearestStop = (years: number) => HORIZON_STOPS.reduce((best, y, i) => Math.abs(y - years) < Math.abs(HORIZON_STOPS[best] - years) ? i : best, 0);
/** Brew stage for a horizon, in the same bands as horizonPoints: 0 espresso .. 4 home-grown. */
export function brewStage(years: number): number {
  return years <= 2 ? 0 : years <= 5 ? 1 : years <= 10 ? 2 : years <= 20 ? 3 : 4;
}

/** Capacity points for a horizon in whole years: the classic questionnaire's bands. */
export function horizonPoints(years: number): number {
  for (const [upper, points] of [[2, 0], [5, 25], [10, 50], [20, 75]] as const) if (years <= upper) return points;
  return 100;
}

export const EMPTY_ORDER: Order = { base: null, horizon: 10, buffer: null, experience: null, milk: null, sugar: null, amount: '', monthly: '' };

const index = (max: number) => (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
const validPreset = index(4);
const validBuffer = index(BUFFER.length - 1), validExperience = index(EXPERIENCE.length - 1);
const validAmount = (v: unknown) => typeof v === 'string' && (v === '' || amountValue(v) !== null) ? v : '';
export function parseOrder(raw: string | null): Order {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object') return { ...EMPTY_ORDER };
    const v = value as Record<string, unknown>;
    return {
      base: v.base === 'coffee' || v.base === 'matcha' ? v.base : null,
      horizon: typeof v.horizon === 'number' && Number.isInteger(v.horizon) && v.horizon >= 1 && v.horizon <= 40 ? v.horizon : 10,
      buffer: validBuffer(v.buffer) ? v.buffer : null,
      experience: validExperience(v.experience) ? v.experience : null,
      milk: validPreset(v.milk) ? v.milk : null,
      sugar: validPreset(v.sugar) ? v.sugar : null,
      amount: validAmount(v.amount),
      monthly: validAmount(v.monthly),
    };
  } catch { return { ...EMPTY_ORDER }; }
}

export function amountValue(raw: string, max = 1_000_000_000): number | null {
  if (!raw.trim()) return null;
  const value = raw.trim().replace(/\s/g, '');
  const dutchGrouped = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value);
  const englishGrouped = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(value);
  if (!dutchGrouped && !englishGrouped && !/^\d+(?:[.,]\d{1,2})?$/.test(value)) return null;
  const amount = Number(englishGrouped ? value.replace(/,/g, '') : (dutchGrouped ? value.replace(/\./g, '') : value).replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 && amount <= max ? amount : null;
}
export const MONTHLY_MAX = 1_000_000;

export function complete(order: Order): boolean {
  return (order.base === 'coffee' || order.base === 'matcha') && Number.isInteger(order.horizon) && order.horizon >= 1 && order.horizon <= 40
    && validBuffer(order.buffer) && validExperience(order.experience) && validPreset(order.milk) && validPreset(order.sugar);
}

export interface Scores { capacity: number; tolerance: number; score: number; limiting: 'capacity' | 'tolerance' | 'none'; capped: boolean; profile: MenuProfile; }
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** Risk score as in the classic questionnaire: the lower of capacity and tolerance, each the mean of its answers.
 * Extra sweet (no loss accepted) always gives the mildest profile, whatever the other answers. */
export function scores(order: Order): Scores | null {
  if (!complete(order)) return null;
  const capacity = mean([MILK[order.milk!].score, horizonPoints(order.horizon), BUFFER[order.buffer!].score]);
  const tolerance = mean([SUGAR[order.sugar!].score, EXPERIENCE[order.experience!].score]);
  const capped = order.sugar === 4;
  const score = capped ? 0 : Math.min(capacity, tolerance);
  const limiting = Math.abs(capacity - tolerance) < 1e-9 ? 'none' : capacity < tolerance ? 'capacity' : 'tolerance';
  return { capacity, tolerance, score, limiting, capped, profile: profileFor(score) };
}
export function needsConsent(order: Order): boolean { return order.sugar === 4; }

export function orderRequest(order: Order, consent = false): Schemas['OrderRequest'] {
  const s = scores(order);
  if (!s) throw new Error('Maak eerst alle keuzes af.');
  if (needsConsent(order) && !consent) throw new Error('Bevestig dat je alleen een voorbeeld met mogelijk verlies wilt verkennen.');
  return {
    base: order.base!, profile_id: s.profile.id, horizon_years: order.horizon,
    initial_amount: amountValue(order.amount) ?? 0, monthly_amount: amountValue(order.monthly, MONTHLY_MAX) ?? 0,
  };
}

/** Warnings that point to a buffer or a short horizon. Shown, never scored twice. */
export function nudges(order: Order): ('buffer' | 'short')[] {
  const out: ('buffer' | 'short')[] = [];
  if (order.buffer === BUFFER.length - 1) out.push('buffer');
  if (order.horizon <= 2) out.push('short');
  return out;
}

export const ASSET_NAMES: Record<string, string> = { equity: 'Aandelen', bond: 'Obligaties', cash: 'Geldmarkt', commodity: 'Grondstoffen', real_estate: 'Vastgoed', crypto: 'Crypto' };
export const ASSET_COLORS: Record<string, string> = { equity: '#53714c', bond: '#bd7f55', cash: '#d5bd75', commodity: '#888162', real_estate: '#a8747b', crypto: '#736087' };
