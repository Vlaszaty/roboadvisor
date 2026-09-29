import json

import pytest

from app import config
from app.engine import pipeline
from app.engine.errors import InfeasibleConstraints, NoEligibleFunds
from app.engine.types import EngineSettings, InvestorProfile, Preferences

FAST = EngineSettings(mc_paths=1000)


def _profile(risk=50, base="EUR", **prefs) -> InvestorProfile:
    return InvestorProfile(risk_level=risk, horizon_years=10, base_currency=base, preferences=Preferences(**prefs))


def test_recommend_eur_is_a_valid_portfolio(synthetic):
    rec = pipeline.recommend(_profile(), FAST, synthetic)
    weights = [h.weight for h in rec.holdings]
    assert abs(sum(weights) - 1) < 1e-6
    assert all(w > 0 for w in weights)
    assert weights == sorted(weights, reverse=True)
    assert rec.summary.target_volatility == pytest.approx(0.11)
    assert rec.summary.volatility <= 0.11 + 1e-3 or rec.warnings
    assert abs(sum(rec.summary.mix.values()) - 1) < 1e-6
    assert rec.summary.annual_cost_per_10k == pytest.approx(rec.summary.weighted_ter * 10_000, abs=1e-3)
    assert abs(sum(h.risk_contribution for h in rec.holdings) - 1) < 1e-4
    assert len(rec.downside.stress) == len(config.STRESS_EVENTS)
    assert [p.year for p in rec.downside.fan] == list(range(11))
    assert [p.threshold for p in rec.downside.drawdown_probs] == list(FAST.drawdown_thresholds)


def test_trace_has_every_step_in_order_with_meaningful_summaries(synthetic):
    rec = pipeline.recommend(_profile(), FAST, synthetic)
    assert [s.step for s in rec.trace] == list(pipeline.RECOMMEND_STEPS)
    s = {step.step: step.summary for step in rec.trace}
    assert s["universe"]["n_funds"] == len(synthetic.funds())
    assert s["universe"]["n_eligible"] < s["universe"]["n_funds"]
    assert s["universe"]["removed"]["non_ucits"] > 0  # EUR default is UCITS-only
    assert s["universe"]["removed"]["crypto"] == 2  # crypto_max defaults to 0
    assert s["returns"]["weeks"] > 900
    assert set(s["returns"]["anchors"].values()) == set(config.ANCHORS["EUR"].values())
    assert "SYNESGEQ0001" in s["returns"]["proxied"]
    assert s["covariance"]["weeks_used"] > 200 and isinstance(s["covariance"]["dropped"], list)
    assert "SYNYOUNG0001" in s["covariance"]["dropped"]  # < 80% of the 5-year window
    assert s["expected_returns"]["model"] == "capm_multi_asset"
    assert s["expected_returns"]["premium"] == 0.035
    assert s["expected_returns"]["rf"] == pytest.approx(0.03)  # synthetic EUR rf after 2022-07-27
    assert s["constraints"]["target_vol"] == pytest.approx(0.11)
    assert s["optimize"]["n_holdings"] == len(rec.holdings)
    assert s["metrics"]["volatility"] == pytest.approx(rec.summary.volatility, abs=1e-6)
    assert s["downside"]["paths"] == 1000 and s["downside"]["history_weeks"] > 0
    json.dumps([step.model_dump(mode="json") for step in rec.trace], allow_nan=False)


def test_usd_profile_uses_usd_anchors(synthetic):
    rec = pipeline.recommend(_profile(base="USD"), FAST, synthetic)
    s = {step.step: step.summary for step in rec.trace}
    assert set(s["returns"]["anchors"].values()) == set(config.ANCHORS["USD"].values())
    assert s["expected_returns"]["rf"] == pytest.approx(0.045)


def test_anchors_filtered_out_of_universe_still_define_the_market(synthetic):
    rec = pipeline.recommend(_profile(regions_exclude=["global"]), FAST, synthetic)
    held = {h.isin for h in rec.holdings}
    anchors = set(config.ANCHORS["EUR"].values())
    assert not held & anchors
    s = {step.step: step.summary for step in rec.trace}
    assert set(s["returns"]["anchors_outside_universe"]) == anchors
    assert not set(s["expected_returns"]["expected"]) & anchors  # not optimisation candidates


def test_capm_equity_note_when_bonds_are_held(synthetic):
    rec = pipeline.recommend(_profile(risk=30), EngineSettings(mc_paths=1000, expected_return_model="capm_equity"), synthetic)
    holds_bonds = any(h.asset_class == "bond" for h in rec.holdings)
    assert (pipeline.CAPM_EQUITY_BOND_NOTE in rec.warnings) == holds_bonds
    assert (pipeline.CAPM_EQUITY_BOND_NOTE in rec.trace[3].notes) == holds_bonds


def test_no_eligible_funds_raises(synthetic):
    with pytest.raises(NoEligibleFunds):
        pipeline.recommend(_profile(max_ter=0.0), FAST, synthetic)


def test_too_few_funds_for_max_position_raises_clearly(synthetic):
    with pytest.raises(InfeasibleConstraints, match="max_position"):
        pipeline.recommend(_profile(esg_only=True), FAST, synthetic)


def test_max_etfs_times_max_position_below_one_raises_early(synthetic):
    with pytest.raises(InfeasibleConstraints, match="max_etfs"):
        pipeline.recommend(_profile(max_etfs=2, max_position=0.4), FAST, synthetic)


def test_expected_returns_are_total_but_optimizer_gets_excess(synthetic, monkeypatch):
    from app.engine import optimize

    seen = {}
    original = optimize.optimize

    def spy(mu, cov, constraints, strategy):
        seen["mu"] = mu.copy()
        return original(mu, cov, constraints, strategy)

    monkeypatch.setattr(optimize, "optimize", spy)
    rec = pipeline.recommend(_profile(), FAST, synthetic)
    rf = rec.trace[3].summary["rf"]
    for h in rec.holdings:
        assert h.expected_return == pytest.approx(seen["mu"][h.isin] + rf, abs=1e-6)


def test_risk_parity_excludes_cash_with_a_note(synthetic):
    rec = pipeline.recommend(_profile(), EngineSettings(mc_paths=1000, strategy="risk_parity"), synthetic)
    assert all(h.asset_class != "cash" for h in rec.holdings)
    assert any("cash funds excluded" in n for n in rec.trace[5].notes)
