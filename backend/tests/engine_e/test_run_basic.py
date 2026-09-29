from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.engine import metrics
from app.engine.backtest import run
from app.engine.errors import InvalidSettings
from app.engine.types import BacktestSettings
from tests.engine_e.helpers import bt, fixed, weekly, zero_rf

ANCHORS_6040 = {"IE00B6R52259": 0.6, "IE00BDBRDM35": 0.4}


def test_none_equals_buy_and_hold_minus_initial_cost():
    # Row 0 holds garbage on purpose: the return of t0 is never earned.
    r = weekly({"A": [9.99, 0.10, -0.05, 0.02], "B": [9.99, 0.01, 0.01, -0.03]})
    res = bt(r, {"A": 0.6, "B": 0.4}, transaction_cost_bps=10)
    growth = (1 + r.iloc[1:]).prod()  # A: 1.1*0.95*1.02, B: 1.01*1.01*0.97
    expected = (1 - 10 / 1e4) * (0.6 * growth["A"] + 0.4 * growth["B"])
    assert res.series.portfolio[0] == 1.0
    assert res.series.portfolio[-1] == pytest.approx(expected, rel=1e-12)
    assert res.rebalance_dates == []
    assert res.metrics["portfolio"]["turnover"] == 0.0


def test_zero_bps_equals_no_cost_path():
    r = weekly({"A": [0.0, 0.10, -0.05, 0.02], "B": [0.0, 0.01, 0.01, -0.03]})
    res = bt(r, {"A": 0.6, "B": 0.4}, transaction_cost_bps=0)
    cum = (1 + r.iloc[1:]).cumprod()
    no_cost = [1.0] + list(0.6 * cum["A"] + 0.4 * cum["B"])
    assert res.series.portfolio == pytest.approx(no_cost, rel=1e-12)


def test_nan_return_of_held_fund_counts_as_zero_and_warns():
    r = weekly({
        "A": [0.0, 0.10, np.nan, 0.10],
        "B": [0.0, 0.0, 0.0, 0.0],
        "C": [np.nan, np.nan, np.nan, np.nan],  # not held: no warning
    })
    res = bt(r, {"A": 0.5, "B": 0.5}, transaction_cost_bps=0)
    assert res.series.portfolio[-1] == pytest.approx(0.5 * 1.1 * 1.1 + 0.5)
    assert any(w.startswith("A:") and "1 week" in w for w in res.warnings)
    assert not any(w.startswith("C:") for w in res.warnings)


def test_result_shape_series_and_metrics():
    r = weekly({"A": [0.0, 0.01, -0.02, 0.03, 0.01, -0.01], "B": [0.0, 0.002, 0.001, -0.001, 0.0, 0.003]})
    res = bt(r, {"A": 0.5, "B": 0.5}, bench={"A": 1.0}, transaction_cost_bps=10)
    s = res.series
    n = len(r)
    assert len(s.dates) == len(s.portfolio) == len(s.benchmark) == len(s.drawdown) == n
    assert len(s.rolling_vol) == len(s.rolling_sharpe) == n
    assert s.dates[0] == date(2024, 1, 5)  # value 1.0 sits on the week before the first return
    assert s.portfolio[0] == 1.0 and s.benchmark[0] == 1.0 and s.drawdown[0] == 0.0
    assert all(d <= 0 for d in s.drawdown)
    assert all(v is None for v in s.rolling_vol)  # fewer than 156 weeks
    assert s.benchmark[-1] == pytest.approx((1 - 0.001) * (1 + r["A"].iloc[1:]).prod())
    assert set(res.metrics["portfolio"]) == set(metrics.REGISTRY) | {"beta", "turnover"}
    assert set(res.metrics["benchmark"]) == set(metrics.REGISTRY)
    assert res.weights == {"A": 0.5, "B": 0.5}
    assert res.trace == []


def test_window_defaults_to_last_15_years(weekly_eur):
    w = pd.Series(ANCHORS_6040)
    res = run(weekly_eur, fixed(ANCHORS_6040), BacktestSettings(transaction_cost_bps=0), w, zero_rf(weekly_eur), {})
    end = weekly_eur.index[-1]
    expected_start = weekly_eur.index[weekly_eur.index >= end - pd.DateOffset(years=15)][0]
    assert res.series.dates[0] == expected_start.date()
    assert res.series.dates[-1] == end.date()


def test_window_respects_settings(weekly_eur):
    w = pd.Series(ANCHORS_6040)
    settings = BacktestSettings(start=date(2012, 1, 1), end=date(2015, 6, 30))
    res = run(weekly_eur, fixed(ANCHORS_6040), settings, w, zero_rf(weekly_eur), {})
    assert res.series.dates[0] == date(2012, 1, 6)  # first Friday >= start
    assert res.series.dates[-1] == date(2015, 6, 26)  # last Friday <= end

    only_end = run(weekly_eur, fixed(ANCHORS_6040), BacktestSettings(end=date(2020, 12, 31)), w, zero_rf(weekly_eur), {})
    # last Friday <= 2020-12-31 is 2020-12-25; minus 15 years = 2005-12-25 (a Sunday) -> next Friday 2005-12-30
    assert only_end.series.dates[0] == date(2005, 12, 30)


def test_window_with_fewer_than_two_weeks_is_rejected():
    r = weekly({"A": [0.0, 0.01, 0.02]})
    with pytest.raises(InvalidSettings):
        bt(r, {"A": 1.0}, start=date(2024, 1, 19))
