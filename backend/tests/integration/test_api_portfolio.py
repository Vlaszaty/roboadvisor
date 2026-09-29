import time

import pytest

from app.engine.pipeline import CAPM_EQUITY_BOND_NOTE, RECOMMEND_STEPS
from tests.integration.helpers import FAST, has_vol_warning, profile, recommend


@pytest.mark.parametrize("base", ["EUR", "USD"])
@pytest.mark.parametrize("risk", [20, 50, 80])
def test_portfolio_is_valid(client, synthetic, base, risk):
    rec = recommend(client, risk, base)
    weights = [h["weight"] for h in rec["holdings"]]
    assert abs(sum(weights) - 1) < 1e-5
    assert all(w > 0 for w in weights) and len(weights) <= 10
    target = 0.02 + risk / 100 * 0.18
    assert rec["summary"]["target_volatility"] == pytest.approx(target)
    assert rec["summary"]["volatility"] <= target + 1e-3 or has_vol_warning(rec["warnings"]), rec["warnings"]
    assert [s["step"] for s in rec["trace"]] == list(RECOMMEND_STEPS)
    funds = synthetic.funds()
    if base == "EUR":  # UCITS-only by default: no non-UCITS ETF may be held
        for h in rec["holdings"]:
            f = funds.loc[h["isin"]]
            assert f["ucits"] or f["wrapper"] != "etf", h["isin"]


@pytest.mark.parametrize("base", ["EUR", "USD"])
def test_equity_share_rises_with_risk(client, base):
    shares = [recommend(client, r, base)["summary"]["mix"].get("equity", 0.0) for r in (20, 50, 80)]
    assert shares[0] <= shares[1] <= shares[2] and shares[0] < shares[2], shares


def test_no_crypto_below_min_risk_level(client):
    rec = recommend(client, 30, "EUR", crypto_max=0.05)
    assert all(h["asset_class"] != "crypto" for h in rec["holdings"])
    assert rec["trace"][0]["summary"]["removed"]["crypto"] >= 1


def test_crypto_is_capped_when_allowed(client):
    rec = recommend(client, 80, "EUR", crypto_max=0.05)
    assert sum(h["weight"] for h in rec["holdings"] if h["asset_class"] == "crypto") <= 0.05 + 1e-6


def test_esg_only_with_default_limits_is_a_clear_422(client):
    # The synthetic market has a single ESG fund; max_position 40% cannot reach 100%.
    r = client.post("/api/portfolio", json={"profile": profile(50, "EUR", esg_only=True), "settings": FAST})
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "InfeasibleConstraints"
    assert "too few funds" in body["detail"] and "max_position" in body["detail"]


def test_esg_only_with_relaxed_limits_holds_only_esg_funds(client, synthetic):
    rec = recommend(client, 80, "EUR", esg_only=True, max_position=1.0, max_etfs=1)
    esg = synthetic.funds()["esg"]
    assert rec["holdings"] and all(bool(esg[h["isin"]]) for h in rec["holdings"])
    assert abs(sum(h["weight"] for h in rec["holdings"]) - 1) < 1e-5
    # one equity fund cannot hit the 16.4% target exactly: either it does or the warning says why
    assert rec["summary"]["volatility"] <= rec["summary"]["target_volatility"] + 1e-3 or has_vol_warning(rec["warnings"])


def test_expected_return_models_differ(client):
    eq = recommend(client, 50, "EUR", settings={**FAST, "expected_return_model": "capm_equity"})
    ma = recommend(client, 50, "EUR", settings={**FAST, "expected_return_model": "capm_multi_asset"})
    s_eq, s_ma = eq["trace"][3]["summary"], ma["trace"][3]["summary"]
    assert (s_eq["model"], s_eq["premium"]) == ("capm_equity", 0.05)
    assert (s_ma["model"], s_ma["premium"]) == ("capm_multi_asset", 0.035)
    assert s_eq["expected"] != s_ma["expected"]
    holds_bonds = any(h["asset_class"] == "bond" for h in eq["holdings"])
    assert (CAPM_EQUITY_BOND_NOTE in eq["warnings"]) == holds_bonds


def test_market_premium_override(client):
    rec = recommend(client, 50, "EUR", settings={**FAST, "market_premium": 0.06})
    assert rec["trace"][3]["summary"]["premium"] == 0.06
    assert rec["trace"][3]["summary"]["premium_source"] == "settings"


def test_portfolio_is_fast_enough(client):
    client.post("/api/portfolio", json={"profile": profile(40), "settings": {"mc_paths": 500}})  # warm-up: imports
    t = time.perf_counter()
    r = client.post("/api/portfolio", json={"profile": profile(60)})  # default settings: 10,000 paths
    elapsed = time.perf_counter() - t
    assert r.status_code == 200, r.text
    assert elapsed < 3.0, f"/api/portfolio took {elapsed:.2f}s"
