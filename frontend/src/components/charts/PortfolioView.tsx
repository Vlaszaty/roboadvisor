import type { Schemas } from '../../api/client';
import { Card, LinkButton, Stat } from '../ui';
import { AssetMixDonut } from './Donut';
import { ChartFrame } from './ChartFrame';
import { Comparison } from './Comparison';
import { DownsidePanel } from './DownsidePanel';
import { Frontier } from './FrontierChart';
import { HoldingsTable } from './HoldingsTable';
import { TraceList } from './TraceList';
import { decimal, money, percent } from './format';
import { mixRows } from './transforms';
import './results.css';

export function PortfolioView({
  rec, currency, horizonYears,
}: {
  rec: Schemas['Recommendation'];
  currency: string;
  horizonYears: number;
}) {
  const s = rec.summary;
  const warnings = rec.warnings ?? [];
  const slices = mixRows(s.mix);
  const volGap = s.volatility - s.target_volatility;
  const volHint =
    Math.abs(volGap) < 0.005
      ? `on target (${percent(s.target_volatility)})`
      : `${volGap < 0 ? 'below' : 'above'} the ${percent(s.target_volatility)} target`;

  return (
    <div className="stack">
      {warnings.length > 0 && (
        <div className="banner" role="status">
          <strong>Heads up</strong>
          <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="results-grid grid-stats">
        <Card><Stat label="Expected return" value={percent(s.expected_return)} hint="per year, model estimate" /></Card>
        <Card><Stat label="Volatility" value={percent(s.volatility)} hint={volHint} /></Card>
        <Card><Stat label="Sharpe ratio" value={decimal(s.sharpe, 2)} hint="return per unit of risk" /></Card>
        <Card><Stat label="Beta" value={decimal(s.beta, 2)} hint="vs. the market portfolio" /></Card>
        <Card>
          <Stat
            label={`Cost per ${money(10_000, currency)}`}
            value={money(s.annual_cost_per_10k, currency)}
            hint={`per year, weighted TER ${percent(s.weighted_ter, 2)}`}
          />
        </Card>
      </div>

      <div className="results-grid grid-2">
        <Card title="Asset mix">
          <ChartFrame
            title="Portfolio split by asset class"
            description={`Donut chart. ${slices.map((x) => `${x.label} ${percent(x.value)}`).join(', ')}.`}
            table={{ head: ['Asset class', 'Weight'], rows: slices.map((x) => [x.label, percent(x.value)]) }}
          >
            <AssetMixDonut slices={slices} />
          </ChartFrame>
        </Card>
      </div>

      <Card title="Holdings">
        <HoldingsTable holdings={rec.holdings} />
      </Card>

      <Comparison />

      <Frontier />

      <h2 style={{ marginBottom: 0 }}>Downside: what could go wrong</h2>
      <DownsidePanel downside={rec.downside} horizonYears={horizonYears} />

      <Card title="How was this built?">
        <TraceList trace={rec.trace ?? []} />
      </Card>

      <div className="row">
        <LinkButton to="/backtest" variant="primary">Test it historically</LinkButton>
        <span className="muted">See how this portfolio would have behaved in the past.</span>
      </div>
    </div>
  );
}
