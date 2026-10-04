import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Schemas } from '../api/client';
import { ChartFrame } from '../components/charts/ChartFrame';
import { MetricsTable } from '../components/charts/MetricsTable';
import { EmptyState, ErrorBox } from '../components/charts/Status';
import { TimeChart } from '../components/charts/TimeChart';
import {
  defaultBacktestForm, describeRun, toBacktestSettings, validateBacktestForm, withMode, type BacktestForm,
} from '../components/charts/backtestForm';
import { decimal, errorMessage, money as fmtMoney, percent } from '../components/charts/format';
import { replayMoney } from '../components/charts/replayMoney';
import {
  backtestRows, SERIES_COLOR, comparisonColumns, drawdownChart, growthRows, growthSeries, isProfileTouched, isoMonth,
  lateReferences, proxiedSpans, referenceTitle, sampleEvenly, yearsAgo,
} from '../components/charts/transforms';
import { Chapter, Details } from '../components/Story';
import { Card, LinkButton, PageHeader } from '../components/ui';
import { Term } from '../glossary/Term';
import { initialState, useStore } from '../state/store';
import '../components/charts/results.css';
import './Backtest.css';

type BacktestResult = Schemas['BacktestResult'];
interface Run {
  label: string;
  mode: BacktestForm['mode'];
  result: BacktestResult;
}

const PORTFOLIO = { key: 'portfolio', label: 'Your plan', color: SERIES_COLOR.portfolio };
const YEARS = [3, 5, 10, 15] as const;

type Tidy = 'none' | 'monthly' | 'quarterly' | 'annual' | 'threshold';
const tidyOf = (f: BacktestForm): Tidy => (f.rebalanceType === 'periodic' ? f.frequency : f.rebalanceType);

function withTidy(f: BacktestForm, t: Tidy): BacktestForm {
  if (t === 'none' || t === 'threshold') return { ...f, rebalanceType: t };
  return { ...f, rebalanceType: 'periodic', frequency: t };
}

/** Honest replay by default, over the last 5 years. */
const startForm = (): BacktestForm => withMode({ ...defaultBacktestForm, start: yearsAgo(5) }, 'walk_forward');

export default function Backtest() {
  const [{ profile, settings, score }] = useStore();
  const touched = isProfileTouched(profile, initialState.profile, score);

  const [form, setForm] = useState<BacktestForm>(startForm);
  const [years, setYears] = useState<number | null>(5);
  const [current, setCurrent] = useState<Run | null>(null);
  const [previous, setPrevious] = useState<Run | null>(null);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const patch = (p: Partial<BacktestForm>) => setForm((f) => ({ ...f, ...p }));
  const pickYears = (n: number) => {
    setYears(n);
    patch({ start: yearsAgo(n), end: '' });
  };

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

  // Replay straight away, and again a moment after any change.
  const key = JSON.stringify({ form, profile, settings });
  useEffect(() => {
    if (!touched) return;
    const t = setTimeout(() => void run(), current ? 450 : 0);
    return () => clearTimeout(t);
    // `run` reads the latest state through this render's closure; `key` describes every input it uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, touched]);

  if (!touched) {
    return (
      <EmptyState
        title="Nothing to replay yet"
        action={<LinkButton to="/start" variant="primary">Build my plan</LinkButton>}
      >
        Build a plan first, then see how it would have done in the past.
      </EmptyState>
    );
  }

  const walk = form.mode === 'walk_forward';

  return (
    <div className="replay">
      <PageHeader
        title="How it did"
        lead="Your plan, replayed through real past markets. The past does not predict the future, but it shows how bumpy the ride can be."
      />

      <section className="replay-controls card" aria-labelledby="replay-h">
        <h2 id="replay-h" className="replay-h">Your replay</h2>

        <fieldset className="replay-group">
          <legend>How far back?</legend>
          <div className="replay-chips" role="radiogroup" aria-label="How far back">
            {YEARS.map((n) => (
              <label key={n} className={`replay-chip ${years === n ? 'is-selected' : ''}`}>
                <input type="radio" name="years" value={n} checked={years === n} onChange={() => pickYears(n)} />
                {n} years
              </label>
            ))}
            {years === null && <span className="replay-chip is-selected" aria-live="polite">Your dates</span>}
          </div>
        </fieldset>

        <fieldset className="replay-group">
          <legend>How honest should the replay be?</legend>
          <div className="replay-modes" role="radiogroup" aria-label="Replay type">
            <label className={`replay-mode ${walk ? 'is-selected' : ''}`}>
              <input type="radio" name="mode" checked={walk} onChange={() => setForm((f) => withMode(f, 'walk_forward'))} />
              <span className="replay-mode-title">Honest replay <span className="replay-tag">Recommended</span></span>
              <span className="replay-mode-note">Rebuilds your plan every quarter, using only what was known at the time. No hindsight.</span>
            </label>
            <label className={`replay-mode ${!walk ? 'is-selected' : ''}`}>
              <input type="radio" name="mode" checked={!walk} onChange={() => setForm((f) => withMode(f, 'static'))} />
              <span className="replay-mode-title">Quick look</span>
              <span className="replay-mode-note">Uses today&apos;s plan for the whole past. Fast, but it flatters the result because it uses hindsight.</span>
            </label>
          </div>
        </fieldset>

        <Details title="More options" hint="How often to tidy the mix, your own dates, trading cost">
          <div className="replay-more">
            <label className="replay-field">
              <span><Term id="rebalancing">How often to tidy the mix</Term></span>
              <select className="input" value={tidyOf(form)} onChange={(e) => setForm((f) => withTidy(f, e.target.value as Tidy))}>
                <option value="none" disabled={walk}>Never</option>
                <option value="monthly">Every month</option>
                <option value="quarterly">Every quarter</option>
                <option value="annual">Every year</option>
                <option value="threshold">When it drifts from plan</option>
              </select>
              {walk && <span className="small muted">An honest replay needs regular tidying.</span>}
            </label>
            {form.rebalanceType === 'threshold' && (
              <label className="replay-field">
                <span>How far it may drift (%)</span>
                <input className="input" type="number" min="0.5" max="50" step="0.5" value={form.thresholdPct} onChange={(e) => patch({ thresholdPct: e.target.value })} />
              </label>
            )}
            <label className="replay-field">
              <span>Start date</span>
              <input className="input" type="date" value={form.start} onChange={(e) => { setYears(null); patch({ start: e.target.value }); }} />
            </label>
            <label className="replay-field">
              <span>End date</span>
              <input className="input" type="date" value={form.end} onChange={(e) => { setYears(null); patch({ end: e.target.value }); }} />
              <span className="small muted">Leave empty for the latest data.</span>
            </label>
            <label className="replay-field">
              <span>Trading cost per trade (%)</span>
              <input
                className="input" type="number" min="0" max="5" step="0.05"
                value={form.costBps.trim() === '' ? '' : String(Number(form.costBps) / 100)}
                onChange={(e) => patch({ costBps: e.target.value.trim() === '' ? '' : String(Math.round(Number(e.target.value) * 100)) })}
              />
              <span className="small muted">Charged on every trade, including the first purchase.</span>
            </label>
          </div>
        </Details>

        <p className="small muted replay-bench">
          The comparison mix is a simple blend of world shares and bonds with about the same ups and downs as your plan (<Term id="benchmark">more</Term>).
        </p>
        {previous && current && (
          <label className="check">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            Compare with my previous replay
          </label>
        )}
      </section>

      {error && <ErrorBox message={error} />}
      {!current && !error && <p className="muted" role="status">Replaying the past…</p>}
      {current && (
        <div className={busy ? 'stale' : undefined} aria-busy={busy}>
          <ReplayResults run={current} />
          {previous && compare && <CompareCard a={previous} b={current} />}
        </div>
      )}
    </div>
  );
}

function ReplayResults({ run }: { run: Run }) {
  const [{ profile }] = useStore();
  const { result } = run;
  const currency = profile.base_currency;
  const once = profile.initial_amount ?? 0;
  const monthly = profile.monthly_amount ?? 0;
  const rows = useMemo(() => backtestRows(result.series), [result]);
  const growth = useMemo(() => growthRows(result), [result]);
  const series = growthSeries(result, true);
  const late = lateReferences(result);
  const domain: [number, number] = rows.length > 0 ? [rows[0].t, rows[rows.length - 1].t] : [0, 0];
  const spans = proxiedSpans(result.proxied_periods, domain);
  const rebalances = result.rebalance_dates ?? [];
  const warnings = (result.warnings ?? []).filter((w) => run.mode !== 'static' || !/look-ahead/i.test(w));
  const proxyNote = spans.length > 0
    ? <><span className="swatch swatch-proxy" />Shaded: part of the history comes from <Term id="proxy">older stand-in data</Term>, not the funds themselves.</>
    : undefined;
  const times = (v: number) => `${decimal(v, 2)}×`;
  const sample = sampleEvenly(rows, 12);

  const last = growth[growth.length - 1];
  const spanYears = growth.length > 1 ? (growth[growth.length - 1].t - growth[0].t) / (365.25 * 86_400_000) : 0;
  const m = result.metrics.portfolio ?? {};
  const own = ['portfolio', 'world', 'sp500', 'benchmark'].map((k) => ({
    key: k, money: replayMoney(growth, k, once, monthly),
  }));
  const ownPlan = own.find((o) => o.key === 'portfolio')?.money;
  const tiles: Array<{ key: string; label: string; mult: number | null | undefined }> = [
    { key: 'portfolio', label: 'Your plan', mult: last?.portfolio },
    { key: 'world', label: 'World shares', mult: last?.world },
    { key: 'sp500', label: 'S&P 500', mult: last?.sp500 },
    { key: 'benchmark', label: 'Comparison mix', mult: last?.benchmark },
  ];
  const yrsText = spanYears >= 1 ? `${Math.round(spanYears * 10) / 10} years` : 'this period';

  return (
    <div className="replay-results">
      {run.mode === 'static' && (
        <div className="banner" role="status">
          <strong>This quick look uses hindsight.</strong> It applies today&apos;s plan to the past, so the past looks better than
          it could have been at the time. Choose the honest replay for a fairer test.
        </div>
      )}
      {warnings.length > 0 && (
        <div className="banner" role="status"><ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>
      )}

      <section className="replay-summary card" aria-labelledby="sum-h">
        <h2 id="sum-h" className="replay-h">What would have happened</h2>
        {ownPlan ? (
          <p className="replay-big">
            Over {yrsText}, you would have paid in <strong className="num">{fmtMoney(ownPlan.paidIn, currency)}</strong> and ended with about{' '}
            <strong className="num">{fmtMoney(ownPlan.value, currency)}</strong>.
          </p>
        ) : (
          <p className="replay-big">
            Over {yrsText}, <strong className="num">1,000</strong> in your plan would have become about{' '}
            <strong className="num">{last?.portfolio != null ? Math.round(1000 * last.portfolio).toLocaleString('en-US') : '–'}</strong>.
          </p>
        )}
        <div className="replay-tiles">
          {tiles.map((t) => {
            const mm = own.find((o) => o.key === t.key)?.money;
            return (
              <div key={t.key} className={`replay-tile ${t.key === 'portfolio' ? 'is-you' : ''}`}>
                <span className="replay-tile-label">{t.label}</span>
                <span className="replay-tile-value num">
                  {mm ? fmtMoney(mm.value, currency) : t.mult != null ? `${Math.round(1000 * t.mult).toLocaleString('en-US')}` : '–'}
                </span>
                <span className="replay-tile-sub">{mm ? 'same deposits' : 'from 1,000'}</span>
              </div>
            );
          })}
        </div>
        <ul className="replay-facts">
          <li><span><Term id="cagr">Average yearly growth</Term></span><strong className="num">{percent(m.cagr)}</strong></li>
          <li><span><Term id="drawdown">Worst fall</Term></span><strong className="num neg">{percent(m.max_drawdown)}</strong></li>
          <li><span>Longest time below its high</span><strong className="num">{m.max_drawdown_duration != null ? `${Math.round(m.max_drawdown_duration)} weeks` : '–'}</strong></li>
        </ul>
        <p className="small muted">
          {run.label}. {rebalances.length === 0 ? 'No tidying trades.' : `Tidied ${rebalances.length} times.`} Past results do not predict the future.
        </p>
      </section>

      <Chapter id="growth" number={1} title="How it grew" lead="Your plan next to the world stock market, the S&P 500 and a simple comparison mix.">
        <Card>
          <ChartFrame
            title="How an investment would have grown, as a multiple of what you put in"
            description="Line chart of the value of 1.00 invested in the plan, the comparison mix, the world equity index and the S&P 500 over the replay period."
            note={<>{proxyNote}{late.length > 0 && (
              <span style={{ display: 'block' }}>
                {late.map((r) => `${referenceTitle(r)} starts on ${r.start.slice(0, 10)}`).join('; ')}, after the start of the
                window, so its line and numbers cover a shorter period.
              </span>
            )}</>}
            table={{
              head: ['Month', ...series.map((s) => s.label)],
              rows: sampleEvenly(growth, 12).map((r) => [
                isoMonth(r.t), ...series.map((s) => { const v = r[s.key]; return v == null ? '–' : times(v); }),
              ]),
            }}
          >
            <TimeChart rows={growth} series={series} yFormat={times} spans={spans} />
          </ChartFrame>
        </Card>
      </Chapter>

      <Chapter id="falls" number={2} title="The bad stretches" lead="How far your plan fell below its highest point, and when.">
        <Card>
          <ChartFrame
            title="Fall from the highest point so far"
            description="Area chart of how far the plan was below its previous peak at each point in time."
            note={proxyNote}
            table={{ head: ['Month', 'Fall'], rows: sample.map((r) => [isoMonth(r.t), percent(r.drawdown)]) }}
          >
            <TimeChart rows={rows} {...drawdownChart(PORTFOLIO.color)} spans={spans} />
          </ChartFrame>
        </Card>
      </Chapter>

      <Chapter id="numbers" number={3} title="The numbers" lead="Everything side by side, with plain names.">
        <Card>
          <MetricsTable
            caption="Replay numbers for your plan, the comparison mix, world shares and the S&P 500"
            columns={comparisonColumns(result, true)}
          />
        </Card>
        <Details title="More charts" hint="Ups and downs over time, reward for the risk over time">
          <Card>
            <ChartFrame
              title="Typical ups and downs, over a rolling 3 years"
              description="Line chart of annualised volatility over a rolling three-year window."
              note={proxyNote}
              table={{ head: ['Month', 'Ups and downs'], rows: sample.map((r) => [isoMonth(r.t), percent(r.rollingVol)]) }}
            >
              <TimeChart rows={rows} series={[{ ...PORTFOLIO, key: 'rollingVol', label: 'Ups and downs' }]} yFormat={(v) => percent(v, 0)} spans={spans} />
            </ChartFrame>
          </Card>
          <Card>
            <ChartFrame
              title="Reward for the risk, over a rolling 3 years"
              description="Line chart of the Sharpe ratio over a rolling three-year window."
              note={proxyNote}
              table={{ head: ['Month', 'Reward for the risk'], rows: sample.map((r) => [isoMonth(r.t), decimal(r.rollingSharpe)]) }}
            >
              <TimeChart rows={rows} series={[{ ...PORTFOLIO, key: 'rollingSharpe', label: 'Reward for the risk' }]} yFormat={(v) => decimal(v, 1)} spans={spans} />
            </ChartFrame>
          </Card>
        </Details>
      </Chapter>
    </div>
  );
}

function CompareCard({ a, b }: { a: Run; b: Run }) {
  return (
    <Card title="Previous replay and this one">
      <MetricsTable
        caption="Plan numbers for the previous replay (A) and the latest replay (B)"
        showDelta
        columns={[
          { title: 'Previous', subtitle: a.label, values: a.result.metrics.portfolio },
          { title: 'This one', subtitle: b.label, values: b.result.metrics.portfolio },
        ]}
      />
    </Card>
  );
}
