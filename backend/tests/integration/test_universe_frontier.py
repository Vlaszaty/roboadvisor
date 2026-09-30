"""Universe risk/return chart (spec 2026-09-30-universe-frontier-design)."""

import json
import math
import time

import numpy as np
import pytest

from app import config
from app.api.universe import list_funds
from app.engine import pipeline
from app.engine.types import UniverseFilters
from app.engine.universe import filter_funds

CASES = [UniverseFilters(), UniverseFilters(asset_class="bond"), UniverseFilters(region="us", max_ter=0.002),
         UniverseFilters(esg=True), UniverseFilters(q="gold")]


def test_filter_funds_matches_the_table(synthetic):
    for f in CASES:
        table = [x.isin for x in list_funds(**f.model_dump(), data=synthetic)]
        assert list(filter_funds(synthetic.funds(), synthetic.listings(), f).index) == table, f


def _uf(synthetic, f=UniverseFilters(), years=5, points=8):
    return pipeline.universe_frontier(f, years, "EUR", points, synthetic)


def test_curve_sorted_and_points_on_or_under_it(synthetic):
    res = _uf(synthetic)
    vols = [p.volatility for p in res.curve]
    assert len(res.curve) >= 5 and vols == sorted(vols)
    for p in res.points:
        m = p.model
        if res.curve[0].volatility <= m.volatility <= res.curve[-1].volatility:
            top = float(np.interp(m.volatility, vols, [c.expected_return for c in res.curve]))
            assert m.expected_return <= top + 5e-3, p.isin


def test_points_follow_the_filters(synthetic):
    res = _uf(synthetic, UniverseFilters(asset_class="bond"))
    assert res.points and {p.asset_class for p in res.points} == {"bond"}


def test_realised_is_cagr_and_vol_over_the_window(synthetic):
    res = _uf(synthetic, UniverseFilters(q="SYNUSEQ00001"), years=3)
    (p,) = res.points
    prep_returns = pipeline._weekly(
        pipeline._listing_rows(synthetic.funds(), synthetic.listings(), "EUR", ["SYNUSEQ00001"],
                               error=pipeline.InsufficientHistory, what="test"), "EUR", synthetic).returns
    r = prep_returns["SYNUSEQ00001"].tail(3 * 52).dropna()
    cagr = float((1 + r).prod() ** (52 / len(r)) - 1)
    assert p.realised is not None
    assert p.realised.expected_return == pytest.approx(cagr, abs=1e-9)
    assert p.realised.volatility == pytest.approx(float(r.std() * math.sqrt(52)), abs=1e-9)
    assert str(res.period["end"]) == str(r.index[-1].date())


def test_single_fund_has_no_curve_and_empty_filter_is_empty(synthetic):
    one = _uf(synthetic, UniverseFilters(q="SYNGOLD00001"))
    assert len(one.points) == 1 and one.curve == [] and one.capital_market_line == []
    none = _uf(synthetic, UniverseFilters(q="no such fund"))
    assert none.points == [] and none.curve == []


def test_young_fund_is_dropped_and_named(synthetic):
    res = _uf(synthetic, years=10)
    assert "SYNYOUNG0001" not in {p.isin for p in res.points}
    assert any("SYNYOUNG0001" in w for w in res.warnings)


def _reject(token: str):
    raise AssertionError(f"non-finite JSON token {token!r} in response")


def test_api_universe_frontier(client):
    body = {"filters": {"asset_class": "equity"}, "period_years": 3, "points": 6}
    r = client.post("/api/universe/frontier", json=body)
    assert r.status_code == 200, r.text
    d = json.loads(r.text, parse_constant=_reject)
    assert d["points"] and d["curve"] and {p["asset_class"] for p in d["points"]} == {"equity"}


def test_api_universe_frontier_validates(client):
    assert client.post("/api/universe/frontier", json={"period_years": 0}).status_code == 422
    assert client.post("/api/universe/frontier", json={"points": 2}).status_code == 422


@pytest.mark.skipif(not config.DB_PATH.exists(), reason="real database not present")
def test_real_db_universe_frontier_is_fast_when_warm():
    from app.api.deps import get_data

    data = get_data()
    for base in ("EUR", "USD"):
        pipeline.universe_frontier(UniverseFilters(), 5, base, 12, data)  # cold: loads the data caches
        t = time.perf_counter()
        res = pipeline.universe_frontier(UniverseFilters(), 5, base, 12, data)
        elapsed = time.perf_counter() - t
        print(f"universe frontier {base}: {len(res.points)} points, warm {elapsed:.2f}s")
        assert len(res.points) > 100 and elapsed <= 3.0, f"{base} warm {elapsed:.2f}s"
