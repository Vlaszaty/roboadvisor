"""Lane B. Spec §5.3."""

import pandas as pd
from pypfopt.risk_models import CovarianceShrinkage

from app import config
from app.engine.errors import InsufficientHistory


def covariance(returns: pd.DataFrame, window_years: int, end: pd.Timestamp | None = None) -> tuple[pd.DataFrame, list[str]]:
    """Ledoit-Wolf shrunk, annualised (x52) covariance of weekly returns.

    Window: the last window_years*52 weeks up to and including `end` (default: last row). Never reads rows after `end`.
    Funds with fewer than config.MIN_COVERAGE non-NaN weeks in the window are dropped; their isins are the
    second return value. Remaining rows containing any NaN are dropped before estimation.
    Returns (cov indexed/columned by isin, dropped isins).
    Raises InsufficientHistory if no fund or fewer than 52 complete weeks remain.
    """
    window = (returns if end is None else returns.loc[:end]).iloc[-window_years * config.PERIODS_PER_YEAR :]
    coverage = window.notna().mean()
    dropped = coverage.index[coverage < config.MIN_COVERAGE].tolist()
    usable = window.drop(columns=dropped).dropna()
    if usable.shape[1] == 0 or len(usable) < config.PERIODS_PER_YEAR:
        raise InsufficientHistory("not enough overlapping weekly returns in the estimation window")
    cov = CovarianceShrinkage(usable, returns_data=True, frequency=config.PERIODS_PER_YEAR).ledoit_wolf()
    return cov, dropped
