"""Lane D. Spec §5.6. Inputs are weekly simple returns; annualisation uses periods=52.

Sign conventions: max_drawdown and cvar are negative numbers (losses).
"""

from typing import Callable

import numpy as np
import pandas as pd

_EPS = 1e-12  # volatilities / drawdowns smaller than this are floating-point noise, treated as zero
_NAN = float("nan")


def _excess(r: pd.Series, rf: pd.Series | float) -> pd.Series:
    """Weekly excess returns r - rf on the non-NaN weeks of r (rf Series is aligned by date)."""
    r = r.dropna()
    if isinstance(rf, pd.Series):
        rf = rf.reindex(r.index)
    return (r - rf).dropna()


def cagr(r: pd.Series, periods: int = 52) -> float:
    r = r.dropna()
    if r.empty:
        return _NAN
    growth = float((1 + r).prod())
    if growth <= 0:
        return -1.0  # total loss; a fractional power of a non-positive number is undefined
    return float(growth ** (periods / len(r)) - 1)


def volatility(r: pd.Series, periods: int = 52) -> float:
    r = r.dropna()
    if len(r) < 2:
        return _NAN
    return float(r.std(ddof=1) * np.sqrt(periods))


def sharpe(r: pd.Series, rf: pd.Series | float = 0.0, periods: int = 52) -> float:
    """Annualised mean excess return / annualised vol. rf: weekly rate series aligned to r, or a constant weekly rate."""
    ex = _excess(r, rf)
    vol = volatility(r.loc[ex.index], periods)
    if not vol > _EPS:
        return _NAN
    return float(ex.mean() * periods / vol)


def sortino(r: pd.Series, rf: pd.Series | float = 0.0, periods: int = 52) -> float:
    ex = _excess(r, rf)
    if ex.empty:
        return _NAN
    downside = float(np.sqrt((np.minimum(ex, 0.0) ** 2).mean()) * np.sqrt(periods))
    if not downside > _EPS:
        return _NAN
    return float(ex.mean() * periods / downside)


def drawdown_series(r: pd.Series) -> pd.Series:
    """Drawdown of the cumulative value on the same index as r (values <= 0; start value 1 counts as a peak).
    A NaN week is treated as a zero return, so it carries the previous drawdown (0 before the first return)."""
    value = (1 + r.fillna(0.0)).cumprod()
    peak = value.cummax().clip(lower=1.0)
    return value / peak - 1


def max_drawdown(r: pd.Series) -> float:
    """Most negative peak-to-trough decline of the cumulative value (starting value 1 counts as a peak)."""
    r = r.dropna()
    if r.empty:
        return _NAN
    return float(min(drawdown_series(r).min(), 0.0))


def max_drawdown_duration(r: pd.Series) -> int:
    """Longest number of weeks spent below a previous peak (unrecovered drawdowns count to the end)."""
    longest = run = 0
    for below in drawdown_series(r.dropna()).to_numpy() < -_EPS:
        run = run + 1 if below else 0
        longest = max(longest, run)
    return longest


def cvar(r: pd.Series, level: float = 0.95) -> float:
    """Mean of the worst (1 - level) share of weekly returns (negative number)."""
    x = np.sort(r.dropna().to_numpy(dtype=float))
    if len(x) == 0:
        return _NAN
    # round first: 100 * (1 - 0.95) is 5.000000000000004 and 100 * (1 - 0.90) is 9.999999999999998 in floating
    # point; they must count as 5 and 10 observations
    k = max(1, int(np.floor(round(len(x) * (1 - level), 9))))
    return float(x[:k].mean())


def calmar(r: pd.Series, periods: int = 52) -> float:
    mdd = max_drawdown(r)
    if not mdd < -_EPS:
        return _NAN
    return cagr(r, periods) / abs(mdd)


def beta(r: pd.Series, benchmark: pd.Series) -> float:
    both = pd.concat([r, benchmark], axis=1).dropna()
    if len(both) < 2:
        return _NAN
    var = both.iloc[:, 1].var()
    if not var > 0:
        return _NAN
    return float(both.iloc[:, 0].cov(both.iloc[:, 1]) / var)


def rolling_vol(r: pd.Series, window: int = 156, periods: int = 52) -> pd.Series: raise NotImplementedError("Lane D")
def rolling_sharpe(r: pd.Series, rf: pd.Series | float = 0.0, window: int = 156, periods: int = 52) -> pd.Series:
    raise NotImplementedError("Lane D")
def risk_contribution(weights: pd.Series, cov: pd.DataFrame) -> pd.Series:
    """w_i * (Σw)_i / w'Σw; sums to 1."""
    raise NotImplementedError("Lane D")
def ex_ante(weights: pd.Series, mu: pd.Series, cov: pd.DataFrame, beta: pd.Series, ter: pd.Series, rf: float) -> dict:
    """{'expected_return', 'volatility', 'sharpe' ((er - rf) / vol), 'beta', 'weighted_ter',
    'annual_cost_per_10k' (weighted_ter * 10_000), 'risk_contribution': pd.Series}."""
    raise NotImplementedError("Lane D")


# Metrics reported in backtests. Each takes (weekly returns, weekly rf series) -> float (NaN on degenerate input,
# never raises). Keys are frozen: cagr, volatility, sharpe, sortino, max_drawdown, max_drawdown_duration, cvar_95, calmar.
REGISTRY: dict[str, Callable[[pd.Series, pd.Series], float]] = {}
