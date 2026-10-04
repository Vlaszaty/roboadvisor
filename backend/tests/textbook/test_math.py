import numpy as np
import pandas as pd
import pytest

from app.engine import textbook as tb
from app.engine.errors import InsufficientHistory


def _weeks(n: int, cols: list[str]) -> pd.DataFrame:
    idx = pd.date_range("2018-01-05", periods=n, freq="W-FRI")
    rng = np.random.default_rng(1)
    return pd.DataFrame(rng.normal(0.001, 0.02, (n, len(cols))), index=idx, columns=cols)


def test_window_keeps_the_last_years_and_drops_incomplete_weeks():
    r = _weeks(400, ["A", "B"])
    r.iloc[-1, 0] = np.nan
    w = tb.window(r, 5)
    assert len(w) == 259 and w.index[-1] == r.index[-2]


def test_window_needs_a_year_of_complete_weeks():
    with pytest.raises(InsufficientHistory):
        tb.window(_weeks(40, ["A"]), 5)


def test_annual_stats_by_hand():
    weekly = [0.01, -0.01, 0.03, 0.01]
    mean, vol = tb.annual_stats(pd.DataFrame({"A": weekly}))
    assert mean["A"] == pytest.approx(0.01 * 52)
    assert vol["A"] == pytest.approx(np.std(weekly, ddof=1) * np.sqrt(52))


def test_annual_covariance_diagonal_is_volatility_squared():
    w = _weeks(100, ["A", "B"])
    _, vol = tb.annual_stats(w)
    cov = tb.annual_covariance(w)
    assert np.sqrt(cov.at["A", "A"]) == pytest.approx(vol["A"])
    assert cov.at["A", "B"] == pytest.approx(cov.at["B", "A"])


def test_risk_aversion_scale():
    assert tb.risk_aversion(0) == pytest.approx(10.0)
    assert tb.risk_aversion(50) == pytest.approx(6.0)
    assert tb.risk_aversion(100) == pytest.approx(2.0)


def test_tangent_of_two_uncorrelated_funds_matches_the_closed_form():
    # tangent weights are proportional to inverse(cov) @ (mu - rf) = [0.06/0.04, 0.02/0.01] = [1.5, 2]
    cov = pd.DataFrame([[0.04, 0.0], [0.0, 0.01]], index=["A", "B"], columns=["A", "B"])
    w = tb.tangent_weights(pd.Series({"A": 0.08, "B": 0.04}), cov, rf=0.02)
    assert w["A"] == pytest.approx(3 / 7, abs=1e-3) and w["B"] == pytest.approx(4 / 7, abs=1e-3)


def test_no_tangent_when_no_fund_beats_the_risk_free_rate():
    cov = pd.DataFrame([[0.04, 0.0], [0.0, 0.01]], index=["A", "B"], columns=["A", "B"])
    assert tb.tangent_weights(pd.Series({"A": 0.02, "B": 0.01}), cov, rf=0.02) is None


def test_split_follows_the_formula_and_is_capped():
    assert tb.split(0.04, 0.0144, 10.0) == pytest.approx((0.04 / 0.144, 0.04 / 0.144))
    uncapped, capped = tb.split(0.04, 0.0144, 2.0)  # 1.39 before the cap: no borrowing
    assert uncapped == pytest.approx(0.04 / 0.0288) and capped == 1.0
    assert tb.split(-0.01, 0.0144, 5.0)[1] == 0.0


def test_split_refuses_a_tangent_without_volatility():
    with pytest.raises(InsufficientHistory):
        tb.split(0.04, 0.0, 5.0)
