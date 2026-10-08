import { CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from '../charts/ChartFrame';
import { chartDescription, chartSeries, chartTable, smlSeries, textFmt, type Language, type Layer, type Textbook, type TextFmt, type XY } from './textbook';

const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 12 };
/** Axis and tooltip percent: a decimal point in English, a decimal comma in Dutch. */
const pctOf = (x: TextFmt, language: Language) => (v: number) => (language === 'en' ? `${v.toFixed(1)}%` : `${x.num(v, 1)}%`);
const LEGEND = { paddingBottom: 8, fontSize: 13 };
const legendText = (v: unknown) => <span style={{ color: 'var(--ink-2)' }}>{String(v)}</span>;
/** Lines are Scatter series without a point shape, so they never catch the hover. */
const NoPoint = () => <g />;

function PointTip({ active, payload, xName, xFormat, yName, yFormat }: {
  active?: boolean; payload?: ReadonlyArray<{ payload?: XY }>; xName: string; xFormat: (v: number) => string;
  yName: string; yFormat: (v: number) => string;
}) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p?.label) return null;
  return (
    <div className="tip">
      <div className="tip-title">{p.label}</div>
      <div>{xName}: <span className="num">{xFormat(p.x)}</span></div>
      <div>{yName}: <span className="num">{yFormat(p.y)}</span></div>
    </div>
  );
}

/** Funds and frontier; from 'tangent' also the risk-free fund, capital market line and tangent; from 'split' your portfolio. */
export function RiskReturnChart({ t, layer, title, language = 'en' }: { t: Textbook; layer: Layer; title: string; language?: Language }) {
  const x = textFmt(language);
  const pct = pctOf(x, language);
  const s = chartSeries(t, layer, language);
  return (
    <ChartFrame title={title} description={chartDescription(t, layer, language)} table={chartTable(t, layer, language)} tableLabel={language === 'nl' ? 'Bekijk als tabel' : undefined}>
      <ResponsiveContainer width="100%" height={360}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
          <CartesianGrid stroke="var(--line-soft)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x" type="number" domain={[0, 'auto']} tickFormatter={pct} tick={AXIS_TICK} stroke="var(--line-soft)"
            name={x.t('Schommeling', 'Volatility')} tickCount={6}
            label={{ value: x.t('Schommeling (per jaar)', 'Volatility (per year)'), position: 'insideBottom', offset: -10, fill: 'var(--ink-3)', fontSize: 12 }}
          />
          <YAxis dataKey="y" type="number" domain={['auto', 'auto']} tickFormatter={pct} tick={AXIS_TICK} stroke="var(--line-soft)" width={56} name={x.t('Verwacht rendement', 'Expected return')} />
          <Tooltip content={<PointTip xName={x.t('Schommeling', 'Volatility')} xFormat={pct} yName={x.t('Verwacht rendement', 'Expected return')} yFormat={pct} />} cursor={false} />
          <Legend verticalAlign="top" wrapperStyle={LEGEND} itemSorter={null} formatter={legendText} />
          <Scatter
            data={s.frontier} dataKey="y" name={x.t('Efficiënte grens', 'Efficient frontier')} legendType="plainline" fill="var(--ink-2)"
            line={{ stroke: 'var(--ink-2)', strokeWidth: 2 }} shape={NoPoint} isAnimationActive={false}
          />
          {s.cml.length > 0 && (
            <Scatter
              data={s.cml} dataKey="y" name={x.t('Kapitaalmarktlijn', 'Capital market line')} legendType="plainline" fill="var(--ink-3)"
              line={{ stroke: 'var(--ink-3)', strokeWidth: 1.5, strokeDasharray: '2 4' }} shape={NoPoint} isAnimationActive={false}
            />
          )}
          <Scatter data={s.funds} dataKey="y" name={x.t('Fondsen', 'Funds')} fill="var(--series-1)" isAnimationActive={false} />
          {s.riskFree.length > 0 && <Scatter data={s.riskFree} dataKey="y" name={x.t('Geldmarktfonds', 'Risk-free fund')} shape="square" fill="var(--ink-3)" isAnimationActive={false} />}
          {s.tangent.length > 0 && <Scatter data={s.tangent} dataKey="y" name={x.t('Raakportefeuille', 'Tangent portfolio')} shape="diamond" fill="var(--series-2)" isAnimationActive={false} />}
          {s.investor.length > 0 && <Scatter data={s.investor} dataKey="y" name={x.t('Jouw portefeuille', 'Your portfolio')} shape="star" fill="var(--series-3)" isAnimationActive={false} />}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}


/** Security market line: every fund's CAPM return lies on the line through (0, rf) with slope = market premium. */
export function SmlChart({ t, language = 'en' }: { t: Textbook; language?: Language }) {
  const x = textFmt(language);
  const pct = pctOf(x, language);
  const beta = (v: number) => (language === 'en' ? v.toFixed(2) : x.num(v, 2));
  const s = smlSeries(t, language);
  return (
    <ChartFrame
      title={x.t('Effectenmarktlijn', 'Security market line')}
      description={x.t(
        `Spreidingsgrafiek van beta tegen verwacht CAPM-rendement in procenten; alle ${t.funds.length} fondsen liggen op één rechte lijn.`,
        `Scatter chart of beta against CAPM expected return in percent; all ${t.funds.length} funds lie on one straight line.`,
      )}
    >
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
          <CartesianGrid stroke="var(--line-soft)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x" type="number" domain={['auto', 'auto']} tickFormatter={beta} tick={AXIS_TICK} stroke="var(--line-soft)" name="Beta"
            label={{ value: 'Beta', position: 'insideBottom', offset: -10, fill: 'var(--ink-3)', fontSize: 12 }}
          />
          <YAxis dataKey="y" type="number" domain={['auto', 'auto']} tickFormatter={pct} tick={AXIS_TICK} stroke="var(--line-soft)" width={56} name={x.t('Verwacht rendement', 'Expected return')} />
          <Tooltip content={<PointTip xName="Beta" xFormat={beta} yName={x.t('Verwacht rendement', 'Expected return')} yFormat={pct} />} cursor={false} />
          <Scatter
            data={s.line} dataKey="y" name={x.t('Effectenmarktlijn', 'Security market line')} fill="var(--ink-2)"
            line={{ stroke: 'var(--ink-2)', strokeWidth: 2 }} shape={NoPoint} isAnimationActive={false}
          />
          <Scatter data={s.funds} dataKey="y" name={x.t('Fondsen', 'Funds')} fill="var(--series-1)" isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
