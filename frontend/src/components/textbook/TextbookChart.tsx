import { CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from '../charts/ChartFrame';
import { chartDescription, chartSeries, chartTable, smlSeries, type Layer, type Textbook, type XY } from './textbook';

const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 12 };
const pct = (v: number) => `${v.toFixed(1)}%`;
const LEGEND = { paddingBottom: 8, fontSize: 13 };
const legendText = (v: unknown) => <span style={{ color: 'var(--ink-2)' }}>{String(v)}</span>;
/** Lines are Scatter series without a point shape, so they never catch the hover. */
const NoPoint = () => <g />;

function PointTip({ active, payload, xName, xFormat }: {
  active?: boolean; payload?: ReadonlyArray<{ payload?: XY }>; xName: string; xFormat: (v: number) => string;
}) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p?.label) return null;
  return (
    <div className="tip">
      <div className="tip-title">{p.label}</div>
      <div>{xName}: <span className="num">{xFormat(p.x)}</span></div>
      <div>Expected return: <span className="num">{pct(p.y)}</span></div>
    </div>
  );
}

/** Funds and frontier; from 'tangent' also the risk-free fund, capital market line and tangent; from 'split' your portfolio. */
export function RiskReturnChart({ t, layer, title }: { t: Textbook; layer: Layer; title: string }) {
  const s = chartSeries(t, layer);
  return (
    <ChartFrame title={title} description={chartDescription(layer)} table={chartTable(t, layer)}>
      <ResponsiveContainer width="100%" height={360}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x" type="number" domain={[0, 'auto']} tickFormatter={pct} tick={AXIS_TICK} stroke="var(--line)"
            name="Volatility" tickCount={6}
            label={{ value: 'Volatility (per year)', position: 'insideBottom', offset: -10, fill: 'var(--ink-3)', fontSize: 12 }}
          />
          <YAxis dataKey="y" type="number" domain={['auto', 'auto']} tickFormatter={pct} tick={AXIS_TICK} stroke="var(--line)" width={56} name="Expected return" />
          <Tooltip content={<PointTip xName="Volatility" xFormat={pct} />} cursor={false} />
          <Legend verticalAlign="top" wrapperStyle={LEGEND} itemSorter={null} formatter={legendText} />
          <Scatter
            data={s.frontier} dataKey="y" name="Efficient frontier" legendType="plainline" fill="var(--ink-2)"
            line={{ stroke: 'var(--ink-2)', strokeWidth: 2 }} shape={NoPoint} isAnimationActive={false}
          />
          {s.cml.length > 0 && (
            <Scatter
              data={s.cml} dataKey="y" name="Capital market line" legendType="plainline" fill="var(--ink-3)"
              line={{ stroke: 'var(--ink-3)', strokeWidth: 1.5, strokeDasharray: '2 4' }} shape={NoPoint} isAnimationActive={false}
            />
          )}
          <Scatter data={s.funds} dataKey="y" name="Funds" fill="var(--series-1)" isAnimationActive={false} />
          {s.riskFree.length > 0 && <Scatter data={s.riskFree} dataKey="y" name="Risk-free fund" shape="square" fill="var(--ink-3)" isAnimationActive={false} />}
          {s.tangent.length > 0 && <Scatter data={s.tangent} dataKey="y" name="Tangent portfolio" shape="diamond" fill="var(--series-2)" isAnimationActive={false} />}
          {s.investor.length > 0 && <Scatter data={s.investor} dataKey="y" name="Your portfolio" shape="star" fill="var(--series-3)" isAnimationActive={false} />}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

const beta = (v: number) => v.toFixed(2);

/** Security market line: every fund's CAPM return lies on the line through (0, rf) with slope = market premium. */
export function SmlChart({ t }: { t: Textbook }) {
  const s = smlSeries(t);
  return (
    <ChartFrame
      title="Security market line"
      description="Scatter chart of beta against CAPM expected return in percent; all seven funds lie on one straight line."
    >
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x" type="number" domain={['auto', 'auto']} tickFormatter={beta} tick={AXIS_TICK} stroke="var(--line)" name="Beta"
            label={{ value: 'Beta', position: 'insideBottom', offset: -10, fill: 'var(--ink-3)', fontSize: 12 }}
          />
          <YAxis dataKey="y" type="number" domain={['auto', 'auto']} tickFormatter={pct} tick={AXIS_TICK} stroke="var(--line)" width={56} name="Expected return" />
          <Tooltip content={<PointTip xName="Beta" xFormat={beta} />} cursor={false} />
          <Scatter
            data={s.line} dataKey="y" name="Security market line" fill="var(--ink-2)"
            line={{ stroke: 'var(--ink-2)', strokeWidth: 2 }} shape={NoPoint} isAnimationActive={false}
          />
          <Scatter data={s.funds} dataKey="y" name="Funds" fill="var(--series-1)" isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
