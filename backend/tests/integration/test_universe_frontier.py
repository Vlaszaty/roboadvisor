"""Universe risk/return chart (spec 2026-09-30-universe-frontier-design)."""

import math

import numpy as np
import pytest

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
