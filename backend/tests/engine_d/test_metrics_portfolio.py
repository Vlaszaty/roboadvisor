import math

import numpy as np
import pandas as pd
import pytest

from app.engine import metrics as m

R = pd.Series([0.01, -0.02, 0.03, 0.0, 0.01, -0.01], index=pd.date_range("2020-01-03", periods=6, freq="W-FRI"))


def test_rolling_vol_nan_until_window_filled():
    rv = m.rolling_vol(R, window=4)
    assert rv.index.equals(R.index)
    assert rv.iloc[:3].isna().all()
    assert rv.iloc[3] == pytest.approx(np.std([0.01, -0.02, 0.03, 0.0], ddof=1) * math.sqrt(52))
    assert rv.iloc[5] == pytest.approx(np.std([0.03, 0.0, 0.01, -0.01], ddof=1) * math.sqrt(52))


def test_rolling_sharpe_with_constant_rf():
    rs = m.rolling_sharpe(R, 0.001, window=4)
    assert rs.iloc[:3].isna().all()
    first = [0.01, -0.02, 0.03, 0.0]
    expected = (np.mean(first) - 0.001) * 52 / (np.std(first, ddof=1) * math.sqrt(52))
    assert rs.iloc[3] == pytest.approx(expected)


def test_rolling_sharpe_zero_vol_is_nan_not_inf():
    rs = m.rolling_sharpe(pd.Series([0.01] * 6), window=3)
    assert rs.isna().all()


def test_risk_contribution_diagonal_equal_variance_equals_weights():
    isins = ["A", "B", "C", "D"]
    w = pd.Series(0.25, index=isins)
    cov = pd.DataFrame(0.04 * np.eye(4), index=isins, columns=isins)
    rc = m.risk_contribution(w, cov)
    assert rc.sum() == pytest.approx(1.0)
    assert rc.tolist() == pytest.approx(w.tolist())


def test_risk_contribution_sums_to_one_and_uses_weight_order():
    isins = ["A", "B", "C"]
    cov = pd.DataFrame([[0.04, 0.01, 0.0], [0.01, 0.09, 0.02], [0.0, 0.02, 0.01]], index=isins, columns=isins)
    w = pd.Series({"C": 0.5, "A": 0.3, "B": 0.2})
    rc = m.risk_contribution(w, cov)
    assert list(rc.index) == ["C", "A", "B"]
    assert rc.sum() == pytest.approx(1.0)


def test_ex_ante_two_assets():
    # vols 20% / 10%, corr 0.3 -> cov 0.006; w = 0.6/0.4
    # var = 0.36*0.04 + 0.16*0.01 + 2*0.24*0.006 = 0.01888
    cov = pd.DataFrame([[0.04, 0.006], [0.006, 0.01]], index=["EQ", "BD"], columns=["EQ", "BD"])
    w = pd.Series({"EQ": 0.6, "BD": 0.4})
    mu = pd.Series({"EQ": 0.08, "BD": 0.03, "XX": 0.5})  # extra, unheld isin is ignored
    beta = pd.Series({"EQ": 1.0, "BD": 0.1})
    ter = pd.Series({"EQ": 0.002, "BD": 0.001})
    out = m.ex_ante(w, mu, cov, beta, ter, rf=0.02)
    assert set(out) == {"expected_return", "volatility", "sharpe", "beta", "weighted_ter",
                        "annual_cost_per_10k", "risk_contribution"}
    assert out["expected_return"] == pytest.approx(0.06)
    assert out["volatility"] == pytest.approx(math.sqrt(0.01888))
    assert out["sharpe"] == pytest.approx(0.04 / math.sqrt(0.01888))
    assert out["beta"] == pytest.approx(0.64)
    assert out["weighted_ter"] == pytest.approx(0.0016)
    assert out["annual_cost_per_10k"] == pytest.approx(16.0)
    # Σw = [0.0264, 0.0076]; w*(Σw) = [0.01584, 0.00304]; / 0.01888
    rc = out["risk_contribution"]
    assert rc["EQ"] == pytest.approx(0.01584 / 0.01888)
    assert rc["BD"] == pytest.approx(0.00304 / 0.01888)
    for k in ("expected_return", "volatility", "sharpe", "beta", "weighted_ter", "annual_cost_per_10k"):
        assert isinstance(out[k], float)


def test_ex_ante_nan_ter_counts_as_zero():
    cov = pd.DataFrame([[0.04]], index=["A"], columns=["A"])
    w = pd.Series({"A": 1.0})
    out = m.ex_ante(w, pd.Series({"A": 0.05}), cov, pd.Series({"A": 1.0}), pd.Series({"A": np.nan}), rf=0.0)
    assert out["weighted_ter"] == 0.0


def test_registry_keys_and_signature():
    assert set(m.REGISTRY) == {"cagr", "volatility", "sharpe", "sortino", "max_drawdown",
                               "max_drawdown_duration", "cvar_95", "calmar"}
    rng = np.random.default_rng(3)
    idx = pd.date_range("2015-01-02", periods=300, freq="W-FRI")
    r = pd.Series(rng.normal(0.001, 0.02, 300), index=idx)
    rf = pd.Series(0.0005, index=idx)
    for name, fn in m.REGISTRY.items():
        assert isinstance(fn(r, rf), float), name
    assert m.REGISTRY["sharpe"](r, rf) == pytest.approx(m.sharpe(r, rf))
    assert m.REGISTRY["sortino"](r, rf) == pytest.approx(m.sortino(r, rf))
    assert m.REGISTRY["cvar_95"](r, rf) == pytest.approx(m.cvar(r, 0.95))
    assert m.REGISTRY["max_drawdown_duration"](r, rf) == float(m.max_drawdown_duration(r))
    assert m.REGISTRY["cagr"](r, rf) == pytest.approx(m.cagr(r))
    assert m.REGISTRY["calmar"](r, rf) == pytest.approx(m.calmar(r))


@pytest.mark.parametrize(
    "r",
    [
        pd.Series([], dtype=float),
        pd.Series([np.nan, np.nan]),
        pd.Series([0.01]),
        pd.Series([0.01] * 10),
        pd.Series([0.0] * 10),
    ],
    ids=["empty", "all_nan", "single", "constant", "zeros"],
)
def test_registry_returns_nan_instead_of_raising_on_degenerate_input(r):
    rf = pd.Series(0.0, index=r.index)
    for name, fn in m.REGISTRY.items():
        with np.errstate(all="raise"):
            out = fn(r, rf)
        assert isinstance(out, float), name
    if r.dropna().empty:
        assert all(math.isnan(fn(r, rf)) for fn in m.REGISTRY.values())


def test_rolling_series_keep_input_index_with_nan():
    r = R.copy()
    r.iloc[1] = np.nan
    rf = pd.Series(0.0005, index=R.index[2:])  # shorter rf series is aligned by date
    assert m.rolling_vol(r, window=3).index.equals(r.index)
    assert m.rolling_sharpe(r, rf, window=3).index.equals(r.index)
