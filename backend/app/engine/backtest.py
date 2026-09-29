"""Lane E. Spec §5.8. Weekly backtest with drift, rebalancing and transaction costs.

Timing convention (the whole module relies on it):
- The window is the index weeks t0..tN inside [start, end].
- At the close of t0 the initial target weights_fn(t0) is bought. value[0] = 1.0, recorded before the buy cost.
- Week k >= 1: holdings grow by the returns of row t_k, value[k] is recorded, and only then, if a rebalance is
  due at t_k (never at tN), we trade at the close of t_k and pay the cost, which shows up in value[k+1].
- So a decision taken at t (including weights_fn(t)) never earns the return of week t, and weights_fn only
  ever needs data <= t. The return in row t0 is never earned.
"""

import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import pandas as pd

from app import config
from app.engine import metrics  # call metrics.X at run time (tests patch the module while Lane D is a stub)
from app.engine.errors import InvalidSettings
from app.engine.types import BacktestResult, BacktestSeries, BacktestSettings, ProxiedPeriod, RebalanceSettings

WeightsFn = Callable[[pd.Timestamp], pd.Series]

LOOKAHEAD_WARNING = "static mode: weights were chosen using data from the whole period (look-ahead bias)"
_PERIOD = {"monthly": "M", "quarterly": "Q", "annual": "Y"}


def rebalance_dates(index: pd.DatetimeIndex, rebalance: RebalanceSettings) -> list[pd.Timestamp]:
    """periodic: the last week of each month / quarter / year in index, excluding the final week.
    none / threshold: [] (threshold triggers are evaluated inside run)."""
    if rebalance.type != "periodic" or len(index) < 2:
        return []
    periods = index.to_period(_PERIOD[rebalance.frequency])
    # A week is the last of its period when the next week belongs to another period.
    # The final week has no next week, so it is never included.
    is_last = np.asarray(periods[1:] != periods[:-1])
    return list(index[:-1][is_last])


def auto_benchmark(equity: pd.Series, bonds: pd.Series, target_vol: float) -> float:
    """Equity share in [0, 1] (step 0.01) whose fixed-mix annualised vol (weekly std * sqrt(52), common non-NaN
    weeks) is closest to target_vol."""
    raise NotImplementedError("Lane E")


def run(
    returns: pd.DataFrame,
    weights_fn: WeightsFn,
    settings: BacktestSettings,
    benchmark_weights: pd.Series,
    rf: pd.Series,
    proxied: dict[str, tuple[pd.Timestamp, pd.Timestamp]],
) -> BacktestResult:
    """Simulate the portfolio and benchmark over the backtest window (spec §5.8).

    returns: weekly base-ccy returns; columns include every isin weights_fn can return and every benchmark isin.
    rf: weekly risk-free rate (annual/52) aligned to returns, for Sharpe/Sortino.
    Window: settings.start..settings.end (None -> last index week and last minus config.BACKTEST_YEARS years).
    Initial target = weights_fn(first window week); the initial buy costs bps/1e4 * 1.0.
    Each week holdings drift with returns. Rebalance on rebalance_dates (periodic) or when
    max |w_drift - target| > threshold (threshold); never for 'none'.
    On each rebalance: walk_forward -> target = weights_fn(t); static -> target stays the initial weights.
    Cost per trade = bps/1e4 * sum |w_new - w_drift|, deducted from value.
    A NaN return for a held fund counts as 0 that week and adds a warning.
    Benchmark: benchmark_weights, same rebalancing rule, static target, same costs.
    series: value starts at 1.0 on the week before the first return; rolling windows config.ROLLING_WINDOW_WEEKS.
    metrics: {'portfolio': REGISTRY + beta + turnover, 'benchmark': REGISTRY}; 
      turnover = sum over rebalances of 0.5 * sum|w_new - w_drift| (initial buy excluded) / (weeks / 52).
    Timing: series.dates[0] = t0 with value 1.0 (before the buy cost); t0's return is not earned; a trade's cost shows
      in the next week's value; no trades in the final week; rebalance_dates excludes t0.
    weights: the initial target weights. proxied_periods: proxied ranges of held funds clipped to the window.
    static mode adds the warning
      'static mode: weights were chosen using data from the whole period (look-ahead bias)'.
    trace is left empty (the pipeline fills it).
    """
    raise NotImplementedError("Lane E")
