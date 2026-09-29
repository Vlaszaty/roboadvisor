"""Lane B. Spec §5.3."""

import pandas as pd


def covariance(returns: pd.DataFrame, window_years: int, end: pd.Timestamp | None = None) -> tuple[pd.DataFrame, list[str]]:
    """Ledoit-Wolf shrunk, annualised (x52) covariance of weekly returns.

    Window: the last window_years*52 weeks up to and including `end` (default: last row). Never reads rows after `end`.
    Funds with fewer than config.MIN_COVERAGE non-NaN weeks in the window are dropped; their isins are the
    second return value. Remaining rows containing any NaN are dropped before estimation.
    Raises InsufficientHistory if no fund or fewer than 52 complete weeks remain.
    Returns (cov indexed/columned by isin, dropped isins).
    """
    raise NotImplementedError("Lane B")
