"""Lane C. Spec §5.4."""

import pandas as pd

from app.engine.types import CapmResult


def market_returns(returns: pd.DataFrame, anchors: dict[str, str], weights: dict[str, float]) -> pd.Series:
    """Weekly market-portfolio return = sum(weights[key] * returns[anchors[key]]).

    anchors: key -> isin (config.ANCHORS[base]); weights: key -> weight (config.MARKETS[model]['weights']).
    Weeks where any used anchor is NaN are NaN.
    """
    raise NotImplementedError("Lane C")


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
    """
    raise NotImplementedError("Lane C")
