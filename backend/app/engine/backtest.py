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
    both = pd.concat([equity, bonds], axis=1).dropna().to_numpy(dtype=float)
    if len(both) < 2:
        raise InvalidSettings("auto benchmark needs at least 2 weeks where both anchors have returns")
    shares = np.arange(101) / 100  # 0.00, 0.01, ..., 1.00 (0 and 1 are exact)
    mixes = both[:, [0]] * shares + both[:, [1]] * (1 - shares)  # one column per candidate share
    vols = mixes.std(axis=0, ddof=1) * math.sqrt(config.PERIODS_PER_YEAR)
    return float(shares[np.argmin(np.abs(vols - target_vol))])  # argmin: ties -> lowest share


@dataclass
class _Path:
    """One simulated path (portfolio or benchmark)."""

    value: np.ndarray  # one value per window week, value[0] == 1.0
    rebalances: list[pd.Timestamp] = field(default_factory=list)  # trades after the initial buy
    one_way_turnover: float = 0.0  # sum of ½ Σ|w_new - w_drift| over rebalances
    nan_weeks: dict[str, int] = field(default_factory=dict)  # held isin -> weeks with a missing return
    held: set[str] = field(default_factory=set)  # isins with a non-zero target at any time


def _window(index: pd.DatetimeIndex, settings: BacktestSettings) -> pd.DatetimeIndex:
    end = pd.Timestamp(settings.end) if settings.end else index[-1]
    if settings.start:
        start = pd.Timestamp(settings.start)
    else:
        # count the default years back from the last data week <= end (not from a calendar end date)
        last = index[index <= end]
        start = (last[-1] if len(last) else end) - pd.DateOffset(years=config.BACKTEST_YEARS)
    window = index[(index >= start) & (index <= end)]
    if len(window) < 2:
        raise InvalidSettings(f"the backtest window {start.date()}..{end.date()} contains fewer than 2 weeks of data")
    return window


def _as_array(weights: pd.Series, cols: list[str]) -> np.ndarray:
    """Weights as an array aligned to the returns columns (missing isins -> 0)."""
    unknown = sorted(set(weights.index) - set(cols))
    if unknown:
        raise InvalidSettings(f"weights for funds without return data: {unknown}")
    w = weights.reindex(cols).fillna(0.0).to_numpy(dtype=float)
    if abs(w.sum() - 1) > 1e-6:
        raise InvalidSettings(f"weights must sum to 1, got {w.sum():.6f}")
    return w


def _grow(hold: np.ndarray, r: np.ndarray, cols: list[str], nan_weeks: dict[str, int]) -> np.ndarray:
    """One week of drift. A missing return on a held fund counts as 0 and is tallied for a warning."""
    missing = np.isnan(r)
    for i in np.flatnonzero(missing & (hold != 0)):
        nan_weeks[cols[i]] = nan_weeks.get(cols[i], 0) + 1
    return hold * (1.0 + np.where(missing, 0.0, r))


def _simulate(
    R: np.ndarray,
    window: pd.DatetimeIndex,
    cols: list[str],
    target: np.ndarray,
    rebalance: RebalanceSettings,
    bps: float,
    periodic: set[pd.Timestamp],
    retarget: Callable[[pd.Timestamp], np.ndarray] | None = None,
) -> _Path:
    """Buy at the close of t0, then let holdings drift week by week (rebalancing arrives in Task 4)."""
    path = _Path(value=np.empty(len(window)))
    path.value[0] = 1.0
    path.held.update(c for c, x in zip(cols, target) if x != 0)
    hold = target * (1.0 - bps)  # initial buy from cash: one-way turnover 1.0, cost bps * 1.0
    for k in range(1, len(window)):
        hold = _grow(hold, R[k], cols, path.nan_weeks)
        path.value[k] = hold.sum()
    return path


def _num(x) -> float | None:
    """JSON-safe float: NaN / inf -> None."""
    x = float(x)
    return x if math.isfinite(x) else None


def _nan_warnings(path: _Path, prefix: str) -> list[str]:
    return [
        f"{prefix}{isin}: {n} week(s) with a missing return while held, counted as 0%"
        for isin, n in sorted(path.nan_weeks.items())
    ]


def _result(
    window: pd.DatetimeIndex,
    port: _Path,
    bench: _Path,
    rf: pd.Series,
    weights: dict[str, float],
    warnings: list[str],
    proxied_periods: list[ProxiedPeriod],
) -> BacktestResult:
    port_r = pd.Series(port.value, index=window).pct_change().iloc[1:]
    bench_r = pd.Series(bench.value, index=window).pct_change().iloc[1:]
    rf_w = rf.reindex(port_r.index)
    years = len(port_r) / config.PERIODS_PER_YEAR

    m_port = {name: fn(port_r, rf_w) for name, fn in metrics.REGISTRY.items()}
    m_port["beta"] = metrics.beta(port_r, bench_r)
    m_port["turnover"] = port.one_way_turnover / years
    m_bench = {name: fn(bench_r, rf_w) for name, fn in metrics.REGISTRY.items()}

    n = config.ROLLING_WINDOW_WEEKS
    return BacktestResult(
        series=BacktestSeries(
            dates=[t.date() for t in window],
            portfolio=[float(x) for x in port.value],
            benchmark=[float(x) for x in bench.value],
            # metrics work on returns (t1..tN); t0 gets the neutral value
            drawdown=[0.0] + [float(x) for x in metrics.drawdown_series(port_r)],
            rolling_vol=[None] + [_num(x) for x in metrics.rolling_vol(port_r, window=n)],
            rolling_sharpe=[None] + [_num(x) for x in metrics.rolling_sharpe(port_r, rf_w, window=n)],
        ),
        metrics={
            "portfolio": {k: _num(v) for k, v in m_port.items()},
            "benchmark": {k: _num(v) for k, v in m_bench.items()},
        },
        weights=weights,
        proxied_periods=proxied_periods,
        rebalance_dates=[t.date() for t in port.rebalances],
        warnings=warnings,
    )


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
    window = _window(returns.index, settings)
    cols = list(returns.columns)
    R = returns.loc[window].to_numpy(dtype=float)
    bps = settings.transaction_cost_bps / 1e4
    periodic = set(rebalance_dates(window, settings.rebalance))

    target0 = _as_array(weights_fn(window[0]), cols)
    port = _simulate(R, window, cols, target0, settings.rebalance, bps, periodic)
    bench = _simulate(R, window, cols, _as_array(benchmark_weights, cols), settings.rebalance, bps, periodic)

    warnings = _nan_warnings(port, "") + _nan_warnings(bench, "benchmark ")
    weights = {c: float(x) for c, x in zip(cols, target0) if x != 0}
    return _result(window, port, bench, rf, weights, warnings, proxied_periods=[])
