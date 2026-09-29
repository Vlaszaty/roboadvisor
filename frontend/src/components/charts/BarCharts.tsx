import { Bar, BarChart, CartesianGrid, Legend, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTip } from './ChartFrame';
import { percent } from './format';
import type { ProbabilityRow } from './transforms';

export interface BarSeries {
  key: 'monteCarlo' | 'normal';
  label: string;
  /** a CSS variable such as 'var(--series-1)' */
  color: string;
}

const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 12 };

/**
 * One or two bars per threshold (e.g. simulated vs normal). 4px rounded data ends on the baseline, a 2px surface
 * gap around each bar, direct value labels (at most 3 thresholds x 2 series), legend only for 2+ series.
 */
export function PairedBars({ rows, series }: { rows: ProbabilityRow[]; series: BarSeries[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 20, right: 12, bottom: 0, left: 0 }} barGap={4}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} stroke="var(--line)" />
        <YAxis tickFormatter={(v: number) => percent(v, 0)} tick={AXIS_TICK} stroke="var(--line)" width={48} domain={[0, 'auto']} />
        <Tooltip content={<ChartTip valueFormat={(v) => percent(v, 2)} />} cursor={{ fill: 'var(--band)' }} />
        {series.length > 1 && (
          <Legend
            verticalAlign="top" height={28}
            formatter={(value: unknown) => <span style={{ color: 'var(--ink-2)' }}>{String(value)}</span>}
          />
        )}
        {series.map((s) => (
          <Bar
            key={s.key} dataKey={s.key} name={s.label} fill={s.color} stroke="var(--surface)" strokeWidth={2}
            radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}
          >
            <LabelList
              dataKey={s.key} position="top" fill="var(--ink-2)" fontSize={12}
              formatter={(v: unknown) => percent(typeof v === 'number' ? v : null, 1)}
            />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
