"""Model efficient frontier (spec 2026-09-30 §3.2, §5)."""

import json
import math
import time

import numpy as np
import pytest

from app import config
from app.engine import pipeline
from app.engine.types import EngineSettings, Frontier, InvestorProfile

PROFILE = InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR")
SETTINGS = EngineSettings()
POINTS = 12
SYNTHETIC_REFS = {
    "world": {"label": "World equities (MSCI World)", "isin": "IE00B6R52259"},
    "sp500": {"label": "S&P 500", "isin": "SYNUSEQ00001"},
}
REAL_REFS = {k: dict(v) for k, v in config.REFERENCES.items()}  # captured before any monkeypatch
STRATEGIES = ["min_variance", "max_sharpe", "risk_parity", "hrp"]


@pytest.fixture(autouse=True)
def synthetic_refs(monkeypatch):
    monkeypatch.setattr(config, "REFERENCES", {k: dict(v) for k, v in SYNTHETIC_REFS.items()})


@pytest.fixture(scope="module")
def result(synthetic) -> Frontier:
    with pytest.MonkeyPatch.context() as mp:  # module-scoped: the autouse fixture is function-scoped
        mp.setattr(config, "REFERENCES", {k: dict(v) for k, v in SYNTHETIC_REFS.items()})
        return pipeline.frontier(PROFILE, SETTINGS, POINTS, synthetic)


@pytest.fixture(scope="module")
def prepared(synthetic):
    return pipeline._prepare(PROFILE, SETTINGS, synthetic)


def _marker(result: Frontier, key: str):
    return next(m for m in result.markers if m.key == key)


def _interp(curve, vol: float) -> float:
    return float(np.interp(vol, [p.volatility for p in curve], [p.expected_return for p in curve]))


def test_curve_sorted_by_volatility_and_finite(result):
    curve = result.model_curve
    assert len(curve) >= 5
    vols = [p.volatility for p in curve]
    assert vols == sorted(vols)
    for p in curve:
        assert math.isfinite(p.volatility) and math.isfinite(p.expected_return)
        assert p.sharpe is None or math.isfinite(p.sharpe)


def test_model_curve_return_non_decreasing_in_volatility(result):
    rets = [p.expected_return for p in result.model_curve]
    assert all(b >= a - 1e-4 for a, b in zip(rets, rets[1:]))


def test_portfolio_lies_on_the_model_curve(result):
    p = _marker(result, "portfolio").model
    curve = result.model_curve
    assert curve[0].volatility - 1e-4 <= p.volatility <= curve[-1].volatility + 1e-4
    on_curve = _interp(curve, p.volatility)
    assert on_curve - 5e-3 <= p.expected_return <= on_curve + 1e-3


def test_markers_cover_every_kind(result, prepared):
    keys = [m.key for m in result.markers]
    assert keys.count("portfolio") == 1
    assert {"world", "sp500"} <= set(keys)
    assert set(STRATEGIES) <= set(keys)
    funds = sorted(k.removeprefix("fund:") for k in keys if k.startswith("fund:"))
    assert funds == sorted(prepared.fit.cov.index)
    kinds = {m.key: m.kind for m in result.markers}
    assert kinds["portfolio"] == "portfolio" and kinds["world"] == kinds["sp500"] == "reference"
    assert all(kinds[s] == "strategy" for s in STRATEGIES)
    for m in result.markers:
        assert math.isfinite(m.model.volatility) and math.isfinite(m.model.expected_return)


def test_capital_market_line_starts_at_rf(result):
    cml = result.capital_market_line
    assert len(cml) == 2
    assert cml[0].volatility == 0 and cml[0].expected_return == pytest.approx(result.rf)
    assert cml[1].volatility == pytest.approx(result.model_curve[-1].volatility)
    best = max((p for p in result.model_curve if p.sharpe is not None), key=lambda p: p.sharpe)
    assert (cml[1].expected_return - result.rf) / cml[1].volatility == pytest.approx(best.sharpe, rel=1e-4)


def test_references_ignore_the_candidate_set(synthetic, monkeypatch):
    """A reference that fails the investor's filters still gets a marker, and does not change the curves."""
    esg = InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR",
                          preferences={"esg_only": True, "max_position": 1.0, "max_etfs": 3})
    res = pipeline.frontier(esg, SETTINGS, 5, synthetic)
    assert {"world", "sp500"} <= {m.key for m in res.markers}
    monkeypatch.setattr(config, "REFERENCES", {})
    bare = pipeline.frontier(esg, SETTINGS, 5, synthetic)
    assert bare.model_curve == res.model_curve


def _reject(token: str):
    raise AssertionError(f"non-finite JSON token {token!r} in response")


def test_api_frontier_serialises_without_nan(client):
    body = {"profile": {"risk_level": 50, "horizon_years": 10, "base_currency": "EUR"}, "points": 8}
    r = client.post("/api/frontier", json=body)
    assert r.status_code == 200, r.text
    data = json.loads(r.text, parse_constant=_reject)
    assert data["model_curve"] and data["markers"] and data["trace"][-1]["step"] == "frontier"


def test_api_frontier_validates_points(client):
    body = {"profile": {"risk_level": 50, "horizon_years": 10, "base_currency": "EUR"}, "points": 2}
    assert client.post("/api/frontier", json=body).status_code == 422


@pytest.mark.skipif(not config.DB_PATH.exists(), reason="real database not present")
def test_real_db_frontier_is_fast_when_warm(monkeypatch):
    monkeypatch.setattr(config, "REFERENCES", {k: dict(v) for k, v in REAL_REFS.items()})
    from app.api.deps import get_data

    data = get_data()
    t = time.perf_counter()
    pipeline.frontier(PROFILE, SETTINGS, 20, data)  # cold: loads the data caches
    cold = time.perf_counter() - t
    t = time.perf_counter()
    res = pipeline.frontier(PROFILE, SETTINGS, 20, data)
    elapsed = time.perf_counter() - t
    assert {"world", "sp500"} <= {m.key for m in res.markers}
    print(f"frontier EUR-50 real DB: cold {cold:.2f}s, warm {elapsed:.2f}s")
    assert elapsed <= 3.0, f"warm frontier took {elapsed:.2f}s"


@pytest.mark.skipif(not config.DB_PATH.exists(), reason="real database not present")
def test_real_db_usd_frontier_with_ui_points_is_fast_when_warm(monkeypatch):
    """USD has the largest candidate set; the UI asks for 12 points per curve (FRONTIER_POINTS in frontier.ts)."""
    monkeypatch.setattr(config, "REFERENCES", {k: dict(v) for k, v in REAL_REFS.items()})
    from app.api.deps import get_data

    data = get_data()
    usd = InvestorProfile(risk_level=50, horizon_years=10, base_currency="USD")
    t = time.perf_counter()
    pipeline.frontier(usd, SETTINGS, POINTS, data)  # cold: loads the data caches
    cold = time.perf_counter() - t
    t = time.perf_counter()
    res = pipeline.frontier(usd, SETTINGS, POINTS, data)
    elapsed = time.perf_counter() - t
    assert {"world", "sp500"} <= {m.key for m in res.markers}
    print(f"frontier USD-50 real DB, points={POINTS}: cold {cold:.2f}s, warm {elapsed:.2f}s")
    assert elapsed <= 3.0, f"warm USD frontier took {elapsed:.2f}s"



ONE_FUND = InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR",
                           preferences={"esg_only": True, "max_position": 1.0, "max_etfs": 3})


def test_hrp_with_a_single_candidate_holds_it(synthetic):
    rec = pipeline.recommend(ONE_FUND, EngineSettings(strategy="hrp", mc_paths=500), synthetic)
    assert [(h.isin, h.weight) for h in rec.holdings] == [("SYNESGEQ0001", 1.0)]
    assert any("single" in n for s in rec.trace if s.step == "optimize" for n in s.notes)


def test_api_hrp_with_a_single_candidate(client):
    body = {"profile": ONE_FUND.model_dump(mode="json"), "settings": {"strategy": "hrp", "mc_paths": 500}}
    assert client.post("/api/portfolio", json=body).status_code == 200


def test_frontier_single_candidate_keeps_every_strategy(synthetic):
    res = pipeline.frontier(ONE_FUND, SETTINGS, 5, synthetic)
    assert set(STRATEGIES) <= {m.key for m in res.markers}
    assert not any("skipped" in w for w in res.warnings)


def test_frontier_is_deterministic(result, synthetic):
    again = pipeline.frontier(PROFILE, SETTINGS, POINTS, synthetic)
    assert again.model_dump() == result.model_dump()
    notes = " ".join(result.trace[-1].notes)
    assert "TER penalty" in notes
