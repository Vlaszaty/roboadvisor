import numpy as np
import pandas as pd
import pytest

from app import config
from app.engine.expected import capm, market_returns

ANCHORS = config.ANCHORS["EUR"]
EQUITY_ANCHOR = ANCHORS["global_equity"]
BOND_ANCHOR = ANCHORS["global_bonds"]
LOW_EQUITY_BONDS = ["IE00BDBRDM35", "SYNGOVS00001", "SYNGOVL00001", "SYNUSTLEH001", "SYNCORP00001"]


def run_capm(synthetic, weekly, model, end=None):
    market = market_returns(weekly, ANCHORS, config.MARKETS[model]["weights"])
    premium = config.MARKETS[model]["premium"]
    return capm(weekly, market, synthetic.rf("EUR"), premium, model, window_years=5, end=end)


# ---------- market_returns


def test_market_returns_is_the_weighted_sum():
    returns = pd.DataFrame({"EQ": [0.10, -0.02], "BD": [0.01, 0.03]})
    market = market_returns(returns, {"global_equity": "EQ", "global_bonds": "BD"}, {"global_equity": 0.6, "global_bonds": 0.4})
    assert market.tolist() == pytest.approx([0.6 * 0.10 + 0.4 * 0.01, 0.6 * -0.02 + 0.4 * 0.03])


def test_market_returns_is_nan_when_any_anchor_is_missing():
    returns = pd.DataFrame({"EQ": [0.10, 0.02], "BD": [np.nan, 0.03]})
    market = market_returns(returns, {"global_equity": "EQ", "global_bonds": "BD"}, {"global_equity": 0.6, "global_bonds": 0.4})
    assert np.isnan(market.iloc[0])
    assert market.iloc[1] == pytest.approx(0.6 * 0.02 + 0.4 * 0.03)


def test_market_returns_ignores_unused_anchors():
    returns = pd.DataFrame({"EQ": [0.10], "BD": [np.nan]})
    market = market_returns(returns, {"global_equity": "EQ", "global_bonds": "BD"}, {"global_equity": 1.0})
    assert market.iloc[0] == pytest.approx(0.10)


# ---------- capm


def test_market_proxy_has_beta_one(synthetic, weekly_eur):
    result = run_capm(synthetic, weekly_eur, "capm_equity")
    assert result.beta[EQUITY_ANCHOR] == pytest.approx(1.0, abs=1e-9)


def test_multi_asset_market_itself_has_beta_one(synthetic, weekly_eur):
    weekly = weekly_eur.copy()
    weekly["MARKET"] = 0.6 * weekly[EQUITY_ANCHOR] + 0.4 * weekly[BOND_ANCHOR]
    result = run_capm(synthetic, weekly, "capm_multi_asset")
    assert result.beta["MARKET"] == pytest.approx(1.0, abs=1e-9)


def test_cash_has_beta_zero(synthetic, weekly_eur):
    for model in config.MARKETS:
        result = run_capm(synthetic, weekly_eur, model)
        assert abs(result.beta["SYNCASH00001"]) < 0.01
        assert result.expected["SYNCASH00001"] == pytest.approx(result.rf, abs=0.001)


def test_equity_market_gives_bonds_about_rf(synthetic, weekly_eur):
    result = run_capm(synthetic, weekly_eur, "capm_equity")
    assert (result.beta[LOW_EQUITY_BONDS].abs() < 0.2).all()
    assert np.allclose(result.expected[LOW_EQUITY_BONDS], result.rf, atol=0.2 * result.premium)


def test_multi_asset_market_gives_bonds_a_real_beta(synthetic, weekly_eur):
    equity_only = run_capm(synthetic, weekly_eur, "capm_equity")
    multi_asset = run_capm(synthetic, weekly_eur, "capm_multi_asset")
    for isin in ["IE00BDBRDM35", "SYNGOVL00001", "SYNCORP00001"]:
        assert multi_asset.beta[isin] > 0.05
        assert multi_asset.beta[isin] > equity_only.beta[isin] + 0.05


def test_expected_is_rf_plus_beta_times_premium(synthetic, weekly_eur):
    result = run_capm(synthetic, weekly_eur, "capm_multi_asset")
    rf_now = synthetic.rf("EUR").iloc[-1]
    assert result.rf == rf_now
    assert result.premium == config.MARKETS["capm_multi_asset"]["premium"]
    assert result.market == "capm_multi_asset"
    pd.testing.assert_series_equal(result.expected, rf_now + result.beta * result.premium, check_names=False)


def test_premium_override_is_used(synthetic, weekly_eur):
    market = market_returns(weekly_eur, ANCHORS, {"global_equity": 1.0})
    result = capm(weekly_eur, market, synthetic.rf("EUR"), 0.07, "capm_equity", window_years=5)
    assert result.expected[EQUITY_ANCHOR] == pytest.approx(result.rf + 0.07)


def test_beta_uses_only_the_window(synthetic, weekly_eur):
    """A fund that copies the market for the last 5 years but is noise before has beta 1."""
    weekly = weekly_eur.copy()
    rng = np.random.default_rng(1)
    weekly["COPY"] = weekly[EQUITY_ANCHOR]
    weekly.iloc[: -5 * 52, weekly.columns.get_loc("COPY")] = rng.normal(0, 0.05, len(weekly) - 5 * 52)
    result = run_capm(synthetic, weekly, "capm_equity")
    assert result.beta["COPY"] == pytest.approx(1.0, abs=1e-9)


def test_end_ignores_everything_after_it(synthetic, weekly_eur):
    end = pd.Timestamp("2019-12-27")
    clean = run_capm(synthetic, weekly_eur, "capm_multi_asset", end=end)

    corrupted_returns = weekly_eur.copy()
    corrupted_returns.loc[corrupted_returns.index > end] = 0.5
    corrupted_rf = synthetic.rf("EUR").copy()
    corrupted_rf[corrupted_rf.index > end] = 0.99
    market = market_returns(corrupted_returns, ANCHORS, config.MARKETS["capm_multi_asset"]["weights"])
    corrupted = capm(corrupted_returns, market, corrupted_rf, 0.035, "capm_multi_asset", window_years=5, end=end)

    pd.testing.assert_series_equal(clean.beta, corrupted.beta)
    pd.testing.assert_series_equal(clean.expected, corrupted.expected)
    assert clean.rf == corrupted.rf == synthetic.rf("EUR")[:end].iloc[-1]


def test_fund_without_data_in_window_gets_nan(synthetic, weekly_eur):
    result = run_capm(synthetic, weekly_eur, "capm_equity", end=pd.Timestamp("2012-12-28"))
    assert np.isnan(result.beta["SYNYOUNG0001"])
    assert np.isnan(result.expected["SYNYOUNG0001"])
