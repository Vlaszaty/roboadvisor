"""Lane D. Spec §5.7."""

from collections.abc import Iterable, Iterator

import numpy as np
import pandas as pd
from scipy.stats import norm

from app import config
from app.engine.errors import InsufficientHistory, InvalidSettings
from app.engine.types import FanPoint, NormalComparison, ProbabilityPoint, SimulationResult, StressResult

PERIODS = config.PERIODS_PER_YEAR
# Monte Carlo paths are processed in chunks of this many paths (float64). 500 paths x 40 years x 52 weeks
# = ~1M cells per array (8 MB), so a 10k-path, 40-year run stays well under 100 MB peak memory.
CHUNK_PATHS = 500


def portfolio_history(
    returns: pd.DataFrame, weights: pd.Series, proxied: dict[str, tuple[pd.Timestamp, pd.Timestamp]]
) -> tuple[pd.Series, pd.Series]:
    """Weekly fixed-weight portfolio returns (weights reset every week) over weeks where every held fund has data.
    Second value: bool Series on the same index, True where any held fund's return came from its proxy."""
    held = weights[weights != 0]
    sub = returns[list(held.index)].dropna(how="any")
    port = sub.mul(held, axis=1).sum(axis=1).rename("portfolio")
    mask = pd.Series(False, index=port.index, name="proxied")
    for isin in held.index:
        if isin in proxied:
            start, end = proxied[isin]
            mask |= (port.index >= pd.Timestamp(start)) & (port.index <= pd.Timestamp(end))
    return port, mask


def simulate(
    port_returns: pd.Series,
    expected_return: float,
    horizon_years: int,
    thresholds: list[float],
    n_paths: int,
    block_weeks: tuple[int, int] = config.BLOCK_WEEKS,
    seed: int | None = config.MC_SEED,
) -> SimulationResult:
    """Stationary block bootstrap of weekly portfolio returns.

    Blocks: random start, integer length uniform in [block_weeks[0], block_weeks[1]], wrapping around the history.
    Returns are demeaned, then shifted by (1 + expected_return) ** (1/52) - 1 so the mean matches the CAPM expectation.
    Paths: 52 * horizon_years weeks, value starts at 1.0.
    drawdown_probs[t]: P(min over path of value/running_peak - 1 <= -t) (start value counts as a peak).
    annual_loss_probs[t]: P(any of the horizon's consecutive 52-week years has return <= -t).
    p_below_invested: P(final value < 1). fan: year 0..horizon_years, percentiles config.FAN_PERCENTILES of value.
    Deterministic for a given seed. Raises InsufficientHistory if port_returns has fewer than 52 weeks.
    """
    raise NotImplementedError("Lane D")


def normal_comparison(
    mu: float, sigma: float, horizon_years: int, thresholds: list[float], n_paths: int, seed: int | None = config.MC_SEED
) -> NormalComparison:
    """Same probabilities under a normal model (teaching comparison).
    Annual loss: yearly log return ~ N(ln(1+mu) - sigma^2/2, sigma); p = P(year return <= -t);
      P(any year over horizon) = 1 - (1 - p) ** horizon_years.
    Drawdown: simulated GBM with weekly steps using the same parameters."""
    raise NotImplementedError("Lane D")


def stress(
    port_returns: pd.Series, proxied_mask: pd.Series, events: list[tuple[str, str, str]] = config.STRESS_EVENTS
) -> list[StressResult]:
    """Cumulative return over each (name, start, end) window: prod(1 + r) - 1 of the weeks inside it.
    loss=None if the history starts after the window start. proxied=True if any week in the window is proxied."""
    r = port_returns.dropna()
    out: list[StressResult] = []
    for name, start, end in events:
        s, e = pd.Timestamp(start), pd.Timestamp(end)
        window = r.loc[s:e]
        if r.empty or r.index[0] > s or window.empty:
            out.append(StressResult(event=name, start=s.date(), end=e.date(), loss=None, proxied=False))
            continue
        proxied = bool(proxied_mask.reindex(window.index, fill_value=False).astype(bool).any())
        loss = float((1 + window).prod() - 1)
        out.append(StressResult(event=name, start=s.date(), end=e.date(), loss=loss, proxied=proxied))
    return out
