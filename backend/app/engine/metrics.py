"""Lane D. Spec §5.6. Inputs are weekly simple returns; annualisation uses periods=52.

Sign conventions: max_drawdown and cvar are negative numbers (losses).
"""

from typing import Callable

import pandas as pd


def cagr(r: pd.Series, periods: int = 52) -> float: raise NotImplementedError("Lane D")
def volatility(r: pd.Series, periods: int = 52) -> float: raise NotImplementedError("Lane D")
def sharpe(r: pd.Series, rf: pd.Series | float = 0.0, periods: int = 52) -> float:
    """Annualised mean excess return / annualised vol. rf: weekly rate series aligned to r, or a constant weekly rate."""
    raise NotImplementedError("Lane D")
def sortino(r: pd.Series, rf: pd.Series | float = 0.0, periods: int = 52) -> float: raise NotImplementedError("Lane D")
def max_drawdown(r: pd.Series) -> float:
    """Most negative peak-to-trough decline of the cumulative value (starting value 1 counts as a peak)."""
    raise NotImplementedError("Lane D")
def max_drawdown_duration(r: pd.Series) -> int:
    """Longest number of weeks spent below a previous peak (unrecovered drawdowns count to the end)."""
    raise NotImplementedError("Lane D")
def cvar(r: pd.Series, level: float = 0.95) -> float:
    """Mean of the worst (1 - level) share of weekly returns (negative number)."""
    raise NotImplementedError("Lane D")
def calmar(r: pd.Series, periods: int = 52) -> float: raise NotImplementedError("Lane D")
def beta(r: pd.Series, benchmark: pd.Series) -> float: raise NotImplementedError("Lane D")
def drawdown_series(r: pd.Series) -> pd.Series: raise NotImplementedError("Lane D")
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
