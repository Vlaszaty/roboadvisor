"""Reference indices (World, S&P 500) next to every backtest (spec 2026-09-30 §2, §3.1)."""

import json
from datetime import date

import pytest

from app import config
from app.engine import metrics as metrics_mod
from app.engine import pipeline
from app.engine.types import BacktestSettings, EngineSettings, InvestorProfile, Preferences

FAST = EngineSettings(mc_paths=1000)
PROFILE = InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR")
WALK_FORWARD = BacktestSettings(
    mode="walk_forward", start=date(2018, 1, 1), end=date(2021, 12, 31),
    rebalance={"type": "periodic", "frequency": "quarterly"},
)
SYNTHETIC_REFS = {
    "world": {"label": "World equities (MSCI World)", "isin": "IE00B6R52259"},
    "sp500": {"label": "S&P 500", "isin": "SYNUSEQ00001"},
}
WEIGHTS = {"IE00B6R52259": 0.6, "SYNGOVS00001": 0.4}


@pytest.fixture(autouse=True)
def synthetic_refs(monkeypatch):
    monkeypatch.setattr(config, "REFERENCES", {k: dict(v) for k, v in SYNTHETIC_REFS.items()})


def _check_aligned(res):
    assert [r.key for r in res.references] == ["world", "sp500"]
    for r in res.references:
        assert r.isin == config.REFERENCES[r.key]["isin"] and r.label == config.REFERENCES[r.key]["label"]
        assert r.ticker
        assert len(r.values) == len(res.series.dates)
        first = next(k for k, v in enumerate(r.values) if v is not None)
        assert res.series.dates[first] == r.start
        assert r.values[first] == pytest.approx(1.0)
        assert all(v is not None for v in r.values[first:])
        assert set(r.metrics) == set(metrics_mod.REGISTRY)


def test_static_backtest_has_both_references(synthetic):
    res = pipeline.backtest(PROFILE, None, FAST, BacktestSettings(), synthetic)
    _check_aligned(res)
    for r in res.references:
        assert r.start == res.series.dates[0]  # both synthetic references cover the whole window
        assert r.metrics["cagr"] is not None and r.metrics["sharpe"] is not None
    notes = " ".join(res.trace[-1].notes)
    assert "references:" in notes and "world from" in notes and "sp500 from" in notes


def test_walk_forward_backtest_has_references(synthetic):
    res = pipeline.backtest(PROFILE, None, FAST, WALK_FORWARD, synthetic)
    _check_aligned(res)


def test_references_ignore_investor_filters(synthetic):
    esg = InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR",
                          preferences=Preferences(esg_only=True, max_position=1.0, max_etfs=1))
    res = pipeline.backtest(esg, None, FAST, BacktestSettings(), synthetic)
    assert [r.key for r in res.references] == ["world", "sp500"]


def test_reference_starting_late_is_none_before_start(synthetic, monkeypatch):
    # SYNYOUNG0001 has own prices from 2023-06-01 and no proxy
    monkeypatch.setitem(config.REFERENCES, "sp500", {"label": "S&P 500", "isin": "SYNYOUNG0001"})
    bt = BacktestSettings(start=date(2022, 1, 1), end=date(2025, 6, 30))
    res = pipeline.backtest(PROFILE, WEIGHTS, FAST, bt, synthetic)
    _check_aligned(res)
    late = res.references[1]
    assert late.start > res.series.dates[0] and late.start >= date(2023, 5, 26)
    k = res.series.dates.index(late.start)
    assert k > 0 and all(v is None for v in late.values[:k])
    assert 0 not in late.values[:k]


def test_missing_reference_isin_is_skipped_with_warning(synthetic, monkeypatch):
    monkeypatch.setitem(config.REFERENCES, "sp500", {"label": "S&P 500", "isin": "NOPE00000000"})
    res = pipeline.backtest(PROFILE, WEIGHTS, FAST, BacktestSettings(), synthetic)
    assert [r.key for r in res.references] == ["world"]
    assert any("NOPE00000000" in w and "sp500" in w for w in res.warnings)


def test_references_serialise_without_nan(synthetic):
    res = pipeline.backtest(PROFILE, WEIGHTS, FAST, BacktestSettings(), synthetic)
    json.dumps(res.model_dump(mode="json"), allow_nan=False)
