import pandas as pd
import pytest
from pydantic import ValidationError

from app.api.schemas import BacktestRequest, fund_summary
from app.engine.trace import Trace
from app.engine.types import BacktestSettings, EngineSettings, InvestorProfile, Preferences


def test_profile_defaults():
    p = InvestorProfile(risk_level=55.5, horizon_years=10, base_currency="EUR")
    assert p.preferences.max_etfs == 10
    assert p.preferences.crypto_max == 0.0
    assert EngineSettings().expected_return_model == "capm_multi_asset"
    assert EngineSettings().vol_range == (0.02, 0.20)


def test_risk_level_bounds():
    with pytest.raises(ValidationError):
        InvestorProfile(risk_level=101, horizon_years=10, base_currency="EUR")


def test_crypto_hard_cap():
    with pytest.raises(ValidationError):
        Preferences(crypto_max=0.2)


def test_walk_forward_requires_rebalancing():
    with pytest.raises(ValidationError):
        BacktestSettings(mode="walk_forward")
    BacktestSettings(mode="walk_forward", rebalance={"type": "periodic", "frequency": "quarterly"})


def test_backtest_request_needs_profile():
    with pytest.raises(ValidationError):
        BacktestRequest.model_validate({"backtest": {}})


def test_trace_collects_steps():
    t = Trace()
    t.add("universe", {"n_funds": 12}, ["dropped 3 non-UCITS funds"])
    assert t.steps[0].step == "universe"
    assert t.steps[0].summary == {"n_funds": 12}


def test_fund_summary_cleans_pandas_values():
    row = pd.Series({
        "name": "X", "issuer": "I", "asset_class": "equity", "sub_class": "broad", "region": "global",
        "sector": float("nan"), "esg": pd.NA, "ter": 0.002, "domicile": "IE", "ucits": True,
        "wrapper": "etf", "distribution": "acc", "hedged_to": None, "duration": float("nan"),
        "index_name": "MSCI ACWI", "inception_date": pd.Timestamp("2011-10-21"),
        "proxy_ticker": "SYN-EQ", "proxy_currency": "USD",
    })
    s = fund_summary("IE00B6R52259", row, ["IUSQ.DE"])
    assert s.sector is None and s.duration is None and s.esg is False
    assert str(s.inception_date) == "2011-10-21"
    assert s.has_proxy is True


@pytest.mark.parametrize("kwargs", [
    {"vol_range": (0.2, 0.1)},
    {"vol_range": (0.1, 0.1)},
    {"vol_range": (-0.1, 0.2)},
    {"vol_range": (0.1, 1.5)},
    {"drawdown_thresholds": []},
    {"drawdown_thresholds": [0.0, 0.2]},
    {"drawdown_thresholds": [0.2, 1.0]},
    {"market_premium": 0.5},
    {"market_premium": -0.2},
])
def test_engine_settings_rejects_invalid(kwargs):
    with pytest.raises(ValidationError):
        EngineSettings(**kwargs)


def test_engine_settings_accepts_valid():
    EngineSettings(vol_range=(0.0, 1.0), drawdown_thresholds=[0.1, 0.5], market_premium=0.05)


@pytest.mark.parametrize("tilt", [-0.1, 1.1])
def test_sector_tilts_bounds(tilt):
    with pytest.raises(ValidationError):
        Preferences(sector_tilts={"tech": tilt})
    Preferences(sector_tilts={"tech": 0.2})


@pytest.mark.parametrize("weights", [{}, {"A": 1.5, "B": -0.5}])
def test_backtest_request_weights_validation(weights):
    with pytest.raises(ValidationError):
        BacktestRequest(profile={"risk_level": 50, "horizon_years": 10, "base_currency": "EUR"}, weights=weights)
