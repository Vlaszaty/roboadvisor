import { useId, useState } from 'react';
import {
  CartesianGrid, Cell, ComposedChart, Legend, Line, LabelList, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../../api/client';
import { useStore } from '../../state/store';
import { Card } from '../ui';
import { ChartFrame } from './ChartFrame';
import { Async } from './Status';
import { frontierSeries, frontierTable, markerColor, type Frame, type MarkerPoint } from './frontier';
import { useRequest } from './hooks';
import './results.css';

const FRAMES: readonly Frame[] = ['model', 'hindsight'];
const LOOKBACKS = [1, 3, 5, 10] as const;
type Lookback = (typeof LOOKBACKS)[number];
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

function MarkerTip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Partial<MarkerPoint> & { x: number; y: number } }> }) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="tip">
      {p.label && <div className="tip-title">{p.label}</div>}
      <div>Volatility: <span className="num">{pct(p.x)}</span></div>
      <div>Expected return: <span className="num">{pct(p.y)}</span></div>
    </div>
  );
}

/** Efficient frontier: model vs hindsight curves, capital market line and every marker in either frame. */
export function Frontier() {
  const [{ profile, settings }] = useStore();
  const [years, setYears] = useState<Lookback>(5);
  const [frame, setFrame] = useState<Frame>('model');
  const [funds, setFunds] = useState(false);
  const fundsId = useId();
  const { state, reload } = useRequest(
    (signal) => api.POST('/api/frontier', { body: { profile, settings, lookback_years: years }, signal }),
    JSON.stringify({ profile, settings, years }),
  );

  return (
    <Card title="Efficient frontier">
      <div className="stack">
        <div className="row">
          <Radio<Lookback> label="Lookback" options={LOOKBACKS} value={years} onChange={setYears} fmt={(n) => `${n}y`} />
          <Radio<Frame>
            label="Positions" options={FRAMES} value={frame} onChange={setFrame}
            fmt={(v) => (v === 'model' ? 'Model' : 'Hindsight')}
          />
          <label htmlFor={fundsId} className="row small" style={{ gap: 'var(--space-2)' }}>
            <input id={fundsId} type="checkbox" checked={funds} onChange={(e) => setFunds(e.target.checked)} />
            Show individual funds
          </label>
        </div>
        <Async state={state} onRetry={reload}>
          {(f) => {
            const s = frontierSeries(f, frame, funds);
            const big = s.markers.filter((m) => m.kind !== 'fund').map((m) => ({ ...m, text: m.label.replace(/\s*\(.*\)/, '') }));
            const small = s.markers.filter((m) => m.kind === 'fund');
            const frameName = frame === 'model' ? 'model estimates' : 'hindsight (realised) returns';
            return (
              <>
                <ChartFrame
                  title="Risk and return: what the model expects versus what was possible"
                  description={`Scatter and line chart of volatility against expected return, in percent. Curves: model frontier, hindsight frontier, capital market line. Markers are placed using ${frameName}: ${s.markers.map((m) => `${m.label} at ${pct(m.x)} volatility and ${pct(m.y)} return`).join('; ')}.`}
                  note={
                    <>
                      Your portfolio sits on the model curve by construction. The hindsight curve shows what would have
                      been best with perfect knowledge of the last {years === 1 ? 'year' : `${years} years`};
                      the gap between the two is the price of not knowing the future.
                    </>
                  }
                  table={frontierTable(f)}
                >
                  <ResponsiveContainer width="100%" height={360}>
                    <ComposedChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
                      <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="x" type="number" domain={['auto', 'auto']} tickFormatter={pct} tick={AXIS_TICK}
                        stroke="var(--line)" name="Volatility" tickCount={6}
                        label={{ value: 'Volatility (per year)', position: 'insideBottom', offset: -10, fill: 'var(--ink-3)', fontSize: 12 }}
                      />
                      <YAxis
                        dataKey="y" type="number" domain={['auto', 'auto']} tickFormatter={pct} tick={AXIS_TICK}
                        stroke="var(--line)" width={56} name="Expected return"
                      />
                      <Tooltip content={<MarkerTip />} cursor={{ stroke: 'var(--ink-3)' }} />
                      <Legend
                        verticalAlign="top" wrapperStyle={{ paddingBottom: 8, fontSize: 13 }} itemSorter={null}
                        formatter={(v: unknown) => <span style={{ color: 'var(--ink-2)' }}>{String(v)}</span>}
                      />
                      <Line
                        data={s.modelCurve} dataKey="y" name="Model frontier" type="linear" stroke="var(--series-1)"
                        strokeWidth={2} dot={false} isAnimationActive={false}
                      />
                      <Line
                        data={s.hindsightCurve} dataKey="y" name="Hindsight frontier" type="linear" stroke="var(--series-2)"
                        strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false}
                      />
                      <Line
                        data={s.cml} dataKey="y" name="Capital market line" type="linear" stroke="var(--ink-3)"
                        strokeWidth={1.5} strokeDasharray="2 4" dot={false} isAnimationActive={false}
                      />
                      {small.length > 0 && (
                        <Scatter data={small} dataKey="y" name="Funds" legendType="none" isAnimationActive={false}>
                          {small.map((m) => <Cell key={m.key} fill={markerColor(m)} fillOpacity={0.35} r={3} />)}
                        </Scatter>
                      )}
                      <Scatter data={big} dataKey="y" name="Portfolio and benchmarks" legendType="none" isAnimationActive={false}>
                        {big.map((m) => (
                          <Cell key={m.key} fill={markerColor(m)} stroke="var(--surface)" strokeWidth={1.5} r={m.kind === 'portfolio' ? 8 : 5} />
                        ))}
                        <LabelList
                          dataKey="text" position="top" offset={10}
                          style={{ fill: 'var(--ink-2)', fontSize: 11 }}
                        />
                      </Scatter>
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartFrame>
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
