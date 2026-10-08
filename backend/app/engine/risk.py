"""Lane B. Spec §5.3."""

from collections.abc import Iterable

import pandas as pd
from pypfopt.risk_models import CovarianceShrinkage

from app import config
from app.engine.errors import InsufficientHistory


def covariance(returns: pd.DataFrame, window_years: int, end: pd.Timestamp | None = None,
               cash: Iterable[str] = ()) -> tuple[pd.DataFrame, list[str]]:
    """Ledoit-Wolf shrunk, annualised (x52) covariance of weekly returns.

    `cash`: isins of cash funds. Their variance is NOT shrunk: Ledoit-Wolf pulls every variance toward the average
    variance, which turns a 0.2% money-market fund into a 2-3% one. Shrinkage is estimated on the other funds; a
    cash fund keeps its sample variance, and its covariances with the others are scaled by (1 - shrinkage), as
    every other off-diagonal is. The result carries attrs["shrinkage"] (the Ledoit-Wolf intensity) and
    attrs["unshrunk"] (the cash isins it was applied to).

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
    unshrunk = [c for c in usable.columns if c in set(cash)]
    risky = [c for c in usable.columns if c not in unshrunk]
    if not risky:  # only cash: nothing to shrink
        cov = usable.cov() * config.PERIODS_PER_YEAR
        cov.attrs = {"shrinkage": 0.0, "unshrunk": unshrunk}
        return cov, dropped
    estimator = CovarianceShrinkage(usable[risky], returns_data=True, frequency=config.PERIODS_PER_YEAR)
    cov = estimator.ledoit_wolf()
    shrinkage = float(estimator.delta)
    if unshrunk:
        # (1 - shrinkage) on the cross terms keeps the matrix positive definite: the Schur complement of the cash
        # block is then at least (1 - shrinkage) x the sample one plus shrinkage x mean variance x I.
        sample = usable.cov(ddof=0) * config.PERIODS_PER_YEAR
        full = sample.copy()
        full.loc[risky, risky] = cov
        full.loc[risky, unshrunk] = (1 - shrinkage) * sample.loc[risky, unshrunk]
        full.loc[unshrunk, risky] = (1 - shrinkage) * sample.loc[unshrunk, risky]
        cov = full
    cov.attrs = {"shrinkage": shrinkage, "unshrunk": unshrunk}
    return cov, dropped
