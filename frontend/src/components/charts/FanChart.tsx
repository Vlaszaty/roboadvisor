import type { ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Schemas } from '../../api/client';
import { decimal, money as fmtMoney, moneyCompact } from './format';
import { fanRows, type FanRow } from './transforms';
import './results.css';

const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 12 };

type MoneyRow = FanRow & { paid_in?: number };

function FanTip({
  active, payload, fmt,
}: { active?: boolean; payload?: ReadonlyArray<{ payload?: MoneyRow }>; fmt: (v: number) => string }): ReactNode {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const lines: Array<[string, number]> = [
    ['Good case (1 in 20)', row.p95], ['Better than middle', row.p75], ['Middle', row.p50], ['Weaker than middle', row.p25], ['Poor case (1 in 20)', row.p5],
  ];
  return (
    <div className="tip">
      <div className="tip-title">After {row.year} {row.year === 1 ? 'year' : 'years'}</div>
      {row.paid_in != null && <div>You paid in: <span className="num">{fmt(row.paid_in)}</span></div>}
      {lines.map(([label, v]) => (
        <div key={label}>{label}: <span className="num">{fmt(v)}</span></div>
      ))}
    </div>
  );
}

/**
 * Fan chart of the value of 1.00 invested: stacked areas (transparent base under three bands) plus a median line.
 * Outer band = 5th–95th percentile, inner band = 25th–75th.
 */
export function FanChart({
  fan, money,
}: {
  fan: Schemas['FanPoint'][];
  /** the investor's own amounts: when given, the chart shows money instead of the value of 1.00 */
  money?: { points: Schemas['MoneyFanPoint'][]; currency: string };
}) {
  const rows: MoneyRow[] = money
    ? fanRows(money.points).map((r, i) => ({ ...r, paid_in: money.points[i]?.paid_in }))
    : fanRows(fan);
  const fmt = (v: number) => (money ? fmtMoney(v, money.currency) : `${decimal(v, 2)}×`);
  const axis = (v: number) => (money ? moneyCompact(v, money.currency) : `${decimal(v, 1)}×`);
  return (
    <div className="donut-wrap">
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line-soft)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="year" type="number" domain={[0, 'dataMax']} allowDecimals={false} tickFormatter={(y: number) => `${y}y`} tick={AXIS_TICK} stroke="var(--line-soft)" />
            <YAxis tickFormatter={axis} tick={AXIS_TICK} stroke="var(--line-soft)" width={money ? 64 : 52} domain={[0, 'auto']} />
            <Tooltip content={<FanTip fmt={fmt} />} cursor={{ stroke: 'var(--ink-3)' }} />
            <Area dataKey="base" stackId="fan" stroke="none" fill="none" isAnimationActive={false} />
            <Area dataKey="lower" stackId="fan" stroke="none" fill="var(--series-1)" fillOpacity={0.15} isAnimationActive={false} />
            <Area dataKey="mid" stackId="fan" stroke="none" fill="var(--series-1)" fillOpacity={0.3} isAnimationActive={false} />
            <Area dataKey="upper" stackId="fan" stroke="none" fill="var(--series-1)" fillOpacity={0.15} isAnimationActive={false} />
            <Line dataKey="p50" name="Middle" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
            {money && <Line dataKey="paid_in" name="Paid in" stroke="var(--ink-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="legend">
        <li><span className="swatch" style={{ background: 'var(--series-1)' }} />Middle result</li>
        <li><span className="swatch" style={{ background: 'var(--series-1)', opacity: 0.3 }} />Usual range (half of all outcomes)</li>
        <li><span className="swatch" style={{ background: 'var(--series-1)', opacity: 0.15 }} />Wider range (nine out of ten outcomes)</li>
        {money && <li><span className="swatch" style={{ background: 'var(--ink-2)' }} />What you paid in</li>}
      </ul>
    </div>
  );
}
