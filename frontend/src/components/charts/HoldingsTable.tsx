import { Link } from 'react-router-dom';
import type { Schemas } from '../../api/client';
import { TableScroll } from './ChartFrame';
import { decimal, percent } from './format';
import { assetClassColor, assetClassLabel } from './transforms';
import './results.css';

export function HoldingsTable({ holdings }: { holdings: Schemas['Holding'][] }) {
  const rows = [...holdings].sort((a, b) => b.weight - a.weight);
  const total = rows.reduce((s, h) => s + h.weight, 0);
  const proxied = rows.filter((h) => h.proxied).length;
  return (
    <>
    <TableScroll label="Holdings, scrolls horizontally on small screens">
      <table className="table table-holdings">
        <caption className="sr-only">Recommended ETFs with weight, cost, beta and share of portfolio risk</caption>
        <thead>
          <tr>
            <th scope="col">Fund</th>
            <th scope="col">Asset class</th>
            <th scope="col" className="num">Weight</th>
            <th scope="col" className="num">TER</th>
            <th scope="col" className="num">Beta</th>
            <th scope="col" className="num">Risk share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.isin}>
              <td>
                <Link to={`/universe/${h.isin}`}>{h.name}</Link>
                {h.proxied && proxied < rows.length && <span className="muted" title="Early history comes from a proxy (see note below the table)"> *</span>}
                <div className="small muted num">{h.ticker} · {h.isin}</div>
              </td>
              <td>
                <span className="swatch" style={{ background: assetClassColor(h.asset_class) }} />
                {assetClassLabel(h.asset_class)}
              </td>
              <td className="num">{percent(h.weight)}</td>
              <td className="num">{percent(h.ter, 2)}</td>
              <td className="num">{decimal(h.beta, 2)}</td>
              <td className="num">{percent(h.risk_contribution)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Total</td>
            <td className="num">{percent(total)}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </TableScroll>
    {proxied > 0 && (
      <p className="small muted holdings-note">
        {proxied === rows.length ? 'For all of these funds' : `* For ${proxied} of these funds`}, part of the price
        history comes from a proxy: an older fund or index tracking the same market, used to extend the history to 15+
        years for risk estimates and backtests.
      </p>
    )}
    </>
  );
}
