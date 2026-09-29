import time
from datetime import date

import pandas as pd

from app.engine.backtest import run
from app.engine.types import BacktestSettings
from tests.engine_e.helpers import bt, weekly

TS = pd.Timestamp


def test_proxied_periods_are_clipped_and_limited_to_held_funds():
    # Weeks: Jan 5, 12, 19, 26, Feb 2, 9, 16, 23; the window starts Jan 19
    zeros = [0.0] * 8
    r = weekly({"A": zeros, "B": zeros, "E": zeros, "C": zeros})
    proxied = {
        "A": (TS("2023-06-02"), TS("2024-01-26")),  # starts before the window -> clipped to Jan 19
        "B": (TS("2024-02-09"), TS("2024-06-28")),  # ends after the window -> clipped to Feb 23
        "E": (TS("2023-01-06"), TS("2024-01-12")),  # entirely before the window -> dropped
        "C": (TS("2024-01-05"), TS("2024-02-23")),  # not held -> dropped
    }
    res = bt(r, {"A": 0.4, "B": 0.4, "E": 0.2}, bench={"C": 1.0}, proxied=proxied, start=date(2024, 1, 19))
    assert [(p.isin, p.start, p.end) for p in res.proxied_periods] == [
        ("A", date(2024, 1, 19), date(2024, 1, 26)),
        ("B", date(2024, 2, 9), date(2024, 2, 23)),
    ]


def test_proxied_periods_include_funds_bought_later_in_walk_forward():
    r = weekly({"A": [0.0, 0.1, 0.0, 0.0], "B": [0.0, 0.0, 0.0, 0.0]}, start="2024-01-19")
    t0 = r.index[0]
    fn = lambda t: pd.Series({"A": 1.0}) if t == t0 else pd.Series({"B": 1.0})  # noqa: E731
    s = BacktestSettings(mode="walk_forward", rebalance={"type": "periodic", "frequency": "monthly"})
    res = run(r, fn, s, pd.Series({"A": 1.0}), pd.Series(0.0, index=r.index), {"B": (TS("2020-01-03"), TS("2030-01-04"))})
    assert [(p.isin, p.start, p.end) for p in res.proxied_periods] == [("B", date(2024, 1, 19), date(2024, 2, 9))]


def test_realistic_15y_run_is_fast(synthetic, weekly_eur):
    w = pd.Series({"IE00B6R52259": 0.6, "IE00BDBRDM35": 0.4})
    rf = (synthetic.weekly_rf("EUR") / 52).reindex(weekly_eur.index)
    settings = BacktestSettings(rebalance={"type": "periodic", "frequency": "quarterly"})
    start = time.perf_counter()
    res = run(weekly_eur, lambda t: w, settings, w, rf, {})
    elapsed = time.perf_counter() - start
    assert elapsed < 1.0, f"backtest took {elapsed:.2f}s"
    assert len(res.series.dates) > 770  # ~15 years of weeks
    assert len(res.rebalance_dates) > 55  # ~60 quarter ends minus the final week
    assert res.series.portfolio[-1] > 0
