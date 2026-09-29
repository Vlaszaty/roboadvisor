import numpy as np
import pandas as pd
import pytest

from app.engine.returns import convert_prices, weekly_returns
from app.engine.types import InvestorProfile, Preferences
from app.engine.universe import select

FRIDAY = pd.offsets.Week(weekday=4)


def test_convert_prices_matches_fx_and_round_trips(synthetic):
    px = synthetic.prices(["IUSQ.DE", "SSAC.L"])
    fx = synthetic.fx()
    ccy = {"IUSQ.DE": "EUR", "SSAC.L": "USD"}
    eur = convert_prices(px, ccy, fx, "EUR")
    usd = convert_prices(px, ccy, fx, "USD")
    assert list(eur.columns) == ["IUSQ.DE", "SSAC.L"]
    pd.testing.assert_series_equal(eur["IUSQ.DE"], px["IUSQ.DE"])  # already EUR
    pd.testing.assert_series_equal(eur["SSAC.L"], px["SSAC.L"] / fx["EUR"], check_names=False)
    pd.testing.assert_series_equal(usd["IUSQ.DE"], px["IUSQ.DE"] * fx["EUR"], check_names=False)
    pd.testing.assert_series_equal(usd["SSAC.L"], px["SSAC.L"])  # already USD
    # round trip: EUR values times the EUR rate are the USD values
    pd.testing.assert_frame_equal(eur.mul(fx["EUR"], axis=0), usd)


def test_convert_prices_forward_fills_fx_and_keeps_nan():
    idx = pd.to_datetime(["2020-01-01", "2020-01-02", "2020-01-03"])
    prices = pd.DataFrame({"A": [10.0, 11.0, 12.0], "B": [np.nan, 5.0, 5.0]}, index=idx)
    fx = pd.DataFrame(
        {"USD": [1.0, 1.0], "EUR": [1.1, 1.3]}, index=pd.to_datetime(["2020-01-01", "2020-01-03"])
    )
    out = convert_prices(prices, {"A": "EUR", "B": "USD"}, fx, "USD")
    np.testing.assert_allclose(out["A"], [11.0, 12.1, 15.6])  # 01-02 uses the 01-01 rate
    assert np.isnan(out["B"].iloc[0])
    np.testing.assert_allclose(out["B"].iloc[1:], [5.0, 5.0])


def _selection(synthetic, base):
    profile = InvestorProfile(
        risk_level=60, horizon_years=10, base_currency=base, preferences=Preferences(crypto_max=0.05)
    )
    return select(synthetic.funds(), synthetic.listings(), profile)


def _prices(synthetic, sel):
    cols = list(sel["ticker"]) + sorted(sel["proxy_ticker"].dropna().unique())
    return synthetic.prices(cols)


def _run(synthetic, base):
    sel = _selection(synthetic, base)
    prices = _prices(synthetic, sel)
    return sel, prices, weekly_returns(prices, sel, synthetic.fx(), base)


def _weekly_ret(s: pd.Series) -> pd.Series:
    return s.resample("W-FRI").last().pct_change(fill_method=None)


@pytest.mark.parametrize("base", ["EUR", "USD"])
def test_matches_fixture_reference_after_first_own_week(synthetic, base):
    # Engine and reference both compute price_econ * fx[econ] / fx[base]; only float rounding differs (~1e-16),
    # so 1e-9 is a tight bound. Weeks up to the first own-price week are proxied (proxy has no idiosyncratic
    # noise) and legitimately differ from the reference, so they are excluded here.
    sel, prices, res = _run(synthetic, base)
    ref = synthetic.weekly_returns(base)
    assert list(res.returns.columns) == list(sel.index)
    assert res.returns.index.equals(ref.index)
    for isin, row in sel.iterrows():
        first_own = FRIDAY.rollforward(prices[row["ticker"]].first_valid_index())
        after = res.returns.index > first_own
        pd.testing.assert_series_equal(
            res.returns.loc[after, isin], ref.loc[res.returns.index[after], isin],
            rtol=1e-9, atol=1e-12, check_freq=False,
        )


def test_index_is_w_fri_and_first_week_dropped(synthetic):
    _, _, res = _run(synthetic, "EUR")
    idx = res.returns.index
    assert idx.freqstr == "W-FRI" and (idx.dayofweek == 4).all()
    assert idx[0] == pd.Timestamp("2005-01-14")  # 2005-01-07 has no prior price
    assert np.isfinite(res.returns["IE00B6R52259"]).all()  # proxy covers the early years


def test_extra_price_columns_are_ignored(synthetic):
    sel = _selection(synthetic, "EUR")
    prices = _prices(synthetic, sel).join(synthetic.prices(["SUSE"]))
    res = weekly_returns(prices, sel, synthetic.fx(), "EUR")
    assert list(res.returns.columns) == list(sel.index)


def test_young_fund_is_nan_before_inception(synthetic):
    _, _, res = _run(synthetic, "EUR")
    young = res.returns["SYNYOUNG0001"]
    assert young.loc[:"2023-06-02"].isna().all()  # first own price 2023-06-01 -> first return 2023-06-09
    assert np.isfinite(young.loc["2023-06-09":]).all()
    assert "SYNYOUNG0001" not in res.proxied  # no proxy_ticker


def test_proxied_ranges_eur(synthetic):
    _, _, res = _run(synthetic, "EUR")
    ts = pd.Timestamp
    assert res.proxied["IE00B6R52259"] == (ts("2005-01-14"), ts("2011-10-21"))
    assert res.proxied["IE00BDBRDM35"] == (ts("2005-01-14"), ts("2017-11-24"))
    assert res.proxied["SYNESGEQ0001"] == (ts("2005-01-14"), ts("2015-06-05"))
    assert res.proxied["SYNUSTLEH001"] == (ts("2005-01-14"), ts("2016-03-04"))
    assert res.proxied["SYNBTC000001"] == (ts("2014-09-26"), ts("2020-01-03"))  # proxy itself starts 2014-09-17
    assert set(res.proxied) == {"IE00B6R52259", "IE00BDBRDM35", "SYNESGEQ0001", "SYNUSTLEH001", "SYNBTC000001"}
    assert res.returns["SYNBTC000001"].loc[:"2014-09-19"].isna().all()


def test_proxy_returns_are_converted_to_base(synthetic):
    _, _, res = _run(synthetic, "EUR")
    eq = synthetic.prices(["SYN-EQ"])["SYN-EQ"]
    expected = _weekly_ret(eq / synthetic.fx()["EUR"])  # USD proxy -> EUR
    span = slice("2005-01-14", "2011-10-21")
    pd.testing.assert_series_equal(
        res.returns["IE00B6R52259"].loc[span], expected.loc[span],
        check_names=False, check_freq=False, rtol=1e-9, atol=1e-12,
    )


def test_hedged_fund_proxy_uses_unconverted_returns(synthetic):
    _, _, res = _run(synthetic, "EUR")  # IE00BDBRDM35 is hedged_to EUR
    bd = synthetic.prices(["SYN-BD"])["SYN-BD"]
    unconverted = _weekly_ret(bd)
    converted = _weekly_ret(bd / synthetic.fx()["EUR"])
    span = slice("2005-01-14", "2017-11-24")
    got = res.returns["IE00BDBRDM35"].loc[span]
    pd.testing.assert_series_equal(
        got, unconverted.loc[span], check_names=False, check_freq=False, rtol=1e-9, atol=1e-12
    )
    assert (got - converted.loc[span]).abs().max() > 0.005  # FX moves would have shown up


def test_usd_base_proxy_ranges_match_and_hedge_rule_is_base_specific(synthetic):
    _, _, res = _run(synthetic, "USD")
    ts = pd.Timestamp
    assert res.proxied["IE00B6R52259"] == (ts("2005-01-14"), ts("2011-10-21"))
    assert res.proxied["SYNIBIT00001"] == (ts("2014-09-26"), ts("2024-01-12"))
    # hedged_to == 'EUR' is not the USD base, so the proxy is converted (fx[USD] == 1 makes it identical here)
    bd = synthetic.prices(["SYN-BD"])["SYN-BD"]
    span = slice("2005-01-14", "2017-11-24")
    pd.testing.assert_series_equal(
        res.returns["IE00BDBRDM35"].loc[span], _weekly_ret(bd).loc[span],
        check_names=False, check_freq=False, rtol=1e-9, atol=1e-12,
    )
