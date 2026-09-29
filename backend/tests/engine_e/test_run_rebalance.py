from datetime import date

import pytest

from tests.engine_e.helpers import bt, weekly

MONTHLY = {"type": "periodic", "frequency": "monthly"}


def test_periodic_monthly_rebalances_on_month_end_weeks():
    # Weeks: Jan 12 (t0), Jan 19, Jan 26 (last week of January -> rebalance), Feb 2, Feb 9, Feb 16 (final)
    r = weekly({"A": [9.99, 0.10, 0.10, 0.0, 0.10, 0.0], "B": [9.99, 0.0, 0.0, 0.0, 0.0, 0.0]}, start="2024-01-12")
    res = bt(r, {"A": 0.5, "B": 0.5}, rebalance=MONTHLY, transaction_cost_bps=0)
    assert res.rebalance_dates == [date(2024, 1, 26)]
    # up to Jan 26: 0.5*1.1*1.1 + 0.5 = 1.105; reset to 50/50, then A +10%: *(0.5*1.1 + 0.5)
    assert res.series.portfolio[-1] == pytest.approx(1.105 * 1.05)
    assert res.series.portfolio[-1] != pytest.approx(0.5 * 1.1**3 + 0.5)  # buy and hold differs
    assert res.series.benchmark == res.series.portfolio  # same weights, same rule


def test_threshold_rebalances_exactly_when_drift_first_exceeds():
    # A +10% per week for 3 weeks, B flat. Drift of A from 0.5: 0.0238, 0.0475, 0.0710 -> first > 0.05 at week 3.
    r = weekly({"A": [9.99, 0.10, 0.10, 0.10, 0.0, 0.0, 0.0], "B": [9.99, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]})
    res = bt(r, {"A": 0.5, "B": 0.5}, rebalance={"type": "threshold", "threshold": 0.05}, transaction_cost_bps=0)
    assert res.rebalance_dates == [date(2024, 1, 26)]  # row 3


def test_trade_cost_is_bps_times_turnover_and_appears_next_week():
    r = weekly({"A": [9.99, 0.10, 0.0, 0.0], "B": [9.99, 0.0, 0.0, 0.0]})
    res = bt(r, {"A": 0.5, "B": 0.5}, rebalance={"type": "threshold", "threshold": 0.01}, transaction_cost_bps=100)
    drift_a = 0.55 / 1.05  # A's weight after week 1
    trade = 2 * (drift_a - 0.5)  # sum |w_new - w_drift| over both funds
    assert res.rebalance_dates == [date(2024, 1, 12)]
    assert res.series.portfolio[1] == pytest.approx(0.99 * 1.05)  # initial cost only; trade cost not yet visible
    assert res.series.portfolio[2] == pytest.approx(0.99 * 1.05 * (1 - 0.01 * trade))
    assert res.series.portfolio[-1] == pytest.approx(0.99 * 1.05 * (1 - 0.01 * trade))
    assert res.metrics["portfolio"]["turnover"] == pytest.approx((trade / 2) / (3 / 52))


def test_zero_bps_rebalancing_has_no_cost():
    r = weekly({"A": [9.99, 0.10, 0.0, 0.0], "B": [9.99, 0.0, 0.0, 0.0]})
    res = bt(r, {"A": 0.5, "B": 0.5}, rebalance={"type": "threshold", "threshold": 0.01}, transaction_cost_bps=0)
    assert res.series.portfolio == pytest.approx([1.0, 1.05, 1.05, 1.05])
