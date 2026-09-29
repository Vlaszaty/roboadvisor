from datetime import date

import numpy as np
import pandas as pd
import pytest

from app import config
from app.engine import backtest as bt_engine
from app.engine import pipeline
from app.engine.errors import InvalidSettings
from app.engine.types import BacktestSettings, EngineSettings, InvestorProfile

FAST = EngineSettings(mc_paths=1000)
PROFILE = InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR")
WALK_FORWARD = BacktestSettings(
    mode="walk_forward", start=date(2018, 1, 1), end=date(2021, 12, 31),
    rebalance={"type": "periodic", "frequency": "quarterly"},
)
ORIGINAL_RUN = bt_engine.run


def _look_ahead(result) -> bool:
    return any("look-ahead" in w for w in result.warnings)


def test_static_from_recommendation(synthetic):
    res = pipeline.backtest(PROFILE, None, FAST, BacktestSettings(), synthetic)
    rec = pipeline.recommend(PROFILE, FAST, synthetic)
    assert res.weights == pytest.approx({h.isin: h.weight for h in rec.holdings}, abs=1e-6)
    assert _look_ahead(res)
    steps = [s.step for s in res.trace]
    assert steps == [*pipeline.RECOMMEND_STEPS, "backtest"]
    summary = res.trace[-1].summary
    assert summary["mode"] == "static" and summary["benchmark_target_vol"] == pytest.approx(rec.summary.volatility)
    assert set(summary["benchmark"]) <= set(config.ANCHORS["EUR"].values())
    assert res.series.portfolio[0] == pytest.approx(1.0, abs=0.01)
    assert len(res.series.dates) > 700  # ~15 years of weeks


def test_static_with_explicit_weights_and_benchmark(synthetic):
    w = {"IE00B6R52259": 0.6, "SYNGOVS00001": 0.4}
    bt = BacktestSettings(benchmark={"IE00B6R52259": 1.0})
    res = pipeline.backtest(PROFILE, w, FAST, bt, synthetic)
    assert res.weights == pytest.approx(w)
    assert [s.step for s in res.trace] == ["returns", "backtest"]
    assert res.trace[-1].summary["benchmark"] == {"IE00B6R52259": 1.0}
    assert _look_ahead(res)


def test_walk_forward_has_no_look_ahead_warning(synthetic):
    res = pipeline.backtest(PROFILE, None, FAST, WALK_FORWARD, synthetic)
    assert not _look_ahead(res)
    assert len(res.rebalance_dates) >= 12
    assert [s.step for s in res.trace] == ["universe", "returns", "backtest"]
    assert res.trace[-1].summary["n_fits"] >= len(res.rebalance_dates)
    assert abs(sum(res.weights.values()) - 1) < 1e-6


def test_unknown_isin_in_weights_is_invalid(synthetic):
    with pytest.raises(InvalidSettings, match="NOPE00000000"):
        pipeline.backtest(PROFILE, {"NOPE00000000": 1.0}, FAST, BacktestSettings(), synthetic)


def test_benchmark_weights_must_sum_to_one(synthetic):
    bt = BacktestSettings(benchmark={"IE00B6R52259": 0.5})
    with pytest.raises(InvalidSettings, match="sum to 1"):
        pipeline.backtest(PROFILE, {"IE00B6R52259": 1.0}, FAST, bt, synthetic)


# ---------- walk-forward no-look-ahead ----------

CUTOFF = pd.Timestamp("2019-12-27")  # a Friday: week labels <= CUTOFF only contain prices <= CUTOFF


class CorruptAfter:
    """DataSource wrapper that wrecks every price, FX rate and risk-free rate after `cutoff`."""

    def __init__(self, inner, cutoff: pd.Timestamp) -> None:
        self.inner, self.cutoff = inner, cutoff

    def funds(self):
        return self.inner.funds()

    def listings(self):
        return self.inner.listings()

    def prices(self, tickers):
        px = self.inner.prices(tickers).copy()
        after = px.index > self.cutoff
        px.loc[after] = px.loc[after].mul(np.linspace(0.3, 3.0, int(after.sum())), axis=0)
        return px

    def fx(self):
        fx = self.inner.fx().copy()
        fx.loc[fx.index > self.cutoff, "EUR"] *= 1.7
        return fx

    def rf(self, currency):
        rf = self.inner.rf(currency).copy()
        rf[rf.index > self.cutoff] = 0.25
        return rf

    def last_ingest(self):
        return self.inner.last_ingest()


def _weights_by_date(monkeypatch, data) -> dict[pd.Timestamp, pd.Series]:
    calls: dict[pd.Timestamp, pd.Series] = {}

    def spy(returns, weights_fn, settings, benchmark_weights, rf, proxied):
        def recording(t):
            w = weights_fn(t)
            calls[pd.Timestamp(t)] = w.copy()
            return w

        return ORIGINAL_RUN(returns, recording, settings, benchmark_weights, rf, proxied)

    monkeypatch.setattr(bt_engine, "run", spy)
    pipeline.backtest(PROFILE, None, FAST, WALK_FORWARD, data)
    return calls


def test_walk_forward_never_reads_data_after_the_rebalance_date(monkeypatch, synthetic):
    clean = _weights_by_date(monkeypatch, synthetic)
    corrupt = _weights_by_date(monkeypatch, CorruptAfter(synthetic, CUTOFF))
    assert clean.keys() == corrupt.keys()
    before = [t for t in clean if t <= CUTOFF]
    after = [t for t in clean if t > CUTOFF]
    assert len(before) >= 4 and after
    for t in before:
        pd.testing.assert_series_equal(clean[t].sort_index(), corrupt[t].sort_index(), check_exact=False, atol=1e-9,
                                       obj=f"weights at {t.date()}")
    # sanity: the corruption is strong enough to matter once it is visible
    assert any(not clean[t].sort_index().round(6).equals(corrupt[t].sort_index().round(6)) for t in after)


def test_walk_forward_too_early_start_names_date_and_suggests_later_start(synthetic):
    from app.engine.errors import InsufficientHistory

    bt = WALK_FORWARD.model_copy(update={"start": date(2005, 3, 1)})  # synthetic data starts 2005-01
    with pytest.raises(InsufficientHistory) as exc:
        pipeline.backtest(PROFILE, None, FAST, bt, synthetic)
    msg = str(exc.value)
    assert "walk-forward rebalance 2005-03-04" in msg
    assert "later start" in msg


def test_walk_forward_ignores_given_weights_with_a_warning(synthetic):
    res = pipeline.backtest(PROFILE, {"IE00B6R52259": 1.0}, FAST, WALK_FORWARD, synthetic)
    assert any("ignored in walk-forward" in w for w in res.warnings)
    assert res.weights != {"IE00B6R52259": 1.0}


def test_static_backtest_starts_when_every_held_fund_has_data(synthetic):
    w = {"SYNYOUNG0001": 0.5, "IE00B6R52259": 0.5}  # SYNYOUNG0001 has no data (and no proxy) before 2023-06
    res = pipeline.backtest(PROFILE, w, FAST, BacktestSettings(), synthetic)
    first_return_week = pd.Timestamp(res.series.dates[1])
    assert pd.Timestamp("2023-06-01") <= first_return_week <= pd.Timestamp("2023-06-16")
    assert any("SYNYOUNG0001" in m and "starts" in m for m in res.warnings)
    assert not any("with a missing return" in m for m in res.warnings)  # backtest.run's 0% tally


def test_static_backtest_from_recommendation_needs_no_later_start(synthetic):
    res = pipeline.backtest(PROFILE, None, FAST, BacktestSettings(), synthetic)
    assert not any("starts" in m and "instead of" in m for m in res.warnings)
