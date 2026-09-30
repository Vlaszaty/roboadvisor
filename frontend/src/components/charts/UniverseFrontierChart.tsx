import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../../api/client';
import { useStore } from '../../state/store';
import { Card } from '../ui';
import { ChartFrame } from './ChartFrame';
import { decimal } from './format';
import { useRequest } from './hooks';
import { Async } from './Status';
import { assetClassColor, assetClassLabel } from './transforms';
import { filtersToQuery, type FundFilters } from './universe';
import {
  universeLegend, universeNote, universeRequest, universeSeries, universeTable, type UFrame, type UPoint,
} from './universeFrontier';
import './results.css';

const PERIODS = [1, 3, 5, 10] as const;
type Period = (typeof PERIODS)[number];
const FRAMES: readonly UFrame[] = ['model', 'realised'];
const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 12 };
const pct = (v: number) => `${v.toFixed(1)}%`;

function Radio<T extends string | number>({
  label, options, value, onChange, fmt,
}: { label: string; options: readonly T[]; value: T; onChange: (v: T) => void; fmt: (v: T) => string }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="period">
      {options.map((o) => (
        <label key={o}>
          <input type="radio" name={name} value={o} checked={value === o} onChange={() => onChange(o)} />
          <span>{fmt(o)}</span>
        </label>
      ))}
    </div>
  );
}

function PointTip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Partial<UPoint> }> }) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p?.label || p.x == null || p.y == null) return null;
  return (
    <div className="tip">
      <div className="tip-title">{p.label}</div>
      <div>{assetClassLabel(p.assetClass ?? '')}</div>
      <div>Volatility: <span className="num">{pct(p.x)}</span></div>
      <div>Return: <span className="num">{pct(p.y)}</span></div>
      {p.sharpe != null && <div>Sharpe: <span className="num">{decimal(p.sharpe, 2)}</span></div>}
      {p.proxied && <div className="muted">Proxied history in this period</div>}
    </div>
  );
}

/** Curves are Scatter series drawn as lines only: no point shape, so they never catch the hover. */
const NoPoint = () => <g />;

/** Every ETF matching the page filters on one risk/return chart; Model (with frontier) or Realised (no curve). */
export function UniverseFrontier({ filters }: { filters: FundFilters }) {
  const [{ profile }] = useStore();
  const navigate = useNavigate();
  const [years, setYears] = useState<Period>(5);
  const [frame, setFrame] = useState<UFrame>('model');
  const base = profile.base_currency;
  const { state, reload } = useRequest(
    (signal) => api.POST('/api/universe/frontier', { body: universeRequest(filters, years, base), signal }),
    JSON.stringify({ q: filtersToQuery(filters), years, base }),
  );

  return (
    <Card title="Risk and return">
      <div className="stack">
        <div className="row">
          <Radio<Period> label="Period" options={PERIODS} value={years} onChange={setYears} fmt={(n) => `${n}y`} />
          <Radio<UFrame> label="Frame" options={FRAMES} value={frame} onChange={setFrame} fmt={(v) => (v === 'model' ? 'Model' : 'Realised')} />
        </div>
        <Async state={state} onRetry={reload}>
          {(f) => {
            const s = universeSeries(f, frame);
            if (f.points.length === 0) return <p className="muted">No funds match these filters.</p>;
            const legend = universeLegend(s.points);
            const byClass = legend.map((l) => ({ ...l, data: s.points.filter((p) => p.assetClass === l.key) }));
            const what = frame === 'model' ? 'what the model expects' : 'what happened';
            return (
              <>
                <ChartFrame
                  title={`Risk and return of these ETFs: ${what}`}
                  description={`Scatter chart of volatility against ${frame === 'model' ? 'expected' : 'realised'} return, in percent, for ${s.points.length} funds coloured by asset class${frame === 'model' ? ', with the efficient frontier and the capital market line' : ''}.`}
                  note={universeNote(frame, years)}
                  table={universeTable(f, frame)}
                >
                  <ul className="marker-legend" role="list" aria-label="Asset classes">
                    {legend.map((l) => (
                      <li key={l.key}>
                        <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true"><circle r={5} fill={l.color} /></svg>
                        {l.label}
                      </li>
                    ))}
                  </ul>
                  <ResponsiveContainer width="100%" height={380}>
                    {/* ScatterChart, not ComposedChart: recharts 3 ComposedChart only has axis tooltips. */}
                    <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
                      <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="x" type="number" domain={['auto', 'auto']} tickFormatter={pct} tick={AXIS_TICK}
                        stroke="var(--line)" name="Volatility" tickCount={6}
                        label={{ value: 'Volatility (per year)', position: 'insideBottom', offset: -10, fill: 'var(--ink-3)', fontSize: 12 }}
                      />
                      <YAxis dataKey="y" type="number" domain={['auto', 'auto']} tickFormatter={pct} tick={AXIS_TICK} stroke="var(--line)" width={56} name="Return" />
                      <Tooltip content={<PointTip />} cursor={false} />
                      {frame === 'model' && (
                        <Legend
                          verticalAlign="top" wrapperStyle={{ paddingBottom: 8, fontSize: 13 }} itemSorter={null}
                          formatter={(v: unknown) => <span style={{ color: 'var(--ink-2)' }}>{String(v)}</span>}
                        />
                      )}
                      {frame === 'model' && (
                        <Scatter
                          data={s.curve} dataKey="y" name="Efficient frontier" legendType="plainline" fill="var(--ink-2)"
                          line={{ stroke: 'var(--ink-2)', strokeWidth: 2 }} shape={NoPoint} isAnimationActive={false}
                        />
                      )}
                      {frame === 'model' && (
                        <Scatter
                          data={s.cml} dataKey="y" name="Capital market line" legendType="plainline" fill="var(--ink-3)"
                          stroke="var(--ink-3)" strokeDasharray="2 4"
                          line={{ stroke: 'var(--ink-3)', strokeWidth: 1.5, strokeDasharray: '2 4' }} shape={NoPoint} isAnimationActive={false}
                        />
                      )}
                      {byClass.map((c) => (
                        <Scatter
                          key={c.key} data={c.data} dataKey="y" name={c.label} legendType="none" fill={assetClassColor(c.key)}
                          isAnimationActive={false} style={{ cursor: 'pointer' }}
                          onClick={(p: { payload?: UPoint }) => p.payload && navigate(`/universe/${p.payload.isin}`)}
                        />
                      ))}
                    </ScatterChart>
                  </ResponsiveContainer>
                </ChartFrame>
                {s.missing > 0 && (
                  <p className="muted small" style={{ margin: 0 }}>
                    {s.missing} {s.missing === 1 ? 'fund has' : 'funds have'} too little history in this period.
                  </p>
                )}
                {(f.warnings ?? []).length > 0 && (
                  <p className="muted small" style={{ margin: 0 }}>{(f.warnings ?? []).join(' ')}</p>
                )}
              </>
            );
          }}
        </Async>
      </div>
    </Card>
  );
}
