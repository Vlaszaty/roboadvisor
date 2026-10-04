import { describe, expect, it } from 'vitest';
import type { Schemas } from '../../api/client';
import { emptyFilters, filterFundsLocal, filtersToQuery, pageCount, pageItems, pageWindow, sortFunds } from './universe';

const fund = (over: Partial<Schemas['FundSummary']>): Schemas['FundSummary'] => ({
  isin: 'X', name: 'X', issuer: null, asset_class: 'equity', sub_class: null, region: null, sector: null, esg: false,
  ter: null, domicile: null, ucits: true, wrapper: 'etf', distribution: null, hedged_to: null, duration: null,
  index_name: null, inception_date: null, has_proxy: false, tickers: [], ...over,
});

describe('filtersToQuery', () => {
  it('omits empty filters', () => {
    expect(filtersToQuery(emptyFilters)).toEqual({});
  });
  it('converts percent TER to a fraction, trims the search and only sends true flags', () => {
    expect(filtersToQuery({ ...emptyFilters, asset_class: 'bond', max_ter: '0.25', esg: true, q: ' msci ' })).toEqual({
      asset_class: 'bond', esg: true, max_ter: 0.0025, q: 'msci',
    });
  });
  it('ignores an unparsable TER', () => {
    expect(filtersToQuery({ ...emptyFilters, max_ter: 'abc' })).toEqual({});
  });
});

describe('sortFunds', () => {
  const funds = [
    fund({ isin: 'A', name: 'beta fund', ter: 0.002 }),
    fund({ isin: 'B', name: 'Alpha fund', ter: null }),
    fund({ isin: 'C', name: 'Gamma fund', ter: 0.001 }),
  ];
  it('sorts strings case-insensitively', () => {
    expect(sortFunds(funds, 'name', 'asc').map((f) => f.isin)).toEqual(['B', 'A', 'C']);
    expect(sortFunds(funds, 'name', 'desc').map((f) => f.isin)).toEqual(['C', 'A', 'B']);
  });
  it('keeps missing values last in both directions and does not mutate the input', () => {
    expect(sortFunds(funds, 'ter', 'asc').map((f) => f.isin)).toEqual(['C', 'A', 'B']);
    expect(sortFunds(funds, 'ter', 'desc').map((f) => f.isin)).toEqual(['A', 'C', 'B']);
    expect(funds.map((f) => f.isin)).toEqual(['A', 'B', 'C']);
  });
});

describe('pagination helpers', () => {
  it('counts pages, never fewer than one', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(12)).toBe(1);
    expect(pageCount(13)).toBe(2);
    expect(pageCount(319)).toBe(27);
  });
  it('slices a page', () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    expect(pageItems(items, 1)).toEqual(items.slice(0, 12));
    expect(pageItems(items, 3)).toEqual(items.slice(24, 30));
  });
  it('shows first, last and neighbours with gaps', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 27)).toEqual([1, 2, 'gap', 27]);
    expect(pageWindow(10, 27)).toEqual([1, 'gap', 9, 10, 11, 'gap', 27]);
    expect(pageWindow(27, 27)).toEqual([1, 'gap', 26, 27]);
  });
});

describe('filterFundsLocal', () => {
  const base = { issuer: 'X', sub_class: null, region: 'us', sector: null, esg: false, ter: 0.001, domicile: null, ucits: true, wrapper: 'etf', distribution: 'acc', hedged_to: null, duration: null, index_name: 'S&P 500', inception_date: null, has_proxy: false, tickers: ['SPXS'] };
  const funds = [
    { ...base, isin: 'A', name: 'Alpha US', asset_class: 'equity' },
    { ...base, isin: 'B', name: 'Beta Bonds', asset_class: 'bond', region: 'europe', ter: null, esg: true },
  ];
  it('filters by type, region, flags, fee and search', () => {
    expect(filterFundsLocal(funds, { ...emptyFilters, asset_class: 'bond' }).map((f) => f.isin)).toEqual(['B']);
    expect(filterFundsLocal(funds, { ...emptyFilters, region: 'us' }).map((f) => f.isin)).toEqual(['A']);
    expect(filterFundsLocal(funds, { ...emptyFilters, esg: true }).map((f) => f.isin)).toEqual(['B']);
    expect(filterFundsLocal(funds, { ...emptyFilters, max_ter: '0.05' }).map((f) => f.isin)).toEqual(['B']); // unknown fee stays
    expect(filterFundsLocal(funds, { ...emptyFilters, q: 'spxs' }).map((f) => f.isin)).toEqual(['A', 'B']);
    expect(filterFundsLocal(funds, { ...emptyFilters, q: 'beta' }).map((f) => f.isin)).toEqual(['B']);
  });
});
