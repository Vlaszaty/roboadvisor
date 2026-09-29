# Lane D — Metrics and Downside Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the bodies of `backend/app/engine/metrics.py` (all performance/risk metrics, ex-ante portfolio figures, the backtest `REGISTRY`) and `backend/app/engine/downside.py` (portfolio history, block-bootstrap Monte Carlo, normal-model comparison, stress tests) exactly per the frozen Phase 0 signatures and docstrings.

**Architecture:** Both modules are pure functions over pandas/numpy with no I/O. Metrics take weekly simple-return Series (annualisation factor 52). `downside.simulate` runs a vectorised block bootstrap: for each chunk of paths it builds an `(n_paths × weeks)` index array from random block starts/lengths (wrap-around via modulo), gathers returns, compounds with `np.cumprod`, and measures drawdowns with `np.maximum.accumulate`. Paths are processed in chunks of 500 (float64), so 10 000 paths × 40 years never allocate more than roughly 50–80 MB at once. `normal_comparison` reuses the same path-statistics helper with GBM paths and computes annual-loss probabilities analytically.

**Tech Stack:** Python 3.12, uv, pandas, numpy, scipy (`scipy.stats.norm`), pydantic v2 models from `app.engine.types`, pytest.

**Spec:** `docs/superpowers/specs/2026-09-29-roboadvisor-design.md` (§5.6 metrics, §5.7 downside, §9 config, §10 testing). Builds on `docs/superpowers/plans/2026-09-29-phase0-contracts.md` as merged (git tag `phase0-contracts`).

## Global Constraints

- Python tooling is **uv** only: `uv sync`, `uv add`, `uv run pytest`, `uv run python -m ...`. Python pinned to **3.12**. Never use pip or a hand-made venv.
- Backend port **8740**, frontend port **5740** with Vite `strictPort: true`; Vite proxies `/api` → `http://localhost:8740`.
- All API routes live under `/api`. The API is stateless.
- Engine modules (`app/engine/*`) never import FastAPI, sqlite3 or `app.data`.
- All engine return series are **weekly (W-FRI)**, simple returns, base currency, columns = ISIN. Annualisation factor 52.
- Base currencies: `EUR`, `USD`.
- Drawdowns and losses are **negative numbers** (−0.35 = −35%). Thresholds are positive (0.3 means "−30% or worse").
- No network access in tests.
- Only Phase 0 adds Python/npm dependencies. Lanes that need one must escalate.
- Contract files created here (`config.py` structure, `engine/types.py`, `engine/errors.py`, `api/schemas.py`, `data/schema.sql`, route signatures, stub signatures) are frozen after Phase 0; changes go through the integrator.

**Lane D rules (in addition):**
- Lane D owns only `backend/app/engine/metrics.py`, `backend/app/engine/downside.py` and `backend/tests/engine_d/**`. Do not edit any other file. If a contract looks wrong, stop and escalate to the integrator.
- Function names, parameters, defaults and return types of the Phase 0 stubs are frozen. Private helpers (leading underscore) may be added.
- Available libraries: pandas, numpy, scipy. Do not add dependencies.
- All commands run from `backend/`: `cd backend && uv run pytest ...`.

## File structure

| File | Responsibility |
|---|---|
| `backend/app/engine/metrics.py` | Return-series metrics (cagr … beta), drawdown/rolling series, ex-ante portfolio figures, `REGISTRY` |
| `backend/app/engine/downside.py` | `portfolio_history`, `stress`, bootstrap `simulate`, `normal_comparison` + private path helpers |
| `backend/tests/engine_d/__init__.py` | empty |
| `backend/tests/engine_d/test_metrics.py` | Task 1: point metrics on hand-made series |
| `backend/tests/engine_d/test_metrics_portfolio.py` | Task 2: rolling series, risk contribution, ex-ante, registry |
| `backend/tests/engine_d/test_downside_history.py` | Task 3: portfolio history and stress |
| `backend/tests/engine_d/test_simulate.py` | Task 4: bootstrap indices and simulate |
| `backend/tests/engine_d/test_normal_comparison.py` | Task 5: analytic formula and Monte Carlo vs analytic |

Fixtures used (from Phase 0 `backend/tests/conftest.py`): `weekly_eur`, `weekly_usd` (session-scoped reference weekly returns from `SyntheticData`, full history 2005–2025, columns = ISIN).

---

### Task 1: Point metrics on a return series

**Files:**
- Modify: `backend/app/engine/metrics.py` (replace the stubs for `cagr, volatility, sharpe, sortino, max_drawdown, max_drawdown_duration, cvar, calmar, beta, drawdown_series`)
- Create: `backend/tests/engine_d/__init__.py` (empty), `backend/tests/engine_d/test_metrics.py`

**Interfaces:**
- Consumes: nothing beyond pandas/numpy.
- Produces (frozen Phase 0 signatures):
  - `cagr(r: pd.Series, periods: int = 52) -> float`
  - `volatility(r: pd.Series, periods: int = 52) -> float` (sample std, ddof=1, × √periods)
  - `sharpe(r: pd.Series, rf: pd.Series | float = 0.0, periods: int = 52) -> float` (mean weekly excess × periods / volatility(r); NaN if vol ≈ 0)
  - `sortino(r: pd.Series, rf: pd.Series | float = 0.0, periods: int = 52) -> float` (mean excess × periods / (√mean(min(excess,0)²) × √periods))
  - `max_drawdown(r: pd.Series) -> float` (≤ 0)
  - `max_drawdown_duration(r: pd.Series) -> int` (weeks)
  - `cvar(r: pd.Series, level: float = 0.95) -> float` (≤ 0 for loss tails)
  - `calmar(r: pd.Series, periods: int = 52) -> float` (cagr / |max_drawdown|; NaN if no drawdown)
  - `beta(r: pd.Series, benchmark: pd.Series) -> float`
  - `drawdown_series(r: pd.Series) -> pd.Series` (same index as `r.dropna()`, values ≤ 0)
  - private `_excess(r, rf) -> pd.Series`, constant `_EPS = 1e-12`
  - All functions drop NaN from `r` first.

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_d/__init__.py`: empty file.

`backend/tests/engine_d/test_metrics.py`:

```python
import math

import numpy as np
import pandas as pd
import pytest

from app.engine import metrics as m

# Cumulative value 1.1, 0.55, 0.66, 0.726; peak 1.1 -> drawdowns 0, -0.5, -0.4, -0.34 (never recovers)
HAND = pd.Series([0.1, -0.5, 0.2, 0.1], index=pd.date_range("2020-01-03", periods=4, freq="W-FRI"))


def test_drawdown_series_hand_example():
    dd = m.drawdown_series(HAND)
    assert dd.index.equals(HAND.index)
    assert dd.tolist() == pytest.approx([0.0, -0.5, -0.4, -0.34])


def test_max_drawdown_hand_example():
    assert m.max_drawdown(HAND) == pytest.approx(-0.5)


def test_max_drawdown_counts_start_value_as_peak():
    # value 0.9 then 0.81: drawdown measured from the starting value 1.0
    assert m.max_drawdown(pd.Series([-0.1, -0.1])) == pytest.approx(-0.19)


def test_max_drawdown_is_zero_for_rising_series():
    assert m.max_drawdown(pd.Series([0.01, 0.02, 0.0, 0.03])) == 0.0


def test_max_drawdown_duration_unrecovered():
    assert m.max_drawdown_duration(HAND) == 3  # weeks 2, 3, 4 below the 1.1 peak, never recovered


def test_max_drawdown_duration_recovered_episode():
    # values 0.9, 1.08, 1.026, 0.9747, 1.07217, 1.2866: below-peak runs of 1 and 3 weeks
    r = pd.Series([-0.1, 0.2, -0.05, -0.05, 0.1, 0.2])
    assert m.max_drawdown_duration(r) == 3


def test_max_drawdown_duration_unrecovered_tail_is_longest():
    r = pd.Series([-0.1, 0.2, -0.01, -0.01, -0.01, -0.01])
    assert m.max_drawdown_duration(r) == 4


def test_max_drawdown_duration_zero_for_rising_series():
    assert m.max_drawdown_duration(pd.Series([0.01, 0.02, 0.03])) == 0


def test_cagr_constant_weekly_return():
    r = pd.Series([0.001] * 104)
    assert m.cagr(r) == pytest.approx(1.001**52 - 1)


def test_cagr_hand_example():
    assert m.cagr(HAND) == pytest.approx(0.726 ** (52 / 4) - 1)


def test_cagr_ignores_nan():
    assert m.cagr(pd.Series([0.001, np.nan, 0.001])) == pytest.approx(1.001**52 - 1)


def test_volatility_of_constant_series_is_zero():
    assert m.volatility(pd.Series([0.01] * 20)) == pytest.approx(0.0, abs=1e-12)


def test_volatility_is_annualised_sample_std():
    r = pd.Series([0.02, 0.0] * 26)
    assert m.volatility(r) == pytest.approx(0.01 * math.sqrt(52 / 51) * math.sqrt(52))


def test_sharpe_with_constant_rf():
    # mean 0.01, sample std 0.01*sqrt(52/51); excess mean 0.009 -> 0.009*52 / (0.01*sqrt(52/51)*sqrt(52)) = 0.9*sqrt(51)
    r = pd.Series([0.02, 0.0] * 26, index=pd.date_range("2020-01-03", periods=52, freq="W-FRI"))
    assert m.sharpe(r, 0.001) == pytest.approx(0.9 * math.sqrt(51))
    rf = pd.Series(0.001, index=r.index)
    assert m.sharpe(r, rf) == pytest.approx(0.9 * math.sqrt(51))


def test_sharpe_is_nan_for_zero_volatility():
    assert math.isnan(m.sharpe(pd.Series([0.01] * 10)))


def test_sortino_hand_example():
    # mean 0.01; downside deviation sqrt((0.02^2 + 0.02^2) / 4) = sqrt(0.0002)
    # sortino = 0.01*52 / (sqrt(0.0002)*sqrt(52)) = sqrt(26)
    r = pd.Series([0.04, -0.02, 0.04, -0.02])
    assert m.sortino(r) == pytest.approx(math.sqrt(26))


def test_sortino_only_penalises_downside():
    # same mean (0.01) and same losing weeks; b has much more upside dispersion
    a = pd.Series([0.04, -0.02, 0.04, -0.02])
    b = pd.Series([0.08, -0.02, 0.00, -0.02])
    assert m.sortino(a) == pytest.approx(m.sortino(b))
    assert m.sharpe(b) < m.sharpe(a)


def test_sortino_nan_without_downside():
    assert math.isnan(m.sortino(pd.Series([0.01, 0.02, 0.03])))


def test_cvar_on_known_values():
    values = np.arange(-50, 50) / 100  # -0.50 .. 0.49, 100 values
    r = pd.Series(np.random.default_rng(0).permutation(values))
    # worst 5% = -0.50, -0.49, -0.48, -0.47, -0.46
    assert m.cvar(r, 0.95) == pytest.approx(-0.48)
    # worst 10% = -0.50 .. -0.41
    assert m.cvar(r, 0.90) == pytest.approx(-0.455)


def test_cvar_uses_at_least_one_observation():
    assert m.cvar(pd.Series([0.01, -0.03, 0.02]), 0.95) == pytest.approx(-0.03)


def test_calmar_is_cagr_over_abs_max_drawdown():
    assert m.calmar(HAND) == pytest.approx(m.cagr(HAND) / 0.5)


def test_calmar_nan_without_drawdown():
    assert math.isnan(m.calmar(pd.Series([0.01, 0.02])))


def test_beta_of_double_series_is_two():
    x = pd.Series(np.random.default_rng(1).normal(0, 0.02, 200))
    assert m.beta(2 * x, x) == pytest.approx(2.0)


def test_beta_aligns_and_drops_nan():
    x = pd.Series(np.random.default_rng(2).normal(0, 0.02, 200))
    y = 2 * x
    y.iloc[:10] = np.nan
    assert m.beta(y, x) == pytest.approx(2.0)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_d/test_metrics.py -v`
Expected: FAIL — every test errors with `NotImplementedError: Lane D`.

- [ ] **Step 3: Implement the point metrics**

Replace the whole content of `backend/app/engine/metrics.py` with the following (the Task 2 functions stay exactly as the Phase 0 stubs for now):

```python
"""Lane D. Spec §5.6. Inputs are weekly simple returns; annualisation uses periods=52.

Sign conventions: max_drawdown and cvar are negative numbers (losses).
"""

from typing import Callable

import numpy as np
import pandas as pd

_EPS = 1e-12  # volatilities / drawdowns smaller than this are floating-point noise, treated as zero
_NAN = float("nan")


def _excess(r: pd.Series, rf: pd.Series | float) -> pd.Series:
    """Weekly excess returns r - rf on the non-NaN weeks of r (rf Series is aligned by date)."""
    r = r.dropna()
    if isinstance(rf, pd.Series):
        rf = rf.reindex(r.index)
    return (r - rf).dropna()


def cagr(r: pd.Series, periods: int = 52) -> float:
    r = r.dropna()
    if r.empty:
        return _NAN
    return float((1 + r).prod() ** (periods / len(r)) - 1)


def volatility(r: pd.Series, periods: int = 52) -> float:
    return float(r.dropna().std(ddof=1) * np.sqrt(periods))


def sharpe(r: pd.Series, rf: pd.Series | float = 0.0, periods: int = 52) -> float:
    """Annualised mean excess return / annualised vol. rf: weekly rate series aligned to r, or a constant weekly rate."""
    ex = _excess(r, rf)
    vol = volatility(r.loc[ex.index], periods)
    if not vol > _EPS:
        return _NAN
    return float(ex.mean() * periods / vol)


def sortino(r: pd.Series, rf: pd.Series | float = 0.0, periods: int = 52) -> float:
    ex = _excess(r, rf)
    downside = float(np.sqrt((np.minimum(ex, 0.0) ** 2).mean()) * np.sqrt(periods))
    if not downside > _EPS:
        return _NAN
    return float(ex.mean() * periods / downside)


def drawdown_series(r: pd.Series) -> pd.Series:
    r = r.dropna()
    value = (1 + r).cumprod()
    peak = value.cummax().clip(lower=1.0)  # the starting value 1.0 counts as a peak
    return value / peak - 1


def max_drawdown(r: pd.Series) -> float:
    """Most negative peak-to-trough decline of the cumulative value (starting value 1 counts as a peak)."""
    dd = drawdown_series(r)
    return float(min(dd.min(), 0.0)) if not dd.empty else _NAN


def max_drawdown_duration(r: pd.Series) -> int:
    """Longest number of weeks spent below a previous peak (unrecovered drawdowns count to the end)."""
    longest = run = 0
    for below in drawdown_series(r).to_numpy() < -_EPS:
        run = run + 1 if below else 0
        longest = max(longest, run)
    return longest


def cvar(r: pd.Series, level: float = 0.95) -> float:
    """Mean of the worst (1 - level) share of weekly returns (negative number)."""
    x = np.sort(r.dropna().to_numpy(dtype=float))
    if len(x) == 0:
        return _NAN
    # round first: 100 * (1 - 0.95) is 5.000000000000004 and 100 * (1 - 0.90) is 9.999999999999998 in floating
    # point; they must count as 5 and 10 observations
    k = max(1, int(np.floor(round(len(x) * (1 - level), 9))))
    return float(x[:k].mean())


def calmar(r: pd.Series, periods: int = 52) -> float:
    mdd = max_drawdown(r)
    if not mdd < -_EPS:
        return _NAN
    return cagr(r, periods) / abs(mdd)


def beta(r: pd.Series, benchmark: pd.Series) -> float:
    both = pd.concat([r, benchmark], axis=1).dropna()
    var = both.iloc[:, 1].var()
    if not var > 0:
        return _NAN
    return float(both.iloc[:, 0].cov(both.iloc[:, 1]) / var)


def rolling_vol(r: pd.Series, window: int = 156, periods: int = 52) -> pd.Series: raise NotImplementedError("Lane D")
def rolling_sharpe(r: pd.Series, rf: pd.Series | float = 0.0, window: int = 156, periods: int = 52) -> pd.Series:
    raise NotImplementedError("Lane D")
def risk_contribution(weights: pd.Series, cov: pd.DataFrame) -> pd.Series:
    """w_i * (Σw)_i / w'Σw; sums to 1."""
    raise NotImplementedError("Lane D")
def ex_ante(weights: pd.Series, mu: pd.Series, cov: pd.DataFrame, beta: pd.Series, ter: pd.Series, rf: float) -> dict:
    """{'expected_return', 'volatility', 'sharpe' ((er - rf) / vol), 'beta', 'weighted_ter',
    'annual_cost_per_10k' (weighted_ter * 10_000), 'risk_contribution': pd.Series}."""
    raise NotImplementedError("Lane D")


# Metrics reported in backtests. Each takes (weekly returns, weekly rf series) -> float.
REGISTRY: dict[str, Callable[[pd.Series, pd.Series], float]] = {}
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/engine_d/test_metrics.py -v`
Expected: PASS (24 tests).

Also run: `cd backend && uv run pytest tests/test_contract.py -v`
Expected: PASS (all stub names still exist as functions).

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/metrics.py backend/tests/engine_d/__init__.py backend/tests/engine_d/test_metrics.py
git commit -m "feat(metrics): cagr, volatility, sharpe, sortino, drawdowns, cvar, calmar, beta"
```

---

### Task 2: Rolling series, risk contribution, ex-ante figures and REGISTRY

**Files:**
- Modify: `backend/app/engine/metrics.py` (replace the four remaining stubs and the empty `REGISTRY`)
- Create: `backend/tests/engine_d/test_metrics_portfolio.py`

**Interfaces:**
- Consumes (Task 1): `cagr, volatility, sharpe, sortino, max_drawdown, max_drawdown_duration, cvar, calmar`, `_excess`.
- Produces:
  - `rolling_vol(r, window=156, periods=52) -> pd.Series` — same index as `r`, NaN for the first `window - 1` weeks.
  - `rolling_sharpe(r, rf=0.0, window=156, periods=52) -> pd.Series` — rolling mean excess × periods / rolling vol; NaN (not inf) where vol is 0.
  - `risk_contribution(weights, cov) -> pd.Series` indexed like `weights`, sums to 1.
  - `ex_ante(weights, mu, cov, beta, ter, rf) -> dict` with keys `expected_return, volatility, sharpe, beta, weighted_ter, annual_cost_per_10k` (floats) and `risk_contribution` (Series). `mu`, `beta`, `ter` are aligned to `weights.index`; NaN TER counts as 0.
  - `REGISTRY` keys exactly: `cagr, volatility, sharpe, sortino, max_drawdown, max_drawdown_duration, cvar_95, calmar`; every value is `(r: pd.Series, rf: pd.Series) -> float`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_d/test_metrics_portfolio.py`:

```python
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_d/test_metrics_portfolio.py -v`
Expected: FAIL — rolling/risk/ex-ante tests with `NotImplementedError: Lane D`; `test_registry_keys_and_signature` with `AssertionError` (empty registry).

- [ ] **Step 3: Implement**

In `backend/app/engine/metrics.py`, replace everything from the line `def rolling_vol(` to the end of the file with:

```python
def rolling_vol(r: pd.Series, window: int = 156, periods: int = 52) -> pd.Series:
    return r.rolling(window).std(ddof=1) * np.sqrt(periods)


def rolling_sharpe(r: pd.Series, rf: pd.Series | float = 0.0, window: int = 156, periods: int = 52) -> pd.Series:
    if isinstance(rf, pd.Series):
        rf = rf.reindex(r.index)
    mean_excess = (r - rf).rolling(window).mean() * periods
    vol = rolling_vol(r, window, periods)
    return (mean_excess / vol.where(vol > _EPS)).replace([np.inf, -np.inf], np.nan)


def risk_contribution(weights: pd.Series, cov: pd.DataFrame) -> pd.Series:
    """w_i * (Σw)_i / w'Σw; sums to 1."""
    sigma = cov.loc[weights.index, weights.index]
    marginal = sigma @ weights
    return weights * marginal / float(weights @ marginal)


def ex_ante(weights: pd.Series, mu: pd.Series, cov: pd.DataFrame, beta: pd.Series, ter: pd.Series, rf: float) -> dict:
    """{'expected_return', 'volatility', 'sharpe' ((er - rf) / vol), 'beta', 'weighted_ter',
    'annual_cost_per_10k' (weighted_ter * 10_000), 'risk_contribution': pd.Series}."""
    w = weights
    sigma = cov.loc[w.index, w.index]
    er = float(w @ mu.reindex(w.index))
    vol = float(np.sqrt(w @ sigma @ w))
    weighted_ter = float(w @ ter.reindex(w.index).fillna(0.0))
    return {
        "expected_return": er,
        "volatility": vol,
        "sharpe": (er - rf) / vol if vol > _EPS else _NAN,
        "beta": float(w @ beta.reindex(w.index)),
        "weighted_ter": weighted_ter,
        "annual_cost_per_10k": weighted_ter * 10_000,
        "risk_contribution": risk_contribution(w, cov),
    }


# Metrics reported in backtests. Each takes (weekly returns, weekly rf series) -> float.
# Adding an indicator = one function above + one line here.
REGISTRY: dict[str, Callable[[pd.Series, pd.Series], float]] = {
    "cagr": lambda r, rf: cagr(r),
    "volatility": lambda r, rf: volatility(r),
    "sharpe": lambda r, rf: sharpe(r, rf),
    "sortino": lambda r, rf: sortino(r, rf),
    "max_drawdown": lambda r, rf: max_drawdown(r),
    "max_drawdown_duration": lambda r, rf: float(max_drawdown_duration(r)),
    "cvar_95": lambda r, rf: cvar(r, 0.95),
    "calmar": lambda r, rf: calmar(r),
}
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/engine_d/test_metrics.py tests/engine_d/test_metrics_portfolio.py tests/test_contract.py -v`
Expected: PASS (24 + 8 + 2 = 34 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/metrics.py backend/tests/engine_d/test_metrics_portfolio.py
git commit -m "feat(metrics): rolling series, risk contribution, ex-ante figures and registry"
```

---

### Task 3: Portfolio history and stress tests

**Files:**
- Modify: `backend/app/engine/downside.py` (full rewrite; `simulate` and `normal_comparison` stay stubs until Tasks 4–5)
- Create: `backend/tests/engine_d/test_downside_history.py`

**Interfaces:**
- Consumes: `app.engine.types.StressResult`, `app.config.STRESS_EVENTS`.
- Produces:
  - `portfolio_history(returns: pd.DataFrame, weights: pd.Series, proxied: dict[str, tuple[pd.Timestamp, pd.Timestamp]]) -> tuple[pd.Series, pd.Series]` — (weekly portfolio return named `"portfolio"`, bool mask named `"proxied"`), same index; only weeks where every fund with non-zero weight has data; funds with weight 0 are ignored.
  - `stress(port_returns: pd.Series, proxied_mask: pd.Series, events: list[tuple[str, str, str]] = config.STRESS_EVENTS) -> list[StressResult]` — one result per event, in order. Weeks inside a window = index dates in `[start, end]`. `loss=None, proxied=False` when the history is empty, starts after the window start (first index date > start) or has no week in the window.
  - module constants `PERIODS = config.PERIODS_PER_YEAR`, `CHUNK_PATHS = 500` (used in Tasks 4–5).

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_d/test_downside_history.py`:

```python
from datetime import date

import numpy as np
import pandas as pd
import pytest

from app import config
from app.engine.downside import portfolio_history, stress

IDX = pd.date_range("2020-01-03", periods=5, freq="W-FRI")
RET = pd.DataFrame(
    {
        "A": [0.01, 0.02, -0.01, 0.03, 0.0],
        "B": [np.nan, 0.05, 0.01, -0.02, 0.01],
        "C": [np.nan] * 5,  # not held (weight 0) -> must not remove weeks
    },
    index=IDX,
)
W = pd.Series({"A": 0.6, "B": 0.4, "C": 0.0})


def test_portfolio_history_drops_weeks_with_missing_held_fund():
    port, mask = portfolio_history(RET, W, {})
    assert port.index.equals(IDX[1:])
    assert port.tolist() == pytest.approx([0.032, -0.002, 0.010, 0.004])
    assert mask.index.equals(port.index)
    assert not mask.any()


def test_portfolio_history_marks_proxied_weeks():
    proxied = {"B": (IDX[1], IDX[2]), "C": (IDX[0], IDX[4])}  # C is not held -> ignored
    _, mask = portfolio_history(RET, W, proxied)
    assert mask.dtype == bool
    assert mask.tolist() == [True, True, False, False]


# ---- stress ----

EQ, BD = "IE00B6R52259", "IE00BDBRDM35"


@pytest.fixture(scope="module")
def port_6040(weekly_eur):
    port, mask = portfolio_history(weekly_eur, pd.Series({EQ: 0.6, BD: 0.4}), {})
    return port, mask


def test_stress_default_events_on_synthetic_6040(port_6040):
    port, mask = port_6040
    out = stress(port, mask)
    assert [s.event for s in out] == [e[0] for e in config.STRESS_EVENTS]
    gfc, covid, rates = out
    assert gfc.start == date(2007, 10, 9) and gfc.end == date(2009, 3, 9)
    expected_gfc = float((1 + port.loc["2007-10-09":"2009-03-09"]).prod() - 1)
    assert gfc.loss == pytest.approx(expected_gfc)
    # synthetic equity factor loses 1.2%/day from 2020-02-20; 60% equity -> about -13%
    assert covid.loss < -0.03
    assert rates.loss is not None
    assert not any(s.proxied for s in out)


def test_stress_crash_window_is_clearly_negative(weekly_usd):
    # the fixture's GFC shock (-0.3%/day on the equity factor) runs 2008-09-15..2009-03-09
    port, mask = portfolio_history(weekly_usd, pd.Series({"US4642882579": 1.0}), {})
    (crash,) = stress(port, mask, [("crash", "2008-09-13", "2009-03-09")])
    assert crash.loss < -0.15


def test_stress_none_when_history_starts_after_event_start(port_6040):
    port, mask = port_6040
    late = port.loc["2010-01-01":]
    gfc, covid, rates = stress(late, mask.loc[late.index])
    assert gfc.loss is None and gfc.proxied is False
    assert covid.loss is not None and rates.loss is not None


def test_stress_proxied_flag(port_6040):
    port, _ = port_6040
    mask = pd.Series(False, index=port.index)
    mask.loc["2020-01-01":"2020-12-31"] = True
    gfc, covid, rates = stress(port, mask)
    assert covid.proxied is True
    assert gfc.proxied is False and rates.proxied is False


def test_stress_none_when_history_ends_before_window(port_6040):
    port, mask = port_6040
    early = port.loc[:"2015-12-31"]
    _, covid, _ = stress(early, mask.loc[early.index])
    assert covid.loss is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_d/test_downside_history.py -v`
Expected: FAIL — every test errors with `NotImplementedError: Lane D`.

- [ ] **Step 3: Implement**

Replace the whole content of `backend/app/engine/downside.py` with (imports for Tasks 4–5 are included now so later tasks only replace function bodies):

```python
"""Lane D. Spec §5.7."""

from collections.abc import Iterable, Iterator

import numpy as np
import pandas as pd
from scipy.stats import norm

from app import config
from app.engine.errors import InvalidSettings, InsufficientHistory
from app.engine.types import FanPoint, NormalComparison, ProbabilityPoint, SimulationResult, StressResult

PERIODS = config.PERIODS_PER_YEAR
# Monte Carlo paths are processed in chunks of this many paths (float64). 500 paths x 40 years x 52 weeks
# = ~1M cells per array (8 MB), so a 10k-path, 40-year run stays well under 100 MB peak memory.
CHUNK_PATHS = 500


def portfolio_history(
    returns: pd.DataFrame, weights: pd.Series, proxied: dict[str, tuple[pd.Timestamp, pd.Timestamp]]
) -> tuple[pd.Series, pd.Series]:
    """Weekly fixed-weight portfolio returns (weights reset every week) over weeks where every held fund has data.
    Second value: bool Series on the same index, True where any held fund's return came from its proxy."""
    held = weights[weights != 0]
    sub = returns[list(held.index)].dropna(how="any")
    port = sub.mul(held, axis=1).sum(axis=1).rename("portfolio")
    mask = pd.Series(False, index=port.index, name="proxied")
    for isin in held.index:
        if isin in proxied:
            start, end = proxied[isin]
            mask |= (port.index >= pd.Timestamp(start)) & (port.index <= pd.Timestamp(end))
    return port, mask


def simulate(
    port_returns: pd.Series,
    expected_return: float,
    horizon_years: int,
    thresholds: list[float],
    n_paths: int,
    block_weeks: tuple[int, int] = config.BLOCK_WEEKS,
    seed: int | None = config.MC_SEED,
) -> SimulationResult:
    """Stationary block bootstrap of weekly portfolio returns.

    Blocks: random start, integer length uniform in [block_weeks[0], block_weeks[1]], wrapping around the history.
    Returns are demeaned, then shifted by (1 + expected_return) ** (1/52) - 1 so the mean matches the CAPM expectation.
    Paths: 52 * horizon_years weeks, value starts at 1.0.
    drawdown_probs[t]: P(min over path of value/running_peak - 1 <= -t) (start value counts as a peak).
    annual_loss_probs[t]: P(any of the horizon's consecutive 52-week years has return <= -t).
    p_below_invested: P(final value < 1). fan: year 0..horizon_years, percentiles config.FAN_PERCENTILES of value.
    Deterministic for a given seed.
    """
    raise NotImplementedError("Lane D")


def normal_comparison(
    mu: float, sigma: float, horizon_years: int, thresholds: list[float], n_paths: int, seed: int | None = config.MC_SEED
) -> NormalComparison:
    """Same probabilities under a normal model (teaching comparison).
    Annual loss: yearly log return ~ N(ln(1+mu) - sigma^2/2, sigma); p = P(year return <= -t);
      P(any year over horizon) = 1 - (1 - p) ** horizon_years.
    Drawdown: simulated GBM with weekly steps using the same parameters."""
    raise NotImplementedError("Lane D")


def stress(
    port_returns: pd.Series, proxied_mask: pd.Series, events: list[tuple[str, str, str]] = config.STRESS_EVENTS
) -> list[StressResult]:
    """Cumulative return over each (name, start, end) window: prod(1 + r) - 1 of the weeks inside it.
    loss=None if the history starts after the window start. proxied=True if any week in the window is proxied."""
    r = port_returns.dropna()
    out: list[StressResult] = []
    for name, start, end in events:
        s, e = pd.Timestamp(start), pd.Timestamp(end)
        window = r.loc[s:e]
        if r.empty or r.index[0] > s or window.empty:
            out.append(StressResult(event=name, start=s.date(), end=e.date(), loss=None, proxied=False))
            continue
        proxied = bool(proxied_mask.reindex(window.index, fill_value=False).astype(bool).any())
        loss = float((1 + window).prod() - 1)
        out.append(StressResult(event=name, start=s.date(), end=e.date(), loss=loss, proxied=proxied))
    return out
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/engine_d/test_downside_history.py -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/downside.py backend/tests/engine_d/test_downside_history.py
git commit -m "feat(downside): portfolio history and stress-event losses"
```

---

### Task 4: Vectorised block bootstrap and `simulate`

**Files:**
- Modify: `backend/app/engine/downside.py` (replace the `simulate` stub; add private helpers directly above it)
- Create: `backend/tests/engine_d/test_simulate.py`

**Interfaces:**
- Consumes (Task 3): `PERIODS`, `CHUNK_PATHS`, imports already in the module.
- Produces:
  - `_block_indices(n_hist: int, n_paths: int, n_weeks: int, block_weeks: tuple[int, int], rng: np.random.Generator) -> np.ndarray` — int array `(n_paths, n_weeks)` of history positions; consecutive blocks of length uniform in `[lo, hi]`, each starting at a uniform random position, wrapping modulo `n_hist`.
  - `_chunk_sizes(n_paths: int) -> Iterator[int]` — chunk sizes of at most `CHUNK_PATHS` summing to `n_paths`.
  - `_path_stats(chunks: Iterable[np.ndarray], horizon_years: int) -> tuple[np.ndarray, np.ndarray]` — from chunks of weekly simple returns `(m, 52*H)`: max drawdown per path `(n,)` (≤ 0, start value counts as a peak) and value at each year boundary `(n, H+1)` with column 0 = 1.0 (year y = value after week 52·y).
  - `_probabilities(values: np.ndarray, thresholds: list[float]) -> list[ProbabilityPoint]` — P(values ≤ −t).
  - `simulate(...)` per the frozen docstring. Raises `InvalidSettings` if `block_weeks` is not `1 <= lo <= hi`, `horizon_years < 1` or `n_paths < 1`; raises `InsufficientHistory` if `port_returns` has no non-NaN value.

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_d/test_simulate.py`:

```python
import numpy as np
import pandas as pd
import pytest

from app.engine.downside import _block_indices, simulate
from app.engine.errors import InvalidSettings, InsufficientHistory


def _history(n: int, mean: float = 0.001, sd: float = 0.02, seed: int = 0) -> pd.Series:
    idx = pd.date_range("1990-01-05", periods=n, freq="W-FRI")
    return pd.Series(np.random.default_rng(seed).normal(mean, sd, n), index=idx)


def _runs(row_continues: np.ndarray, n_weeks: int) -> np.ndarray:
    breaks = np.flatnonzero(~row_continues) + 1  # positions where a new block starts
    return np.diff(np.concatenate([[0], breaks, [n_weeks]]))


def test_block_indices_fixed_length_blocks_wrap_around():
    idx = _block_indices(n_hist=50, n_paths=40, n_weeks=200, block_weeks=(5, 5), rng=np.random.default_rng(0))
    assert idx.shape == (40, 200)
    assert idx.min() >= 0 and idx.max() < 50
    step = np.diff(idx, axis=1)
    continues = (step == 1) | (step == -49)  # -49 = wrap from position 49 back to 0
    assert (step == -49).any()
    for row in continues:
        runs = _runs(row, 200)
        # every completed run is a whole number of 5-week blocks (two blocks can join by chance)
        assert (runs[:-1] % 5 == 0).all()


def test_block_indices_variable_lengths_at_least_minimum():
    idx = _block_indices(n_hist=1000, n_paths=30, n_weeks=520, block_weeks=(4, 13), rng=np.random.default_rng(1))
    step = np.diff(idx, axis=1)
    continues = (step == 1) | (step == -999)
    n_breaks = 0
    for row in continues:
        runs = _runs(row, 520)
        assert (runs[:-1] >= 4).all()
        n_breaks += len(runs) - 1
    # mean block length 8.5 -> about 60 blocks per path; far more than 1
    assert n_breaks > 30 * 20


def test_constant_history_gives_exact_expected_growth():
    # a constant history demeans to 0, then every week earns exactly (1.05)^(1/52) - 1
    hist = pd.Series(0.002, index=pd.date_range("2000-01-07", periods=300, freq="W-FRI"))
    res = simulate(hist, 0.05, 3, [0.1, 0.2], n_paths=200, seed=1)
    assert [p.year for p in res.fan] == [0, 1, 2, 3]
    for p in res.fan:
        for v in (p.p5, p.p25, p.p50, p.p75, p.p95):
            assert v == pytest.approx(1.05**p.year, rel=1e-9)
    assert res.p_below_invested == 0.0
    assert all(p.probability == 0.0 for p in res.drawdown_probs + res.annual_loss_probs)


def test_simulate_is_deterministic_for_a_seed():
    hist = _history(520)
    a = simulate(hist, 0.05, 5, [0.1, 0.2, 0.3], n_paths=1000, seed=3)
    b = simulate(hist, 0.05, 5, [0.1, 0.2, 0.3], n_paths=1000, seed=3)
    c = simulate(hist, 0.05, 5, [0.1, 0.2, 0.3], n_paths=1000, seed=4)
    assert a == b
    assert a != c


def test_simulate_output_shape_and_ordering():
    hist = _history(780, sd=0.025)
    thresholds = [0.1, 0.2, 0.3, 0.4]
    res = simulate(hist, 0.06, 10, thresholds, n_paths=2000, seed=5)
    assert len(res.fan) == 11
    assert res.fan[0].model_dump() == {"year": 0, "p5": 1.0, "p25": 1.0, "p50": 1.0, "p75": 1.0, "p95": 1.0}
    for p in res.fan:
        assert p.p5 <= p.p25 <= p.p50 <= p.p75 <= p.p95
    for probs in (res.drawdown_probs, res.annual_loss_probs):
        assert [p.threshold for p in probs] == thresholds
        values = [p.probability for p in probs]
        assert all(0.0 <= v <= 1.0 for v in values)
        assert values == sorted(values, reverse=True)  # decreasing in threshold
    assert 0.0 <= res.p_below_invested <= 1.0
    # any 10-year path with a -10% calendar-year loss also has a drawdown of at least 10%
    assert res.drawdown_probs[0].probability >= res.annual_loss_probs[0].probability


def test_simulate_median_log_growth_matches_expected_return():
    # history mean (0.3%/week) is replaced by the CAPM expectation (6%/year): median growth
    # ≈ exp(H * (ln(1.06) - sigma^2 / 2)) with sigma = annualised history volatility (15%)
    sigma = 0.15
    hist = _history(52 * 200, mean=0.003, sd=sigma / np.sqrt(52), seed=11)
    res = simulate(hist, 0.06, 10, [0.3], n_paths=4000, seed=2)
    expected_median = np.exp(10 * (np.log(1.06) - sigma**2 / 2))
    assert res.fan[-1].p50 == pytest.approx(expected_median, rel=0.05)


def test_simulate_large_run_is_feasible():
    res = simulate(_history(52 * 20), 0.05, 40, [0.3, 0.4, 0.5], n_paths=10_000, seed=1)
    assert len(res.fan) == 41


def test_simulate_rejects_bad_inputs():
    hist = _history(100)
    with pytest.raises(InvalidSettings):
        simulate(hist, 0.05, 5, [0.3], n_paths=100, block_weeks=(10, 4))
    with pytest.raises(InvalidSettings):
        simulate(hist, 0.05, 0, [0.3], n_paths=100)
    with pytest.raises(InsufficientHistory):
        simulate(pd.Series([np.nan, np.nan]), 0.05, 5, [0.3], n_paths=100)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_d/test_simulate.py -v`
Expected: FAIL — collection error `ImportError: cannot import name '_block_indices' from 'app.engine.downside'`.

- [ ] **Step 3: Implement**

In `backend/app/engine/downside.py`, replace the entire `def simulate(...)` stub (signature, docstring and `raise NotImplementedError("Lane D")`) with:

```python
def _block_indices(
    n_hist: int, n_paths: int, n_weeks: int, block_weeks: tuple[int, int], rng: np.random.Generator
) -> np.ndarray:
    """History positions (n_paths, n_weeks) built from random blocks, fully vectorised.

    Each path is a sequence of blocks; block j starts at history position starts[j] and lasts lengths[j] weeks.
    offsets[j] = first path week of block j. A 1 is marked at every block's first path week; the cumulative sum
    of the marks gives, for every path week, the block it belongs to. Positions wrap around the history.
    """
    lo, hi = block_weeks
    n_blocks = -(-n_weeks // lo)  # ceil: enough blocks even if all have the minimum length
    starts = rng.integers(0, n_hist, size=(n_paths, n_blocks))
    lengths = rng.integers(lo, hi + 1, size=(n_paths, n_blocks))
    offsets = np.cumsum(lengths, axis=1) - lengths  # offsets[:, 0] == 0
    marks = np.zeros((n_paths, n_weeks), dtype=np.int32)
    rows, cols = np.nonzero(offsets < n_weeks)
    marks[rows, offsets[rows, cols]] = 1
    block = np.cumsum(marks, axis=1) - 1
    t = np.arange(n_weeks)
    pos = np.take_along_axis(starts, block, axis=1) + (t - np.take_along_axis(offsets, block, axis=1))
    return pos % n_hist


def _chunk_sizes(n_paths: int) -> Iterator[int]:
    for first in range(0, n_paths, CHUNK_PATHS):
        yield min(CHUNK_PATHS, n_paths - first)


def _path_stats(chunks: Iterable[np.ndarray], horizon_years: int) -> tuple[np.ndarray, np.ndarray]:
    """Max drawdown per path and value at each year boundary (column 0 = 1.0) from chunks of weekly returns."""
    mdds, years = [], []
    for r in chunks:
        value = np.cumprod(1.0 + r, axis=1)
        peak = np.maximum(np.maximum.accumulate(value, axis=1), 1.0)  # start value 1.0 counts as a peak
        mdds.append((value / peak - 1.0).min(axis=1))
        yearly = np.ones((len(r), horizon_years + 1))
        yearly[:, 1:] = value[:, PERIODS - 1 :: PERIODS]  # value after weeks 52, 104, ...
        years.append(yearly)
    return np.concatenate(mdds), np.vstack(years)


def _probabilities(values: np.ndarray, thresholds: list[float]) -> list[ProbabilityPoint]:
    """P(values <= -t) per threshold t (values are returns/drawdowns, negative = loss)."""
    return [ProbabilityPoint(threshold=float(t), probability=float(np.mean(values <= -t))) for t in thresholds]


def simulate(
    port_returns: pd.Series,
    expected_return: float,
    horizon_years: int,
    thresholds: list[float],
    n_paths: int,
    block_weeks: tuple[int, int] = config.BLOCK_WEEKS,
    seed: int | None = config.MC_SEED,
) -> SimulationResult:
    """Stationary block bootstrap of weekly portfolio returns.

    Blocks: random start, integer length uniform in [block_weeks[0], block_weeks[1]], wrapping around the history.
    Returns are demeaned, then shifted by (1 + expected_return) ** (1/52) - 1 so the mean matches the CAPM expectation.
    Paths: 52 * horizon_years weeks, value starts at 1.0.
    drawdown_probs[t]: P(min over path of value/running_peak - 1 <= -t) (start value counts as a peak).
    annual_loss_probs[t]: P(any of the horizon's consecutive 52-week years has return <= -t).
    p_below_invested: P(final value < 1). fan: year 0..horizon_years, percentiles config.FAN_PERCENTILES of value.
    Deterministic for a given seed.
    """
    lo, hi = block_weeks
    if not 1 <= lo <= hi:
        raise InvalidSettings(f"block_weeks must satisfy 1 <= min <= max, got {block_weeks}")
    if horizon_years < 1 or n_paths < 1:
        raise InvalidSettings("horizon_years and n_paths must be at least 1")
    x = port_returns.dropna().to_numpy(dtype=float)
    if len(x) < PERIODS:
        raise InsufficientHistory("less than one year of portfolio return history to bootstrap")
    x = x - x.mean() + ((1 + expected_return) ** (1 / PERIODS) - 1)

    n_weeks = PERIODS * horizon_years
    rng = np.random.default_rng(seed)
    chunks = (x[_block_indices(len(x), m, n_weeks, block_weeks, rng)] for m in _chunk_sizes(n_paths))
    mdd, yearly = _path_stats(chunks, horizon_years)

    worst_year = (yearly[:, 1:] / yearly[:, :-1] - 1.0).min(axis=1)
    pct = np.percentile(yearly, config.FAN_PERCENTILES, axis=0)  # (len(FAN_PERCENTILES), H + 1)
    fan = [
        FanPoint(year=y, **{f"p{p}": float(pct[i, y]) for i, p in enumerate(config.FAN_PERCENTILES)})
        for y in range(horizon_years + 1)
    ]
    return SimulationResult(
        drawdown_probs=_probabilities(mdd, thresholds),
        annual_loss_probs=_probabilities(worst_year, thresholds),
        p_below_invested=float(np.mean(yearly[:, -1] < 1.0)),
        fan=fan,
    )
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/engine_d/test_simulate.py -v`
Expected: PASS (8 tests). `test_simulate_large_run_is_feasible` should take a few seconds at most; if it takes more than ~15 s, profile `_block_indices` before continuing.

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/downside.py backend/tests/engine_d/test_simulate.py
git commit -m "feat(downside): vectorised block-bootstrap Monte Carlo simulation"
```

---

### Task 5: `normal_comparison` and Monte Carlo vs analytic check

**Files:**
- Modify: `backend/app/engine/downside.py` (replace the `normal_comparison` stub)
- Create: `backend/tests/engine_d/test_normal_comparison.py`

**Interfaces:**
- Consumes (Task 4): `_chunk_sizes`, `_path_stats`, `_probabilities`, `PERIODS`; `scipy.stats.norm`.
- Produces: `normal_comparison(mu, sigma, horizon_years, thresholds, n_paths, seed=config.MC_SEED) -> NormalComparison`.
  - Annual loss (analytic): `m = ln(1+mu) - sigma²/2`; `p = Φ((ln(1-t) - m) / sigma)`; value `1 - (1-p)^H`.
  - Drawdown (simulated): weekly log returns `N(m/52, sigma/√52)`, simple returns via `expm1`, same `_path_stats` as `simulate`.
  - Raises `InvalidSettings` if `sigma <= 0`, `horizon_years < 1` or `n_paths < 1`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_d/test_normal_comparison.py`:

```python
import numpy as np
import pandas as pd
import pytest
from scipy.stats import norm

from app.engine.downside import normal_comparison, simulate
from app.engine.errors import InvalidSettings

MU, SIGMA, H = 0.06, 0.15, 10
THRESHOLDS = [0.1, 0.2, 0.3]


def test_annual_loss_matches_scipy_formula():
    res = normal_comparison(MU, SIGMA, H, THRESHOLDS, n_paths=500, seed=0)
    for point, t in zip(res.annual_loss_probs, THRESHOLDS):
        p_year = norm.cdf(np.log(1 - t), loc=np.log(1 + MU) - SIGMA**2 / 2, scale=SIGMA)
        assert point.threshold == t
        assert point.probability == pytest.approx(1 - (1 - p_year) ** H, rel=1e-12)


def test_annual_loss_known_values():
    # z = (ln(0.9) - (ln(1.06) - 0.01125)) / 0.15 ≈ -1.016 -> p ≈ 0.155 -> any of 10 years ≈ 0.81
    res = normal_comparison(MU, SIGMA, H, [0.1], n_paths=500, seed=0)
    assert res.annual_loss_probs[0].probability == pytest.approx(0.81, abs=0.01)


def test_normal_drawdown_probs_valid_and_decreasing():
    res = normal_comparison(MU, SIGMA, H, THRESHOLDS, n_paths=2000, seed=1)
    values = [p.probability for p in res.drawdown_probs]
    assert [p.threshold for p in res.drawdown_probs] == THRESHOLDS
    assert all(0.0 <= v <= 1.0 for v in values)
    assert values == sorted(values, reverse=True)


def test_normal_comparison_is_deterministic():
    a = normal_comparison(MU, SIGMA, H, THRESHOLDS, n_paths=1000, seed=9)
    b = normal_comparison(MU, SIGMA, H, THRESHOLDS, n_paths=1000, seed=9)
    assert a == b


def test_normal_comparison_rejects_zero_sigma():
    with pytest.raises(InvalidSettings):
        normal_comparison(MU, 0.0, H, THRESHOLDS, n_paths=100)


def test_monte_carlo_matches_analytic_on_normal_data():
    # i.i.d. normal weekly returns whose arithmetic mean compounds to 6%/year and whose volatility is 15%/year.
    # Bootstrapping i.i.d. data keeps it i.i.d., so the bootstrap must reproduce the normal model.
    n = 52 * 200
    weekly_mean = 1.06 ** (1 / 52) - 1
    hist = pd.Series(
        np.random.default_rng(1).normal(weekly_mean, SIGMA / np.sqrt(52), n),
        index=pd.date_range("1900-01-05", periods=n, freq="W-FRI"),
    )
    mc = simulate(hist, MU, H, THRESHOLDS, n_paths=4000, seed=7)
    normal = normal_comparison(MU, SIGMA, H, THRESHOLDS, n_paths=4000, seed=7)
    for sim, ana in zip(mc.annual_loss_probs, normal.annual_loss_probs):
        assert sim.probability == pytest.approx(ana.probability, abs=0.04), sim.threshold
    for sim, gbm in zip(mc.drawdown_probs, normal.drawdown_probs):
        assert sim.probability == pytest.approx(gbm.probability, abs=0.05), sim.threshold
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_d/test_normal_comparison.py -v`
Expected: FAIL — tests error with `NotImplementedError: Lane D`.

- [ ] **Step 3: Implement**

In `backend/app/engine/downside.py`, replace the entire `def normal_comparison(...)` stub with:

```python
def normal_comparison(
    mu: float, sigma: float, horizon_years: int, thresholds: list[float], n_paths: int, seed: int | None = config.MC_SEED
) -> NormalComparison:
    """Same probabilities under a normal model (teaching comparison).
    Annual loss: yearly log return ~ N(ln(1+mu) - sigma^2/2, sigma); p = P(year return <= -t);
      P(any year over horizon) = 1 - (1 - p) ** horizon_years.
    Drawdown: simulated GBM with weekly steps using the same parameters."""
    if not sigma > 0:
        raise InvalidSettings(f"sigma must be positive, got {sigma}")
    if horizon_years < 1 or n_paths < 1:
        raise InvalidSettings("horizon_years and n_paths must be at least 1")
    log_mean = float(np.log1p(mu) - sigma**2 / 2)

    annual = []
    for t in thresholds:
        p_year = float(norm.cdf((np.log1p(-t) - log_mean) / sigma))
        annual.append(ProbabilityPoint(threshold=float(t), probability=1.0 - (1.0 - p_year) ** horizon_years))

    rng = np.random.default_rng(seed)
    n_weeks = PERIODS * horizon_years
    chunks = (
        np.expm1(rng.normal(log_mean / PERIODS, sigma / np.sqrt(PERIODS), size=(m, n_weeks)))
        for m in _chunk_sizes(n_paths)
    )
    mdd, _ = _path_stats(chunks, horizon_years)
    return NormalComparison(drawdown_probs=_probabilities(mdd, thresholds), annual_loss_probs=annual)
```

- [ ] **Step 4: Run the lane's tests**

Run: `cd backend && uv run pytest tests/engine_d/test_normal_comparison.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the whole backend suite**

Run: `cd backend && uv run pytest -v`
Expected: all Lane D tests pass (24 + 8 + 7 + 8 + 6 = 53) and every Phase 0 test (`test_contract.py`, `test_types.py`, `test_schema.py`, `test_health.py`, `test_synthetic.py`, `test_export_contract.py`) still passes. Also confirm `git status` shows changes only under `backend/app/engine/{metrics,downside}.py` and `backend/tests/engine_d/`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/engine/downside.py backend/tests/engine_d/test_normal_comparison.py
git commit -m "feat(downside): normal-model comparison with Monte Carlo vs analytic check"
```

---

## Notes for the integrator (Phase 2)

- `simulate` and `normal_comparison` return the pieces of `Downside`; the pipeline assembles `Downside(drawdown_probs, annual_loss_probs, p_below_invested, fan, stress=stress(...), normal_comparison=normal_comparison(...))`. Call `normal_comparison` with the portfolio's ex-ante `expected_return` and `volatility` from `metrics.ex_ante`.
- `simulate` raises `InsufficientHistory` (HTTP 422 via the domain handler) when the portfolio has no common history — see the contract remarks in the hand-off report.
- `stress` treats a window as covered only if the first weekly return is dated on/before the window start; a history whose first Friday falls a few days after the start returns `loss=None`.
