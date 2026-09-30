import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Schemas } from '../api/client';
import { Field, TableScroll } from '../components/charts/ChartFrame';
import { percent } from '../components/charts/format';
import { useDebounced, useRequest } from '../components/charts/hooks';
import { Async } from '../components/charts/Status';
import { assetClassLabel } from '../components/charts/transforms';
import {
  ASSET_CLASSES, REGIONS, emptyFilters, filtersToQuery, sortFunds, type FundFilters, type SortDir, type SortKey,
} from '../components/charts/universe';
import { Button, Card, PageHeader } from '../components/ui';
import { UniverseFrontier } from '../components/charts/UniverseFrontierChart';
import '../components/charts/results.css';

const COLUMNS: Array<{ key: SortKey; label: string; num?: boolean }> = [
  { key: 'name', label: 'Fund' },
  { key: 'asset_class', label: 'Asset class' },
  { key: 'region', label: 'Region' },
  { key: 'ter', label: 'TER', num: true },
];

export default function Universe() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FundFilters>(emptyFilters);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const q = useDebounced(filters.q, 300);
  const query = filtersToQuery({ ...filters, q });
  const { state, reload } = useRequest<Schemas['FundSummary'][]>(
    (signal) => api.GET('/api/universe', { params: { query }, signal }),
    JSON.stringify(query),
  );
  const patch = (p: Partial<FundFilters>) => setFilters((f) => ({ ...f, ...p }));
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  return (
    <div className="stack">
      <PageHeader title="ETF universe" lead="Every fund the engine can choose from. Select a fund for its details and price history." />

      <Card title="Filters">
        <div className="form-grid">
          <Field label="Asset class">
            <select className="input" value={filters.asset_class} onChange={(e) => patch({ asset_class: e.target.value })}>
              <option value="">All</option>
              {ASSET_CLASSES.map((c) => <option key={c} value={c}>{assetClassLabel(c)}</option>)}
            </select>
          </Field>
          <Field label="Region">
            <select className="input" value={filters.region} onChange={(e) => patch({ region: e.target.value })}>
              <option value="">All</option>
              {REGIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Max TER (% per year)">
            <input className="input" type="number" min="0" step="0.05" placeholder="e.g. 0.30" value={filters.max_ter} onChange={(e) => patch({ max_ter: e.target.value })} />
          </Field>
          <Field label="Search">
            <input className="input" type="search" placeholder="Name, ISIN, ticker, index" value={filters.q} onChange={(e) => patch({ q: e.target.value })} />
          </Field>
          <label className="check"><input type="checkbox" checked={filters.esg} onChange={(e) => patch({ esg: e.target.checked })} />ESG only</label>
          <label className="check"><input type="checkbox" checked={filters.ucits} onChange={(e) => patch({ ucits: e.target.checked })} />UCITS only</label>
          <div><Button type="button" onClick={() => setFilters(emptyFilters)}>Clear filters</Button></div>
        </div>
      </Card>

      <UniverseFrontier filters={{ ...filters, q }} />

      <Async state={state} onRetry={reload}>
        {(funds) => {
          const rows = sortFunds(funds, sort.key, sort.dir);
          return (
            <Card title={`${rows.length} ${rows.length === 1 ? 'fund' : 'funds'}`}>
              {rows.length === 0 ? (
                <p className="muted">No funds match these filters.</p>
              ) : (
                <TableScroll label="Funds, scrolls horizontally on small screens">
                  <table className="table">
                    <caption className="sr-only">Funds in the universe, sortable by column</caption>
                    <thead>
                      <tr>
                        {COLUMNS.map((c) => (
                          <th
                            key={c.key} scope="col" className={c.num ? 'num' : undefined}
                            aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                          >
                            <button type="button" className="sort-btn" onClick={() => toggleSort(c.key)}>
                              {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                            </button>
                          </th>
                        ))}
                        <th scope="col">Hedged</th>
                        <th scope="col">ESG</th>
                        <th scope="col">UCITS</th>
                        <th scope="col">Dist.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((f) => (
                        <tr key={f.isin} className="clickable" onClick={() => navigate(`/universe/${f.isin}`)}>
                          <td>
                            <Link to={`/universe/${f.isin}`} onClick={(e) => e.stopPropagation()}>{f.name}</Link>
                            <div className="small muted num">{f.isin}{f.tickers.length > 0 ? ` · ${f.tickers.join(', ')}` : ''}</div>
                          </td>
                          <td>{assetClassLabel(f.asset_class)}</td>
                          <td>{f.region ?? '–'}</td>
                          <td className="num">{percent(f.ter, 2)}</td>
                          <td>{f.hedged_to ?? '–'}</td>
                          <td>{f.esg ? 'Yes' : '–'}</td>
                          <td>{f.ucits ? 'Yes' : '–'}</td>
                          <td>{f.distribution ?? '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </Card>
          );
        }}
      </Async>
    </div>
  );
}
