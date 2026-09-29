import numpy as np
import pandas as pd
import pytest

from app.engine.optimize import optimize
from tests.engine_c.conftest import TARGETS, TOL, assert_valid, make_constraints, net_return, no_cardinality, vol


# ---------- other strategies


def test_min_variance_is_the_lowest_volatility(mu, cov, selection):
    c = no_cardinality(selection)
    min_variance = optimize(mu, cov, c, "min_variance")
    assert_valid(min_variance, cov, c)
    for target in TARGETS:
        assert min_variance.achieved_vol <= optimize(mu, cov, no_cardinality(selection, target_vol=target), "target_vol").achieved_vol + 1e-6


def test_min_variance_with_cardinality(mu, cov, selection):
    c = make_constraints(selection, group_min={"sector:healthcare": 0.05})
    result = optimize(mu, cov, c, "min_variance")
    assert_valid(result, cov, c)
    assert result.warnings == []


def test_max_sharpe_beats_every_target_vol_portfolio(synthetic, mu, cov, selection):
    rf_now = synthetic.rf("EUR").iloc[-1]
    excess_mu = mu - rf_now  # max_sharpe reads mu as excess returns
    c = no_cardinality(selection)
    tangency = optimize(excess_mu, cov, c, "max_sharpe")
    assert_valid(tangency, cov, c)
    best_sharpe = net_return(tangency.weights, excess_mu, c.ter) / tangency.achieved_vol
    for target in TARGETS:
        other = optimize(excess_mu, cov, no_cardinality(selection, target_vol=target), "target_vol")
        assert best_sharpe >= net_return(other.weights, excess_mu, c.ter) / other.achieved_vol - 1e-4


def test_max_sharpe_with_cardinality(synthetic, mu, cov, selection):
    c = make_constraints(selection, group_min={"sector:healthcare": 0.05})
    result = optimize(mu - synthetic.rf("EUR").iloc[-1], cov, c, "max_sharpe")
    assert_valid(result, cov, c)


def test_max_sharpe_without_positive_excess_return_falls_back(mu, cov, selection):
    result = optimize(mu - 1.0, cov, no_cardinality(selection), "max_sharpe")
    assert result.weights.sum() == pytest.approx(1.0)
    assert any("no fund has a positive expected excess return" in w for w in result.warnings)


def test_risk_parity_equalises_risk_contributions(mu, cov, selection):
    four = ["IE00B6R52259", "IE00BDBRDM35", "SYNGOLD00001", "SYNGOVL00001"]
    c = no_cardinality(selection.loc[four], max_position=1.0)
    result = optimize(mu[four], cov.loc[four, four], c, "risk_parity")
    w = result.weights.reindex(four)
    sub_cov = cov.loc[four, four]
    contributions = w * (sub_cov @ w) / (w @ sub_cov @ w)
    assert contributions.tolist() == pytest.approx([0.25] * 4, abs=1e-3)
    assert result.warnings == []


@pytest.mark.parametrize("strategy", ["risk_parity", "hrp"])
def test_heuristic_strategies_give_valid_weights_and_report_broken_bounds(mu, cov, selection, strategy):
    c = make_constraints(selection)
    result = optimize(mu, cov, c, strategy)
    w = result.weights
    assert w.sum() == pytest.approx(1.0, abs=1e-9)
    assert (w > 0).all() and np.isfinite(w).all()
    assert result.achieved_vol == pytest.approx(vol(w, cov), abs=1e-6)
    # cash has almost no volatility, so both methods pile into it beyond max_position -> must be reported
    if w.max() > c.max_position + TOL:
        assert any("above max_position" in warning for warning in result.warnings)
    if len(w) > c.max_etfs:
        assert any("max_etfs" in warning for warning in result.warnings)


def test_hrp_on_uncorrelated_funds_is_inverse_variance():
    isins = ["RISKY", "CALM"]
    cov = pd.DataFrame([[0.04, 0.0], [0.0, 0.01]], index=isins, columns=isins)
    c = no_cardinality(pd.DataFrame({"asset_class": ["equity", "bond"], "sector": [None, None], "ter": [0.0, 0.0]}, index=isins),
                       max_position=1.0, group_max={})
    result = optimize(pd.Series(0.05, index=isins), cov, c, "hrp")
    assert result.weights["RISKY"] == pytest.approx(0.2, abs=1e-6)
    assert result.weights["CALM"] == pytest.approx(0.8, abs=1e-6)
