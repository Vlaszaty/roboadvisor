import numpy as np
import pandas as pd
import pytest

from app.engine.backtest import auto_benchmark
from app.engine.errors import InvalidSettings

EQ, BD = "IE00B6R52259", "IE00BDBRDM35"


def ann_vol(s: pd.Series) -> float:
    return float(s.std() * np.sqrt(52))


def test_equity_vol_gives_all_equity(weekly_eur):
    eq, bd = weekly_eur[EQ], weekly_eur[BD]
    assert auto_benchmark(eq, bd, ann_vol(eq)) == 1.0
    assert auto_benchmark(eq, bd, 5.0) == 1.0  # unreachable target -> closest end


def test_bond_vol_gives_all_bonds(weekly_eur):
    eq, bd = weekly_eur[EQ], weekly_eur[BD]
    assert auto_benchmark(eq, bd, ann_vol(bd)) == 0.0


def test_in_between_targets_are_monotonic(weekly_eur):
    eq, bd = weekly_eur[EQ], weekly_eur[BD]
    targets = np.linspace(ann_vol(bd), ann_vol(eq), 9)
    shares = [auto_benchmark(eq, bd, t) for t in targets]
    assert shares == sorted(shares)
    assert shares[0] == 0.0 and shares[-1] == 1.0
    assert 0.0 < shares[4] < 1.0
    assert all(round(s, 2) == s for s in shares)  # 0.01 grid


def test_uses_common_non_nan_weeks_only():
    idx = pd.date_range("2024-01-05", periods=4, freq="W-FRI")
    eq = pd.Series([np.nan, 0.02, -0.01, np.nan], index=idx)
    bd = pd.Series([0.001, np.nan, 0.002, 0.0], index=idx)
    with pytest.raises(InvalidSettings):
        auto_benchmark(eq, bd, 0.1)  # only one common week
