import { useId, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useStore } from '../../state/store';
import { Card } from '../ui';
import { ChartFrame } from './ChartFrame';
import { MetricsTable } from './MetricsTable';
import { ReadingGuide } from './ReadingGuide';
import { Async } from './Status';
import { TimeChart } from './TimeChart';
import { comparisonRequest } from './backtestForm';
import { decimal } from './format';
import { useRequest } from './hooks';
import {
  comparisonColumns, growthRows, growthSeries, isoMonth, lateReferences, referenceTitle, sampleEvenly, yearsAgo,
} from './transforms';
import './results.css';

export const PERIODS = [1, 3, 5, 10, 15] as const;
const KEYS = ['cagr', 'volatility', 'sharpe', 'max_drawdown'];

/** "Last N years" section: the current portfolio (static weights) against World and S&P 500 over a chosen window. */
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

  return (
    <Card title={`Last ${years} ${years === 1 ? 'year' : 'years'}`}>
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
          <span className="muted small">Today&apos;s weights applied to the past, against world and US equities.</span>
        </div>
        <Async state={state} onRetry={reload}>
          {(result) => {
            const rows = growthRows(result);
            const series = growthSeries(result);
            const late = lateReferences(result);
            const money = (v: number) => `${decimal(v, 2)}×`;
            const sample = sampleEvenly(rows, 12);
            return (
              <>
                <ChartFrame
                  title={`Growth of 1.00 over the last ${years} ${years === 1 ? 'year' : 'years'}`}
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
                <MetricsTable
                  caption={`Key numbers over the last ${years} ${years === 1 ? 'year' : 'years'}`}
                  columns={comparisonColumns(result)}
                  keys={KEYS}
                />
              </>
            );
          }}
        </Async>
        <ReadingGuide />
      </div>
    </Card>
  );
}
