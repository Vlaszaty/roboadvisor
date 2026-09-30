"""Model vs hindsight efficient frontier (spec 2026-09-30 §3.2, §5)."""

import json
import math
import time

import numpy as np
import pandas as pd
import pytest

from app import config
from app.engine import pipeline
from app.engine.types import EngineSettings, Frontier, InvestorProfile

PROFILE = InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR")
SETTINGS = EngineSettings()
LOOKBACK_YEARS = 5
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
        return pipeline.frontier(PROFILE, SETTINGS, LOOKBACK_YEARS, POINTS, synthetic)


@pytest.fixture(scope="module")
def prepared(synthetic):
    return pipeline._prepare(PROFILE, SETTINGS, synthetic)


def _marker(result: Frontier, key: str):
    return next(m for m in result.markers if m.key == key)


def _interp(curve, vol: float) -> float:
    return float(np.interp(vol, [p.volatility for p in curve], [p.expected_return for p in curve]))


def test_curves_sorted_by_volatility_and_finite(result):
    for curve in (result.model_curve, result.hindsight_curve):
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


def test_bounded_markers_lie_under_the_hindsight_curve(result):
    """Spec §5 sanity: the hindsight curve is the best any constrained portfolio could have done in hindsight."""
    curve = result.hindsight_curve
    for key in ("portfolio", "min_variance", "max_sharpe"):
        h = _marker(result, key).hindsight
        if curve[0].volatility <= h.volatility <= curve[-1].volatility:
            assert h.expected_return <= _interp(curve, h.volatility) + 5e-3, key


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
        for pos in (m.model, m.hindsight):
            assert math.isfinite(pos.volatility) and math.isfinite(pos.expected_return)


def test_capital_market_line_starts_at_rf(result):
    cml = result.capital_market_line
    assert len(cml) == 2
    assert cml[0].volatility == 0 and cml[0].expected_return == pytest.approx(result.rf)
    assert cml[1].volatility == pytest.approx(result.model_curve[-1].volatility)
    best = max((p for p in result.model_curve if p.sharpe is not None), key=lambda p: p.sharpe)
    assert (cml[1].expected_return - result.rf) / cml[1].volatility == pytest.approx(best.sharpe, rel=1e-4)


def test_lookback_spans_the_requested_years(result, prepared):
    weeks = prepared.rr.returns.index
    assert result.lookback["end"] == weeks[-1].date()
    assert result.lookback["start"] == weeks[-LOOKBACK_YEARS * 52].date()
    span = pd.Timestamp(result.lookback["end"]) - pd.Timestamp(result.lookback["start"])
    assert abs(span.days - LOOKBACK_YEARS * 365.25) < 14


def test_portfolio_hindsight_return_is_the_historical_mean(result, prepared):
    w = prepared.fit.opt.weights
    hist = prepared.rr.returns[list(w.index)].tail(LOOKBACK_YEARS * 52)
    mu_hist = hist.mean() * 52
    assert _marker(result, "portfolio").hindsight.expected_return == pytest.approx(float(w @ mu_hist), abs=1e-9)
    assert _marker(result, "portfolio").model.expected_return == pytest.approx(float(w @ prepared.fit.mu[w.index]),
                                                                               abs=1e-9)


def test_references_ignore_the_candidate_set(synthetic, monkeypatch):
    """A reference that fails the investor's filters still gets a marker, and does not change the curves."""
    esg = InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR",
                          preferences={"esg_only": True, "max_position": 1.0, "max_etfs": 3})
    res = pipeline.frontier(esg, SETTINGS, LOOKBACK_YEARS, 5, synthetic)
    assert {"world", "sp500"} <= {m.key for m in res.markers}
    monkeypatch.setattr(config, "REFERENCES", {})
    bare = pipeline.frontier(esg, SETTINGS, LOOKBACK_YEARS, 5, synthetic)
    assert bare.model_curve == res.model_curve and bare.hindsight_curve == res.hindsight_curve


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
    pipeline.frontier(PROFILE, SETTINGS, LOOKBACK_YEARS, 20, data)  # warm the data caches
    t = time.perf_counter()
    res = pipeline.frontier(PROFILE, SETTINGS, LOOKBACK_YEARS, 20, data)
    elapsed = time.perf_counter() - t
    assert {"world", "sp500"} <= {m.key for m in res.markers}
    assert elapsed <= 3.0, f"warm frontier took {elapsed:.2f}s"

