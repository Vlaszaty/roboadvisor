import type { Schemas } from '../../api/client';
import { Term } from '../../glossary/Term';
import { PairedBars, type BarSeries } from './BarCharts';
import { ChartFrame, TableScroll } from './ChartFrame';
import { FanChart } from './FanChart';
import { decimal, money as fmtMoney, percent } from './format';
import { probabilityRows, sampleEvenly, thresholdLabel } from './transforms';
import { Card } from '../ui';
import './results.css';

type Downside = Schemas['Downside'];

const MC: BarSeries = { key: 'monteCarlo', label: 'Simulated from real market behaviour', color: 'var(--series-1)' };
const NORMAL: BarSeries = { key: 'normal', label: 'Simple bell-curve shortcut', color: 'var(--series-2)' };

/** How likely a big fall is, in plain words, and what ending below your deposit looks like. */
export function ChanceOfFall({ downside, horizonYears }: { downside: Downside; horizonYears: number }) {
  const drawdown = probabilityRows(downside.drawdown_probs, downside.normal_comparison.drawdown_probs);
  const annual = probabilityRows(downside.annual_loss_probs, downside.normal_comparison.annual_loss_probs);
  return (
    <Card title="How likely is a big fall?">
      <p className="muted">
        A <Term id="drawdown">fall</Term> is the drop from your highest value before it recovers. These are the chances of
        seeing at least this big a fall at some point in the next {horizonYears} years.
      </p>
      <ChartFrame
        title={`Chance of a fall of at least this size within ${horizonYears} years`}
        description={`Bar chart. ${drawdown.map((r) => `${r.label}: ${percent(r.monteCarlo)}`).join('; ')}.`}
        table={{ head: ['Fall', 'Chance'], rows: drawdown.map((r) => [r.label, percent(r.monteCarlo, 2)]) }}
      >
        <PairedBars rows={drawdown} series={[MC]} />
      </ChartFrame>
      <p className="callout-line">
        Chance of ending below what you put in after {horizonYears} years:{' '}
        <strong className="num">{percent(downside.p_below_invested)}</strong>
      </p>
      <h4 className="mini-h">In any single year</h4>
      <TableScroll label="Chance of a losing calendar year">
        <table className="table">
          <caption className="sr-only">Chance of at least one calendar year with a loss this large</caption>
          <thead>
            <tr><th scope="col">A year with a loss of at least</th><th scope="col" className="num">Chance it happens at least once</th></tr>
          </thead>
          <tbody>
            {annual.map((r) => (
              <tr key={r.threshold}><td>{thresholdLabel(r.threshold)}</td><td className="num">{percent(r.monteCarlo, 1)}</td></tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}

/** The range of outcomes over the horizon. */
export function MoneyFan({ downside, horizonYears, currency }: { downside: Downside; horizonYears: number; currency: string }) {
  const own = downside.fan_money ?? [];
  const hasMoney = own.length > 0;
  const fanTable = hasMoney
    ? sampleEvenly(own, 6).map((f) => [`Year ${f.year}`, fmtMoney(f.paid_in, currency), fmtMoney(f.p5, currency), fmtMoney(f.p50, currency), fmtMoney(f.p95, currency)])
    : sampleEvenly(downside.fan, 6).map((f) => [`Year ${f.year}`, decimal(f.p5), decimal(f.p50), decimal(f.p95)]);
  return (
    <Card title="Where your money could end up">
      <p className="muted">
        {hasMoney ? 'Based on the amounts you chose.' : 'Imagine investing 1 today.'} The line is the middle result. The shaded areas show the usual range, and the{' '}
        wider range that covers nine out of ten possible futures (<Term id="fan-chart">more</Term>).
      </p>
      <ChartFrame
        title={hasMoney ? `What your money could become over ${horizonYears} years` : `What 1 invested could become over ${horizonYears} years`}
        description="Fan chart. The line is the median outcome; shaded bands show the middle 50% and the 90% range of simulated outcomes."
        table={{
          head: hasMoney ? ['Point in time', 'Paid in', 'Poor case (1 in 20)', 'Middle', 'Good case (1 in 20)'] : ['Point in time', 'Poor case (1 in 20)', 'Middle', 'Good case (1 in 20)'],
          rows: fanTable,
        }}
      >
        <FanChart fan={downside.fan} money={hasMoney ? { points: own, currency } : undefined} />
      </ChartFrame>
    </Card>
  );
}

/** What past crises would have done to this portfolio. */
export function StressTests({ downside }: { downside: Downside }) {
  return (
    <Card title="What past crises would have done">
      <p className="muted" style={{ marginTop: 0 }}>
        How much this mix would have lost during famous crashes (<Term id="stress-test">more</Term>). A dash means there is not
        enough history. &quot;Stand-in data&quot; means an older fund that tracks the same market was used (<Term id="proxy">more</Term>).
      </p>
      <TableScroll label="Stress tests, scrolls horizontally on small screens">
        <table className="table">
          <caption className="sr-only">Portfolio loss during each stress event</caption>
          <thead>
            <tr>
              <th scope="col">Event</th><th scope="col">Period</th>
              <th scope="col" className="num">Loss</th><th scope="col">Data</th>
            </tr>
          </thead>
          <tbody>
            {downside.stress.map((s) => (
              <tr key={s.event}>
                <td>{s.event}</td>
                <td className="num">{s.start} to {s.end}</td>
                <td className={`num ${s.loss != null && s.loss < 0 ? 'neg' : ''}`}>{percent(s.loss)}</td>
                <td>{s.loss == null ? 'no data' : s.proxied ? <span className="badge">stand-in data</span> : 'actual'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}

/** Why the simple bell-curve shortcut understates risk. */
export function BellCurveCheck({ downside }: { downside: Downside }) {
  const drawdown = probabilityRows(downside.drawdown_probs, downside.normal_comparison.drawdown_probs);
  const annual = probabilityRows(downside.annual_loss_probs, downside.normal_comparison.annual_loss_probs);
  return (
    <Card title="Why not use a simple bell curve?">
      <p className="muted" style={{ marginTop: 0 }}>
        A <Term id="normal-model">bell-curve shortcut</Term> usually understates big losses, because real markets have more
        extreme days and bad spells that bunch together. That is why we simulate from real market behaviour instead.
      </p>
      <div className="results-grid grid-2">
        <ChartFrame
          title="Fall from the highest point within the horizon"
          description={`Paired bars comparing simulated and normal-model probabilities. ${drawdown.map((r) => `${r.label}: simulated ${percent(r.monteCarlo)}, normal ${percent(r.normal)}`).join('; ')}.`}
          table={{ head: ['Fall', 'Simulated', 'Bell curve'], rows: drawdown.map((r) => [r.label, percent(r.monteCarlo, 2), percent(r.normal, 2)]) }}
        >
          <PairedBars rows={drawdown} series={[MC, NORMAL]} />
        </ChartFrame>
        <ChartFrame
          title="At least one losing calendar year"
          description={`Paired bars comparing simulated and normal-model probabilities. ${annual.map((r) => `${r.label}: simulated ${percent(r.monteCarlo)}, normal ${percent(r.normal)}`).join('; ')}.`}
          table={{ head: ['Loss in a year', 'Simulated', 'Bell curve'], rows: annual.map((r) => [r.label, percent(r.monteCarlo, 2), percent(r.normal, 2)]) }}
        >
          <PairedBars rows={annual} series={[MC, NORMAL]} />
        </ChartFrame>
      </div>
    </Card>
  );
}
