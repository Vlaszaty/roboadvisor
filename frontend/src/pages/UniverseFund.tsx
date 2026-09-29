import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Schemas } from '../api/client';
import { ChartFrame, TableScroll } from '../components/charts/ChartFrame';
import { decimal, humanise, money, percent } from '../components/charts/format';
import { useRequest } from '../components/charts/hooks';
import { Async } from '../components/charts/Status';
import { TimeChart } from '../components/charts/TimeChart';
import { assetClassLabel, dateMs, isoMonth, sampleEvenly } from '../components/charts/transforms';
import { Card, PageHeader } from '../components/ui';
import { useStore } from '../state/store';
import '../components/charts/results.css';

export default function UniverseFund() {
  const { isin = '' } = useParams();
  const [{ profile }] = useStore();
  const base = profile.base_currency;
  const { state, reload } = useRequest<Schemas['FundDetail']>(
    (signal) => api.GET('/api/universe/{isin}', { params: { path: { isin }, query: { base_currency: base } }, signal }),
    `${isin}|${base}`,
  );

  return (
    <div className="stack">
      <p style={{ margin: 0 }}><Link to="/universe">← All funds</Link></p>
      <Async state={state} onRetry={reload}>{(detail) => <FundView detail={detail} base={base} />}</Async>
    </div>
  );
}

function FundView({ detail, base }: { detail: Schemas['FundDetail']; base: string }) {
  const f = detail.fund;
  const rows = useMemo(() => detail.history.map((p) => ({ t: dateMs(p.date), price: p.value })), [detail]);
  const price = (v: number) => money(v, base, 2);
  const facts: Array<[string, string]> = [
    ['ISIN', f.isin],
    ['Asset class', assetClassLabel(f.asset_class)],
    ['Sub-class', f.sub_class ? humanise(f.sub_class) : '–'],
    ['Region', f.region ? humanise(f.region) : '–'],
    ['Sector', f.sector ? humanise(f.sector) : '–'],
    ['TER', percent(f.ter, 2)],
    ['Distribution', f.distribution === 'acc' ? 'Accumulating' : f.distribution === 'dist' ? 'Distributing' : '–'],
    ['Domicile', f.domicile ?? '–'],
    ['Wrapper', f.wrapper.toUpperCase()],
    ['UCITS', f.ucits ? 'Yes' : 'No'],
    ['ESG', f.esg ? 'Yes' : 'No'],
    ['Currency hedged to', f.hedged_to ?? '–'],
    ['Duration', f.duration == null ? '–' : `${decimal(f.duration, 1)} years`],
    ['Index', f.index_name ?? '–'],
    ['Launched', f.inception_date ?? '–'],
  ];

  return (
    <>
      <PageHeader title={f.name} lead={f.issuer ?? undefined} />
      <div className="results-grid grid-2">
        <Card title="Key facts">
          <dl className="kv">
            {facts.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          {f.has_proxy && (
            <p className="muted small">History before launch is filled in from a proxy series when this fund is used in simulations.</p>
          )}
        </Card>
        <Card title="Listings">
          <TableScroll label="Listings, scrolls horizontally on small screens">
            <table className="table">
              <caption className="sr-only">Exchange listings of this fund</caption>
              <thead>
                <tr><th scope="col">Ticker</th><th scope="col">Exchange</th><th scope="col">Currency</th><th scope="col">Primary</th></tr>
              </thead>
              <tbody>
                {detail.listings.map((l) => (
                  <tr key={l.ticker}>
                    <td className="num">{l.ticker}</td><td>{l.exchange}</td><td>{l.currency}</td><td>{l.is_primary ? 'Yes' : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      </div>
      <Card title="Price history">
        <ChartFrame
          title={`Weekly price in ${base}`}
          description={`Line chart of the fund's weekly price in ${base}, from ${rows[0] ? isoMonth(rows[0].t) : 'the start'} to ${rows.length ? isoMonth(rows[rows.length - 1].t) : 'now'}.`}
          table={{ head: ['Month', `Price (${base})`], rows: sampleEvenly(rows, 12).map((r) => [isoMonth(r.t), price(r.price)]) }}
        >
          <TimeChart rows={rows} series={[{ key: 'price', label: 'Price', color: 'var(--series-1)' }]} yFormat={price} />
        </ChartFrame>
      </Card>
    </>
  );
}
