import { Link } from 'react-router-dom';
import type { Schemas } from '../../api/client';
import { Term } from '../../glossary/Term';
import { TableScroll } from './ChartFrame';
import { decimal, percent } from './format';
import { assetClassColor, assetClassLabel } from './transforms';
import './results.css';

/**
 * What you own. Phones get one card per fund with plain labels, wider screens get the full table
 * with the technical columns. Both show the same numbers.
 */
export function HoldingsTable({ holdings }: { holdings: Schemas['Holding'][] }) {
  const rows = [...holdings].sort((a, b) => b.weight - a.weight);
  const total = rows.reduce((s, h) => s + h.weight, 0);
  const proxied = rows.filter((h) => h.proxied).length;
  return (
    <>
      <ul className="holding-cards" aria-label="Your funds">
        {rows.map((h) => (
          <li key={h.isin} className="holding-card">
            <div className="holding-top">
              <span className="swatch" style={{ background: assetClassColor(h.asset_class) }} />
              <span className="holding-class">{assetClassLabel(h.asset_class)}</span>
              <span className="holding-weight num">{percent(h.weight)}</span>
            </div>
            <Link to={`/universe/${h.isin}`} className="holding-name">{h.name}</Link>
            <dl className="holding-facts">
              <div><dt><Term id="ter">Yearly fee</Term></dt><dd className="num">{percent(h.ter, 2)}</dd></div>
              <div><dt>Share of the ups and downs</dt><dd className="num">{percent(h.risk_contribution)}</dd></div>
            </dl>
          </li>
        ))}
        <li className="holding-total"><span>Total</span><span className="num">{percent(total)}</span></li>
      </ul>

      <div className="holding-table">
        <TableScroll label="Funds you own, scrolls horizontally on small screens">
          <table className="table table-holdings">
            <caption className="sr-only">Recommended ETFs with share, yearly fee, beta and share of the ups and downs</caption>
            <thead>
              <tr>
                <th scope="col">Fund</th>
                <th scope="col">Type</th>
                <th scope="col" className="num">Share</th>
                <th scope="col" className="num"><Term id="ter">Yearly fee</Term></th>
                <th scope="col" className="num"><Term id="beta">Follows the market</Term></th>
                <th scope="col" className="num">Share of the ups and downs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.isin}>
                  <td>
                    <Link to={`/universe/${h.isin}`}>{h.name}</Link>
                    {h.proxied && proxied < rows.length && <span className="muted" title="Early history comes from older stand-in data (see note below)"> *</span>}
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
      </div>
      {proxied > 0 && (
        <p className="small muted holdings-note">
          {proxied === rows.length ? 'For all of these funds' : `* For ${proxied} of these funds`}, part of the price
          history comes from <Term id="proxy">older stand-in data</Term>: an older fund or index tracking the same market,
          used so we can judge risk over 15 or more years.
        </p>
      )}
    </>
  );
}
