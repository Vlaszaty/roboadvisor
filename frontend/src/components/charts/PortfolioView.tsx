import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Schemas } from '../../api/client';
import { Term } from '../../glossary/Term';
import { riskKey, riskLabel, badYear } from '../../intake/logic';
import { Chapter, ChapterNav, Details, type ChapterDef } from '../Story';
import { Card, LinkButton, Stat } from '../ui';
import { AssetMixDonut } from './Donut';
import { ChartFrame } from './ChartFrame';
import { Comparison } from './Comparison';
import { BellCurveCheck, ChanceOfFall, MoneyFan, StressTests } from './DownsidePanel';
import { Frontier } from './FrontierChart';
import { HoldingsTable } from './HoldingsTable';
import { TraceList } from './TraceList';
import { decimal, money, percent, signedPercent } from './format';
import { useStore } from '../../state/store';
import { mixRows } from './transforms';
import './results.css';

const CHAPTERS: ChapterDef[] = [
  { id: 'own', label: 'What you own' },
  { id: 'cost', label: 'What it costs' },
  { id: 'risk', label: 'What could go wrong' },
  { id: 'future', label: 'Where it could go' },
  { id: 'past', label: 'How it did' },
  { id: 'numbers', label: 'The numbers' },
];

const PLAIN_CLASS: Record<string, string> = {
  equity: 'shares', bond: 'bonds', cash: 'cash', commodity: 'gold and commodities', real_estate: 'property', crypto: 'crypto',
};

function mixSentence(mix: Record<string, number>): string {
  const parts = mixRows(mix).map((x) => `${Math.round(x.value * 100)}% ${PLAIN_CLASS[x.key] ?? x.label.toLowerCase()}`);
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function PortfolioView({
  rec, currency, horizonYears, riskLevel, adjuster,
}: {
  rec: Schemas['Recommendation'];
  currency: string;
  horizonYears: number;
  riskLevel: number;
  /** shown straight after the plan summary */
  adjuster?: ReactNode;
}) {
  const [{ profile }] = useStore();
  const once = profile.initial_amount ?? 0;
  const monthly = profile.monthly_amount ?? 0;
  const lastMoney = rec.downside.fan_money?.[rec.downside.fan_money.length - 1];
  const s = rec.summary;
  const warnings = rec.warnings ?? [];
  const slices = mixRows(s.mix);
  const key = riskKey(riskLevel);
  const volGap = s.volatility - s.target_volatility;
  const volHint =
    Math.abs(volGap) < 0.005
      ? `on target (${percent(s.target_volatility)})`
      : `${volGap < 0 ? 'below' : 'above'} the ${percent(s.target_volatility)} target`;
  const typicalLow = s.expected_return - s.volatility;
  const typicalHigh = s.expected_return + s.volatility;

  return (
    <div className="story">
      <section id="plan" className="plan-hero" aria-labelledby="plan-h">
        <p className="plan-kicker">Your plan</p>
        <h2 id="plan-h" className="plan-title">
          <span className="key-badge" aria-label={`Key ${key} of 5`}>Key {key}</span> {riskLabel(riskLevel)}
        </h2>
        <p className="plan-sentence">
          Over {horizonYears} years, this plan puts about {mixSentence(s.mix)} into {rec.holdings.length} funds.
        </p>
        {lastMoney && (
          <div className="plan-money">
            <p>
              {once > 0 && monthly > 0
                ? `You plan to put in ${money(once, currency)} now and ${money(monthly, currency)} every month.`
                : once > 0
                  ? `You plan to put in ${money(once, currency)} once.`
                  : `You plan to put in ${money(monthly, currency)} every month.`}{' '}
              After {horizonYears} years you will have paid in <strong className="num">{money(lastMoney.paid_in, currency)}</strong>.
            </p>
            <div className="plan-money-range">
              <div><span>Poor case, 1 in 20</span><strong className="num">{money(lastMoney.p5, currency)}</strong></div>
              <div className="is-mid"><span>Middle result</span><strong className="num">{money(lastMoney.p50, currency)}</strong></div>
              <div><span>Good case, 1 in 20</span><strong className="num">{money(lastMoney.p95, currency)}</strong></div>
            </div>
            {rec.downside.p_below_paid_in != null && (
              <p className="small">
                Chance of ending with less than you paid in:{' '}
                <strong className="num">{percent(rec.downside.p_below_paid_in)}</strong>. A guide from many simulated futures, not a promise.
              </p>
            )}
          </div>
        )}
        <div className="plan-stats">
          <div className="plan-stat">
            <span className="plan-stat-label"><Term id="expected-return">Likely yearly growth</Term></span>
            <span className="plan-stat-value num">{percent(s.expected_return)}</span>
            <span className="plan-stat-hint">about {money(s.expected_return * 10_000, currency)} a year on {money(10_000, currency)}. An estimate, not a promise.</span>
          </div>
          <div className="plan-stat">
            <span className="plan-stat-label"><Term id="volatility">Typical ups and downs</Term></span>
            <span className="plan-stat-value num">{percent(s.volatility)}</span>
            <span className="plan-stat-hint">In about two years out of three, expect between {signedPercent(typicalLow, 0)} and {signedPercent(typicalHigh, 0)}.</span>
          </div>
          <div className="plan-stat">
            <span className="plan-stat-label"><Term id="ter">Yearly cost</Term></span>
            <span className="plan-stat-value num">{money(s.annual_cost_per_10k, currency)}</span>
            <span className="plan-stat-hint">per {money(10_000, currency)} invested, in fund fees.</span>
          </div>
        </div>
        <p className="plan-bad">
          A bad year, about 1 in 20, could lose around <strong className="num">{percent(Math.abs(badYear(s.volatility)), 0)}</strong>.
          If that would keep you up at night, make the plan calmer below.
        </p>
      </section>

      {adjuster}

      {warnings.length > 0 && (
        <div className="banner" role="status">
          <strong>Good to know</strong>
          <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <ChapterNav chapters={CHAPTERS} />

      <Chapter id="own" number={1} title="What you own" lead="A short list of funds. Each one holds many investments, so your money is spread out.">
        <Card title="How your money is split">
          <ChartFrame
            title="Plan split by type of investment"
            description={`Donut chart. ${slices.map((x) => `${x.label} ${percent(x.value)}`).join(', ')}.`}
            table={{ head: ['Type', 'Share'], rows: slices.map((x) => [x.label, percent(x.value)]) }}
          >
            <AssetMixDonut slices={slices} />
          </ChartFrame>
        </Card>
        <Card title="Your funds">
          <HoldingsTable holdings={rec.holdings} />
          <p className="small muted">Tap a fund name to see its details, price history and fees.</p>
        </Card>
      </Chapter>

      <Chapter id="cost" number={2} title="What it costs" lead="Fund fees are taken inside the fund, so you never see a bill. They still add up, so we keep them low.">
        <section className="card cost-card">
          <div className="cost-row">
            <div>
              <div className="cost-big num">{money(s.annual_cost_per_10k, currency)}</div>
              <div className="muted">a year for every {money(10_000, currency)} invested</div>
            </div>
            <p className="cost-note">
              That is a <Term id="weighted-ter">total yearly fee</Term> of {percent(s.weighted_ter, 2)}, across all your funds. Each
              fund&apos;s own fee is in the list above.
            </p>
          </div>
        </section>
      </Chapter>

      <Chapter id="risk" number={3} title="What could go wrong" lead="Every investment can fall. We show it up front, so there are no surprises.">
        <ChanceOfFall downside={rec.downside} horizonYears={horizonYears} />
        <StressTests downside={rec.downside} />
      </Chapter>

      <Chapter id="future" number={4} title="Where it could go" lead="Nobody knows the future, so we show a range of possible outcomes instead of one number.">
        <MoneyFan downside={rec.downside} horizonYears={horizonYears} currency={currency} />
      </Chapter>

      <Chapter id="past" number={5} title="How it did in the past" lead="Today's plan, replayed over past years, next to the world stock market and the S&P 500.">
        <Comparison />
        <div className="row">
          <LinkButton to="/backtest" variant="primary">Try a more honest replay</LinkButton>
          <span className="muted">It only uses what was known at each date.</span>
        </div>
      </Chapter>

      <Chapter id="numbers" number={6} title="The numbers behind it" lead="For the curious. Everything the plan is built on, with plain names. Words with a dotted line are explained in the glossary.">
        <Details title="The key numbers" hint="Growth, ups and downs, reward for the risk" defaultOpen>
          <div className="results-grid grid-stats">
            <Card><Stat label="Likely yearly growth" value={percent(s.expected_return)} hint="model estimate" /></Card>
            <Card><Stat label="Typical ups and downs" value={percent(s.volatility)} hint={volHint} /></Card>
            <Card><Stat label="Reward for the risk" value={decimal(s.sharpe, 2)} hint="world shares are around 0.3 to 0.5 in the long run" /></Card>
            <Card><Stat label="Follows the market" value={decimal(s.beta, 2)} hint="1.00 means it moves like the market" /></Card>
            <Card><Stat label={`Yearly cost per ${money(10_000, currency)}`} value={money(s.annual_cost_per_10k, currency)} hint={`total fee ${percent(s.weighted_ter, 2)}`} /></Card>
          </div>
          <p className="small muted">
            Technical names: <Term id="expected-return">expected return</Term>, <Term id="volatility">volatility</Term>,{' '}
            <Term id="sharpe">Sharpe ratio</Term>, <Term id="beta">beta</Term>, <Term id="ter">TER</Term>.
          </p>
        </Details>
        <Details title="Best mix for each level of risk" hint="The efficient frontier chart">
          <Frontier />
        </Details>
        <Details title="Why we do not use a simple bell curve" hint="Simulated versus shortcut">
          <BellCurveCheck downside={rec.downside} />
        </Details>
        <Details title="How we built your plan" hint="Every calculation step">
          <TraceList trace={rec.trace ?? []} />
        </Details>
      </Chapter>

      <section className="next-steps" aria-labelledby="next-h">
        <h2 id="next-h">What next?</h2>
        <div className="next-grid">
          <Link to="/backtest" className="next-card"><strong>Replay the past</strong><span>Test your plan over more years.</span></Link>
          <Link to="/textbook" className="next-card"><strong>See how it works</strong><span>The method behind it, in seven steps.</span></Link>
          <Link to="/universe" className="next-card"><strong>Browse the funds</strong><span>Every fund we can choose from.</span></Link>
          <Link to="/glossary" className="next-card"><strong>Words explained</strong><span>Any term, in plain English.</span></Link>
        </div>
      </section>
    </div>
  );
}
