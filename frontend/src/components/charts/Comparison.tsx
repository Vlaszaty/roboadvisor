import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Schemas } from '../../api/client';
import { useStore } from '../../state/store';
import { Card } from '../ui';
import { ChartFrame } from './ChartFrame';
import { MetricsTable } from './MetricsTable';
import { ReadingGuide } from './ReadingGuide';
import { Async, Loading } from './Status';
import { TimeChart } from './TimeChart';
import { comparisonRequest } from './backtestForm';
import { decimal } from './format';
import { useLastData, useRequest } from './hooks';
import {
  comparisonColumns, growthRows, growthSeries, isoMonth, lateReferences, referenceTitle, sampleEvenly, yearsAgo,
} from './transforms';
import './results.css';

export const PERIODS = [1, 3, 5, 10, 15] as const;
const KEYS = ['cagr', 'volatility', 'sharpe', 'max_drawdown'];

/** Today's weights applied to the last N years, against World and S&P 500. Not a track record: the weights were
 *  estimated on (part of) this period, so it flatters the portfolio; the walk-forward backtest is the honest test. */
export function Comparison() {
  const [{ profile, settings }] = useStore();
  const [years, setYears] = useState<(typeof PERIODS)[number]>(5);
  const name = useId();
  const start = useMemo(() => yearsAgo(years), [years]);
  const { state, reload } = useRequest(
    (signal) => api.POST('/api/backtest', {
      body: comparisonRequest(profile, settings, years),
      signal,
    }),
    JSON.stringify({ profile, settings, start }),
  );
  const last = useLastData(state, years);
  const span = (n: number) => `${n} ${n === 1 ? 'year' : 'years'}`;

  const render = (result: Schemas['BacktestResult'], n: number) => {
    const rows = growthRows(result);
    const series = growthSeries(result);
    const late = lateReferences(result);
    const money = (v: number) => `${decimal(v, 2)}×`;
    const sample = sampleEvenly(rows, 12);
    return (
      <>
        <ChartFrame
          title={`Growth of 1.00 over the last ${span(n)}`}
          description="Line chart of the value of 1.00 invested in the portfolio, the world equity index and the S&P 500."
          table={{
            head: ['Month', ...series.map((s) => s.label)],
            rows: sample.map((r) => [
              isoMonth(r.t),
              ...series.map((s) => { const v = r[s.key]; return v == null ? '–' : money(v); }),
            ]),
          }}
        >
          <TimeChart rows={rows} series={series} yFormat={money} />
        </ChartFrame>
        {late.length > 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            {late.map((r) => `${referenceTitle(r)} starts on ${r.start.slice(0, 10)}`).join('; ')}, after the start
            of this window, so its line and numbers cover a shorter period.
          </p>
        )}
        <MetricsTable caption={`Key numbers over the last ${span(n)}`} columns={comparisonColumns(result)} keys={KEYS} />
        <p className="muted small" style={{ margin: 0 }}>
          Trailing World, the S&amp;P 500 or a same-risk mix in a given period is expected: the weights come from
          forward-looking estimates spread across regions and asset classes, not from picking what did best.
        </p>
      </>
    );
  };

  return (
    <Card title={`Today's mix, applied to the last ${span(years)}`} explain="plan.past">
      <div className="stack">
        <div className="row">
          <div role="radiogroup" aria-label="Period" className="period">
            {PERIODS.map((n) => (
              <label key={n}>
                <input type="radio" name={name} value={n} checked={years === n} onChange={() => setYears(n)} />
                <span>{n}y</span>
              </label>
            ))}
          </div>
          <span className="muted small">Against world and US equities.</span>
        </div>
        <p className="banner" style={{ margin: 0 }}>
          Not a track record: these weights were chosen with data from this period. For an honest test, see the{' '}
          <Link to="/backtest">backtest</Link>, which only uses data available at each date.
        </p>
        {state.status === 'loading' && last ? (
          <div className="stack stale" aria-busy="true">
            <Loading label={`Loading the last ${span(years)}…`} className="sr-only" />
            {render(last.data, last.tag)}
          </div>
        ) : (
          <Async state={state} onRetry={reload}>{(result) => render(result, years)}</Async>
        )}
        <ReadingGuide />
      </div>
    </Card>
  );
}
