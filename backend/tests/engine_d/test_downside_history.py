from datetime import date

import numpy as np
import pandas as pd
import pytest

from app import config
from app.engine.downside import portfolio_history, stress

IDX = pd.date_range("2020-01-03", periods=5, freq="W-FRI")
RET = pd.DataFrame(
    {
        "A": [0.01, 0.02, -0.01, 0.03, 0.0],
        "B": [np.nan, 0.05, 0.01, -0.02, 0.01],
        "C": [np.nan] * 5,  # not held (weight 0) -> must not remove weeks
    },
    index=IDX,
)
W = pd.Series({"A": 0.6, "B": 0.4, "C": 0.0})


def test_portfolio_history_drops_weeks_with_missing_held_fund():
    port, mask = portfolio_history(RET, W, {})
    assert port.index.equals(IDX[1:])
    assert port.tolist() == pytest.approx([0.032, -0.002, 0.010, 0.004])
    assert mask.index.equals(port.index)
    assert not mask.any()


def test_portfolio_history_marks_proxied_weeks():
    proxied = {"B": (IDX[1], IDX[2]), "C": (IDX[0], IDX[4])}  # C is not held -> ignored
    _, mask = portfolio_history(RET, W, proxied)
    assert mask.dtype == bool
    assert mask.tolist() == [True, True, False, False]


# ---- stress ----

EQ, BD = "IE00B6R52259", "IE00BDBRDM35"


@pytest.fixture(scope="module")
def port_6040(weekly_eur):
    port, mask = portfolio_history(weekly_eur, pd.Series({EQ: 0.6, BD: 0.4}), {})
    return port, mask


def test_stress_default_events_on_synthetic_6040(port_6040):
    port, mask = port_6040
    out = stress(port, mask)
    assert [s.event for s in out] == [e[0] for e in config.STRESS_EVENTS]
    gfc, covid, rates = out
    assert gfc.start == date(2007, 10, 9) and gfc.end == date(2009, 3, 9)
    expected_gfc = float((1 + port.loc["2007-10-09":"2009-03-09"]).prod() - 1)
    assert gfc.loss == pytest.approx(expected_gfc)
    # synthetic equity factor loses 1.2%/day from 2020-02-20; 60% equity -> about -13%
    assert covid.loss < -0.03
    assert rates.loss is not None
    assert not any(s.proxied for s in out)


def test_stress_crash_window_is_clearly_negative(weekly_usd):
    # the fixture's GFC shock (-0.3%/day on the equity factor) runs 2008-09-15..2009-03-09
    port, mask = portfolio_history(weekly_usd, pd.Series({"US4642882579": 1.0}), {})
    (crash,) = stress(port, mask, [("crash", "2008-09-13", "2009-03-09")])
    assert crash.loss < -0.15


def test_stress_none_when_history_starts_after_event_start(port_6040):
    port, mask = port_6040
    late = port.loc["2010-01-01":]
    gfc, covid, rates = stress(late, mask.loc[late.index])
    assert gfc.loss is None and gfc.proxied is False
    assert covid.loss is not None and rates.loss is not None


def test_stress_proxied_flag(port_6040):
    port, _ = port_6040
    mask = pd.Series(False, index=port.index)
    mask.loc["2020-01-01":"2020-12-31"] = True
    gfc, covid, rates = stress(port, mask)
    assert covid.proxied is True
    assert gfc.proxied is False and rates.proxied is False


def test_stress_none_when_history_ends_before_window(port_6040):
    port, mask = port_6040
    early = port.loc[:"2015-12-31"]
    _, covid, _ = stress(early, mask.loc[early.index])
    assert covid.loss is None
