import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.engine import menu, metrics
from app.engine.errors import InvalidSettings
from scripts.cafe_preview import CafeDemoData, create_app


@pytest.fixture(scope="module")
def demo():
    return CafeDemoData()


def test_profiles_cover_every_score_once_with_rising_targets():
    for score in range(0, 101):
        hits = [p for p in menu.PROFILES if p.score_min <= score <= p.score_max]
        assert len(hits) == 1, score
        assert menu.profile_for_score(score) is hits[0]
    assert menu.profile_for_score(14.5).id == 1  # between bands rounds down
    vols = [p.target_volatility for p in menu.PROFILES]
    assert vols == sorted(vols) and len(set(vols)) == 7
    with pytest.raises(InvalidSettings):
        menu.profile_for_score(101)


def test_risk_level_maps_back_to_the_target_volatility():
    for p in menu.PROFILES:
        level = menu.risk_level(p)
        assert 0 <= level <= 100
        assert abs(0.02 + level / 100 * 0.18 - p.target_volatility) < 1e-9


def test_cafe_preferences_are_etf_only_ucits_and_esg_for_matcha():
    coffee = menu.investor_profile("coffee", menu.PROFILES[3])
    matcha = menu.investor_profile("matcha", menu.PROFILES[3])
    assert not coffee.preferences.esg_only and matcha.preferences.esg_only
    for p in (coffee, matcha):
        assert p.preferences.etfs_only and p.preferences.ucits_only and p.preferences.crypto_max == 0
        assert p.preferences.min_fund_size_eur == 100_000_000


def test_order_keeps_the_menu_weights_for_any_horizon_and_amount(demo):
    short = menu.order(menu.OrderRequest(base="coffee", profile_id=4, horizon_years=3), demo)
    long = menu.order(menu.OrderRequest(base="coffee", profile_id=4, horizon_years=25, initial_amount=5000,
                                        monthly_amount=100), demo)
    assert {h.isin: h.weight for h in short.holdings} == {h.isin: h.weight for h in long.holdings}
    assert short.downside.fan[-1].year == 3 and long.downside.fan[-1].year == 25
    assert long.downside.fan_money


def test_menu_item_has_past_results_var_and_growth(demo):
    item = menu.build_item("coffee", menu.PROFILES[4], demo)
    assert [p.years for p in item.performance] == [3, 5]
    for p in item.performance:
        assert p.max_drawdown <= 0 and p.worst_month <= p.annual_return
    assert {(v.level, v.method) for v in item.var_monthly} == {
        (0.95, "historical"), (0.95, "normal"), (0.99, "historical"), (0.99, "normal")}
    by = {(v.level, v.method): v.loss for v in item.var_monthly}
    assert by[(0.99, "historical")] <= by[(0.95, "historical")] < 0
    assert item.growth[0].value == pytest.approx(1.0, abs=0.05) and len(item.growth) >= 55
    assert item.outcome["p5"] <= item.outcome["p50"] <= item.outcome["p95"]


def test_stronger_coffee_profiles_swing_more(demo):
    vols = [menu.build_item("coffee", p, demo).summary.volatility for p in menu.PROFILES[::3]]
    assert vols == sorted(vols)


def test_menu_api_serves_all_fourteen_items_and_orders():
    client = TestClient(create_app())
    response = client.get("/api/menu")
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["profiles"]) == 7 and len(body["items"]) == 14
    assert {(i["base"], i["profile_id"]) for i in body["items"]} == {(b, p) for b in ("coffee", "matcha")
                                                                       for p in range(1, 8)}
    funds = CafeDemoData().funds()
    for item in body["items"]:
        if item["base"] == "matcha":
            assert all(bool(funds.loc[h["isin"], "esg"]) or funds.loc[h["isin"], "asset_class"] == "cash"
                       for h in item["holdings"])
        # no item is riskier than its label: cash (not capped) brings even an all-equity ESG mix down to target
        target = body["profiles"][item["profile_id"] - 1]["target_volatility"]
        assert item["summary"]["volatility"] <= target + 1e-3, (item["base"], item["profile_id"])
    order = client.post("/api/menu/order", json={"base": "matcha", "profile_id": 2, "horizon_years": 7})
    assert order.status_code == 200, order.text
    assert order.json()["downside"]["fan"][-1]["year"] == 7
    assert client.post("/api/menu/order", json={"base": "tea", "profile_id": 2}).status_code == 422
    # the method page: correlations of the held funds, and the frontier the recipe sits on
    corr = next(s for s in order.json()["trace"] if s["step"] == "covariance")["summary"]["correlation"]
    assert set(corr["isins"]) == {h["isin"] for h in order.json()["holdings"]}
    assert all(abs(corr["matrix"][i][i] - 1) < 1e-6 for i in range(len(corr["isins"])))
    trace = {s["step"]: s["summary"] for s in order.json()["trace"]}
    moved = trace["covariance"]["window_returns"]
    assert set(moved) == set(corr["isins"]) and all(v["worst_week"] <= v["best_week"] for v in moved.values())
    free = trace["optimize"]["without_count_rules"]
    assert free["n_funds"] >= len(corr["isins"]) and free["net_return"] >= free["recipe_net_return"] - 1e-6
    front = client.post("/api/menu/frontier", json={"base": "matcha", "profile_id": 2})
    assert front.status_code == 200, front.text
    # one frontier per base, shared by its seven strengths: fund points only, and the recipe lies on or under it
    assert {m["kind"] for m in front.json()["markers"]} == {"fund"}
    assert {h["isin"] for h in order.json()["holdings"]} <= {m["key"].removeprefix("fund:") for m in front.json()["markers"]}
    curve = front.json()["model_curve"]
    assert len(curve) > 3
    s = order.json()["summary"]
    at_target = max(p["expected_return"] for p in curve if p["volatility"] <= s["volatility"] + 1e-3)
    assert s["expected_return"] <= max(p["expected_return"] for p in curve) + 1e-6 and at_target <= s["expected_return"] + 5e-3
    assert client.post("/api/menu/frontier", json={"base": "matcha", "profile_id": 6}).json() == front.json()


def test_var_methods_on_a_known_series():
    idx = pd.date_range("2020-01-01", periods=400, freq="W-FRI")
    r = pd.Series(np.random.default_rng(1).normal(0.001, 0.02, len(idx)), index=idx)
    m = metrics.monthly(r)
    assert len(m) == len(r.groupby(r.index.to_period("M"))) - 2
    hist = metrics.var_historical(m, 0.95)
    assert (m < hist).mean() == pytest.approx(0.05, abs=0.02)
    assert metrics.var_normal(m, 0.99) < metrics.var_normal(m, 0.95) < 0
