"""Tiny hand-computable inputs for Lane E tests."""

import pandas as pd

from app.engine.backtest import run
from app.engine.types import BacktestResult, BacktestSettings


def weekly(rows: dict[str, list[float]], start: str = "2024-01-05") -> pd.DataFrame:
    """Weekly (W-FRI) return frame starting on `start` (a Friday).
    Row 0 is the first window week t0: its return is never earned (see the timing convention)."""
    n = len(next(iter(rows.values())))
    return pd.DataFrame(rows, index=pd.date_range(start, periods=n, freq="W-FRI"), dtype=float)


def zero_rf(returns: pd.DataFrame) -> pd.Series:
    return pd.Series(0.0, index=returns.index)


def fixed(weights: dict[str, float]):
    s = pd.Series(weights, dtype=float)
    return lambda t: s


def bt(returns, weights, bench=None, proxied=None, **settings) -> BacktestResult:
    """run() with constant weights, zero rf and the given BacktestSettings fields."""
    return run(
        returns, fixed(weights), BacktestSettings(**settings),
        pd.Series(bench or weights, dtype=float), zero_rf(returns), proxied or {},
    )


def inverse_vol_fn(returns: pd.DataFrame, isins: list[str], calls: list | None = None):
    """The pattern the pipeline's walk-forward weights_fn must follow: slice to rows <= t FIRST,
    then estimate. Records every call date in `calls`."""

    def weights_fn(t: pd.Timestamp) -> pd.Series:
        if calls is not None:
            calls.append(t)
        past = returns.loc[:t, isins].tail(52)  # only data <= t
        inv = 1 / past.std()
        return inv / inv.sum()

    return weights_fn


def corrupt_after(returns: pd.DataFrame, t: pd.Timestamp) -> pd.DataFrame:
    """Copy of returns with every row after t replaced by garbage."""
    bad = returns.copy()
    bad.loc[bad.index > t] = 1e6
    return bad
