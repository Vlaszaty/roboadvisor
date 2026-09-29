import pandas as pd

from app.engine.backtest import rebalance_dates
from app.engine.types import RebalanceSettings

TS = pd.Timestamp


def periodic(frequency: str) -> RebalanceSettings:
    return RebalanceSettings(type="periodic", frequency=frequency)


def test_monthly_is_last_week_of_each_month_excluding_final_week():
    # Fridays 2024-01-05 .. 2024-05-17 (Jan 4, Feb 4, Mar 5, Apr 4, May 3 weeks)
    idx = pd.date_range("2024-01-05", periods=20, freq="W-FRI")
    assert rebalance_dates(idx, periodic("monthly")) == [
        TS("2024-01-26"), TS("2024-02-23"), TS("2024-03-29"), TS("2024-04-26"),
    ]  # 2024-05-17 is the last week of its (partial) month but is the final week -> excluded


def test_quarterly():
    idx = pd.date_range("2024-01-05", periods=20, freq="W-FRI")
    assert rebalance_dates(idx, periodic("quarterly")) == [TS("2024-03-29")]


def test_annual_excludes_final_week_even_when_it_is_a_year_end():
    idx = pd.date_range("2021-01-01", "2023-12-29", freq="W-FRI")
    assert rebalance_dates(idx, periodic("annual")) == [TS("2021-12-31"), TS("2022-12-30")]


def test_none_and_threshold_give_no_dates():
    idx = pd.date_range("2024-01-05", periods=20, freq="W-FRI")
    assert rebalance_dates(idx, RebalanceSettings(type="none")) == []
    assert rebalance_dates(idx, RebalanceSettings(type="threshold", threshold=0.05)) == []
