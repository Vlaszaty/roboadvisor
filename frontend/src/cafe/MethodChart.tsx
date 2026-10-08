import { CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from '../components/charts/ChartFrame';
import { chartDescription, type ChartPoint, type Fmt, type MethodChartData } from './method';

const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 12 };
const LEGEND = { paddingBottom: 8, fontSize: 13 };
const legendText = (v: unknown) => <span style={{ color: 'var(--ink-2)' }}>{String(v)}</span>;
/** Lines are Scatter series without a point shape, so they never catch the hover. */
const NoPoint = () => <g />;
const dot = (r: number, fill: string, stroke = 'none') => ({ cx, cy }: { cx?: number; cy?: number }) =>
  cx === undefined || cy === undefined ? <g /> : <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />;
const CANDIDATE_DOT = dot(3, 'var(--ink-3)');
const HELD_DOT = dot(6, 'var(--series-1)', 'var(--surface, #fff)');

function Tip({ active, payload, f }: { active?: boolean; payload?: ReadonlyArray<{ payload?: ChartPoint }>; f: Fmt }) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p?.label) return null;
  return (
    <div className="tip">
      <div className="tip-title">{p.label}</div>
      <div>{f.t('Schommeling', 'Swing')}: <span className="num">{f.pct(p.x / 100)}</span></div>
      <div>{f.t('Verwacht rendement', 'Expected return')}: <span className="num">{f.pct(p.y / 100)}</span></div>
    </div>
  );
}

/** Risk-return chart of the candidates, the held funds, the best mixes, the recipe and the volatility target. */
export function MethodChart({ data, f }: { data: MethodChartData; f: Fmt }) {
  const pct = (v: number) => `${v.toFixed(1)}%`;
  return (
    <ChartFrame title={f.t('Alle kandidaten, de beste mixen en jouw recept', 'All candidates, the best mixes and your recipe')} description={chartDescription(data, f)}>
      <ResponsiveContainer width="100%" height={360}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
          <CartesianGrid stroke="var(--line-soft)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x" type="number" domain={[0, 'auto']} tickFormatter={pct} tick={AXIS_TICK} stroke="var(--line-soft)"
            name={f.t('Schommeling', 'Swing')} tickCount={6}
            label={{ value: f.t('Schommeling per jaar', 'Swing per year'), position: 'insideBottom', offset: -10, fill: 'var(--ink-3)', fontSize: 12 }}
          />
          <YAxis dataKey="y" type="number" domain={['auto', 'auto']} tickFormatter={pct} tick={AXIS_TICK} stroke="var(--line-soft)" width={56} name={f.t('Verwacht rendement', 'Expected return')} />
          <Tooltip content={<Tip f={f} />} cursor={false} />
          <Legend verticalAlign="top" wrapperStyle={LEGEND} itemSorter={null} formatter={legendText} />
          <ReferenceLine x={data.target} stroke="var(--accent)" strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain" />
          <Scatter
            data={data.frontier} dataKey="y" name={f.t('Beste mixen', 'Best mixes')} legendType="plainline" fill="var(--ink-2)"
            line={{ stroke: 'var(--ink-2)', strokeWidth: 2 }} shape={NoPoint} isAnimationActive={false}
          />
          <Scatter data={data.candidates} dataKey="y" name={f.t('Andere kandidaten', 'Other candidates')} fill="var(--ink-3)" shape={CANDIDATE_DOT} isAnimationActive={false} />
          <Scatter data={data.held} dataKey="y" name={f.t('In jouw recept', 'In your recipe')} fill="var(--series-1)" shape={HELD_DOT} isAnimationActive={false} />
          <Scatter data={[data.recipe]} dataKey="y" name={f.t('Jouw recept', 'Your recipe')} shape="star" fill="var(--series-2)" isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
      <p className="chart-note">{f.t(`De stippelijn is het doel voor de schommeling: ${f.pct(data.target / 100)} per jaar.`, `The dashed line is the swing target: ${f.pct(data.target / 100)} a year.`)}</p>
    </ChartFrame>
  );
}
