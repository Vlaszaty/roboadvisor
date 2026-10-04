import type { ReactNode } from 'react';

export interface StepCopy {
  title: string;
  /** the textbook name of the step, shown under the plain title */
  technicalTitle: string;
  /** two plain sentences, no jargon */
  plain: string;
  what: string;
  formula: ReactNode;
  source: string;
  notice: string;
}

export type StepKey = 'stats' | 'correlation' | 'expected' | 'frontier' | 'tangent' | 'split' | 'portfolio';

/** Explanatory text per step, in the course's notation (spec 2026-10-04 §6.3). */
export const STEPS: Record<StepKey, StepCopy> = {
  stats: {
    title: 'How each fund has done',
    technicalTitle: 'Returns and risk per fund',
    plain: 'We look at how seven funds, one for each kind of investment, behaved over the last five years. For each we note the average yearly growth and how much it bounced around.',
    what: 'We start from five years of weekly returns for seven funds, one per building block. For each fund we take the average return and the standard deviation, and scale both to a year.',
    formula: (
      <>
        <div>E[R] = average of R<sub>t</sub> × 52</div>
        <div>SD(R) = √Var(R<sub>t</sub>) × √52</div>
      </>
    ),
    source: 'Week 4, slides 52–54',
    notice: 'Funds with a higher average return tend to have a higher volatility, but not one for one. Five years is a short sample: these averages say more about the recent past than about the future.',
  },
  correlation: {
    title: 'How the funds move together',
    technicalTitle: 'Correlation',
    plain: 'Some funds go up when others go down. The more they differ, the more mixing them smooths the ride. The table shows how alike each pair moves: a high number means in step, a low number means different.',
    what: 'Risk in a portfolio depends on how the funds move together, not only on each fund’s own volatility. The correlation between two funds runs from −1 (opposite) to +1 (in step).',
    formula: (
      <div>
        Var(R<sub>P</sub>) = x<sub>1</sub><sup>2</sup>σ<sub>1</sub><sup>2</sup> + x<sub>2</sub><sup>2</sup>σ<sub>2</sub><sup>2</sup> + 2x<sub>1</sub>x<sub>2</sub>ρ<sub>12</sub>σ<sub>1</sub>σ<sub>2</sub>
      </div>
    ),
    source: 'Week 4, slides 60–63',
    notice: 'As long as a correlation is below 1, mixing two funds gives less risk than the average of the two. The lowest numbers in the table are where diversification helps most.',
  },
  expected: {
    title: 'What each fund could earn',
    technicalTitle: 'Expected returns (CAPM)',
    plain: 'We need a guess for what each fund will earn. The textbook rule: the more a fund moves with the whole market, the more extra growth it should earn on top of safe interest.',
    what: 'The optimiser needs an expected return per fund. The CAPM says a fund earns the risk-free rate plus a reward for the market risk it carries, measured by its beta. The alternative is to assume the past average repeats.',
    formula: (
      <>
        <div>E[R<sub>i</sub>] = r<sub>f</sub> + β<sub>i</sub> × (E[R<sub>Mkt</sub>] − r<sub>f</sub>)</div>
        <div>β<sub>i</sub> = Cov(R<sub>i</sub>, R<sub>Mkt</sub>) / Var(R<sub>Mkt</sub>)</div>
      </>
    ),
    source: 'Week 4, slide 69; week 5, slides 6–28',
    notice: 'Compare the two columns. CAPM returns stay in a narrow, plausible range; historical averages swing widely and can be negative. Switch the model at the top and watch what the rest of the page does.',
  },
  frontier: {
    title: 'The best mixes',
    technicalTitle: 'The efficient frontier',
    plain: 'From seven funds you can make endless mixes. For each level of risk, one mix gives the most growth. The curve joins these best mixes.',
    what: 'For every level of expected return there is one mix of the seven funds with the lowest possible risk. Those best mixes together form the efficient frontier. Weights are between 0 and 1 and add up to 1.',
    formula: <div>minimise SD(R<sub>P</sub>) for each E[R<sub>P</sub>], with Σx<sub>i</sub> = 1 and 0 ≤ x<sub>i</sub> ≤ 1</div>,
    source: 'Week 4, slides 64–65',
    notice: 'The curve lies to the left of the individual funds: a mix reaches the same return with less risk. Any portfolio below the curve can be improved without giving anything up.',
  },
  tangent: {
    title: 'The best mix of risky funds',
    technicalTitle: 'The tangent portfolio',
    plain: 'Add a safe fund, like a savings account. One risky mix then stands out as the best partner for it: the one with the most growth for each unit of risk.',
    what: 'Add a risk-free fund and every investor can do better than the frontier alone: combine the risk-free fund with the one mix that has the highest Sharpe ratio. The straight line through both is the capital market line.',
    formula: <div>Sharpe ratio = (E[R<sub>P</sub>] − r<sub>f</sub>) / SD(R<sub>P</sub>)</div>,
    source: 'Week 4, slide 66',
    notice: 'The line touches the frontier in exactly one point. Every investor holds the same mix of risky funds; only the amount differs. Under the CAPM this mix sits close to the market itself.',
  },
  split: {
    title: 'How much goes where',
    technicalTitle: 'Your split (risk aversion)',
    plain: 'How much goes into the risky mix and how much into the safe fund depends on how much risk you are comfortable with. A more cautious person puts more into the safe fund.',
    what: 'How much goes into the tangent portfolio depends on your risk aversion A. Maximising utility along the capital market line gives the share y; the rest goes to the risk-free fund.',
    formula: (
      <>
        <div>U = E(r<sub>p</sub>) − ½Aσ<sup>2</sup></div>
        <div>y = (E[R<sub>T</sub>] − r<sub>f</sub>) / (A × σ<sub>T</sub><sup>2</sup>)</div>
      </>
    ),
    source: 'Week 4, slides 64 and 66 (the formula for y follows from combining them)',
    notice: 'A lower A (more appetite for risk) or a better tangent portfolio raises the share. The theory would let y go above 100% by borrowing at the risk-free rate; this tool stops at 100%.',
  },
  portfolio: {
    title: 'Your textbook plan',
    technicalTitle: 'Your textbook portfolio',
    plain: 'Put it together: your share of the risky mix, with the rest in the safe fund. That is your textbook plan.',
    what: 'Multiply the tangent weights by your share and put the remainder in the risk-free fund. Because that fund has no volatility in the model, risk and excess return both scale with the share.',
    formula: (
      <>
        <div>E[R] = r<sub>f</sub> + y × (E[R<sub>T</sub>] − r<sub>f</sub>)</div>
        <div>SD(R) = y × σ<sub>T</sub></div>
      </>
    ),
    source: 'Week 4, slide 66',
    notice: 'Your Sharpe ratio equals the tangent portfolio’s whatever your share: moving along the line changes how much risk you take, not how well it is rewarded.',
  },
};
