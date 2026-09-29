import type { Schemas } from '../../api/client';
import { PairedBars, type BarSeries } from './BarCharts';
import { ChartFrame, TableScroll } from './ChartFrame';
import { FanChart } from './FanChart';
import { decimal, percent } from './format';
import { probabilityRows, sampleEvenly, thresholdLabel } from './transforms';
import { Card } from '../ui';
import './results.css';

type Downside = Schemas['Downside'];

const MC: BarSeries = { key: 'monteCarlo', label: 'Simulated from history', color: 'var(--series-1)' };
const NORMAL: BarSeries = { key: 'normal', label: 'Normal-distribution model', color: 'var(--series-2)' };

export function DownsidePanel({ downside, horizonYears }: { downside: Downside; horizonYears: number }) {
  const drawdown = probabilityRows(downside.drawdown_probs, downside.normal_comparison.drawdown_probs);
  const annual = probabilityRows(downside.annual_loss_probs, downside.normal_comparison.annual_loss_probs);
  const fanTable = sampleEvenly(downside.fan, 6).map((f) => [`Year ${f.year}`, decimal(f.p5), decimal(f.p50), decimal(f.p95)]);

  return (
    <div className="stack">
      <div className="results-grid grid-2">
        <Card title="Chance of a large fall">
          <ChartFrame
            title={`Probability of a peak-to-trough fall within ${horizonYears} years`}
            description={`Bar chart. ${drawdown.map((r) => `${r.label}: ${percent(r.monteCarlo)}`).join('; ')}.`}
            table={{ head: ['Fall', 'Probability'], rows: drawdown.map((r) => [r.label, percent(r.monteCarlo, 2)]) }}
          >
            <PairedBars rows={drawdown} series={[MC]} />
          </ChartFrame>
          <p style={{ marginBottom: 'var(--space-2)' }}>
            Chance of ending below what you put in after {horizonYears} years:{' '}
            <strong className="num">{percent(downside.p_below_invested)}</strong>
          </p>
          <TableScroll label="Chance of a losing calendar year">
            <table className="table">
              <caption className="sr-only">Chance of at least one calendar year with a loss this large</caption>
              <thead>
                <tr><th scope="col">A single year of</th><th scope="col" className="num">Happens at least once</th></tr>
              </thead>
              <tbody>
                {annual.map((r) => (
                  <tr key={r.threshold}><td>{thresholdLabel(r.threshold)}</td><td className="num">{percent(r.monteCarlo, 1)}</td></tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>

        <Card title="Where your money could end up">
          <ChartFrame
            title={`Value of 1.00 invested, ${horizonYears}-year simulation`}
            description="Fan chart. The line is the median outcome; shaded bands show the middle 50% and the 90% range of simulated outcomes."
            table={{ head: ['Point in time', '5th pct', 'Median', '95th pct'], rows: fanTable }}
          >
            <FanChart fan={downside.fan} />
          </ChartFrame>
        </Card>
      </div>

      <Card title="Historical stress tests">
        <p className="muted" style={{ marginTop: 0 }}>What this portfolio would have lost in past crises. A dash means there is not enough history.</p>
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
                  <td>{s.loss == null ? 'no data' : s.proxied ? <span className="badge">proxy data</span> : 'actual'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      <Card title="Why not just assume a bell curve?">
        <p className="muted" style={{ marginTop: 0 }}>
          The normal-distribution model usually understates the chance of large losses, because real markets have fatter tails and volatility that clusters.
        </p>
        <div className="results-grid grid-2">
          <ChartFrame
            title="Peak-to-trough fall within the horizon"
            description={`Paired bars comparing simulated and normal-model probabilities. ${drawdown.map((r) => `${r.label}: simulated ${percent(r.monteCarlo)}, normal ${percent(r.normal)}`).join('; ')}.`}
            table={{ head: ['Fall', 'Simulated', 'Normal'], rows: drawdown.map((r) => [r.label, percent(r.monteCarlo, 2), percent(r.normal, 2)]) }}
          >
            <PairedBars rows={drawdown} series={[MC, NORMAL]} />
          </ChartFrame>
          <ChartFrame
            title="At least one losing calendar year"
            description={`Paired bars comparing simulated and normal-model probabilities. ${annual.map((r) => `${r.label}: simulated ${percent(r.monteCarlo)}, normal ${percent(r.normal)}`).join('; ')}.`}
            table={{ head: ['Loss in a year', 'Simulated', 'Normal'], rows: annual.map((r) => [r.label, percent(r.monteCarlo, 2), percent(r.normal, 2)]) }}
          >
            <PairedBars rows={annual} series={[MC, NORMAL]} />
          </ChartFrame>
        </div>
      </Card>
    </div>
  );
}
