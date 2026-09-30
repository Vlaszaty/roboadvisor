import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Schemas } from '../api/client';
import { ChartFrame, Field } from '../components/charts/ChartFrame';
import { MetricsTable } from '../components/charts/MetricsTable';
import { EmptyState, ErrorBox, Loading } from '../components/charts/Status';
import { TimeChart } from '../components/charts/TimeChart';
import {
  defaultBacktestForm, describeRun, toBacktestSettings, validateBacktestForm, withMode, type BacktestForm,
} from '../components/charts/backtestForm';
import { decimal, errorMessage, percent } from '../components/charts/format';
import { backtestRows, SERIES_COLOR, comparisonColumns, drawdownChart, growthRows, growthSeries, lateReferences, referenceTitle, isProfileTouched, isoMonth, proxiedSpans, sampleEvenly } from '../components/charts/transforms';
import { Button, Card, LinkButton, PageHeader } from '../components/ui';
import { initialState, useStore } from '../state/store';
import '../components/charts/results.css';

type BacktestResult = Schemas['BacktestResult'];
interface Run {
  label: string;
  mode: BacktestForm['mode'];
  result: BacktestResult;
}

const PORTFOLIO = { key: 'portfolio', label: 'Portfolio', color: SERIES_COLOR.portfolio };

export default function Backtest() {
  const [{ profile, settings, score }] = useStore();
  const touched = isProfileTouched(profile, initialState.profile, score);

  const [form, setForm] = useState<BacktestForm>(defaultBacktestForm);
  const [current, setCurrent] = useState<Run | null>(null);
  const [previous, setPrevious] = useState<Run | null>(null);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const patch = (p: Partial<BacktestForm>) => setForm((f) => ({ ...f, ...p }));

  async function run() {
    const problem = validateBacktestForm(form);
    if (problem) {
      setError(problem);
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setError(null);
    try {
      const res = await api.POST('/api/backtest', {
        body: { profile, settings, backtest: toBacktestSettings(form) },
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) return;
      if (res.data === undefined) {
        setError(errorMessage(res.error));
        return;
      }
      setPrevious(current);
      setCurrent({ label: describeRun(form), mode: form.mode, result: res.data });
    } catch (e) {
      if (!ctl.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  }

  if (!touched) {
    return (
      <EmptyState
        title="Nothing to test yet"
        action={<LinkButton to="/start" variant="primary">Build my portfolio</LinkButton>}
      >
        Build a portfolio first, then test how it would have behaved in the past.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Test it historically"
        lead="Replay your portfolio through past markets. Past performance is no guarantee of future results."
      />

      <Card title="Settings">
        <form
          className="stack" style={{ gap: 'var(--space-4)' }}
          onSubmit={(e) => { e.preventDefault(); void run(); }}
        >
          <div className="form-grid">
            <Field
              label="Mode"
              hint={form.mode === 'static'
                ? "Uses today's recommended weights for the whole period."
                : 'Re-runs the engine at each rebalance date using only data available then.'}
            >
              <select className="input" value={form.mode} onChange={(e) => setForm((f) => withMode(f, e.target.value as BacktestForm['mode']))}>
                <option value="static">Static weights</option>
                <option value="walk_forward">Walk-forward</option>
              </select>
            </Field>
            <Field label="Rebalancing" hint={form.mode === 'walk_forward' ? 'Required for walk-forward.' : undefined}>
              <select className="input" value={form.rebalanceType} onChange={(e) => patch({ rebalanceType: e.target.value as BacktestForm['rebalanceType'] })}>
                <option value="none" disabled={form.mode === 'walk_forward'}>None (buy and hold)</option>
                <option value="periodic">Periodic</option>
                <option value="threshold">When weights drift</option>
              </select>
            </Field>
            {form.rebalanceType === 'periodic' && (
              <Field label="Frequency">
                <select className="input" value={form.frequency} onChange={(e) => patch({ frequency: e.target.value as BacktestForm['frequency'] })}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </Field>
            )}
            {form.rebalanceType === 'threshold' && (
              <Field label="Drift threshold (%)" hint="Rebalance when any weight is this far from target.">
                <input className="input" type="number" min="0.5" max="50" step="0.5" value={form.thresholdPct} onChange={(e) => patch({ thresholdPct: e.target.value })} />
              </Field>
            )}
            <Field label="Start date" hint="Blank = 15 years back.">
              <input className="input" type="date" value={form.start} onChange={(e) => patch({ start: e.target.value })} />
            </Field>
            <Field label="End date" hint="Blank = latest data.">
              <input className="input" type="date" value={form.end} onChange={(e) => patch({ end: e.target.value })} />
            </Field>
            <Field label="Transaction cost (bps)" hint="Charged on every trade, including the first purchase.">
              <input className="input" type="number" min="0" max="500" step="1" value={form.costBps} onChange={(e) => patch({ costBps: e.target.value })} />
            </Field>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Benchmark: automatic mix of global equities and bonds, matched to your portfolio&apos;s volatility.
          </p>
          <div className="row">
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Running…' : 'Run backtest'}</Button>
            {previous && current && (
              <label className="check">
                <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
                Compare with previous run
              </label>
            )}
          </div>
        </form>
      </Card>

      {error && <ErrorBox message={error} />}
      {busy && <Loading label="Running backtest…" />}
      {!current && !busy && !error && (
        <p className="muted">Choose your settings and press &ldquo;Run backtest&rdquo;.</p>
      )}
      {current && <BacktestResults run={current} />}
      {current && previous && compare && <CompareCard a={previous} b={current} />}
    </div>
  );
}

function BacktestResults({ run }: { run: Run }) {
  const { result } = run;
  const rows = useMemo(() => backtestRows(result.series), [result]);
  const growth = useMemo(() => growthRows(result), [result]);
  const series = growthSeries(result, true);
  const late = lateReferences(result);
  const domain: [number, number] = rows.length > 0 ? [rows[0].t, rows[rows.length - 1].t] : [0, 0];
  const spans = proxiedSpans(result.proxied_periods, domain);
  const rebalances = result.rebalance_dates ?? [];
  const warnings = (result.warnings ?? []).filter((w) => run.mode !== 'static' || !/look-ahead/i.test(w));
  const proxyNote = spans.length > 0
    ? <><span className="swatch swatch-proxy" />Shaded: part of the history comes from proxy series, not the funds themselves.</>
    : undefined;
  const money = (v: number) => `${decimal(v, 2)}×`;
  const sample = sampleEvenly(rows, 12);

  return (
    <div className="stack">
      {run.mode === 'static' && (
        <div className="banner" role="status">
          <strong>Look-ahead bias.</strong> Static mode uses weights chosen with today&apos;s knowledge, so the past looks
          better than it could have been in real time. Use walk-forward for an honest test.
        </div>
      )}
      {warnings.length > 0 && (
        <div className="banner" role="status"><ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>
      )}
      <p className="muted" style={{ margin: 0 }}>
        {run.label}. {rebalances.length === 0 ? 'No rebalancing trades.' : `Rebalanced ${rebalances.length} times.`}
      </p>

      <div className="results-grid grid-2">
        <Card title="Growth of 1.00">
          <ChartFrame
            title="Portfolio value vs benchmark, World and S&P 500"
            description="Line chart of the value of 1.00 invested in the portfolio, the benchmark, the world equity index and the S&P 500 over the backtest period."
            note={<>{proxyNote}{late.length > 0 && (
              <span style={{ display: 'block' }}>
                {late.map((r) => `${referenceTitle(r)} starts on ${r.start.slice(0, 10)}`).join('; ')}, after the start of the
                window, so its line and numbers cover a shorter period.
              </span>
            )}</>}
            table={{
              head: ['Month', ...series.map((s) => s.label)],
              rows: sampleEvenly(growth, 12).map((r) => [
                isoMonth(r.t), ...series.map((s) => { const v = r[s.key]; return v == null ? '–' : money(v); }),
              ]),
            }}
          >
            <TimeChart rows={growth} series={series} yFormat={money} spans={spans} />
          </ChartFrame>
        </Card>
        <Card title="Falls from the peak">
          <ChartFrame
            title="Portfolio drawdown"
            description="Area chart of how far the portfolio was below its previous peak at each point in time."
            note={proxyNote}
            table={{ head: ['Month', 'Drawdown'], rows: sample.map((r) => [isoMonth(r.t), percent(r.drawdown)]) }}
          >
            <TimeChart rows={rows} {...drawdownChart(PORTFOLIO.color)} spans={spans} />
          </ChartFrame>
        </Card>
        <Card title="Risk over time">
          <ChartFrame
            title="Rolling volatility (3 years)"
            description="Line chart of annualised volatility over a rolling three-year window."
            note={proxyNote}
            table={{ head: ['Month', 'Volatility'], rows: sample.map((r) => [isoMonth(r.t), percent(r.rollingVol)]) }}
          >
            <TimeChart rows={rows} series={[{ ...PORTFOLIO, key: 'rollingVol', label: 'Rolling volatility' }]} yFormat={(v) => percent(v, 0)} spans={spans} />
          </ChartFrame>
        </Card>
        <Card title="Return per unit of risk over time">
          <ChartFrame
            title="Rolling Sharpe ratio (3 years)"
            description="Line chart of the Sharpe ratio over a rolling three-year window."
            note={proxyNote}
            table={{ head: ['Month', 'Sharpe'], rows: sample.map((r) => [isoMonth(r.t), decimal(r.rollingSharpe)]) }}
          >
            <TimeChart rows={rows} series={[{ ...PORTFOLIO, key: 'rollingSharpe', label: 'Rolling Sharpe' }]} yFormat={(v) => decimal(v, 1)} spans={spans} />
          </ChartFrame>
        </Card>
      </div>

      <Card title="Key numbers">
        <MetricsTable
          caption="Backtest metrics for the portfolio, its benchmark, World and S&P 500"
          columns={comparisonColumns(result, true)}
        />
      </Card>
    </div>
  );
}

function CompareCard({ a, b }: { a: Run; b: Run }) {
  return (
    <Card title="Run A vs Run B">
      <MetricsTable
        caption="Portfolio metrics for the previous run (A) and the latest run (B)"
        showDelta
        columns={[
          { title: 'Run A', subtitle: a.label, values: a.result.metrics.portfolio },
          { title: 'Run B', subtitle: b.label, values: b.result.metrics.portfolio },
        ]}
      />
    </Card>
  );
}
