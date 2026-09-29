"""Lane C. Spec §5.4 — CAPM expected returns.

Teaching outline:
1. Build the market portfolio's weekly return from a few anchor funds.
2. Turn every return into an *excess* return (return minus the weekly risk-free rate).
3. beta_i = cov(excess_i, excess_market) / var(excess_market) over the estimation window.
4. expected_i = rf_now + beta_i * market_premium.
"""

import pandas as pd

from app import config
from app.engine.types import CapmResult


def market_returns(returns: pd.DataFrame, anchors: dict[str, str], weights: dict[str, float]) -> pd.Series:
    """Weekly market-portfolio return = sum(weights[key] * returns[anchors[key]]).

    anchors: key -> isin (config.ANCHORS[base]); weights: key -> weight (config.MARKETS[model]['weights']).
    Weeks where any used anchor is NaN are NaN.
    """
    weighted_legs = [weight * returns[anchors[key]] for key, weight in weights.items()]
    market = sum(weighted_legs)  # NaN in any leg -> NaN for that week
    return market.rename("market")


def _estimation_window(frame: pd.DataFrame | pd.Series, window_years: int, end: pd.Timestamp | None):
    """Rows up to and including `end`, then the last window_years * 52 of them."""
    up_to_end = frame if end is None else frame.loc[:end]
    n_weeks = window_years * config.PERIODS_PER_YEAR
    return up_to_end.iloc[-n_weeks:]


def _weekly_rf(rf_daily_annual: pd.Series, weeks: pd.DatetimeIndex) -> pd.Series:
    """Daily annualised rf -> weekly rate per period (last value of each W-FRI week / 52), on `weeks`."""
    rf_weekly_annual = rf_daily_annual.resample("W-FRI").last()
    return rf_weekly_annual.reindex(weeks, method="ffill") / config.PERIODS_PER_YEAR


def _beta(fund_excess: pd.Series, market_excess: pd.Series) -> float:
    """cov / var on the weeks where both series have data (NaN if fewer than 2 such weeks)."""
    both = fund_excess.notna() & market_excess.notna()
    if both.sum() < 2:
        return float("nan")
    return fund_excess[both].cov(market_excess[both]) / market_excess[both].var()


def capm(
    returns: pd.DataFrame,
    market: pd.Series,
    rf: pd.Series,
    premium: float,
    model: str,
    window_years: int,
    end: pd.Timestamp | None = None,
) -> CapmResult:
    """CAPM betas and expected returns.

    rf: daily annualised risk-free rate (DataSource.rf); weekly rf = rf resampled W-FRI (last) / 52.
    Excess returns: r - weekly rf. beta_i = cov(ex_i, ex_m) / var(ex_m) over the last window_years*52 weeks
    up to `end` (default: last row), pairwise non-NaN weeks. Never reads rows after `end`.
    expected_i = rf_now + beta_i * premium, rf_now = last rf value <= end.
    CapmResult.market = model.
    Funds with fewer than 2 overlapping weeks get beta NaN and expected NaN.
    """
    window_returns = _estimation_window(returns, window_years, end)
    window_market = market.reindex(window_returns.index)
    rf_up_to_end = rf if end is None else rf.loc[:end]

    weekly_rf = _weekly_rf(rf_up_to_end, window_returns.index)
    fund_excess = window_returns.sub(weekly_rf, axis=0)
    market_excess = window_market - weekly_rf

    beta = fund_excess.apply(lambda col: _beta(col, market_excess)).rename("beta")
    rf_now = float(rf_up_to_end.dropna().iloc[-1])
    expected = (rf_now + beta * premium).rename("expected")
    return CapmResult(beta=beta, expected=expected, rf=rf_now, premium=premium, market=model)
