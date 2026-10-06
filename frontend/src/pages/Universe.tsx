import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Schemas } from '../api/client';
import { humanise, percent } from '../components/charts/format';
import { useDebounced, useRequest } from '../components/charts/hooks';
import { Async } from '../components/charts/Status';
import { UniverseFrontier } from '../components/charts/UniverseFrontierChart';
import { assetClassColor, assetClassLabel } from '../components/charts/transforms';
import {
  ASSET_CLASSES, REGIONS, emptyFilters, filterFundsLocal, pageCount, pageItems, pageWindow, sortFunds, PAGE_SIZE,
  type FundFilters, type SortDir, type SortKey,
} from '../components/charts/universe';
import { Details } from '../components/Story';
import { Button, PageHeader } from '../components/ui';
import { Term } from '../glossary/Term';
import '../components/charts/results.css';
import './Universe.css';

type Fund = Schemas['FundSummary'];

const SORTS: Array<{ id: string; label: string; key: SortKey; dir: SortDir }> = [
  { id: 'name', label: 'Name, A to Z', key: 'name', dir: 'asc' },
  { id: 'fee-low', label: 'Lowest yearly fee', key: 'ter', dir: 'asc' },
  { id: 'fee-high', label: 'Highest yearly fee', key: 'ter', dir: 'desc' },
  { id: 'type', label: 'Type of investment', key: 'asset_class', dir: 'asc' },
];

const regionLabel = (r: string | null) => (r ? REGIONS.find((x) => x.value === r)?.label ?? humanise(r) : null);

export default function Universe() {
  const [filters, setFilters] = useState<FundFilters>(emptyFilters);
  const [sortId, setSortId] = useState('name');
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);
  const q = useDebounced(filters.q, 250);
  const applied = useMemo(() => ({ ...filters, q }), [filters, q]);

  // The whole list is small (a few hundred funds), so it is fetched once and filtered here, instantly.
  const { state, reload } = useRequest<Fund[]>((signal) => api.GET('/api/universe', { params: { query: {} }, signal }), 'all');

  const patch = (p: Partial<FundFilters>) => {
    setFilters((f) => ({ ...f, ...p }));
    setPage(1);
  };
  const goTo = (p: number) => {
    setPage(p);
    listRef.current?.scrollIntoView({ block: 'start' });
  };
  useEffect(() => setPage(1), [q]);

  const sort = SORTS.find((s) => s.id === sortId) ?? SORTS[0];
  const activeExtras = [filters.region, filters.max_ter.trim(), filters.esg, filters.ucits].filter(Boolean).length;

  return (
    <div className="funds">
      <PageHeader title="Funds" lead="Every fund we can choose from. Browse by type, search by name, or open a fund to see its details and price history." />

      <Async state={state} onRetry={reload}>
        {(all) => {
          const withoutType = filterFundsLocal(all, { ...applied, asset_class: '' });
          const count = (c: string) => (c ? withoutType.filter((f) => f.asset_class === c).length : withoutType.length);
          const found = sortFunds(filterFundsLocal(all, applied), sort.key, sort.dir);
          const pages = pageCount(found.length);
          const current = Math.min(page, pages);
          const shown = pageItems(found, current);
          const types = ['', ...ASSET_CLASSES.filter((c) => all.some((f) => f.asset_class === c))];

          return (
            <>
              <section className="card funds-controls" aria-label="Find a fund">
                <label className="funds-search">
                  <span className="sr-only">Search funds</span>
                  <input type="search" placeholder="Search by name, ticker or ISIN" value={filters.q} onChange={(e) => patch({ q: e.target.value })} />
                </label>

                <div className="funds-types" role="radiogroup" aria-label="Type of investment">
                  {types.map((c) => (
                    <label key={c || 'all'} className={`funds-type ${filters.asset_class === c ? 'is-selected' : ''}`}>
                      <input type="radio" name="type" checked={filters.asset_class === c} onChange={() => patch({ asset_class: c })} />
                      {c && <span className="swatch" style={{ background: assetClassColor(c) }} />}
                      {c ? assetClassLabel(c) : 'All'} <span className="funds-count num">{count(c)}</span>
                    </label>
                  ))}
                </div>

                <div className="funds-bar">
                  <Details title={activeExtras > 0 ? `More filters (${activeExtras} on)` : 'More filters'} hint="Region, fee, sustainable, European rules">
                    <div className="funds-filters">
                      <label className="replay-field">
                        <span>Region</span>
                        <select className="input" value={filters.region} onChange={(e) => patch({ region: e.target.value })}>
                          <option value="">Anywhere</option>
                          {REGIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </label>
                      <label className="replay-field">
                        <span>Highest yearly fee (%)</span>
                        <input className="input" type="number" min="0" step="0.05" placeholder="For example 0.30" value={filters.max_ter} onChange={(e) => patch({ max_ter: e.target.value })} />
                      </label>
                      <label className="check"><input type="checkbox" checked={filters.esg} onChange={(e) => patch({ esg: e.target.checked })} />Only <Term id="esg">sustainable</Term> funds</label>
                      <label className="check"><input type="checkbox" checked={filters.ucits} onChange={(e) => patch({ ucits: e.target.checked })} />Only <Term id="ucits">European-rules</Term> funds (UCITS)</label>
                      <div><Button type="button" onClick={() => { setFilters(emptyFilters); setPage(1); }}>Clear everything</Button></div>
                    </div>
                  </Details>
                  <label className="funds-sort">
                    <span>Sort by</span>
                    <select className="input" value={sortId} onChange={(e) => { setSortId(e.target.value); setPage(1); }}>
                      {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </label>
                </div>
              </section>

              <div ref={listRef} className="funds-listhead" aria-live="polite">
                <strong>{found.length.toLocaleString('en-US')} {found.length === 1 ? 'fund' : 'funds'}</strong>
                {found.length > 0 && <span className="muted">Showing {(current - 1) * PAGE_SIZE + 1} to {(current - 1) * PAGE_SIZE + shown.length}</span>}
              </div>

              {found.length === 0 ? (
                <p className="card muted">No funds match. Try a different word, or clear the filters.</p>
              ) : (
                <ul className="funds-grid">
                  {shown.map((f) => <FundCard key={f.isin} f={f} />)}
                </ul>
              )}

              {pages > 1 && <Pager current={current} pages={pages} onGo={goTo} />}

              <Details title="See these funds on a chart" hint="Growth you could expect against the ups and downs">
                <UniverseFrontier filters={applied} />
              </Details>
            </>
          );
        }}
      </Async>
    </div>
  );
}

function FundCard({ f }: { f: Fund }) {
  const region = regionLabel(f.region);
  return (
    <li className="fund-card">
      <div className="fund-top">
        <span className="swatch" style={{ background: assetClassColor(f.asset_class) }} />
        <span className="fund-type">{assetClassLabel(f.asset_class)}</span>
        <span className="fund-fee num">{f.ter == null ? 'Fee unknown' : `${percent(f.ter, 2)} a year`}</span>
      </div>
      <Link to={`/universe/${f.isin}`} className="fund-name">{f.name}</Link>
      <p className="fund-sub">{[region, f.issuer].filter(Boolean).join(' · ')}</p>
      <ul className="fund-tags" aria-label="Details">
        {f.wrapper !== 'etf' && <li className="is-warn">{f.wrapper.toUpperCase()}, not an ETF</li>}
        {f.esg && <li>Sustainable</li>}
        {f.ucits && <li>UCITS</li>}
        {f.distribution === 'acc' && <li>Reinvests dividends</li>}
        {f.distribution === 'dist' && <li>Pays out dividends</li>}
        {f.hedged_to && <li>Hedged to {f.hedged_to}</li>}
      </ul>
    </li>
  );
}

function Pager({ current, pages, onGo }: { current: number; pages: number; onGo: (p: number) => void }) {
  return (
    <nav className="pager" aria-label="Pages of funds">
      <button type="button" className="pager-btn" disabled={current === 1} onClick={() => onGo(current - 1)}>
        <span aria-hidden="true">&larr;</span> Previous
      </button>
      <ol className="pager-pages">
        {pageWindow(current, pages).map((p, i) => (
          <li key={`${p}-${i}`}>
            {p === 'gap' ? (
              <span aria-hidden="true" className="pager-gap">…</span>
            ) : (
              <button type="button" className={`pager-num ${p === current ? 'is-current' : ''}`} aria-current={p === current ? 'page' : undefined} aria-label={`Page ${p}`} onClick={() => onGo(p)}>
                {p}
              </button>
            )}
          </li>
        ))}
      </ol>
      <button type="button" className="pager-btn" disabled={current === pages} onClick={() => onGo(current + 1)}>
        Next <span aria-hidden="true">&rarr;</span>
      </button>
      <p className="pager-status">Page {current} of {pages}</p>
    </nav>
  );
}
