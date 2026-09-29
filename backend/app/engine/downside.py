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


def _block_indices(
    n_hist: int, n_paths: int, n_weeks: int, block_weeks: tuple[int, int], rng: np.random.Generator
) -> np.ndarray:
    """History positions (n_paths, n_weeks) built from random blocks, fully vectorised.

    Each path is a sequence of blocks; block j starts at history position starts[j] and lasts lengths[j] weeks.
    offsets[j] = first path week of block j. A 1 is marked at every block's first path week; the cumulative sum
    of the marks gives, for every path week, the block it belongs to. Positions wrap around the history.
    """
    lo, hi = block_weeks
    n_blocks = -(-n_weeks // lo)  # ceil: enough blocks even if all have the minimum length
    starts = rng.integers(0, n_hist, size=(n_paths, n_blocks))
    lengths = rng.integers(lo, hi + 1, size=(n_paths, n_blocks))
    offsets = np.cumsum(lengths, axis=1) - lengths  # offsets[:, 0] == 0
    marks = np.zeros((n_paths, n_weeks), dtype=np.int32)
    rows, cols = np.nonzero(offsets < n_weeks)
    marks[rows, offsets[rows, cols]] = 1
    block = np.cumsum(marks, axis=1) - 1
    t = np.arange(n_weeks)
    pos = np.take_along_axis(starts, block, axis=1) + (t - np.take_along_axis(offsets, block, axis=1))
    return pos % n_hist


def _chunk_sizes(n_paths: int) -> Iterator[int]:
    for first in range(0, n_paths, CHUNK_PATHS):
        yield min(CHUNK_PATHS, n_paths - first)


def _path_stats(chunks: Iterable[np.ndarray], horizon_years: int) -> tuple[np.ndarray, np.ndarray]:
    """Max drawdown per path and value at each year boundary (column 0 = 1.0) from chunks of weekly returns."""
    mdds, years = [], []
    for r in chunks:
        value = np.cumprod(1.0 + r, axis=1)
        peak = np.maximum(np.maximum.accumulate(value, axis=1), 1.0)  # start value 1.0 counts as a peak
        mdds.append((value / peak - 1.0).min(axis=1))
        yearly = np.ones((len(r), horizon_years + 1))
        yearly[:, 1:] = value[:, PERIODS - 1 :: PERIODS]  # value after weeks 52, 104, ...
        years.append(yearly)
    return np.concatenate(mdds), np.vstack(years)


def _probabilities(values: np.ndarray, thresholds: list[float]) -> list[ProbabilityPoint]:
    """P(values <= -t) per threshold t (values are returns/drawdowns, negative = loss)."""
    return [ProbabilityPoint(threshold=float(t), probability=float(np.mean(values <= -t))) for t in thresholds]


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
    lo, hi = block_weeks
    n_blocks = -(-n_weeks // lo)  # ceil: enough blocks even if all have the minimum length
    starts = rng.integers(0, n_hist, size=(n_paths, n_blocks))
    lengths = rng.integers(lo, hi + 1, size=(n_paths, n_blocks))
    offsets = np.cumsum(lengths, axis=1) - lengths  # offsets[:, 0] == 0
    marks = np.zeros((n_paths, n_weeks), dtype=np.int32)
    rows, cols = np.nonzero(offsets < n_weeks)
    marks[rows, offsets[rows, cols]] = 1
    block = np.cumsum(marks, axis=1) - 1
    t = np.arange(n_weeks)
    pos = np.take_along_axis(starts, block, axis=1) + (t - np.take_along_axis(offsets, block, axis=1))
    return pos % n_hist


def _chunk_sizes(n_paths: int) -> Iterator[int]:
    for first in range(0, n_paths, CHUNK_PATHS):
        yield min(CHUNK_PATHS, n_paths - first)


def _path_stats(chunks: Iterable[np.ndarray], horizon_years: int) -> tuple[np.ndarray, np.ndarray]:
    """Max drawdown per path and value at each year boundary (column 0 = 1.0) from chunks of weekly returns."""
    mdds, years = [], []
    for r in chunks:
        value = np.cumprod(1.0 + r, axis=1)
        peak = np.maximum(np.maximum.accumulate(value, axis=1), 1.0)  # start value 1.0 counts as a peak
        mdds.append((value / peak - 1.0).min(axis=1))
        yearly = np.ones((len(r), horizon_years + 1))
        yearly[:, 1:] = value[:, PERIODS - 1 :: PERIODS]  # value after weeks 52, 104, ...
        years.append(yearly)
    return np.concatenate(mdds), np.vstack(years)


def _probabilities(values: np.ndarray, thresholds: list[float]) -> list[ProbabilityPoint]:
    """P(values <= -t) per threshold t (values are returns/drawdowns, negative = loss)."""
    return [ProbabilityPoint(threshold=float(t), probability=float(np.mean(values <= -t))) for t in thresholds]


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
    Deterministic for a given seed.
    """
    lo, hi = block_weeks
    if not 1 <= lo <= hi:
        raise InvalidSettings(f"block_weeks must satisfy 1 <= min <= max, got {block_weeks}")
    if horizon_years < 1 or n_paths < 1:
        raise InvalidSettings("horizon_years and n_paths must be at least 1")
    x = port_returns.dropna().to_numpy(dtype=float)
    if len(x) < PERIODS:
        raise InsufficientHistory("less than one year of portfolio return history to bootstrap")
    x = x - x.mean() + ((1 + expected_return) ** (1 / PERIODS) - 1)

    n_weeks = PERIODS * horizon_years
    rng = np.random.default_rng(seed)
    chunks = (x[_block_indices(len(x), m, n_weeks, block_weeks, rng)] for m in _chunk_sizes(n_paths))
    mdd, yearly = _path_stats(chunks, horizon_years)

    worst_year = (yearly[:, 1:] / yearly[:, :-1] - 1.0).min(axis=1)
    pct = np.percentile(yearly, config.FAN_PERCENTILES, axis=0)  # (len(FAN_PERCENTILES), H + 1)
    fan = [
        FanPoint(year=y, **{f"p{p}": float(pct[i, y]) for i, p in enumerate(config.FAN_PERCENTILES)})
        for y in range(horizon_years + 1)
    ]
    return SimulationResult(
        drawdown_probs=_probabilities(mdd, thresholds),
        annual_loss_probs=_probabilities(worst_year, thresholds),
        p_below_invested=float(np.mean(yearly[:, -1] < 1.0)),
        fan=fan,
    )


def normal_comparison(
    mu: float, sigma: float, horizon_years: int, thresholds: list[float], n_paths: int, seed: int | None = config.MC_SEED
) -> NormalComparison:
    """Same probabilities under a normal model (teaching comparison).
    Annual loss: yearly log return ~ N(ln(1+mu) - sigma^2/2, sigma); p = P(year return <= -t);
      P(any year over horizon) = 1 - (1 - p) ** horizon_years.
    Drawdown: simulated GBM with weekly steps using the same parameters."""
    if not sigma > 0:
        raise InvalidSettings(f"sigma must be positive, got {sigma}")
    if horizon_years < 1 or n_paths < 1:
        raise InvalidSettings("horizon_years and n_paths must be at least 1")
    log_mean = float(np.log1p(mu) - sigma**2 / 2)

    annual = []
    for t in thresholds:
        p_year = float(norm.cdf((np.log1p(-t) - log_mean) / sigma))
        annual.append(ProbabilityPoint(threshold=float(t), probability=1.0 - (1.0 - p_year) ** horizon_years))

    rng = np.random.default_rng(seed)
    n_weeks = PERIODS * horizon_years
    chunks = (
        np.expm1(rng.normal(log_mean / PERIODS, sigma / np.sqrt(PERIODS), size=(m, n_weeks)))
        for m in _chunk_sizes(n_paths)
    )
    mdd, _ = _path_stats(chunks, horizon_years)
    return NormalComparison(drawdown_probs=_probabilities(mdd, thresholds), annual_loss_probs=annual)


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
