from datetime import date

import pandas as pd
import pytest

from app.engine.backtest import LOOKAHEAD_WARNING, run
from app.engine.errors import InvalidSettings
from app.engine.types import BacktestSettings, RebalanceSettings
from tests.engine_e.helpers import corrupt_after, inverse_vol_fn, weekly, zero_rf

ISINS = ["IE00B6R52259", "IE00BDBRDM35", "SYNGOLD00001"]
BENCH = pd.Series({"IE00B6R52259": 0.6, "IE00BDBRDM35": 0.4})
WF = dict(
    mode="walk_forward", start=date(2015, 1, 1), end=date(2020, 12, 31),
    rebalance={"type": "periodic", "frequency": "quarterly"}, transaction_cost_bps=10,
)


def switch_fn(t0: pd.Timestamp):
    """100% A at t0, 100% B at every later call."""
    return lambda t: pd.Series({"A": 1.0}) if t == t0 else pd.Series({"B": 1.0})


# Weeks: Jan 19 (t0), Jan 26 (month end -> rebalance), Feb 2, Feb 9 (final)
SWITCH_R = weekly({"A": [9.99, 0.10, 0.50, 0.50], "B": [9.99, 0.0, 0.20, 0.0]}, start="2024-01-19")
MONTHLY = {"type": "periodic", "frequency": "monthly"}


def test_static_mode_warns_and_keeps_initial_weights():
    fn = switch_fn(SWITCH_R.index[0])
    s = BacktestSettings(mode="static", rebalance=MONTHLY, transaction_cost_bps=0)
    res = run(SWITCH_R, fn, s, pd.Series({"A": 1.0}), zero_rf(SWITCH_R), {})
    assert res.warnings[0] == LOOKAHEAD_WARNING
    assert res.warnings[0] == "static mode: weights were chosen using data from the whole period (look-ahead bias)"
    assert res.series.portfolio[-1] == pytest.approx(1.1 * 1.5 * 1.5)  # stays in A


def test_walk_forward_retargets_at_rebalance_and_has_no_lookahead_warning():
    fn = switch_fn(SWITCH_R.index[0])
    s = BacktestSettings(mode="walk_forward", rebalance=MONTHLY, transaction_cost_bps=0)
    res = run(SWITCH_R, fn, s, pd.Series({"A": 1.0}), zero_rf(SWITCH_R), {})
    assert LOOKAHEAD_WARNING not in res.warnings
    assert res.rebalance_dates == [date(2024, 1, 26)]
    assert res.series.portfolio == pytest.approx([1.0, 1.1, 1.1 * 1.2, 1.1 * 1.2])  # A for a week, then B
    assert res.weights == {"A": 1.0}  # initial target
    assert res.metrics["portfolio"]["turnover"] == pytest.approx(1.0 / (3 / 52))  # A -> B is 100% one-way


def test_walk_forward_calls_weights_fn_only_at_rebalance_points(weekly_eur):
    calls: list[pd.Timestamp] = []
    res = run(weekly_eur, inverse_vol_fn(weekly_eur, ISINS, calls), BacktestSettings(**WF), BENCH,
              zero_rf(weekly_eur), {})
    t0, t_end = pd.Timestamp(res.series.dates[0]), pd.Timestamp(res.series.dates[-1])
    assert calls == [t0] + [pd.Timestamp(d) for d in res.rebalance_dates]
    assert len(res.rebalance_dates) == 23  # quarter ends 2015Q1..2020Q3; 2020-12-25 is the final week
    assert max(calls) < t_end


def test_weights_fn_pattern_ignores_rows_after_t(weekly_eur):
    """The pattern the pipeline must follow: corrupting every row after t changes nothing at t."""
    calls: list[pd.Timestamp] = []
    run(weekly_eur, inverse_vol_fn(weekly_eur, ISINS, calls), BacktestSettings(**WF), BENCH, zero_rf(weekly_eur), {})
    clean = inverse_vol_fn(weekly_eur, ISINS)
    for t in calls:
        pd.testing.assert_series_equal(clean(t), inverse_vol_fn(corrupt_after(weekly_eur, t), ISINS)(t))

    # Negative control: a weights_fn that reads the whole frame is caught by the same check.
    def cheating(returns):
        return lambda t: (1 / returns[ISINS].tail(52).std()) / (1 / returns[ISINS].tail(52).std()).sum()

    t = calls[1]
    assert not cheating(weekly_eur)(t).equals(cheating(corrupt_after(weekly_eur, t))(t))


def test_full_run_unchanged_when_future_rows_are_garbage(weekly_eur):
    clean = run(weekly_eur, inverse_vol_fn(weekly_eur, ISINS), BacktestSettings(**WF), BENCH, zero_rf(weekly_eur), {})

    def garbage_fn(t):  # at each call, everything after t is garbage
        return inverse_vol_fn(corrupt_after(weekly_eur, t), ISINS)(t)

    dirty = run(weekly_eur, garbage_fn, BacktestSettings(**WF), BENCH, zero_rf(weekly_eur), {})
    assert dirty.series.portfolio == clean.series.portfolio
    assert dirty.rebalance_dates == clean.rebalance_dates
    assert dirty.weights == clean.weights


def test_walk_forward_without_rebalancing_is_rejected():
    s = BacktestSettings.model_construct(mode="walk_forward", rebalance=RebalanceSettings(type="none"))
    with pytest.raises(InvalidSettings):
        run(SWITCH_R, switch_fn(SWITCH_R.index[0]), s, pd.Series({"A": 1.0}), zero_rf(SWITCH_R), {})
