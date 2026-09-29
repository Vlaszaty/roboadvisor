# Lane C — CAPM Expected Returns and Optimizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `app/engine/expected.py` (`market_returns`, `capm`) and `app/engine/optimize.py` (`target_vol_from_risk`, `build_constraints`, `optimize` with the strategies `target_vol`, `min_variance`, `max_sharpe`, `risk_parity`, `hrp`) exactly per the frozen Phase 0 signatures and docstrings and spec §5.4–5.5.

**Architecture:** Two pure-pandas engine modules. `expected.py` computes the market return from anchor funds, excess returns over the weekly risk-free rate, betas over the estimation window (never reading past `end`) and `rf_now + β × premium`. `optimize.py` writes every convex problem directly in **cvxpy** (shipped with PyPortfolioOpt): one shared feasible set (long-only, Σw = 1, floor ≤ w ≤ max_position, group min/max), a strategy table `SOLVERS`, a generic cardinality loop (optimise → prune to ≤ max_etfs funds ≥ min_position → re-optimise; the last round forces every kept fund ≥ min_position), and a final "honesty check" that turns every broken bound into a warning. HRP is written out with SciPy clustering.

**Tech Stack:** Python 3.12, uv, pandas, numpy, scipy, cvxpy (via PyPortfolioOpt, solver Clarabel), pytest.

**Spec:** `docs/superpowers/specs/2026-09-29-roboadvisor-design.md` (§5.4, §5.5, §9, §10). Contracts: `docs/superpowers/plans/2026-09-29-phase0-contracts.md` (Task 4 stubs, Task 5 fixture).

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

Lane C specifics:

- Work on branch `lane/c-capm-optimizer` created from tag `phase0-contracts`.
- Lane C owns only `backend/app/engine/expected.py` and `backend/app/engine/optimize.py`. Tests live in `backend/tests/engine_c/` (new, with an empty `__init__.py`). Do not edit any other file.
- Do not import or rely on Lane B (`returns.py`, `risk.py`, `universe.py`). Tests build covariance themselves from the fixture: `weekly_eur[UNIVERSE].iloc[-260:].dropna().cov() * 52`, and use `synthetic.rf("EUR")`.
- Signatures and docstring contracts of the five public functions are frozen; private helpers (leading `_`) are free.
- All commands run from `backend/`: `cd backend && uv run pytest ...`.
- This code is used for teaching: small functions, intermediate quantities with descriptive names, a docstring on every non-obvious helper.

## Design decisions (read before Task 3)

1. **cvxpy directly, not `EfficientFrontier.efficient_risk`.** The TER penalty (`mu − TER_PENALTY·ter`), group bounds and the min-variance / max-return fallbacks are each one explicit line; pypfopt would need a custom objective plus exception-driven fallbacks. The problems are small (≤ ~500 funds) and Clarabel solves them in milliseconds.
2. **PSD covariance.** `_make_psd` symmetrises, clips negative eigenvalues to 0 and adds a `1e-10` ridge; the quadratic form uses `cp.psd_wrap` so cvxpy skips its own (fragile) PSD check.
3. **Unreachable target.** In `_target_vol`: solve min-variance first (same bounds, groups, floor). If `target < min_var_vol` → return it with the warning `"target volatility X% is below the lowest reachable Y%; using the minimum-variance portfolio (volatility Y%)"`. Else solve max-return (an LP). If `target > max_return_vol` → return it with `"... is above the highest-return portfolio's Y% ..."`. Otherwise the target problem is feasible by convexity and is solved.
4. **Bounds feasibility.** `optimize` raises `InfeasibleConstraints` if `max_position × n_funds < 1` or `max_position × max_etfs < 1`. Any other impossible combination (e.g. group bounds that clash) surfaces as `InfeasibleConstraints` from the solver status.
5. **Cardinality loop.** Round 0 solves on the whole universe with floor 0. While the result has more than `max_etfs` funds or a position below `min_position`, prune (largest fund of each `group_min` group first, then largest weights ≥ `min_position`, up to `max_etfs`; topped up if `max_position` would make 100% unreachable) and re-solve on the kept funds. Rounds `1 .. MAX_CARDINALITY_ROUNDS − 1` use floor 0; the last round forces every kept fund ≥ `min_position`, which guarantees both rules for strategies that accept bounds.
6. **max_sharpe and the risk-free rate (contract gap).** `Constraints` carries no rf and the `optimize` signature is frozen. Every other strategy is invariant to adding a constant to all of `mu` (Σw = 1), so the convention is: **`optimize` reads `mu` as excess return for `max_sharpe` (rf = 0)**; the pipeline must pass `capm.expected − capm.rf` (passing excess returns for every strategy is harmless). Written into the module and `optimize` docstrings, and escalated to the integrator.
7. **risk_parity** = equal risk contribution via Spinu's convex log-barrier problem `min ½yᵀΣy − (1/n)Σlog y`, `w = y/Σy`. **hrp** = López de Prado's clustering + recursive bisection, written out because `pypfopt.HRPOpt.optimize` (PyPortfolioOpt 1.6.0) crashes on current SciPy (`scipy.cluster.hierarchy` has no attribute `_LINKAGE_METHODS`). Neither method can respect position or group bounds; the honesty check reports every broken bound as a `"constraint not met: ..."` warning.
8. **Fixture facts the tests depend on** (EUR base, last 5 years): SYNCASH00001 has ~0.2% annual vol (the EUR rate steps from −0.4% to 3% in 2022), not 0, so the CML test uses a loose tolerance; tangency-portfolio vol ≈ 11.5%, so CML targets are 3% and 8%. Under `capm_equity` the hedged/EUR bond funds have |β| < 0.1 but SYNHY0000001 has β ≈ 0.43 (it loads 0.35 on equity), so the "bonds ≈ rf" test excludes high yield.

## File structure

| File | Responsibility |
|---|---|
| `backend/app/engine/expected.py` | market return, window slicing, weekly rf, beta, CAPM result |
| `backend/app/engine/optimize.py` | risk → vol, constraints from preferences, cvxpy strategies, cardinality loop, violation warnings |
| `backend/tests/engine_c/__init__.py` | empty |
| `backend/tests/engine_c/conftest.py` | EUR test universe, `cov` / `mu` / `selection` fixtures, `make_constraints`, `no_cardinality`, assertion helpers |
| `backend/tests/engine_c/test_expected.py` | CAPM tests |
| `backend/tests/engine_c/test_constraints.py` | `target_vol_from_risk`, `build_constraints` tests |
| `backend/tests/engine_c/test_optimize.py` | `target_vol` strategy + cardinality + infeasibility tests |
| `backend/tests/engine_c/test_strategies.py` | `min_variance`, `max_sharpe`, `risk_parity`, `hrp` tests |

---

### Task 1: CAPM expected returns

**Files:**
- Modify: `backend/app/engine/expected.py` (replace the Phase 0 stub bodies)
- Create: `backend/tests/engine_c/__init__.py` (empty), `backend/tests/engine_c/test_expected.py`

**Interfaces:**
- Consumes: `app.config.ANCHORS`, `config.MARKETS`, `config.PERIODS_PER_YEAR`; `app.engine.types.CapmResult(beta, expected, rf, premium, market)`; pytest fixtures `synthetic` (`SyntheticData`, `.rf("EUR")` daily annual rate) and `weekly_eur` (W-FRI returns per ISIN) from `backend/tests/conftest.py`.
- Produces:
  - `market_returns(returns: pd.DataFrame, anchors: dict[str, str], weights: dict[str, float]) -> pd.Series` (named `"market"`).
  - `capm(returns, market, rf, premium, model, window_years, end=None) -> CapmResult`; `beta` / `expected` indexed like `returns.columns`; NaN for funds with < 2 overlapping weeks in the window.

- [ ] **Step 0: Create the lane branch**

```bash
cd /Users/vlaszaty/projects/roboadvisor
git checkout -b lane/c-capm-optimizer phase0-contracts
mkdir -p backend/tests/engine_c && touch backend/tests/engine_c/__init__.py
```

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_c/test_expected.py`:

```python
import numpy as np
import pandas as pd
import pytest

from app import config
from app.engine.expected import capm, market_returns

ANCHORS = config.ANCHORS["EUR"]
EQUITY_ANCHOR = ANCHORS["global_equity"]
BOND_ANCHOR = ANCHORS["global_bonds"]
LOW_EQUITY_BONDS = ["IE00BDBRDM35", "SYNGOVS00001", "SYNGOVL00001", "SYNUSTLEH001", "SYNCORP00001"]


def run_capm(synthetic, weekly, model, end=None):
    market = market_returns(weekly, ANCHORS, config.MARKETS[model]["weights"])
    premium = config.MARKETS[model]["premium"]
    return capm(weekly, market, synthetic.rf("EUR"), premium, model, window_years=5, end=end)


# ---------- market_returns


def test_market_returns_is_the_weighted_sum():
    returns = pd.DataFrame({"EQ": [0.10, -0.02], "BD": [0.01, 0.03]})
    market = market_returns(returns, {"global_equity": "EQ", "global_bonds": "BD"}, {"global_equity": 0.6, "global_bonds": 0.4})
    assert market.tolist() == pytest.approx([0.6 * 0.10 + 0.4 * 0.01, 0.6 * -0.02 + 0.4 * 0.03])


def test_market_returns_is_nan_when_any_anchor_is_missing():
    returns = pd.DataFrame({"EQ": [0.10, 0.02], "BD": [np.nan, 0.03]})
    market = market_returns(returns, {"global_equity": "EQ", "global_bonds": "BD"}, {"global_equity": 0.6, "global_bonds": 0.4})
    assert np.isnan(market.iloc[0])
    assert market.iloc[1] == pytest.approx(0.6 * 0.02 + 0.4 * 0.03)


def test_market_returns_ignores_unused_anchors():
    returns = pd.DataFrame({"EQ": [0.10], "BD": [np.nan]})
    market = market_returns(returns, {"global_equity": "EQ", "global_bonds": "BD"}, {"global_equity": 1.0})
    assert market.iloc[0] == pytest.approx(0.10)


# ---------- capm


def test_market_proxy_has_beta_one(synthetic, weekly_eur):
    result = run_capm(synthetic, weekly_eur, "capm_equity")
    assert result.beta[EQUITY_ANCHOR] == pytest.approx(1.0, abs=1e-9)


def test_multi_asset_market_itself_has_beta_one(synthetic, weekly_eur):
    weekly = weekly_eur.copy()
    weekly["MARKET"] = 0.6 * weekly[EQUITY_ANCHOR] + 0.4 * weekly[BOND_ANCHOR]
    result = run_capm(synthetic, weekly, "capm_multi_asset")
    assert result.beta["MARKET"] == pytest.approx(1.0, abs=1e-9)


def test_cash_has_beta_zero(synthetic, weekly_eur):
    for model in config.MARKETS:
        result = run_capm(synthetic, weekly_eur, model)
        assert abs(result.beta["SYNCASH00001"]) < 0.01
        assert result.expected["SYNCASH00001"] == pytest.approx(result.rf, abs=0.001)


def test_equity_market_gives_bonds_about_rf(synthetic, weekly_eur):
    result = run_capm(synthetic, weekly_eur, "capm_equity")
    assert (result.beta[LOW_EQUITY_BONDS].abs() < 0.2).all()
    assert np.allclose(result.expected[LOW_EQUITY_BONDS], result.rf, atol=0.2 * result.premium)


def test_multi_asset_market_gives_bonds_a_real_beta(synthetic, weekly_eur):
    equity_only = run_capm(synthetic, weekly_eur, "capm_equity")
    multi_asset = run_capm(synthetic, weekly_eur, "capm_multi_asset")
    for isin in ["IE00BDBRDM35", "SYNGOVL00001", "SYNCORP00001"]:
        assert multi_asset.beta[isin] > 0.05
        assert multi_asset.beta[isin] > equity_only.beta[isin] + 0.05


def test_expected_is_rf_plus_beta_times_premium(synthetic, weekly_eur):
    result = run_capm(synthetic, weekly_eur, "capm_multi_asset")
    rf_now = synthetic.rf("EUR").iloc[-1]
    assert result.rf == rf_now
    assert result.premium == config.MARKETS["capm_multi_asset"]["premium"]
    assert result.market == "capm_multi_asset"
    pd.testing.assert_series_equal(result.expected, rf_now + result.beta * result.premium, check_names=False)


def test_premium_override_is_used(synthetic, weekly_eur):
    market = market_returns(weekly_eur, ANCHORS, {"global_equity": 1.0})
    result = capm(weekly_eur, market, synthetic.rf("EUR"), 0.07, "capm_equity", window_years=5)
    assert result.expected[EQUITY_ANCHOR] == pytest.approx(result.rf + 0.07)


def test_beta_uses_only_the_window(synthetic, weekly_eur):
    """A fund that copies the market for the last 5 years but is noise before has beta 1."""
    weekly = weekly_eur.copy()
    rng = np.random.default_rng(1)
    weekly["COPY"] = weekly[EQUITY_ANCHOR]
    weekly.iloc[: -5 * 52, weekly.columns.get_loc("COPY")] = rng.normal(0, 0.05, len(weekly) - 5 * 52)
    result = run_capm(synthetic, weekly, "capm_equity")
    assert result.beta["COPY"] == pytest.approx(1.0, abs=1e-9)


def test_end_ignores_everything_after_it(synthetic, weekly_eur):
    end = pd.Timestamp("2019-12-27")
    clean = run_capm(synthetic, weekly_eur, "capm_multi_asset", end=end)

    corrupted_returns = weekly_eur.copy()
    corrupted_returns.loc[corrupted_returns.index > end] = 0.5
    corrupted_rf = synthetic.rf("EUR").copy()
    corrupted_rf[corrupted_rf.index > end] = 0.99
    market = market_returns(corrupted_returns, ANCHORS, config.MARKETS["capm_multi_asset"]["weights"])
    corrupted = capm(corrupted_returns, market, corrupted_rf, 0.035, "capm_multi_asset", window_years=5, end=end)

    pd.testing.assert_series_equal(clean.beta, corrupted.beta)
    pd.testing.assert_series_equal(clean.expected, corrupted.expected)
    assert clean.rf == corrupted.rf == synthetic.rf("EUR")[:end].iloc[-1]


def test_fund_without_data_in_window_gets_nan(synthetic, weekly_eur):
    result = run_capm(synthetic, weekly_eur, "capm_equity", end=pd.Timestamp("2012-12-28"))
    assert np.isnan(result.beta["SYNYOUNG0001"])
    assert np.isnan(result.expected["SYNYOUNG0001"])
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_c/test_expected.py -v`
Expected: 13 tests FAIL with `NotImplementedError: Lane C`.

- [ ] **Step 3: Implement `expected.py`**

Replace the whole content of `backend/app/engine/expected.py` with:

```python
"""Lane C. Spec §5.4 — CAPM expected returns.

Teaching outline:
1. Build the market portfolio's weekly return from a few anchor funds.
2. Turn every return into an *excess* return (return minus the weekly risk-free rate).
3. beta_i = cov(excess_i, excess_market) / var(excess_market) over the estimation window.
4. expected_i = rf_now + beta_i * market_premium.
"""

import pandas as pd

from app import config
from app.engine.types import CapmResult


def market_returns(returns: pd.DataFrame, anchors: dict[str, str], weights: dict[str, float]) -> pd.Series:
    """Weekly market-portfolio return = sum(weights[key] * returns[anchors[key]]).

    anchors: key -> isin (config.ANCHORS[base]); weights: key -> weight (config.MARKETS[model]['weights']).
    Weeks where any used anchor is NaN are NaN.
    """
    weighted_legs = [weight * returns[anchors[key]] for key, weight in weights.items()]
    market = sum(weighted_legs)  # NaN in any leg -> NaN for that week
    return market.rename("market")


def _estimation_window(frame: pd.DataFrame | pd.Series, window_years: int, end: pd.Timestamp | None):
    """Rows up to and including `end`, then the last window_years * 52 of them."""
    up_to_end = frame if end is None else frame.loc[:end]
    n_weeks = window_years * config.PERIODS_PER_YEAR
    return up_to_end.iloc[-n_weeks:]


def _weekly_rf(rf_daily_annual: pd.Series, weeks: pd.DatetimeIndex) -> pd.Series:
    """Daily annualised rf -> weekly rate per period (last value of each W-FRI week / 52), on `weeks`."""
    rf_weekly_annual = rf_daily_annual.resample("W-FRI").last()
    return rf_weekly_annual.reindex(weeks, method="ffill") / config.PERIODS_PER_YEAR


def _beta(fund_excess: pd.Series, market_excess: pd.Series) -> float:
    """cov / var on the weeks where both series have data (NaN if fewer than 2 such weeks)."""
    both = fund_excess.notna() & market_excess.notna()
    if both.sum() < 2:
        return float("nan")
    return fund_excess[both].cov(market_excess[both]) / market_excess[both].var()


def capm(
    returns: pd.DataFrame,
    market: pd.Series,
    rf: pd.Series,
    premium: float,
    model: str,
    window_years: int,
    end: pd.Timestamp | None = None,
) -> CapmResult:
    """CAPM betas and expected returns.

    rf: daily annualised risk-free rate (DataSource.rf); weekly rf = rf resampled W-FRI (last) / 52.
    Excess returns: r - weekly rf. beta_i = cov(ex_i, ex_m) / var(ex_m) over the last window_years*52 weeks
    up to `end` (default: last row), pairwise non-NaN weeks. Never reads rows after `end`.
    expected_i = rf_now + beta_i * premium, rf_now = last rf value <= end.
    CapmResult.market = model.
    Funds with fewer than 2 overlapping weeks get beta NaN and expected NaN.
    """
    window_returns = _estimation_window(returns, window_years, end)
    window_market = market.reindex(window_returns.index)
    rf_up_to_end = rf if end is None else rf.loc[:end]

    weekly_rf = _weekly_rf(rf_up_to_end, window_returns.index)
    fund_excess = window_returns.sub(weekly_rf, axis=0)
    market_excess = window_market - weekly_rf

    beta = fund_excess.apply(lambda col: _beta(col, market_excess)).rename("beta")
    rf_now = float(rf_up_to_end.dropna().iloc[-1])
    expected = (rf_now + beta * premium).rename("expected")
    return CapmResult(beta=beta, expected=expected, rf=rf_now, premium=premium, market=model)
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && uv run pytest tests/engine_c/test_expected.py -v`
Expected: 13 passed.

Run: `cd backend && uv run pytest tests/test_contract.py -v`
Expected: PASS (signatures unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/expected.py backend/tests/engine_c/__init__.py backend/tests/engine_c/test_expected.py
git commit -m "feat(engine): CAPM market return, betas and expected returns"
```

---

### Task 2: Target volatility and constraints from preferences

**Files:**
- Modify: `backend/app/engine/optimize.py` (implement `target_vol_from_risk`, `build_constraints`; `optimize` stays a stub)
- Create: `backend/tests/engine_c/conftest.py`, `backend/tests/engine_c/test_constraints.py`

**Interfaces:**
- Consumes: `capm`, `market_returns` from Task 1 (only in the test conftest); `app.engine.types.{Constraints, InvestorProfile, Preferences, OptimizeResult, Strategy}`; `app.engine.errors.InfeasibleConstraints`.
- Produces:
  - `target_vol_from_risk(risk_level: float, vol_range: tuple[float, float]) -> float`.
  - `build_constraints(selection: pd.DataFrame, profile: InvestorProfile, target_vol: float) -> Constraints` with group keys `"asset_class:<x>"` / `"sector:<s>"`.
  - Test helpers in `tests/engine_c/conftest.py` used by Tasks 3–4: constants `UNIVERSE` (15 EUR ISINs), `FIVE_YEARS`, `TOL = 1e-4`, `TARGETS`; fixtures `cov`, `mu`, `selection`; functions `make_constraints(selection, **overrides) -> Constraints`, `no_cardinality(selection, **overrides) -> Constraints`, `vol(weights, cov) -> float`, `net_return(weights, mu, ter) -> float`, `assert_valid(result, cov, c)`.

- [ ] **Step 1: Write the shared test conftest**

`backend/tests/engine_c/conftest.py`:

```python
"""Shared inputs for Lane C tests: a EUR universe, its covariance and CAPM expected returns.

The covariance is built here from the fixture's reference weekly returns (sample covariance x 52), so these
tests do not depend on Lane B's risk.covariance.
"""

import numpy as np
import pandas as pd
import pytest

from app import config
from app.engine.expected import capm, market_returns
from app.engine.types import Constraints

UNIVERSE = [
    "IE00B6R52259", "IE00BDBRDM35", "SYNEUEQ00001", "SYNEMEQ00001", "SYNJPEQ00001", "SYNHLTH00001",
    "SYNTECH00001", "SYNGOVS00001", "SYNGOVL00001", "SYNUSTLEH001", "SYNCORP00001", "SYNGOLD00001",
    "SYNCASH00001", "SYNREIT00001", "SYNBTC000001",
]
FIVE_YEARS = 5 * 52


@pytest.fixture(scope="session")
def cov(weekly_eur) -> pd.DataFrame:
    window = weekly_eur[UNIVERSE].iloc[-FIVE_YEARS:].dropna()
    return window.cov() * 52


@pytest.fixture(scope="session")
def mu(synthetic, weekly_eur) -> pd.Series:
    model = "capm_multi_asset"
    market = market_returns(weekly_eur, config.ANCHORS["EUR"], config.MARKETS[model]["weights"])
    result = capm(weekly_eur[UNIVERSE], market, synthetic.rf("EUR"), config.MARKETS[model]["premium"], model, 5)
    return result.expected


@pytest.fixture(scope="session")
def selection(synthetic) -> pd.DataFrame:
    return synthetic.funds().loc[UNIVERSE]


def make_constraints(selection: pd.DataFrame, **overrides) -> Constraints:
    """Constraints with the Preferences defaults unless overridden (no sector tilt, crypto capped at 5%)."""
    groups = {}
    for column in ("asset_class", "sector"):
        for value, members in selection.groupby(column).groups.items():
            groups[f"{column}:{value}"] = list(members)
    values = dict(
        target_vol=0.10, max_etfs=10, min_position=0.03, max_position=0.40,
        ter=selection["ter"].fillna(0.0), groups=groups, group_min={}, group_max={"asset_class:crypto": 0.05},
    )
    values.update(overrides)
    return Constraints(**values)


def no_cardinality(selection: pd.DataFrame, **overrides) -> Constraints:
    """Constraints with max_etfs/min_position switched off, for tests about the pure optimisation."""
    return make_constraints(selection, **{"max_etfs": len(selection), "min_position": 0.0, **overrides})


TOL = 1e-4
TARGETS = [0.03, 0.06, 0.10, 0.14, 0.18]  # annual volatility targets used across tests


def vol(weights: pd.Series, cov: pd.DataFrame) -> float:
    w = weights.reindex(cov.index).fillna(0.0)
    return float(np.sqrt(w @ cov @ w))


def net_return(weights: pd.Series, mu: pd.Series, ter: pd.Series) -> float:
    return float((weights * (mu - config.TER_PENALTY * ter).reindex(weights.index)).sum())


def assert_valid(result, cov, c):
    """Every rule of the contract that holds for the cvxpy-based strategies."""
    w = result.weights
    assert w.sum() == pytest.approx(1.0, abs=1e-9)
    assert (w > 0).all(), "only non-zero weights are returned"
    assert set(w.index) <= set(cov.index)
    assert result.achieved_vol == pytest.approx(vol(w, cov), abs=1e-6)
    assert w.max() <= c.max_position + TOL
    assert w.min() >= c.min_position - TOL
    assert len(w) <= c.max_etfs
    for group, minimum in c.group_min.items():
        assert w.reindex(c.groups[group]).fillna(0).sum() >= minimum - TOL
    for group, maximum in c.group_max.items():
        assert w.reindex(c.groups[group]).fillna(0).sum() <= maximum + TOL
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/engine_c/test_constraints.py`:

```python
import numpy as np
import pytest

from app.engine.errors import InfeasibleConstraints
from app.engine.optimize import build_constraints, target_vol_from_risk
from app.engine.types import InvestorProfile, Preferences


# ---------- target_vol_from_risk


@pytest.mark.parametrize("risk_level, expected", [(0, 0.02), (100, 0.20), (50, 0.11), (25, 0.065)])
def test_target_vol_from_risk(risk_level, expected):
    assert target_vol_from_risk(risk_level, (0.02, 0.20)) == pytest.approx(expected)


# ---------- build_constraints


def profile(**preferences) -> InvestorProfile:
    return InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR", preferences=Preferences(**preferences))


def test_build_constraints_groups_bounds_and_ter(selection):
    with_unknown_ter = selection.copy()
    with_unknown_ter.loc["SYNGOLD00001", "ter"] = np.nan
    c = build_constraints(with_unknown_ter, profile(max_etfs=8, min_position=0.05, max_position=0.3,
                                                    sector_tilts={"healthcare": 0.05}, crypto_max=0.05), 0.11)
    assert c.target_vol == 0.11
    assert (c.max_etfs, c.min_position, c.max_position) == (8, 0.05, 0.3)
    assert c.groups["sector:healthcare"] == ["SYNHLTH00001"]
    assert c.groups["asset_class:crypto"] == ["SYNBTC000001"]
    assert set(c.groups["asset_class:bond"]) == {"IE00BDBRDM35", "SYNGOVS00001", "SYNGOVL00001", "SYNUSTLEH001", "SYNCORP00001"}
    assert c.group_min == {"sector:healthcare": 0.05}
    assert c.group_max == {"asset_class:crypto": 0.05}
    assert c.ter["SYNGOLD00001"] == 0.0
    assert c.ter["IE00B6R52259"] == 0.0020


def test_build_constraints_without_crypto_has_no_crypto_cap(selection):
    c = build_constraints(selection.drop(index="SYNBTC000001"), profile(), 0.1)
    assert c.group_max == {}
    assert "asset_class:crypto" not in c.groups


def test_tilt_on_missing_sector_is_infeasible(selection):
    with pytest.raises(InfeasibleConstraints, match="energy"):
        build_constraints(selection, profile(sector_tilts={"energy": 0.05}), 0.1)


def test_tilts_above_100_percent_are_infeasible(selection):
    with pytest.raises(InfeasibleConstraints, match="100%"):
        build_constraints(selection, profile(sector_tilts={"healthcare": 0.6, "technology": 0.5}), 0.1)


def test_more_tilts_than_max_etfs_is_infeasible(selection):
    with pytest.raises(InfeasibleConstraints, match="max_etfs"):
        build_constraints(selection, profile(max_etfs=1, sector_tilts={"healthcare": 0.1, "technology": 0.1}), 0.1)
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_c/test_constraints.py -v`
Expected: 9 tests FAIL with `NotImplementedError: Lane C`.

- [ ] **Step 4: Implement**

Replace the whole content of `backend/app/engine/optimize.py` with (the `optimize` stub is kept for Task 3):

```python
"""Lane C. Spec §5.5 — portfolio construction.

Solver choice: the convex problems (target_vol, min_variance, max_sharpe, risk_parity) are written directly in
cvxpy (installed with PyPortfolioOpt) rather than through pypfopt's EfficientFrontier. Reasons: the TER penalty
and the group bounds are one line each in plain cvxpy, the min-variance / max-return fallbacks for an
unreachable volatility target are explicit instead of hidden in exceptions, and the maths reads the same as
the spec. HRP has no convex formulation and is written out with SciPy's clustering.

Return-level convention: every strategy except max_sharpe is unchanged if the same constant is added to all
of mu (weights sum to 1). max_sharpe treats mu as returns in excess of the risk-free rate (rf = 0), so callers
should pass capm.expected - capm.rf for that strategy.
"""

import pandas as pd

from app.engine.errors import InfeasibleConstraints
from app.engine.types import Constraints, InvestorProfile, OptimizeResult, Strategy


# ---------------------------------------------------------------- risk level and constraints


def target_vol_from_risk(risk_level: float, vol_range: tuple[float, float]) -> float:
    """vmin + risk_level / 100 * (vmax - vmin)."""
    vol_min, vol_max = vol_range
    return vol_min + risk_level / 100 * (vol_max - vol_min)


def build_constraints(selection: pd.DataFrame, profile: InvestorProfile, target_vol: float) -> Constraints:
    """Constraints from the selected universe and preferences.

    groups: 'asset_class:<x>' for every asset class present and 'sector:<s>' for every sector present.
    group_min: {'sector:<s>': w} from preferences.sector_tilts. Raises InfeasibleConstraints if a tilted sector
      has no eligible fund, if the tilts sum to more than 1, or if there are more tilts than max_etfs.
    group_max: {'asset_class:crypto': preferences.crypto_max} when crypto funds are present.
    ter: selection.ter with NaN -> 0. Position bounds from preferences.
    """
    prefs = profile.preferences
    groups = _groups(selection)
    _check_sector_tilts(prefs.sector_tilts, groups, prefs.max_etfs)

    group_min = {f"sector:{sector}": weight for sector, weight in prefs.sector_tilts.items()}
    group_max = {}
    if "asset_class:crypto" in groups:
        group_max["asset_class:crypto"] = prefs.crypto_max

    return Constraints(
        target_vol=target_vol,
        max_etfs=prefs.max_etfs,
        min_position=prefs.min_position,
        max_position=prefs.max_position,
        ter=selection["ter"].astype(float).fillna(0.0),
        groups=groups,
        group_min=group_min,
        group_max=group_max,
    )


def _groups(selection: pd.DataFrame) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    for column in ("asset_class", "sector"):
        for value, members in selection.groupby(column).groups.items():  # groupby skips None/NaN
            groups[f"{column}:{value}"] = list(members)
    return groups


def _check_sector_tilts(tilts: dict[str, float], groups: dict[str, list[str]], max_etfs: int) -> None:
    missing = [sector for sector in tilts if f"sector:{sector}" not in groups]
    if missing:
        raise InfeasibleConstraints(f"no eligible fund for sector tilt(s): {', '.join(sorted(missing))}")
    if sum(tilts.values()) > 1:
        raise InfeasibleConstraints(f"sector tilts add up to {sum(tilts.values()):.0%}, more than 100%")
    if len(tilts) > max_etfs:
        raise InfeasibleConstraints(f"{len(tilts)} sector tilts need more funds than max_etfs = {max_etfs}")


# ---------------------------------------------------------------- entry point


def optimize(mu: pd.Series, cov: pd.DataFrame, constraints: Constraints, strategy: Strategy) -> OptimizeResult:
    """Long-only weights summing to 1 (spec §5.5). Built in Task 3."""
    raise NotImplementedError("Lane C")
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd backend && uv run pytest tests/engine_c/test_constraints.py tests/test_contract.py -v`
Expected: all passed (9 in `test_constraints.py`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/engine/optimize.py backend/tests/engine_c/conftest.py backend/tests/engine_c/test_constraints.py
git commit -m "feat(engine): target volatility from risk level and constraints from preferences"
```

---

### Task 3: Target-volatility optimizer with cardinality and fallbacks

**Files:**
- Modify: `backend/app/engine/optimize.py` (whole file replaced; Task 2 functions unchanged)
- Create: `backend/tests/engine_c/test_optimize.py`

**Interfaces:**
- Consumes: Task 2 functions and test helpers; `config.TER_PENALTY`, `config.MAX_CARDINALITY_ROUNDS`.
- Produces:
  - `optimize(mu, cov, constraints, strategy) -> OptimizeResult` working for `"target_vol"` and `"min_variance"`; `weights` has only non-zero entries summing to 1; `achieved_vol = sqrt(wᵀΣw)` on the PSD-repaired cov; warnings described in Design decision 3 and `"constraint not met: ..."`.
  - Private building blocks used by Task 4 (exact names): `Solver` type alias `(net_mu, cov, c, floor) -> (weights, warnings)`, `SOLVERS: dict[str, Solver]`, `_variance(w, cov)`, `_solve(objective, constraints, w, isins, what) -> pd.Series`, `_clean(weights) -> pd.Series`, `_group_bounds(w, scale, isins, c) -> list`, `_min_variance(net_mu, cov, c, floor)`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_c/test_optimize.py`:

```python
import numpy as np
import pandas as pd
import pytest

from app.engine.errors import InfeasibleConstraints
from app.engine.optimize import optimize
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_c/test_optimize.py -v`
Expected: 17 tests FAIL with `NotImplementedError: Lane C`.

- [ ] **Step 3: Implement**

Replace the whole content of `backend/app/engine/optimize.py` with:

```python
"""Lane C. Spec §5.5 — portfolio construction.

Solver choice: the convex problems (target_vol, min_variance, max_sharpe, risk_parity) are written directly in
cvxpy (installed with PyPortfolioOpt) rather than through pypfopt's EfficientFrontier. Reasons: the TER penalty
and the group bounds are one line each in plain cvxpy, the min-variance / max-return fallbacks for an
unreachable volatility target are explicit instead of hidden in exceptions, and the maths reads the same as
the spec. HRP has no convex formulation and is written out with SciPy's clustering.

Return-level convention: every strategy except max_sharpe is unchanged if the same constant is added to all
of mu (weights sum to 1). max_sharpe treats mu as returns in excess of the risk-free rate (rf = 0), so callers
should pass capm.expected - capm.rf for that strategy.
"""

from typing import Callable

import cvxpy as cp
import numpy as np
import pandas as pd

from app import config
from app.engine.errors import InfeasibleConstraints
from app.engine.types import Constraints, InvestorProfile, OptimizeResult, Strategy

ZERO_WEIGHT = 1e-6  # weights below this are solver noise and treated as 0
BOUND_TOLERANCE = 1e-4  # slack when checking constraints after a solve

# A solver takes (net expected returns, covariance, constraints, per-fund floor) and returns (weights, warnings).
# The floor is 0 while the optimizer is free to choose funds, and min_position once the fund list is final.
Solver = Callable[[pd.Series, pd.DataFrame, Constraints, float], tuple[pd.Series, list[str]]]


# ---------------------------------------------------------------- risk level and constraints


def target_vol_from_risk(risk_level: float, vol_range: tuple[float, float]) -> float:
    """vmin + risk_level / 100 * (vmax - vmin)."""
    vol_min, vol_max = vol_range
    return vol_min + risk_level / 100 * (vol_max - vol_min)


def build_constraints(selection: pd.DataFrame, profile: InvestorProfile, target_vol: float) -> Constraints:
    """Constraints from the selected universe and preferences.

    groups: 'asset_class:<x>' for every asset class present and 'sector:<s>' for every sector present.
    group_min: {'sector:<s>': w} from preferences.sector_tilts. Raises InfeasibleConstraints if a tilted sector
      has no eligible fund, if the tilts sum to more than 1, or if there are more tilts than max_etfs.
    group_max: {'asset_class:crypto': preferences.crypto_max} when crypto funds are present.
    ter: selection.ter with NaN -> 0. Position bounds from preferences.
    """
    prefs = profile.preferences
    groups = _groups(selection)
    _check_sector_tilts(prefs.sector_tilts, groups, prefs.max_etfs)

    group_min = {f"sector:{sector}": weight for sector, weight in prefs.sector_tilts.items()}
    group_max = {}
    if "asset_class:crypto" in groups:
        group_max["asset_class:crypto"] = prefs.crypto_max

    return Constraints(
        target_vol=target_vol,
        max_etfs=prefs.max_etfs,
        min_position=prefs.min_position,
        max_position=prefs.max_position,
        ter=selection["ter"].astype(float).fillna(0.0),
        groups=groups,
        group_min=group_min,
        group_max=group_max,
    )


def _groups(selection: pd.DataFrame) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    for column in ("asset_class", "sector"):
        for value, members in selection.groupby(column).groups.items():  # groupby skips None/NaN
            groups[f"{column}:{value}"] = list(members)
    return groups


def _check_sector_tilts(tilts: dict[str, float], groups: dict[str, list[str]], max_etfs: int) -> None:
    missing = [sector for sector in tilts if f"sector:{sector}" not in groups]
    if missing:
        raise InfeasibleConstraints(f"no eligible fund for sector tilt(s): {', '.join(sorted(missing))}")
    if sum(tilts.values()) > 1:
        raise InfeasibleConstraints(f"sector tilts add up to {sum(tilts.values()):.0%}, more than 100%")
    if len(tilts) > max_etfs:
        raise InfeasibleConstraints(f"{len(tilts)} sector tilts need more funds than max_etfs = {max_etfs}")


# ---------------------------------------------------------------- entry point


def optimize(mu: pd.Series, cov: pd.DataFrame, constraints: Constraints, strategy: Strategy) -> OptimizeResult:
    """Long-only weights summing to 1 (spec §5.5).

    mu and cov share the same isins (cov order is authoritative).
    target_vol: maximise mu.w - config.TER_PENALTY * ter.w s.t. sqrt(w'Σw) <= target_vol, position and group bounds.
      Target below the minimum-variance portfolio -> return min-variance with a warning naming the achieved vol;
      target above the maximum-return portfolio's vol -> return max-return with a warning.
    min_variance / max_sharpe / risk_parity / hrp: same bounds where the method allows; otherwise warn.
    Cardinality: drop weights < min_position, keep the top max_etfs, re-optimise on the rest
      (at most config.MAX_CARDINALITY_ROUNDS rounds). Returned weights contain only non-zero entries.
    max_sharpe reads mu as excess returns over the risk-free rate (see module docstring).
    """
    isins = list(cov.index)
    cov = _make_psd(cov.loc[isins, isins])
    ter = constraints.ter.reindex(isins).fillna(0.0)
    net_mu = mu.reindex(isins) - config.TER_PENALTY * ter  # expected return after the cost penalty
    _check_position_bounds(len(isins), constraints)

    solver = SOLVERS[strategy]
    weights, warnings = _solve_with_cardinality(solver, net_mu, cov, constraints)
    warnings += _constraint_violations(weights, constraints)
    achieved_vol = _portfolio_vol(weights, cov)
    return OptimizeResult(weights=weights[weights > 0], achieved_vol=achieved_vol, warnings=warnings)


def _make_psd(cov: pd.DataFrame) -> pd.DataFrame:
    """Symmetrise, clip negative eigenvalues (numerical noise) to 0 and add a tiny ridge so cvxpy accepts it."""
    symmetric = (cov.values + cov.values.T) / 2
    eigenvalues, eigenvectors = np.linalg.eigh(symmetric)
    clipped = eigenvectors @ np.diag(np.clip(eigenvalues, 0, None)) @ eigenvectors.T
    ridge = 1e-10 * np.eye(len(cov))
    return pd.DataFrame(clipped + ridge, index=cov.index, columns=cov.columns)


def _check_position_bounds(n_assets: int, c: Constraints) -> None:
    if c.max_position * n_assets < 1 - 1e-9:
        raise InfeasibleConstraints(
            f"{n_assets} funds with max_position {c.max_position:.0%} cannot add up to 100%"
        )
    if c.max_position * min(n_assets, c.max_etfs) < 1 - 1e-9:
        raise InfeasibleConstraints(
            f"max_etfs {c.max_etfs} funds with max_position {c.max_position:.0%} cannot add up to 100%"
        )


def _portfolio_vol(weights: pd.Series, cov: pd.DataFrame) -> float:
    w = weights.reindex(cov.index).fillna(0.0).values
    return float(np.sqrt(max(w @ cov.values @ w, 0.0)))


# ---------------------------------------------------------------- cardinality (max_etfs, min_position)


def _solve_with_cardinality(
    solver: Solver, net_mu: pd.Series, cov: pd.DataFrame, c: Constraints
) -> tuple[pd.Series, list[str]]:
    """Optimise, prune, re-optimise. The last allowed round forces every kept fund to hold >= min_position."""
    weights, warnings = solver(net_mu, cov, c, 0.0)
    for round_number in range(1, config.MAX_CARDINALITY_ROUNDS + 1):
        if _cardinality_ok(weights, c):
            break
        active = _prune(weights, c)
        floor = c.min_position if round_number == config.MAX_CARDINALITY_ROUNDS else 0.0
        weights, warnings = solver(net_mu[active], cov.loc[active, active], _restrict(c, active), floor)
    return weights.reindex(cov.index).fillna(0.0), warnings


def _cardinality_ok(weights: pd.Series, c: Constraints) -> bool:
    held = weights[weights > 0]
    return len(held) <= c.max_etfs and bool((held >= c.min_position - BOUND_TOLERANCE).all())


def _prune(weights: pd.Series, c: Constraints) -> list[str]:
    """Funds kept for the next round: the largest fund of every group with a minimum first (so a sector tilt
    cannot be pruned away), then the largest remaining weights >= min_position, up to max_etfs funds, then
    (only if needed) the next-largest funds until max_position still allows 100% invested."""
    ranked = weights.sort_values(ascending=False)
    kept: list[str] = []
    for group in c.group_min:
        members = ranked[ranked.index.isin(c.groups.get(group, []))]
        if len(members) and members.index[0] not in kept:
            kept.append(members.index[0])
    for isin, weight in ranked.items():
        if len(kept) >= c.max_etfs:
            break
        if weight >= c.min_position and isin not in kept:
            kept.append(isin)
    for isin in ranked.index:  # top up if the kept funds cannot reach 100% under max_position
        if len(kept) * c.max_position >= 1 - 1e-9:
            break
        if isin not in kept:
            kept.append(isin)
    return kept


def _restrict(c: Constraints, isins: list[str]) -> Constraints:
    """The same constraints on a smaller fund list (group member lists are cut down to it)."""
    groups = {key: [i for i in members if i in isins] for key, members in c.groups.items()}
    return Constraints(
        target_vol=c.target_vol, max_etfs=c.max_etfs, min_position=c.min_position, max_position=c.max_position,
        ter=c.ter.reindex(isins).fillna(0.0), groups=groups, group_min=c.group_min, group_max=c.group_max,
    )


# ---------------------------------------------------------------- shared cvxpy building blocks


def _feasible_set(w: cp.Variable, isins: list[str], c: Constraints, floor: float) -> list:
    """Long-only, fully invested, floor <= w <= max_position, and every group's min/max share."""
    return [cp.sum(w) == 1, w >= floor, w <= c.max_position] + _group_bounds(w, 1.0, isins, c)


def _group_bounds(w: cp.Variable, scale, isins: list[str], c: Constraints) -> list:
    """sum(w over group) >= group_min * scale and <= group_max * scale (scale is 1, or k in max_sharpe)."""
    position = {isin: n for n, isin in enumerate(isins)}

    def members(group: str) -> list[int]:
        return [position[i] for i in c.groups.get(group, []) if i in position]

    bounds = []
    for group, minimum in c.group_min.items():
        if not members(group):
            raise InfeasibleConstraints(f"{group} needs at least {minimum:.0%} but no fund of it is left")
        bounds.append(cp.sum(w[members(group)]) >= minimum * scale)
    for group, maximum in c.group_max.items():
        if members(group):
            bounds.append(cp.sum(w[members(group)]) <= maximum * scale)
    return bounds


def _solve(objective, constraints: list, w: cp.Variable, isins: list[str], what: str) -> pd.Series:
    problem = cp.Problem(objective, constraints)
    problem.solve(solver=cp.CLARABEL)
    if problem.status not in (cp.OPTIMAL, cp.OPTIMAL_INACCURATE) or w.value is None:
        raise InfeasibleConstraints(f"{what}: position and group bounds cannot be met together ({problem.status})")
    return _clean(pd.Series(w.value, index=isins))


def _clean(weights: pd.Series) -> pd.Series:
    """Zero out solver noise and rescale to sum exactly to 1."""
    weights = weights.clip(lower=0)
    weights[weights < ZERO_WEIGHT] = 0.0
    return weights / weights.sum()


def _variance(w: cp.Variable, cov: pd.DataFrame):
    return cp.quad_form(w, cp.psd_wrap(cov.values))


# ---------------------------------------------------------------- strategies


def _min_variance(net_mu: pd.Series, cov: pd.DataFrame, c: Constraints, floor: float) -> tuple[pd.Series, list[str]]:
    isins = list(cov.index)
    w = cp.Variable(len(isins))
    weights = _solve(cp.Minimize(_variance(w, cov)), _feasible_set(w, isins, c, floor), w, isins, "min_variance")
    return weights, []


def _max_return(net_mu: pd.Series, cov: pd.DataFrame, c: Constraints, floor: float) -> pd.Series:
    isins = list(cov.index)
    w = cp.Variable(len(isins))
    objective = cp.Maximize(net_mu.values @ w)
    return _solve(objective, _feasible_set(w, isins, c, floor), w, isins, "max_return")


def _target_vol(net_mu: pd.Series, cov: pd.DataFrame, c: Constraints, floor: float) -> tuple[pd.Series, list[str]]:
    """Highest net expected return with volatility <= target; min-variance / max-return if out of reach."""
    min_var_weights, _ = _min_variance(net_mu, cov, c, floor)
    min_var_vol = _portfolio_vol(min_var_weights, cov)
    if c.target_vol < min_var_vol:
        return min_var_weights, [
            f"target volatility {c.target_vol:.2%} is below the lowest reachable {min_var_vol:.2%}; "
            f"using the minimum-variance portfolio (volatility {min_var_vol:.2%})"
        ]

    max_return_weights = _max_return(net_mu, cov, c, floor)
    max_return_vol = _portfolio_vol(max_return_weights, cov)
    if c.target_vol > max_return_vol:
        return max_return_weights, [
            f"target volatility {c.target_vol:.2%} is above the highest-return portfolio's {max_return_vol:.2%}; "
            f"using the maximum-return portfolio (volatility {max_return_vol:.2%})"
        ]

    isins = list(cov.index)
    w = cp.Variable(len(isins))
    within_target = _variance(w, cov) <= c.target_vol**2
    objective = cp.Maximize(net_mu.values @ w)
    weights = _solve(objective, _feasible_set(w, isins, c, floor) + [within_target], w, isins, "target_vol")
    return weights, []


SOLVERS: dict[str, Solver] = {
    "target_vol": _target_vol,
    "min_variance": _min_variance,
}


# ---------------------------------------------------------------- honesty check


def _constraint_violations(weights: pd.Series, c: Constraints) -> list[str]:
    """Human-readable list of every bound the final weights break (empty for the cvxpy strategies)."""
    held = weights[weights > 0]
    too_small = int((held < c.min_position - BOUND_TOLERANCE).sum())
    too_large = int((held > c.max_position + BOUND_TOLERANCE).sum())
    problems = []
    if len(held) > c.max_etfs:
        problems.append(f"{len(held)} funds held, more than max_etfs = {c.max_etfs}")
    if too_small:
        problems.append(f"{too_small} position(s) below min_position {c.min_position:.0%}")
    if too_large:
        problems.append(f"{too_large} position(s) above max_position {c.max_position:.0%}")
    for group, minimum in c.group_min.items():
        share = weights.reindex(c.groups.get(group, [])).fillna(0).sum()
        if share < minimum - BOUND_TOLERANCE:
            problems.append(f"{group} holds {share:.1%}, below its minimum {minimum:.0%}")
    for group, maximum in c.group_max.items():
        share = weights.reindex(c.groups.get(group, [])).fillna(0).sum()
        if share > maximum + BOUND_TOLERANCE:
            problems.append(f"{group} holds {share:.1%}, above its maximum {maximum:.0%}")
    return [f"constraint not met: {p}" for p in problems]
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && uv run pytest tests/engine_c -v`
Expected: 39 passed (13 expected + 9 constraints + 17 optimize).

If `test_capital_market_line_with_cash` fails, print `optimize(...).weights` for both targets: cash must be > 0.1 in both (both targets below the tangency vol ≈ 11.5%). Do not loosen the other tests; a failing `vol <= target + 1e-4` means the solver status handling is wrong, not the tolerance.

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/optimize.py backend/tests/engine_c/test_optimize.py
git commit -m "feat(engine): cvxpy target-volatility optimizer with cardinality loop and fallbacks"
```

---

### Task 4: Comparison strategies — max_sharpe, risk_parity, hrp

**Files:**
- Modify: `backend/app/engine/optimize.py` (add imports, three strategies + HRP helpers, extend `SOLVERS`)
- Create: `backend/tests/engine_c/test_strategies.py`

**Interfaces:**
- Consumes: Task 3 private helpers (`_variance`, `_solve`, `_clean`, `_group_bounds`, `_min_variance`, `Solver`, `SOLVERS`).
- Produces: `optimize(..., strategy)` for all five `Strategy` values. `max_sharpe` reads `mu` as excess return (rf = 0) and falls back to min-variance with the warning `"max_sharpe: no fund has a positive expected excess return; using minimum variance"` when no fund has positive net excess return. `risk_parity` / `hrp` ignore bounds and report violations as warnings.

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_c/test_strategies.py`:

```python
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_c/test_strategies.py -v`
Expected: 7 FAIL with `KeyError: 'max_sharpe'` / `'risk_parity'` / `'hrp'`; the 2 min-variance tests pass already.

- [ ] **Step 3: Add the SciPy imports**

In `backend/app/engine/optimize.py`, directly below `import pandas as pd`, add:

```python
from scipy.cluster.hierarchy import leaves_list, linkage
from scipy.spatial.distance import squareform
```

- [ ] **Step 4: Add the three strategies**

In `backend/app/engine/optimize.py`, insert immediately above the line `SOLVERS: dict[str, Solver] = {`:

```python
def _max_sharpe(net_mu: pd.Series, cov: pd.DataFrame, c: Constraints, floor: float) -> tuple[pd.Series, list[str]]:
    """Tangency portfolio with rf = 0 (net_mu is read as excess return).

    Convex trick (Cornuejols & Tütüncü): with y = k * w and k > 0, maximising mu.w / sqrt(w'Σw) is the same as
    minimising y'Σy subject to mu.y = 1. Every linear bound on w becomes the same bound scaled by k.
    """
    if (net_mu <= 0).all():
        weights, _ = _min_variance(net_mu, cov, c, floor)
        return weights, ["max_sharpe: no fund has a positive expected excess return; using minimum variance"]
    isins = list(cov.index)
    y = cp.Variable(len(isins))
    k = cp.Variable(nonneg=True)
    scaled = [net_mu.values @ y == 1, cp.sum(y) == k, y >= floor * k, y <= c.max_position * k]
    scaled += _group_bounds(y, k, isins, c)
    weights = _solve(cp.Minimize(_variance(y, cov)), scaled, y, isins, "max_sharpe")  # _clean divides by k
    return weights, []


def _risk_parity(net_mu: pd.Series, cov: pd.DataFrame, c: Constraints, floor: float) -> tuple[pd.Series, list[str]]:
    """Equal risk contribution (Spinu's log-barrier form): minimise ½ y'Σy − (1/n) Σ log y, then w = y / Σy.

    At the optimum every fund contributes the same share of variance. Position and group bounds are not part
    of the problem (adding them breaks the equal-contribution property), so violations are reported as warnings.
    """
    isins = list(cov.index)
    y = cp.Variable(len(isins), pos=True)
    objective = cp.Minimize(0.5 * _variance(y, cov) - cp.sum(cp.log(y)) / len(isins))
    problem = cp.Problem(objective)
    problem.solve(solver=cp.CLARABEL)
    if y.value is None:
        raise InfeasibleConstraints(f"risk_parity: solver failed ({problem.status})")
    return _clean(pd.Series(y.value, index=isins)), []


def _hrp(net_mu: pd.Series, cov: pd.DataFrame, c: Constraints, floor: float) -> tuple[pd.Series, list[str]]:
    """Hierarchical risk parity (López de Prado, 2016) from the covariance alone; bounds are not enforced.

    1. Cluster funds by correlation distance sqrt((1 - corr) / 2) (single linkage).
    2. Order funds so that similar ones sit next to each other (the dendrogram's leaf order).
    3. Recursive bisection: split the ordered list in halves and give each half a share inversely
       proportional to its variance, down to single funds.
    (Written out here because pypfopt 1.6's HRPOpt breaks on current SciPy.)
    """
    ordered = _cluster_order(cov)
    weights = pd.Series(1.0, index=ordered)
    clusters = [ordered]
    while clusters:
        clusters = [half for cluster in clusters if len(cluster) > 1
                    for half in (cluster[: len(cluster) // 2], cluster[len(cluster) // 2:])]
        for left, right in zip(clusters[::2], clusters[1::2]):
            left_variance, right_variance = _cluster_variance(cov, left), _cluster_variance(cov, right)
            left_share = 1 - left_variance / (left_variance + right_variance)
            weights[left] *= left_share
            weights[right] *= 1 - left_share
    return _clean(weights.reindex(cov.index)), []


def _cluster_order(cov: pd.DataFrame) -> list[str]:
    vols = np.sqrt(np.diag(cov.values))
    correlation = np.clip(cov.values / np.outer(vols, vols), -1, 1)
    distance = np.sqrt((1 - correlation) / 2)
    np.fill_diagonal(distance, 0.0)
    tree = linkage(squareform(distance, checks=False), method="single")
    return list(cov.index[leaves_list(tree)])


def _cluster_variance(cov: pd.DataFrame, members: list[str]) -> float:
    """Variance of the inverse-variance-weighted portfolio of `members`."""
    sub_cov = cov.loc[members, members].values
    inverse_variance = 1 / np.diag(sub_cov)
    w = inverse_variance / inverse_variance.sum()
    return float(w @ sub_cov @ w)
```

- [ ] **Step 5: Register them**

Replace the `SOLVERS` dict with:

```python
SOLVERS: dict[str, Solver] = {
    "target_vol": _target_vol,
    "min_variance": _min_variance,
    "max_sharpe": _max_sharpe,
    "risk_parity": _risk_parity,
    "hrp": _hrp,
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `cd backend && uv run pytest tests/engine_c -v`
Expected: 48 passed.

Run: `cd backend && uv run pytest`
Expected: all Phase 0 tests and all `engine_c` tests pass (other lanes' stubs are untouched).

- [ ] **Step 7: Commit**

```bash
git add backend/app/engine/optimize.py backend/tests/engine_c/test_strategies.py
git commit -m "feat(engine): max-sharpe, risk-parity and HRP comparison strategies"
```

---

## Notes for the integrator (Phase 2)

- **Pipeline call pattern:** `market = market_returns(returns, config.ANCHORS[base], config.MARKETS[model]["weights"])`; `capm_result = capm(returns[cov.index], market, data.rf(base), premium, model, window_years, end)`; `optimize(capm_result.expected - capm_result.rf, cov, constraints, strategy)`. Passing excess returns is required for `max_sharpe` and harmless for the others.
- Use the same `window_years` and `end` for `risk.covariance` and `capm` so every fund in `cov` has a finite beta (a fund with < 2 overlapping weeks gets NaN `expected`; `optimize` does not accept NaN in `mu`).
- `risk_parity` and `hrp` put most weight in a near-riskless cash fund (≈ 90% in the fixture) and report `"constraint not met: ... above max_position"`; consider removing `asset_class:cash` from the universe for those strategies.
- `InfeasibleConstraints` from `optimize` ("... cannot add up to 100%") happens when `max_position × max_etfs < 1`; the API could validate this earlier in `Preferences`.
