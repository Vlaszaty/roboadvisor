import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ChartTip } from './ChartFrame';
import { percent } from './format';
import type { MixSlice } from './transforms';
import './results.css';

/** Asset-mix donut. Color is never the only identity: the legend lists every class with its weight. */
export function AssetMixDonut({ slices }: { slices: MixSlice[] }) {
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
            <Tooltip content={<ChartTip valueFormat={(v) => percent(v)} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="legend">
        {slices.map((s) => (
          <li key={s.key}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label} <span className="num">{percent(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
