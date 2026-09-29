"""TEMPORARY — remove at integration (Lane E plan, Task 7).

Lane D builds app.engine.metrics in parallel; until it merges, those functions raise NotImplementedError and
REGISTRY is empty. backtest.run calls them as `metrics.<name>` at run time, so replacing the module attributes
here lets Lane E's tests run on their own. Keep these fakes tiny and obviously correct: they are not under test.
"""

import numpy as np
import pandas as pd
import pytest

from app.engine import metrics


def _drawdown_series(r: pd.Series) -> pd.Series:
    value = (1 + r).cumprod()
    peak = value.cummax().clip(lower=1.0)  # the starting value 1 counts as a peak
    return value / peak - 1


def _rolling_vol(r: pd.Series, window: int = 156, periods: int = 52) -> pd.Series:
    return r.rolling(window).std() * np.sqrt(periods)


def _rolling_sharpe(r: pd.Series, rf=0.0, window: int = 156, periods: int = 52) -> pd.Series:
    excess = r - rf
    return excess.rolling(window).mean() * periods / (r.rolling(window).std() * np.sqrt(periods))


def _beta(r: pd.Series, benchmark: pd.Series) -> float:
    both = pd.concat([r, benchmark], axis=1).dropna()
    var = float(both.iloc[:, 1].var())
    return float(both.cov().iloc[0, 1]) / var if var > 0 else float("nan")


_FAKE_REGISTRY = {
    "cagr": lambda r, rf: float((1 + r).prod() ** (52 / len(r)) - 1),
    "volatility": lambda r, rf: float(r.std() * np.sqrt(52)),
}


@pytest.fixture(autouse=True)
def fake_metrics(monkeypatch):
    monkeypatch.setattr(metrics, "drawdown_series", _drawdown_series)
    monkeypatch.setattr(metrics, "rolling_vol", _rolling_vol)
    monkeypatch.setattr(metrics, "rolling_sharpe", _rolling_sharpe)
    monkeypatch.setattr(metrics, "beta", _beta)
    monkeypatch.setattr(metrics, "REGISTRY", _FAKE_REGISTRY)
