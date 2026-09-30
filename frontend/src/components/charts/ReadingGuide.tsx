import './results.css';

/** Plain-language guide to the headline numbers (copy: spec §4.1). Open by default. */
export function ReadingGuide() {
  return (
    <details className="guide" open>
      <summary>How to read these numbers</summary>
      <ul>
        <li>
          <strong>Sharpe ratio</strong> is the return above cash per unit of risk. Long-run world equities sit around
          0.3–0.5, and a sustained figure above 1 is rare. The Sharpe on the summary card is the model&apos;s forward-looking
          estimate, comparable with World&apos;s model Sharpe on the frontier chart (about 0.4); the realised Sharpe over the
          last 5–15 years in the table above was unusually high for equities.
        </li>
        <li>
          <strong>Volatility</strong> is the typical yearly swing in value; world equities are around 15%.
        </li>
        <li>
          <strong>Max drawdown</strong> is the worst fall from a peak; world equities fell about 34% in 2020 and about
          55% in 2008–09.
        </li>
        <li>
          <strong>CAGR</strong> is the average yearly growth rate, compounded.
        </li>
      </ul>
    </details>
  );
}
