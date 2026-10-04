import { useState } from 'react';
import { api } from '../api/client';
import { Field } from '../components/charts/ChartFrame';
import { AssetMixDonut } from '../components/charts/Donut';
import { decimal, percent } from '../components/charts/format';
import { useDebounced, useLastData, useRequest } from '../components/charts/hooks';
import { ErrorBox, Loading } from '../components/charts/Status';
import { Radio } from '../components/charts/UniverseFrontierChart';
import { Card, PageHeader, Stat } from '../components/ui';
import { STEPS } from '../components/textbook/copy';
import { DataTable, Step } from '../components/textbook/Step';
import { RiskReturnChart, SmlChart } from '../components/textbook/TextbookChart';
import {
  corrShade, correlationRows, exampleCorrelation, exampleExpected, exampleFrontier, examplePortfolio, exampleSplit,
  exampleStats, exampleTangent, expectedTable, statsTable, tangentTable, textbookRequest, usedColumn, weightSlices,
  weightsTable, type ReturnModel, type Textbook as TextbookData,
} from '../components/textbook/textbook';
import { useStore } from '../state/store';
import '../components/charts/results.css';
import '../components/textbook/textbook.css';

const MODELS: readonly ReturnModel[] = ['capm', 'historical'];
const MODEL_LABEL: Record<ReturnModel, string> = { capm: 'CAPM', historical: 'Historical average' };
const Note = ({ children }: { children: string }) => <p className="small muted">{children}</p>;

function Steps({ t }: { t: TextbookData }) {
  const corr = correlationRows(t);
  const capm = t.inputs.return_model === 'capm';
  return (
    <div className="stack">
      {(t.warnings ?? []).length > 0 && (
        <div className="banner"><ul>{(t.warnings ?? []).map((w) => <li key={w}>{w}</li>)}</ul></div>
      )}

      <Step n={1} copy={STEPS.stats} example={exampleStats(t)}>
        <DataTable table={statsTable(t)} label="Average return and volatility per fund" />
        <Note>{`Based on ${t.inputs.weeks} weekly returns from ${t.inputs.window.start} to ${t.inputs.window.end}. The course’s examples use monthly returns; weekly gives more observations with the same method.`}</Note>
      </Step>

      <Step n={2} copy={STEPS.correlation} example={exampleCorrelation(t)}>
        <div className="table-scroll" role="region" aria-label="Correlation between the funds" tabIndex={0}>
          <table className="table corr">
            <thead>
              <tr><th scope="col" />{corr.head.map((h) => <th key={h} scope="col" className="num">{h}</th>)}</tr>
            </thead>
            <tbody>
              {corr.rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {r.cells.map((v, k) => <td key={k} className="num" style={{ background: corrShade(v) }}>{decimal(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Step>

      <Step n={3} copy={STEPS.expected} example={exampleExpected(t)}>
        <DataTable table={expectedTable(t)} label="Beta and expected return per fund" highlight={usedColumn(t)} />
        {capm && <SmlChart t={t} />}
        <Note>{`Risk-free rate ${percent(t.inputs.rf)}, market premium ${percent(t.inputs.premium)}, market: ${t.inputs.market.name}. Betas come from weekly returns; the course’s examples use monthly.`}</Note>
        {!capm && <Note>Five years of averages are noisy. Watch how the tangent portfolio below concentrates in whatever did best recently.</Note>}
      </Step>

      <Step n={4} copy={STEPS.frontier} example={exampleFrontier(t)}>
        <RiskReturnChart t={t} layer="frontier" title="The seven funds and their efficient frontier" />
      </Step>

      <Step n={5} copy={STEPS.tangent} example={exampleTangent(t)}>
        <RiskReturnChart t={t} layer="tangent" title="The capital market line and the tangent portfolio" />
        {t.tangent && <DataTable table={tangentTable(t)} label="Weights of the tangent portfolio" />}
      </Step>

      <Step n={6} copy={STEPS.split} example={exampleSplit(t)}>
        <div className="row" style={{ gap: 'var(--space-6)' }}>
          <Stat label="Risk aversion A" value={decimal(t.split.risk_aversion, 1)} />
          <Stat label="Share from the formula" value={percent(t.split.risky_share_uncapped, 0)} />
          <Stat label="Share used" value={percent(t.split.risky_share, 0)} hint="between 0% and 100%" />
        </div>
        <RiskReturnChart t={t} layer="split" title="Your portfolio on the capital market line" />
        <Note>The scale for A (10 for the most cautious investor, 2 for the most adventurous) is this tool’s assumption; the slides give no numbers.</Note>
        <Note>What counts as risk-free depends on the horizon. Over a single period it is a T-bill; for a ten-year goal a ten-year government bond held to maturity is closer. This model takes the one-period view.</Note>
      </Step>

      <Step n={7} copy={STEPS.portfolio} example={examplePortfolio(t)}>
        <div className="row" style={{ gap: 'var(--space-6)' }}>
          <Stat label="Expected return" value={percent(t.portfolio.expected_return)} />
          <Stat label="Volatility" value={percent(t.portfolio.volatility)} />
          <Stat label="Sharpe ratio" value={decimal(t.portfolio.sharpe)} />
        </div>
        <AssetMixDonut slices={weightSlices(t)} />
        <DataTable table={weightsTable(t)} label="Weights of your textbook portfolio" />
        <Note>{`The risk-free fund (${t.risk_free_fund.name}) had a volatility of ${percent(t.risk_free_fund.volatility, 2)} over the window; the model treats it as zero.`}</Note>
      </Step>
    </div>
  );
}

export default function Textbook() {
  const [{ profile }] = useStore();
  const [risk, setRisk] = useState(profile.risk_level);
  const [model, setModel] = useState<ReturnModel>('capm');
  const [premium, setPremium] = useState('5');
  const body = textbookRequest(profile.base_currency, risk, model, premium.trim() === '' ? Number.NaN : Number(premium));
  const key = useDebounced(JSON.stringify(body), 300);
  const { state, reload } = useRequest(
    (signal) => api.POST('/api/textbook', { body: JSON.parse(key) as typeof body, signal }),
    key,
  );
  const last = useLastData(state, key);

  return (
    <>
      <PageHeader
        title="Textbook portfolio"
        lead="The portfolio you get from portfolio theory and the CAPM alone, built step by step from seven funds and a risk-free fund. It ignores your preferences and the main engine’s refinements."
      />
      <div className="stack">
        <Card title="Inputs">
          <div className="textbook-controls">
            <Field label={`Risk level: ${Math.round(risk)}`} hint="0 is the most cautious, 100 the most adventurous">
              <input type="range" min={0} max={100} step={1} value={risk} onChange={(e) => setRisk(Number(e.target.value))} />
            </Field>
            <div className="field">
              <span className="small muted">Expected returns</span>
              <Radio<ReturnModel> label="Expected returns" options={MODELS} value={model} onChange={setModel} fmt={(m) => MODEL_LABEL[m]} />
            </div>
            <Field label="Market premium (%)" hint="0 to 15; the slides give 5–7% historical, 3–5% in practice">
              <input type="number" min={0} max={15} step={0.5} value={premium} onChange={(e) => setPremium(e.target.value)} />
            </Field>
          </div>
        </Card>
        {state.status === 'error' && <ErrorBox message={state.message} onRetry={reload} />}
        {last
          ? <div className={state.status === 'loading' ? 'textbook-stale' : undefined}><Steps t={last.data} /></div>
          : state.status === 'loading' && <Loading />}
      </div>
    </>
  );
}
