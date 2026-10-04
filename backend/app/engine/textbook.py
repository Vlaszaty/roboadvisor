"""Textbook portfolio (spec 2026-10-04): Markowitz and the CAPM as taught in the course, on a fixed fund set.

Deliberately simple: plain sample covariance, weights between 0 and 1 summing to 1, no TER penalty and no caps.
The tangent (maximum Sharpe) portfolio is mixed with a risk-free fund; risk aversion A sets the split.
"""

import numpy as np
import pandas as pd

from app import config
from app.engine import optimize
from app.engine.errors import InsufficientHistory
from app.engine.types import Constraints, DataSource, TextbookPortfolio

PERIODS = config.PERIODS_PER_YEAR
MIN_EXCESS = 1e-9  # an expected return this close to rf does not count as "above rf"
MIN_VARIANCE = 1e-12


def window(returns: pd.DataFrame, years: int) -> pd.DataFrame:
    """The last years x 52 weekly rows, without weeks where any column is missing."""
    w = returns.iloc[-years * PERIODS:].dropna()
    if len(w) < PERIODS:
        raise InsufficientHistory(f"textbook portfolio: only {len(w)} complete weeks in the last {years} years")
    return w


def annual_stats(w: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """(average return, volatility) per column, annualised: mean x 52 and standard deviation x sqrt(52)."""
    return w.mean() * PERIODS, w.std() * np.sqrt(PERIODS)


def annual_covariance(w: pd.DataFrame) -> pd.DataFrame:
    """Plain sample covariance of the weekly returns x 52 (no shrinkage)."""
    return w.cov() * PERIODS


def risk_aversion(risk_level: float) -> float:
    """A in U = E(r) - 1/2 A sigma^2: linear from the cautious end (risk level 0) to the adventurous end (100)."""
    cautious, adventurous = config.TEXTBOOK_RISK_AVERSION
    return cautious + (adventurous - cautious) * risk_level / 100


def loose_constraints(isins: list[str]) -> Constraints:
    """Only the course's constraints: weights between 0 and 1, summing to 1."""
    return Constraints(target_vol=0.0, max_etfs=len(isins), min_position=0.0, max_position=1.0,
                       ter=pd.Series(0.0, index=isins))


def tangent_weights(mu: pd.Series, cov: pd.DataFrame, rf: float) -> pd.Series | None:
    """Weights of the maximum-Sharpe portfolio; None when no fund's expected return is above rf."""
    excess = mu - rf
    if not (excess > MIN_EXCESS).any():
        return None
    return optimize.optimize(excess, cov, loose_constraints(list(cov.index)), "max_sharpe").weights


def split(excess: float, variance: float, a: float) -> tuple[float, float]:
    """Share in the tangent portfolio that maximises U: y = excess / (A x variance). Returns (y, y clipped to 0..1)."""
    if variance <= MIN_VARIANCE:
        raise InsufficientHistory("textbook portfolio: the tangent portfolio has no volatility")
    y = excess / (a * variance)
    return y, min(max(y, 0.0), 1.0)


def textbook(
    base: str, risk_level: float, return_model: str, market_premium: float | None, data: DataSource
) -> TextbookPortfolio:
    raise NotImplementedError("textbook portfolio")
