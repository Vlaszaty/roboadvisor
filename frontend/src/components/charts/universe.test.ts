import { describe, expect, it } from 'vitest';
import type { Schemas } from '../../api/client';
import { emptyFilters, filtersToQuery, sortFunds } from './universe';

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
