import json

import pandas as pd
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
    assert "SYNYOUNG0001" in s["returns"]["short_history_excluded"]  # starts 2023, needs 15 years
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
    with pytest.raises(InfeasibleConstraints, match=r"too few funds: only 2 eligible fund"):
        pipeline.recommend(_profile(esg_only=True), FAST, synthetic)


def test_max_etfs_times_max_position_below_one_raises_early(synthetic):
    with pytest.raises(InfeasibleConstraints, match=r"max_etfs 2 x max_position 40% is below 100%"):
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


def _summary(rec) -> dict:
    return {step.step: step.summary for step in rec.trace}


def test_equity_share_does_not_decrease_with_risk(synthetic):
    shares = [pipeline.recommend(_profile(risk=r), FAST, synthetic).summary.mix.get("equity", 0.0) for r in (10, 50, 90)]
    assert shares == sorted(shares), shares
    assert shares[-1] > shares[0]


def test_crypto_needs_a_risk_level_of_at_least_the_minimum(synthetic):
    from app.engine import universe

    low = _profile(risk=config.CRYPTO_MIN_RISK_LEVEL - 10, crypto_max=0.05)
    rec = pipeline.recommend(low, FAST, synthetic)
    assert all(h.asset_class != "crypto" for h in rec.holdings)
    assert _summary(rec)["universe"]["removed"]["crypto"] > 0

    high = _profile(risk=80, crypto_max=0.05)
    crypto = set(synthetic.funds().query("asset_class == 'crypto'").index)
    eligible = set(universe.select(synthetic.funds(), synthetic.listings(), high).index)
    assert "SYNBTC000001" in eligible  # crypto ETP; SYNIBIT00001 is a non-UCITS ETF, removed by the EUR UCITS rule
    assert crypto & eligible
    rec = pipeline.recommend(high, FAST, synthetic)
    assert _summary(rec)["universe"]["removed"]["crypto"] == 0
    assert sum(h.weight for h in rec.holdings if h.asset_class == "crypto") <= 0.05 + 1e-6


def test_undefined_sharpe_is_reported_as_zero_with_a_warning(synthetic, monkeypatch):
    from app.engine import metrics

    original = metrics.ex_ante

    def zero_vol(*args, **kwargs):
        out = original(*args, **kwargs)
        out["sharpe"] = float("nan")  # what ex_ante returns when volatility is ~0
        return out

    monkeypatch.setattr(metrics, "ex_ante", zero_vol)
    rec = pipeline.recommend(_profile(), FAST, synthetic)
    assert rec.summary.sharpe == 0.0
    assert pipeline.SHARPE_UNDEFINED_NOTE in rec.warnings
    metrics_step = next(s for s in rec.trace if s.step == "metrics")
    assert metrics_step.summary["sharpe"] == 0.0 and pipeline.SHARPE_UNDEFINED_NOTE in metrics_step.notes
    json.dumps(rec.model_dump(mode="json"), allow_nan=False)


@pytest.mark.parametrize("strategy", ["target_vol", "risk_parity"])  # risk_parity drops cash after covariance
def test_weeks_used_counts_complete_weeks_of_the_covariance_fund_set(synthetic, strategy):
    from app.engine import universe

    profile = _profile()
    settings = EngineSettings(mc_paths=1000, strategy=strategy)
    s = _summary(pipeline.recommend(profile, settings, synthetic))["covariance"]
    selection = universe.select(synthetic.funds(), synthetic.listings(), profile)
    rows = pipeline._extend(selection, synthetic.funds(), synthetic.listings(), "EUR",
                            list(config.ANCHORS["EUR"].values()), error=ValueError, what="anchors")
    rr = pipeline._weekly(rows, "EUR", synthetic)
    candidates = pipeline._candidates(selection, rr, profile).selection
    returns = rr.returns
    cov_funds = [i for i in candidates.index if i not in s["dropped"]]
    window = settings.estimation_window_years * config.PERIODS_PER_YEAR
    assert s["n_funds"] == len(cov_funds)
    assert s["weeks_used"] == len(returns[cov_funds].tail(window).dropna())


# ---------- Task 6b: same-index dedupe, minimum history, incomplete final week ----------


def test_same_index_duplicates_keep_the_cheapest_and_anchors_still_define_the_market(synthetic):
    # USD (no UCITS rule): MSCI ACWI is offered twice (anchor ACWI TER 0.32%, IUSQ 0.20%) and, with crypto opted in,
    # Bitcoin twice (ETP 0.95%, ETF 0.25%)
    rec = pipeline.recommend(_profile(risk=80, base="USD", crypto_max=0.05), FAST, synthetic)
    s = _summary(rec)
    assert s["universe"]["removed"]["same_index_duplicates"] == 2
    groups = {(g["index_name"], g["kept"]): g["removed"] for g in s["universe"]["same_index_duplicates"]}
    assert groups == {("MSCI ACWI", "IE00B6R52259"): ["US4642882579"], ("Bitcoin", "SYNIBIT00001"): ["SYNBTC000001"]}
    candidates = set(s["expected_returns"]["expected"])
    assert not candidates & {"US4642882579", "SYNBTC000001"}
    assert "SYNIBIT00001" in candidates  # crypto is exempt from the minimum history (starts 2024)
    assert "US4642882579" in s["returns"]["anchors"].values()  # still the CAPM market
    assert "US4642882579" in s["returns"]["anchors_outside_universe"]


def test_same_index_dedupe_order_ter_then_history_then_isin():
    import pandas as pd

    sel = pd.DataFrame(
        {"index_name": ["X", "X", "X", "X", "Y", None, None],
         "hedged_to": [None, None, None, "EUR", None, None, None],
         "ter": [0.002, None, 0.002, 0.009, 0.001, 0.001, 0.001]},
        index=["B2", "A0", "B1", "H1", "Y1", "N1", "N2"],
    )
    own_start = {"B2": pd.Timestamp("2005-01-07"), "B1": pd.Timestamp("2010-01-01"), "A0": pd.Timestamp("2001-01-05")}
    kept, groups = pipeline._dedupe_same_index(sel, own_start)
    assert list(kept.index) == ["B2", "H1", "Y1", "N1", "N2"]  # hedged class and unnamed indices stay
    assert groups == [{"index_name": "X", "hedged_to": None, "kept": "B2", "removed": ["B1", "A0"]}]
    tie = sel.loc[["B1", "B2"]]
    assert list(pipeline._dedupe_same_index(tie, {})[0].index) == ["B1"]  # no history known -> isin


def test_min_history_excludes_young_funds_but_not_opted_in_crypto(synthetic):
    rec = pipeline.recommend(_profile(risk=80, crypto_max=0.05), FAST, synthetic)
    s = _summary(rec)
    assert s["returns"]["min_history_years"] == config.MIN_HISTORY_YEARS
    assert s["returns"]["short_history_excluded"] == ["SYNYOUNG0001"]
    assert "SYNYOUNG0001" not in s["expected_returns"]["expected"]
    assert "SYNBTC000001" in s["expected_returns"]["expected"]  # crypto exempt
    assert all(h.isin != "SYNYOUNG0001" for h in rec.holdings)


def test_min_history_falls_back_with_a_warning_when_too_few_funds_remain(synthetic, monkeypatch):
    import pandas as pd

    # no fund's returns start early enough -> the filter would leave nothing
    monkeypatch.setattr(pipeline, "_history_needed_from", lambda index: index[0] - pd.Timedelta(weeks=1))
    rec = pipeline.recommend(_profile(), FAST, synthetic)
    s = _summary(rec)
    assert s["returns"]["short_history_excluded"] == [] and s["returns"]["min_history_applied"] is False
    assert any("minimum history" in w for w in rec.warnings)


def test_incomplete_final_week_is_dropped(synthetic):
    # synthetic prices end Wednesday 2025-12-31: the W-FRI week labelled 2026-01-02 is partial
    s = _summary(pipeline.recommend(_profile(), FAST, synthetic))
    assert s["returns"]["end"] == "2025-12-26"
    assert s["covariance"]["end"] == "2025-12-26"


def test_drop_incomplete_week_keeps_a_week_ending_on_its_friday():
    import pandas as pd

    from app.engine.types import ReturnsResult

    idx = pd.date_range("2025-12-05", periods=4, freq="W-FRI")  # ..., 2025-12-26
    rr = ReturnsResult(returns=pd.DataFrame({"A": [0.01, 0.02, 0.03, 0.04]}, index=idx),
                       proxied={"A": (idx[0], idx[-1])})
    assert pipeline._drop_incomplete_week(rr, pd.Timestamp("2025-12-26")) is rr
    cut = pipeline._drop_incomplete_week(rr, pd.Timestamp("2025-12-24"))
    assert list(cut.returns.index) == list(idx[:-1])
    assert cut.proxied == {"A": (idx[0], idx[-2])}


# ---------- final-review fixes ----------


def test_hedge_bonds_drops_bond_funds_hedged_to_another_currency(synthetic):
    # SYNUSTLEH001 and IE00BDBRDM35 are hedged to EUR: a USD investor who wants hedged bonds must not get them
    s = _summary(pipeline.recommend(_profile(base="USD"), FAST, synthetic))
    foreign = ["IE00BDBRDM35", "SYNUSTLEH001"]
    assert not set(foreign) & set(s["expected_returns"]["expected"])
    assert s["universe"]["removed"]["foreign_hedged_bonds"] == 2
    assert sorted(s["universe"]["foreign_hedged_bonds"]) == foreign
    assert any("SYNUSTLEH001" in n and "hedged to EUR" in n for n in next(
        st for st in pipeline.recommend(_profile(base="USD"), FAST, synthetic).trace if st.step == "universe").notes)
    assert "SYNUSTLUH001" in s["expected_returns"]["expected"]  # its unhedged sibling stays

    s = _summary(pipeline.recommend(_profile(base="USD", hedge_bonds=False), FAST, synthetic))
    assert "SYNUSTLEH001" in s["expected_returns"]["expected"]
    assert s["universe"]["removed"]["foreign_hedged_bonds"] == 0


def test_hedge_bonds_keeps_bond_funds_hedged_to_the_base_currency(synthetic):
    s = _summary(pipeline.recommend(_profile(base="EUR"), FAST, synthetic))
    assert "SYNUSTLEH001" in s["expected_returns"]["expected"]
    assert s["universe"]["removed"]["foreign_hedged_bonds"] == 0


def test_walk_forward_applies_the_same_hedged_bond_rule(synthetic):
    from datetime import date

    from app.engine.types import BacktestSettings

    bt = BacktestSettings(mode="walk_forward", start=date(2020, 1, 1), end=date(2021, 12, 31),
                          rebalance={"type": "periodic", "frequency": "annual"})
    res = pipeline.backtest(_profile(base="USD"), None, FAST, bt, synthetic)
    assert sorted(_summary(res)["universe"]["foreign_hedged_bonds"]) == ["IE00BDBRDM35", "SYNUSTLEH001"]
    assert not {"IE00BDBRDM35", "SYNUSTLEH001"} & set(res.weights)


class NoPrices:
    """DataSource whose price table is empty (the ingest never ran)."""

    def __init__(self, inner) -> None:
        self.inner = inner

    def __getattr__(self, name):
        return getattr(self.inner, name)

    def prices(self, tickers):
        return pd.DataFrame(columns=list(tickers), index=pd.DatetimeIndex([]), dtype=float)


def test_empty_price_history_is_insufficient_history_not_a_crash(synthetic):
    from app.engine.errors import InsufficientHistory
    from app.engine.types import BacktestSettings

    with pytest.raises(InsufficientHistory, match="no price history loaded for the eligible funds"):
        pipeline.recommend(_profile(), FAST, NoPrices(synthetic))
    with pytest.raises(InsufficientHistory, match="run the ingest"):
        pipeline.backtest(_profile(), {"IE00B6R52259": 1.0}, FAST, BacktestSettings(), NoPrices(synthetic))


@pytest.mark.parametrize("strategy", ["hrp", "risk_parity", "max_sharpe", "min_variance"])
def test_comparison_strategies_say_they_ignore_the_risk_target(synthetic, strategy):
    rec = pipeline.recommend(_profile(), EngineSettings(mc_paths=1000, strategy=strategy), synthetic)
    expected = f"strategy {strategy} does not target your risk level; achieved volatility {rec.summary.volatility:.1%}"
    assert any(expected in w for w in rec.warnings)
    assert any(expected in n for n in next(s for s in rec.trace if s.step == "optimize").notes)


def test_target_vol_strategy_has_no_ignored_target_note(synthetic):
    rec = pipeline.recommend(_profile(), FAST, synthetic)
    assert not any("does not target your risk level" in w for w in rec.warnings)


def test_min_position_above_max_position_is_invalid_settings(synthetic):
    from datetime import date

    from app.engine.errors import InvalidSettings
    from app.engine.types import BacktestSettings

    bad = _profile(min_position=0.3, max_position=0.25)
    msg = r"min_position 30% is above max_position 25%"
    with pytest.raises(InvalidSettings, match=msg):
        pipeline.recommend(bad, FAST, synthetic)
    wf = BacktestSettings(mode="walk_forward", start=date(2020, 1, 1), end=date(2021, 12, 31),
                          rebalance={"type": "periodic", "frequency": "annual"})
    with pytest.raises(InvalidSettings, match=msg):
        pipeline.backtest(bad, None, FAST, wf, synthetic)
