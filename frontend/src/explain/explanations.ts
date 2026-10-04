export interface Explanation {
  /** short heading shown in the mascot's speech bubble */
  title: string;
  /** one to three short paragraphs, plain English */
  body: string[];
}

/** Static "explain this" copy, keyed by the id passed to <ExplainButton id="..."> or <Card explain="...">. */
export const EXPLANATIONS: Record<string, Explanation> = {
  // Questions (ids match the questionnaire)
  'q.horizon': {
    title: 'Why we ask about years',
    body: [
      'The longer you can leave money alone, the more time it has to recover from a bad year.',
      'Money you need soon should take less risk. Money you will not touch for 20 years can take more.',
    ],
  },
  'q.income_stability': {
    title: 'Why we ask about your income',
    body: ['A steady paycheck means you are less likely to sell investments in a panic to pay bills.', 'A shaky income means we should keep your plan calmer.'],
  },
  'q.wealth_share': {
    title: 'Why we ask what share this is',
    body: ['If this is most of what you own, a big fall hurts much more than if it is a small slice.', 'A bigger share means a calmer plan is usually wiser.'],
  },
  'q.emergency_buffer': {
    title: 'Why we ask about your safety net',
    body: ['Savings outside this investment mean you will not be forced to sell at a bad time.', 'Many people aim for three to six months of living costs.'],
  },
  'q.withdrawals': {
    title: 'Why we ask about taking money out',
    body: ['Money you may need early cannot wait for markets to recover.', 'If a withdrawal is likely, we lower the risk of your plan.'],
  },
  'q.drop_reaction': {
    title: 'Why we ask what you would do',
    body: ['Markets do fall. What counts is whether you could sit through it.', 'There is no wrong answer. We only want a plan you can stick with.'],
  },
  'q.tradeoff': {
    title: 'Why we show these ranges',
    body: ['Each choice shows a best and a worst result for one year. Higher best cases come with lower worst cases.', 'Your pick tells us how you feel about that trade.'],
  },
  'q.experience': {
    title: 'Why we ask about experience',
    body: ['People who have lived through a fall before often handle the next one better.', 'If you are new, we lean calmer and explain more.'],
  },
  'q.self_assessment': {
    title: 'Why we ask how you see yourself',
    body: ['This is a quick check on your own view of risk, next to your other answers.'],
  },
  'q.max_loss': {
    title: 'Why we ask about your largest loss',
    body: ['Pick a loss you could live with without losing sleep. Your plan is built so a bad year stays near that.'],
  },

  // My plan
  'plan.summary': {
    title: 'Your plan in one look',
    body: [
      'These are the three numbers that matter most: likely yearly growth, typical ups and downs, and yearly cost.',
      'The growth number is an estimate from past data. It is not a promise.',
    ],
  },
  'plan.adjuster': {
    title: 'The risk slider',
    body: ['Slide left for a calmer plan, right for a bolder one.', 'A bolder plan can grow more, and it can also fall more. The whole page updates as you slide.'],
  },
  'plan.mix': {
    title: 'How your money is split',
    body: ['Shares can grow more but swing more. Bonds are loans, and they usually swing less.', 'The mix is what sets how bumpy your ride will be.'],
  },
  'plan.funds': {
    title: 'Your funds',
    body: ['Each fund holds many investments in one package, so your money is spread out.', 'Tap a name to see its fees and price history.'],
  },
  'plan.fall-chance': {
    title: 'How likely is a big fall?',
    body: ['We simulated thousands of possible futures. The bars show how often a fall of each size happened.', 'Falls are normal. The question is whether you could live with them.'],
  },
  'plan.money-fan': {
    title: 'Where your money could end up',
    body: ['Nobody knows the future, so we show a range. The middle line is a typical result.', 'The top and bottom lines are a lucky and an unlucky path.'],
  },
  'plan.stress': {
    title: 'What past crises would have done',
    body: ['We replay real crises, like 2008, on your plan today.', 'It shows how bad it could get, using things that really happened.'],
  },
  'plan.bell-curve': {
    title: 'Why not a simple bell curve',
    body: ['A bell curve is a shortcut. It says very big falls almost never happen.', 'Real markets have more big falls than that, so we simulate from real behaviour instead.'],
  },
  'plan.frontier': {
    title: 'The efficient frontier',
    body: ['Each dot is a mix of funds. The curve shows the best growth you can get for each level of risk.', 'Mixes below the curve take more risk for the same growth.'],
  },
  'plan.past': {
    title: 'How the plan did in the past',
    body: ['This replays today’s plan over past years, next to the world stock market and the S&P 500.', 'Past results do not predict the future.'],
  },

  // Backtest
  'backtest.growth': {
    title: 'How it grew',
    body: ['The lines show what 1.00 put in at the start would be worth later.', 'A line at 2.00 means your money doubled.'],
  },
  'backtest.falls': {
    title: 'The bad stretches',
    body: ['This shows how far the plan sat below its highest point so far.', 'The deepest dip is the worst fall. It also shows how long recovery took.'],
  },

  // Funds
  'funds.chart': {
    title: 'Risk and return of every fund',
    body: ['Left to right is risk, bottom to top is growth in the past.', 'Funds high and to the left gave more growth for less risk. That is rare and may not repeat.'],
  },

  // How it works
  'step.1': { title: 'Step 1: ups and downs', body: ['For each fund we measure its average growth and how much it swings.'] },
  'step.2': { title: 'Step 2: moving together', body: ['Funds that move differently cancel out each other’s swings. This is why mixing helps.'] },
  'step.3': { title: 'Step 3: expected growth', body: ['We estimate what each fund should earn for the risk it takes.'] },
  'step.4': { title: 'Step 4: the best mixes', body: ['We try many mixes and keep the best ones for each level of risk.'] },
  'step.5': { title: 'Step 5: the best risky mix', body: ['One mix gives the most reward for each unit of risk. It is the base of your plan.'] },
  'step.6': { title: 'Step 6: calmer or bolder', body: ['We blend that mix with a very safe fund, to match the risk level you chose.'] },
  'step.7': { title: 'Step 7: your plan', body: ['The final list of funds and shares, built from the steps before.'] },
};

export const explanationById = (id: string): Explanation | undefined => EXPLANATIONS[id];
