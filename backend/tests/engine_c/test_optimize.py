import cvxpy as cp
import numpy as np
import pandas as pd
import pytest

from app.engine.errors import InfeasibleConstraints, InsufficientHistory
from app.engine.optimize import _clean, optimize
from tests.engine_c.conftest import TARGETS, TOL, assert_valid, make_constraints, net_return, no_cardinality


# ---------- optimize: target_vol


@pytest.mark.parametrize("target", TARGETS)
def test_target_vol_respects_every_constraint(mu, cov, selection, target):
    c = make_constraints(selection, target_vol=target)
    result = optimize(mu, cov, c, "target_vol")
    assert_valid(result, cov, c)
    assert result.achieved_vol <= target + TOL
    assert result.warnings == []


def test_tight_cardinality_is_respected(mu, cov, selection):
    c = make_constraints(selection, target_vol=0.14, max_etfs=4, min_position=0.10)
    result = optimize(mu, cov, c, "target_vol")
    assert_valid(result, cov, c)
    assert result.achieved_vol <= 0.14 + TOL


@pytest.mark.parametrize("target", [0.06, 0.14])
def test_sector_tilt_is_a_minimum(mu, cov, selection, target):
    c = make_constraints(selection, target_vol=target, group_min={"sector:healthcare": 0.05})
    result = optimize(mu, cov, c, "target_vol")
    assert_valid(result, cov, c)
    assert result.weights.get("SYNHLTH00001", 0) >= 0.05 - TOL


def test_crypto_cap_binds(mu, cov, selection):
    greedy_mu = mu.copy()
    greedy_mu["SYNBTC000001"] = 0.50  # make crypto irresistible so only the cap holds it back
    c = make_constraints(selection, target_vol=0.14)
    result = optimize(greedy_mu, cov, c, "target_vol")
    assert_valid(result, cov, c)
    assert result.weights["SYNBTC000001"] == pytest.approx(0.05, abs=TOL)


def test_target_below_min_variance_returns_min_variance(mu, cov, selection):
    c = make_constraints(selection, target_vol=0.001)
    result = optimize(mu, cov, c, "target_vol")
    min_variance = optimize(mu, cov, c, "min_variance")
    assert_valid(result, cov, c)
    assert result.achieved_vol == pytest.approx(min_variance.achieved_vol, abs=TOL)
    assert result.achieved_vol > 0.001
    assert len(result.warnings) == 1 and "below the lowest reachable" in result.warnings[0]
    assert f"{result.achieved_vol:.2%}" in result.warnings[0]


def test_target_above_max_return_returns_max_return(mu, cov, selection):
    c = make_constraints(selection, target_vol=0.60)
    result = optimize(mu, cov, c, "target_vol")
    assert_valid(result, cov, c)
    assert result.achieved_vol < 0.60
    assert len(result.warnings) == 1 and "above the highest-return" in result.warnings[0]
    assert f"{result.achieved_vol:.2%}" in result.warnings[0]
    # the max-return portfolio fills the highest net returns up to max_position
    best = (mu - c.ter).sort_values(ascending=False).index[:2]
    assert result.weights[best].tolist() == pytest.approx([0.4, 0.4], abs=TOL)


def test_higher_target_never_lowers_expected_return(mu, cov, selection):
    returns = []
    for target in np.arange(0.02, 0.21, 0.02):
        c = no_cardinality(selection, target_vol=float(target))
        returns.append(net_return(optimize(mu, cov, c, "target_vol").weights, mu, c.ter))
    assert all(later >= earlier - 1e-6 for earlier, later in zip(returns, returns[1:]))
    assert returns[-1] > returns[0]


def test_capital_market_line_with_cash(mu, cov, selection):
    """With a (near) risk-free fund and no position limits, a lower target only swaps risky funds for cash:
    the mix inside the risky part stays the same (two-fund separation / capital market line).

    SYNCASH00001 is not perfectly riskless in the fixture: its return follows the EUR rate, which steps
    from -0.4% to 3% in 2022, giving it ~0.2% annual vol and a tiny covariance with the rest. So the risky
    mix is only approximately constant; the tolerance is 0.05 per weight. Both targets sit below the
    tangency portfolio's volatility (~11.5%), so both portfolios hold cash.
    """
    mixes = []
    for target in (0.03, 0.08):
        c = no_cardinality(selection, target_vol=target, max_position=1.0, group_max={})
        weights = optimize(mu, cov, c, "target_vol").weights
        assert weights["SYNCASH00001"] > 0.1
        risky = weights.drop("SYNCASH00001")
        mixes.append((risky / risky.sum()).reindex(cov.index.drop("SYNCASH00001")).fillna(0.0))
    assert (mixes[0] - mixes[1]).abs().max() < 0.05


def test_cheaper_twin_wins():
    """Two funds with identical return and risk: the TER penalty sends all the weight to the cheaper one."""
    isins = ["EXPENSIVE", "CHEAP", "BOND"]
    mu = pd.Series([0.07, 0.07, 0.03], index=isins)
    vols = np.array([0.15, 0.15, 0.05])
    correlation = np.array([[1.0, 1.0, 0.1], [1.0, 1.0, 0.1], [0.1, 0.1, 1.0]])
    cov = pd.DataFrame(correlation * np.outer(vols, vols), index=isins, columns=isins)
    c = no_cardinality(
        pd.DataFrame({"asset_class": ["equity", "equity", "bond"], "sector": [None, None, None],
                      "ter": [0.0060, 0.0005, 0.0010]}, index=isins),
        target_vol=0.10, max_position=1.0, group_max={},
    )
    result = optimize(mu, cov, c, "target_vol")
    assert "EXPENSIVE" not in result.weights
    assert result.weights["CHEAP"] > 0.5


def test_too_few_funds_for_max_position_is_infeasible(mu, cov, selection):
    two = ["IE00B6R52259", "IE00BDBRDM35"]
    c = make_constraints(selection.loc[two], max_position=0.4)
    with pytest.raises(InfeasibleConstraints, match="100%"):
        optimize(mu[two], cov.loc[two, two], c, "target_vol")


def test_max_etfs_times_max_position_below_one_is_infeasible(mu, cov, selection):
    c = make_constraints(selection, max_etfs=2, max_position=0.4)
    with pytest.raises(InfeasibleConstraints, match="max_etfs"):
        optimize(mu, cov, c, "target_vol")


def test_cov_order_is_authoritative(mu, cov, selection):
    c = make_constraints(selection, target_vol=0.10)
    shuffled_mu = mu.sample(frac=1, random_state=3)
    a = optimize(mu, cov, c, "target_vol").weights
    b = optimize(shuffled_mu, cov, c, "target_vol").weights
    pd.testing.assert_series_equal(a.sort_index(), b.sort_index(), atol=1e-6)


# ---------- robustness: bad inputs, solver failures, numerical edges


def test_nan_expected_return_is_insufficient_history(mu, cov, selection):
    holey_mu = mu.copy()
    holey_mu["SYNREIT00001"] = np.nan
    with pytest.raises(InsufficientHistory, match="SYNREIT00001"):
        optimize(holey_mu, cov, make_constraints(selection), "target_vol")


def test_fund_missing_from_mu_is_insufficient_history(mu, cov, selection):
    with pytest.raises(InsufficientHistory, match="SYNGOLD00001"):
        optimize(mu.drop("SYNGOLD00001"), cov, make_constraints(selection), "target_vol")


@pytest.mark.parametrize("strategy", ["target_vol", "min_variance", "max_sharpe", "risk_parity"])
def test_solver_error_becomes_infeasible_constraints(monkeypatch, mu, cov, selection, strategy):
    def broken_solve(self, *args, **kwargs):
        raise cp.error.SolverError("numerical trouble")

    monkeypatch.setattr(cp.Problem, "solve", broken_solve)
    with pytest.raises(InfeasibleConstraints, match="solver failed.*numerical trouble"):
        optimize(mu, cov, no_cardinality(selection), strategy)


def test_solver_stopped_early_is_not_called_infeasible(monkeypatch, mu, cov, selection):
    def stops_early(self, *args, **kwargs):
        self._status = cp.USER_LIMIT

    monkeypatch.setattr(cp.Problem, "solve", stops_early)
    with pytest.raises(InfeasibleConstraints, match="solver stopped early") as error:
        optimize(mu, cov, no_cardinality(selection), "min_variance")
    assert "cannot be met" not in str(error.value)


def test_inaccurate_solution_is_reported_as_a_warning(monkeypatch, mu, cov, selection):
    real_solve = cp.Problem.solve

    def inaccurate_solve(self, *args, **kwargs):
        value = real_solve(self, *args, **kwargs)
        self._status = cp.OPTIMAL_INACCURATE
        return value

    monkeypatch.setattr(cp.Problem, "solve", inaccurate_solve)
    result = optimize(mu, cov, no_cardinality(selection), "min_variance")
    assert any("inaccurate" in warning for warning in result.warnings)


def test_target_a_hair_above_min_variance_falls_back(mu, cov, selection):
    c = no_cardinality(selection)
    min_variance_vol = optimize(mu, cov, c, "min_variance").achieved_vol
    result = optimize(mu, cov, no_cardinality(selection, target_vol=min_variance_vol + 5e-7), "target_vol")
    assert result.achieved_vol == pytest.approx(min_variance_vol, abs=TOL)
    assert any("below the lowest reachable" in warning for warning in result.warnings)


def test_clean_normalises_before_dropping_noise():
    scaled = _clean(pd.Series([10.0, 5e-6], index=["BIG", "NOISE"]))  # 5e-7 of the total: noise
    assert scaled.tolist() == [1.0, 0.0]
    tiny = _clean(pd.Series([4e-7, 4e-7], index=["A", "B"]))  # small scale, equal shares: not noise
    assert tiny.tolist() == pytest.approx([0.5, 0.5])
