import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ChartTip } from '../charts/ChartFrame';
import type { MixSlice } from '../charts/transforms';
import '../charts/results.css';
import type { TextFmt } from './textbook';

/** AssetMixDonut with the lesson's number format (a decimal comma in Dutch); same markup. */
export function MixDonut({ slices, fmt }: { slices: MixSlice[]; fmt: TextFmt }) {
  return (
    <div className="donut-wrap">
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices} dataKey="value" nameKey="label" innerRadius="60%" outerRadius="90%"
              stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}
            >
              {slices.map((s) => <Cell key={s.key} fill={s.color} />)}
            </Pie>
            <Tooltip content={<ChartTip valueFormat={(v) => fmt.pct(v)} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="legend">
        {slices.map((s) => (
          <li key={s.key}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label} <span className="num">{fmt.pct(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
