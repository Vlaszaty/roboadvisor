import { api, type Schemas } from '../api/client';
import { pct } from '../components/ui';
import { ErrorBox, Loading } from './ApiState';
import { DEMO_PROFILE, mixRows, thresholdLabel } from './logic';
import { unwrap } from './request';
import { useRequest } from './useRequest';
import './intake.css';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];

export function ExamplePreview() {
  const [res, retry] = useRequest(
    () => unwrap<Schemas['Recommendation']>(api.POST('/api/portfolio', { body: { profile: DEMO_PROFILE, settings: {} } })),
    [],
  );

  if (res.status === 'loading') return <Loading label="Building the example portfolio" />;
  if (res.status === 'error') return <ErrorBox message={`The example could not be built. ${res.message}`} onRetry={retry} />;

  const { summary, downside } = res.data;
  const rows = mixRows(summary.mix);
  const horizon = DEMO_PROFILE.horizon_years;

  return (
    <div className="preview">
      <div className="preview-col">
        <h3 className="preview-h">What it holds</h3>
        <ul className="bars" aria-label="Asset mix">
          {rows.map((r, i) => (
            <li key={r.key}>
              <span className="bar-label">{r.label}</span>
              <span className="bar-track" aria-hidden="true">
                <span className="bar-fill" style={{ width: `${r.weight * 100}%`, background: SERIES[i % SERIES.length] }} />
              </span>
              <span className="num bar-value">{pct(r.weight, 0)}</span>
            </li>
          ))}
        </ul>
        <dl className="preview-stats">
          <div>
            <dt>Expected return per year</dt>
            <dd className="num">{pct(summary.expected_return)}</dd>
          </div>
          <div>
            <dt>Typical yearly swing</dt>
            <dd className="num">{pct(summary.volatility)}</dd>
          </div>
          <div>
            <dt>Fund fees per 10,000 a year</dt>
            <dd className="num">{summary.annual_cost_per_10k == null ? '–' : summary.annual_cost_per_10k.toFixed(0)}</dd>
          </div>
        </dl>
      </div>

      <div className="preview-col">
        <h3 className="preview-h">What it could cost you</h3>
        <p className="muted preview-lead">Chance of a fall from a peak of at least this size at some point in {horizon} years.</p>
        <ul className="bars" aria-label="Drawdown probabilities">
          {downside.drawdown_probs.map((d) => (
            <li key={d.threshold}>
              <span className="bar-label">{thresholdLabel(d.threshold)}</span>
              <span className="bar-track" aria-hidden="true">
                <span className="bar-fill bar-neg" style={{ width: `${Math.min(100, d.probability * 100)}%` }} />
              </span>
              <span className="num bar-value">{pct(d.probability, 0)}</span>
            </li>
          ))}
        </ul>
        <p className="fineprint">Simulated from historical returns. An illustration, not a forecast or a promise.</p>
      </div>
    </div>
  );
}
