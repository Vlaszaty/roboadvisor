import type { Schemas } from '../../api/client';

type Fund = Schemas['FundSummary'];

export interface FundFilters {
  asset_class: string;
  region: string;
  esg: boolean;
  ucits: boolean;
  /** percent per year as typed by the user, e.g. '0.25' */
  max_ter: string;
  q: string;
}

export const emptyFilters: FundFilters = { asset_class: '', region: '', esg: false, ucits: false, max_ter: '', q: '' };

export const ASSET_CLASSES = ['equity', 'bond', 'commodity', 'real_estate', 'cash', 'crypto'];

export const REGIONS: Array<{ value: string; label: string }> = [
  { value: 'global', label: 'Global' },
  { value: 'us', label: 'US' },
  { value: 'europe', label: 'Europe' },
  { value: 'uk', label: 'UK' },
  { value: 'japan', label: 'Japan' },
  { value: 'pacific_ex_japan', label: 'Pacific ex-Japan' },
  { value: 'em', label: 'Emerging markets' },
];

/** Query for GET /api/universe: empty values are omitted (openapi-fetch drops undefined). */
export function filtersToQuery(f: FundFilters): {
  asset_class?: string; region?: string; esg?: boolean; ucits?: boolean; max_ter?: number; q?: string;
} {
  const out: ReturnType<typeof filtersToQuery> = {};
  if (f.asset_class) out.asset_class = f.asset_class;
  if (f.region) out.region = f.region;
  if (f.esg) out.esg = true;
  if (f.ucits) out.ucits = true;
  const ter = Number(f.max_ter);
  if (f.max_ter.trim() !== '' && Number.isFinite(ter) && ter >= 0) out.max_ter = Number((ter / 100).toFixed(6));
  if (f.q.trim()) out.q = f.q.trim();
  return out;
}

export type SortKey = 'name' | 'asset_class' | 'region' | 'ter' | 'inception_date';
export type SortDir = 'asc' | 'desc';

export function sortFunds(funds: readonly Fund[], key: SortKey, dir: SortDir): Fund[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...funds].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1; // missing values last regardless of direction
    if (y == null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return sign * (x - y);
    return sign * String(x).localeCompare(String(y), undefined, { sensitivity: 'base' });
  });
}
