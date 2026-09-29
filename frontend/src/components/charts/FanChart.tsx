import type { ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Schemas } from '../../api/client';
import { decimal } from './format';
import { fanRows, type FanRow } from './transforms';
import './results.css';

const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 12 };

function FanTip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: FanRow }> }): ReactNode {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const lines: Array<[string, number]> = [
    ['95th percentile', row.p95], ['75th percentile', row.p75], ['Median', row.p50], ['25th percentile', row.p25], ['5th percentile', row.p5],
  ];
  return (
    <div className="tip">
      <div className="tip-title">After {row.year} {row.year === 1 ? 'year' : 'years'}</div>
      {lines.map(([label, v]) => (
        <div key={label}>{label}: <span className="num">{decimal(v, 2)}×</span></div>
      ))}
    </div>
  );
}

/**
 * Fan chart of the value of 1.00 invested: stacked areas (transparent base under three bands) plus a median line.
 * Outer band = 5th–95th percentile, inner band = 25th–75th.
 */
export function FanChart({ fan }: { fan: Schemas['FanPoint'][] }) {
  const rows = fanRows(fan);
  return (
    <div className="donut-wrap">
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="year" type="number" domain={[0, 'dataMax']} allowDecimals={false} tickFormatter={(y: number) => `${y}y`} tick={AXIS_TICK} stroke="var(--line)" />
            <YAxis tickFormatter={(v: number) => `${decimal(v, 1)}×`} tick={AXIS_TICK} stroke="var(--line)" width={52} domain={[0, 'auto']} />
            <Tooltip content={<FanTip />} cursor={{ stroke: 'var(--ink-3)' }} />
            <Area dataKey="base" stackId="fan" stroke="none" fill="none" isAnimationActive={false} />
            <Area dataKey="lower" stackId="fan" stroke="none" fill="var(--series-1)" fillOpacity={0.15} isAnimationActive={false} />
            <Area dataKey="mid" stackId="fan" stroke="none" fill="var(--series-1)" fillOpacity={0.3} isAnimationActive={false} />
            <Area dataKey="upper" stackId="fan" stroke="none" fill="var(--series-1)" fillOpacity={0.15} isAnimationActive={false} />
            <Line dataKey="p50" name="Median" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="legend">
        <li><span className="swatch" style={{ background: 'var(--series-1)' }} />Median</li>
        <li><span className="swatch" style={{ background: 'var(--series-1)', opacity: 0.3 }} />Middle 50% of outcomes (25th–75th percentile)</li>
        <li><span className="swatch" style={{ background: 'var(--series-1)', opacity: 0.15 }} />90% range (5th–95th percentile)</li>
      </ul>
    </div>
  );
}
