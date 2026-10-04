export interface GlossaryTerm {
  id: string;
  /** the everyday name used on the pages */
  plain: string;
  /** the name finance people use */
  technical: string;
  /** one or two sentences, no jargon */
  meaning: string;
  /** optional worked example or tip */
  example?: string;
}

/** Every technical word the app uses, in plain English. Pages link here through <Term id="...">. */
export const TERMS: GlossaryTerm[] = [
  {
    id: 'etf',
    plain: 'Fund that holds many investments',
    technical: 'ETF (exchange-traded fund)',
    meaning:
      'A single investment that holds a basket of many companies or bonds. You buy it like a share, and it spreads your money over everything inside.',
    example: 'One world ETF can hold thousands of companies, so one bad company hurts very little.',
  },
  {
    id: 'etp',
    plain: 'Fund-like product that tracks one asset',
    technical: 'ETP / ETN / ETC',
    meaning:
      'Similar to an ETF, but built differently. Crypto and gold products are often this type. They are not strictly ETFs and can carry extra risks.',
  },
  {
    id: 'equities',
    plain: 'Shares (stocks)',
    technical: 'Equities',
    meaning: 'Small pieces of companies. They tend to grow more over many years, but their value swings more.',
  },
  {
    id: 'bonds',
    plain: 'Loans to governments and companies',
    technical: 'Bonds',
    meaning: 'You lend money and get paid interest. They usually move less than shares, so they steady a portfolio.',
  },
  {
    id: 'diversification',
    plain: 'Not putting all your eggs in one basket',
    technical: 'Diversification',
    meaning: 'Spreading money over many investments, so one bad result does not sink the whole portfolio.',
  },
  {
    id: 'risk-level',
    plain: 'How much ups and downs you are comfortable with',
    technical: 'Risk level (0 to 100) and key (1 to 5)',
    meaning:
      'Your answers give a score from 0 to 100. We group the score into five keys, from 1 (Safe Start) to 5 (Bold Mover). A higher score means a portfolio that can grow more and can also fall more.',
  },
  {
    id: 'horizon',
    plain: 'How long you can leave the money invested',
    technical: 'Investment horizon',
    meaning: 'The number of years until you expect to need a large part of the money. A longer time gives the money longer to recover from bad years.',
  },
  {
    id: 'expected-return',
    plain: 'Likely yearly growth',
    technical: 'Expected return',
    meaning: 'What the model thinks the portfolio could earn per year, on average, over many years. It is an estimate, not a promise.',
    example: '7% a year means 700 more on every 10,000, on average. Some years will be much better, some much worse.',
  },
  {
    id: 'volatility',
    plain: 'Typical ups and downs',
    technical: 'Volatility',
    meaning: 'How much the value usually swings in a year. A higher number means a bumpier ride.',
    example: 'With 12% volatility, a typical year ends between about 12% above and 12% below the average.',
  },
  {
    id: 'sharpe',
    plain: 'Reward for the risk',
    technical: 'Sharpe ratio',
    meaning: 'How much extra growth you get for each unit of bumpiness, compared with just keeping cash. Higher is better. For world shares over the long run it is around 0.3 to 0.5, and above 1 is rare.',
  },
  {
    id: 'sortino',
    plain: 'Reward for the bad swings only',
    technical: 'Sortino ratio',
    meaning: 'Like the reward for the risk, but it only counts the downward swings, since those are the ones that hurt.',
  },
  {
    id: 'beta',
    plain: 'How closely it follows the market',
    technical: 'Beta',
    meaning: 'If the market moves 10%, a beta of 1 means the portfolio moves about 10%. A beta of 1.5 means about 15%, in either direction.',
  },
  {
    id: 'ter',
    plain: 'Yearly fund fee',
    technical: 'TER (total expense ratio)',
    meaning: 'The fee a fund takes every year, as a share of your money. It is taken inside the fund, so you do not see a bill.',
    example: 'A fee of 0.12% costs 12 a year on 10,000.',
  },
  {
    id: 'drawdown',
    plain: 'Fall from the highest point',
    technical: 'Drawdown / max drawdown',
    meaning: 'How far the value dropped from its peak before it recovered. The worst fall is the biggest such drop.',
    example: 'A portfolio worth 10,000 that drops to 8,000 had a 20% fall.',
  },
  {
    id: 'cagr',
    plain: 'Average yearly growth',
    technical: 'CAGR (compound annual growth rate)',
    meaning: 'The steady yearly growth rate that would give the same final result, counting growth on top of earlier growth.',
  },
  {
    id: 'cvar',
    plain: 'Average loss in the worst weeks',
    technical: 'CVaR (95%)',
    meaning: 'Take the worst 5% of weeks. This is the average result across them. It shows how bad the bad weeks are.',
  },
  {
    id: 'calmar',
    plain: 'Growth compared with the worst fall',
    technical: 'Calmar ratio',
    meaning: 'Yearly growth divided by the worst fall. Higher means you were paid more for the pain.',
  },
  {
    id: 'turnover',
    plain: 'How much gets bought and sold',
    technical: 'Turnover',
    meaning: 'The share of the portfolio traded in a year. More trading usually means more costs.',
  },
  {
    id: 'benchmark',
    plain: 'A fair comparison',
    technical: 'Benchmark',
    meaning: 'A simple mix of world shares and bonds with about the same ups and downs as your portfolio, to see whether the extra work paid off.',
  },
  {
    id: 'backtest',
    plain: 'A replay of the past',
    technical: 'Backtest',
    meaning: 'Shows how the portfolio would have done in past markets. Past results do not predict the future.',
  },
  {
    id: 'walk-forward',
    plain: 'An honest replay',
    technical: 'Walk-forward backtest',
    meaning: 'At each date in the past, the portfolio is rebuilt using only what was known then. It avoids using hindsight, so results look more realistic.',
  },
  {
    id: 'static-weights',
    plain: 'Use today’s mix for the whole past',
    technical: 'Static weights',
    meaning: 'Applies today’s portfolio to every past date. It is simple, but it uses hindsight, so it flatters the result.',
  },
  {
    id: 'rebalancing',
    plain: 'Tidying the mix back to plan',
    technical: 'Rebalancing',
    meaning: 'Over time some funds grow more than others. Rebalancing sells a little of the winners and buys the laggards to restore the original shares.',
  },
  {
    id: 'monte-carlo',
    plain: 'Thousands of possible futures',
    technical: 'Monte Carlo simulation',
    meaning: 'The computer plays out ten thousand possible futures using real market behaviour, then counts how often bad things happen.',
  },
  {
    id: 'fan-chart',
    plain: 'The range of where your money could end up',
    technical: 'Fan chart (percentile bands)',
    meaning: 'The line is the middle result. The shaded areas show the usual range, and the wider range that covers nine out of ten futures.',
  },
  {
    id: 'stress-test',
    plain: 'What would a past crisis have done',
    technical: 'Stress test',
    meaning: 'Shows what this portfolio would have lost during famous crashes, like 2008, 2020 and 2022.',
  },
  {
    id: 'proxy',
    plain: 'Older stand-in history',
    technical: 'Proxy data',
    meaning: 'A newer fund has a short track record. For earlier years we use an older fund or index that follows the same market, so we can judge risk over a longer time.',
  },
  {
    id: 'normal-model',
    plain: 'The bell-curve shortcut',
    technical: 'Normal distribution model',
    meaning: 'A simple model that assumes returns bunch around the average. Real markets have more extreme days, so this shortcut underestimates big losses.',
  },
  {
    id: 'frontier',
    plain: 'The best mixes for each level of risk',
    technical: 'Efficient frontier',
    meaning: 'A curve showing the highest expected growth you can aim for at each level of ups and downs. Mixes below the curve give up growth for no reason.',
  },
  {
    id: 'capm',
    plain: 'A rule for how much growth risk should earn',
    technical: 'CAPM (capital asset pricing model)',
    meaning: 'A classic finance rule: the more an investment moves with the whole market, the more extra growth it should earn.',
  },
  {
    id: 'market-premium',
    plain: 'Extra growth shares earn over cash',
    technical: 'Market risk premium',
    meaning: 'The extra yearly growth investors expect for taking the risk of the stock market instead of holding cash.',
  },
  {
    id: 'tangent',
    plain: 'The best mix of risky funds',
    technical: 'Tangent (maximum Sharpe) portfolio',
    meaning: 'The mix of risky funds with the best reward for the risk. The textbook method then blends it with a safe fund to match your comfort level.',
  },
  {
    id: 'ucits',
    plain: 'European rules for funds sold to the public',
    technical: 'UCITS',
    meaning: 'A European standard that sets safety and transparency rules for funds sold to everyday investors.',
  },
  {
    id: 'accumulating',
    plain: 'Dividends are reinvested for you',
    technical: 'Accumulating vs distributing',
    meaning: 'An accumulating fund reinvests what it earns. A distributing fund pays it out to you.',
  },
  {
    id: 'esg',
    plain: 'Funds with a sustainability screen',
    technical: 'ESG',
    meaning: 'Funds that avoid some companies or favour others based on environmental, social and governance standards.',
  },
  {
    id: 'hedging',
    plain: 'Protection against currency swings',
    technical: 'Currency hedging',
    meaning: 'Removes the effect of exchange-rate moves, so a bond fund behaves like a bond in your own currency.',
  },
  {
    id: 'weighted-ter',
    plain: 'Your total yearly fee across all funds',
    technical: 'Weighted TER',
    meaning: 'The yearly fee of each fund, averaged by how much you hold of it.',
  },
];

export const termById = (id: string): GlossaryTerm | undefined => TERMS.find((t) => t.id === id);
