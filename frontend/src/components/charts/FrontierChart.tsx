import { useEffect, useId, useState } from 'react';
import {
  CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../../api/client';
import { useStore } from '../../state/store';
import { Card } from '../ui';
import { ChartFrame } from './ChartFrame';
import { Async } from './Status';
import {
  frontierDescription, frontierNote, frontierRequest, frontierSeries, frontierTable, hasTextLabel, markerColor, markerLegend, markerShape, shortLabel,
  type Frame, type MarkerPoint, type Shape,
} from './frontier';
import { decimal } from './format';
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
      {p.sharpe != null && <div>Sharpe: <span className="num">{decimal(p.sharpe, 2)}</span></div>}
    </div>
  );
}


function ShapePath({ shape, r }: { shape: Shape; r: number }) {
  switch (shape) {
    case 'square': return <rect x={-r} y={-r} width={2 * r} height={2 * r} />;
    case 'diamond': return <polygon points={`0,${-1.3 * r} ${1.3 * r},0 0,${1.3 * r} ${-1.3 * r},0`} />;
    case 'triangle': return <polygon points={`0,${-1.3 * r} ${1.2 * r},${r} ${-1.2 * r},${r}`} />;
    case 'cross': return <path d={`M${-r},${-r} L${r},${r} M${-r},${r} L${r},${-r}`} strokeWidth={3} fill="none" />;
    default: return <circle r={r} />;
  }
}

/** Fixed label placement so labels never collide: portfolio above-left (clear of the model line), World to the left, S&P 500 above. */
const LABEL_POS: Record<string, { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = {
  portfolio: { dx: -12, dy: -16, anchor: 'end' },
  world: { dx: -10, dy: 4, anchor: 'end' },
  sp500: { dx: 0, dy: -12, anchor: 'middle' },
};

type ShapeProps = { cx?: number; cy?: number; payload?: MarkerPoint & { text?: string } };

function makeMarker(showRefLabels: boolean) {
  return function Marker({ cx, cy, payload }: ShapeProps) {
    if (cx == null || cy == null || !payload) return <g />;
    const color = markerColor(payload);
    const fund = payload.kind === 'fund';
    const r = payload.kind === 'portfolio' ? 8 : fund ? 3 : 5;
    const pos = LABEL_POS[payload.key] ?? LABEL_POS.sp500;
    const label = hasTextLabel(payload) && (showRefLabels || payload.kind === 'portfolio');
    return (
      <g transform={`translate(${cx},${cy})`}>
        <g fill={color} stroke={payload.kind === 'strategy' && markerShape(payload) === 'cross' ? color : 'var(--surface)'} strokeWidth={1.5} opacity={fund ? 0.35 : 1}>
          <ShapePath shape={markerShape(payload)} r={r} />
        </g>
        {label && (
          <text x={pos.dx} y={pos.dy} textAnchor={pos.anchor} className="frontier-label">{shortLabel(payload.label)}</text>
        )}
      </g>
    );
  };
}

function LegendIcon({ shape, color }: { shape: Shape; color: string }) {
  return (
    <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true" fill={color} stroke={color}>
      <ShapePath shape={shape} r={5} />
    </svg>
  );
}

function useNarrow(max = 500) {
  const q = `(max-width: ${max - 1}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return narrow;
}

/** Efficient frontier: model vs hindsight curves, capital market line and every marker in either frame. */
export function Frontier() {
  const [{ profile, settings }] = useStore();
  const [years, setYears] = useState<Lookback>(5);
  const [frame, setFrame] = useState<Frame>('model');
  const [funds, setFunds] = useState(false);
  const fundsId = useId();
  const narrow = useNarrow();
  const { state, reload } = useRequest(
    (signal) => api.POST('/api/frontier', { body: frontierRequest(profile, settings, years), signal }),
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
            const big = s.markers.filter((m) => m.kind !== 'fund');
            const legend = markerLegend(s.markers);
            const small = s.markers.filter((m) => m.kind === 'fund');
            const frameName = frame === 'model' ? 'model estimates' : 'hindsight (realised) returns';
            return (
              <>
                <ChartFrame
                  title="Risk and return: what the model expects versus what was possible"
                  description={frontierDescription(s.markers, frameName)}
                  note={frontierNote(frame, years, settings.strategy)}
                  table={frontierTable(f, funds)}
                >
                  <ul className="marker-legend" role="list" aria-label="Marker legend">
                    {legend.map((l) => (
                      <li key={l.key}><LegendIcon shape={l.shape} color={l.color} />{l.label}</li>
                    ))}
                  </ul>
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
                        data={s.modelCurve} dataKey="y" name="Model frontier" legendType="plainline" type="linear" stroke="var(--ink-2)"
                        strokeWidth={2} dot={false} isAnimationActive={false}
                      />
                      <Line
                        data={s.hindsightCurve} dataKey="y" name="Hindsight frontier" legendType="plainline" type="linear" stroke="var(--ink-2)"
                        strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false}
                      />
                      <Line
                        data={s.cml} dataKey="y" name="Capital market line" legendType="plainline" type="linear" stroke="var(--ink-3)"
                        strokeWidth={1.5} strokeDasharray="2 4" dot={false} isAnimationActive={false}
                      />
                      {small.length > 0 && (
                        <Scatter data={small} dataKey="y" name="Funds" legendType="none" isAnimationActive={false} shape={makeMarker(false)} />
                      )}
                      <Scatter
                        data={big} dataKey="y" name="Portfolio and benchmarks" legendType="none" isAnimationActive={false}
                        shape={makeMarker(!narrow)}
                      />
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
