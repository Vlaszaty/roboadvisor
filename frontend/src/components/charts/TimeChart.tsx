import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ChartTip } from './ChartFrame';
import { isoMonth, yearTick, yearTicks, type Span } from './transforms';

export interface TimeSeriesSpec {
  key: string;
  label: string;
  /** a CSS variable such as 'var(--series-1)' */
  color: string;
  kind?: 'line' | 'area';
}

const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 12 };

/**
 * Line/area chart over a numeric time axis (`t` = epoch ms). Fixed marks: 2px lines, no dots, faint horizontal grid.
 * `spans` are shaded with the --band token (used for proxied history). Legend appears for 2+ series only.
 */
export function TimeChart<T extends { t: number }>({
  rows, series, yFormat, spans = [], yDomain = ['auto', 'auto'], height = 280,
}: {
  rows: T[];
  series: TimeSeriesSpec[];
  yFormat: (v: number) => string;
  spans?: Span[];
  yDomain?: [number | 'auto', number | 'auto'];
  height?: number;
}) {
  if (rows.length < 2) return <div className="muted">Not enough data to draw this chart.</div>;
  const ticks = yearTicks(rows[0].t, rows[rows.length - 1].t);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={ticks}
          tickFormatter={yearTick} tick={AXIS_TICK} stroke="var(--line)"
        />
        <YAxis tickFormatter={yFormat} tick={AXIS_TICK} stroke="var(--line)" width={60} domain={yDomain} />
        <Tooltip
          content={<ChartTip labelFormat={(l) => isoMonth(Number(l))} valueFormat={(v) => yFormat(v)} />}
          cursor={{ stroke: 'var(--ink-3)' }} itemSorter={() => 0}
        />
        {series.length > 1 && (
          <Legend
            verticalAlign="top" height={28} itemSorter={null}
            formatter={(value: unknown) => <span style={{ color: 'var(--ink-2)' }}>{String(value)}</span>}
          />
        )}
        {spans.map((s) => (
          <ReferenceArea key={`${s.x1}-${s.x2}`} x1={s.x1} x2={s.x2} fill="var(--band)" stroke="none" ifOverflow="hidden" />
        ))}
        {series.map((s) =>
          s.kind === 'area' ? (
            <Area
              key={s.key} dataKey={s.key} name={s.label} type="linear" stroke={s.color} strokeWidth={2}
              fill={s.color} fillOpacity={0.15} dot={false} isAnimationActive={false} connectNulls={false}
            />
          ) : (
            <Line
              key={s.key} dataKey={s.key} name={s.label} type="linear" stroke={s.color} strokeWidth={2}
              dot={false} isAnimationActive={false} connectNulls={false}
            />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
