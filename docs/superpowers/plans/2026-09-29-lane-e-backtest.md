# Lane E — Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `app.engine.backtest.rebalance_dates`, `auto_benchmark` and `run` exactly per the frozen Phase 0 docstrings and spec §5.8: a weekly portfolio/benchmark simulation with drift, `none`/`periodic`/`threshold` rebalancing, transaction costs, static vs walk-forward targets, and a `BacktestResult` with series, metrics, proxied periods, rebalance dates and warnings.

**Architecture:** One explicit weekly loop over numpy arrays (`_simulate`) used twice — once for the portfolio, once for the benchmark — plus small helpers (`_window`, `_as_array`, `_grow`, `_due`, `_result`, `_proxied_periods`, `_num`). The timing convention is fixed and documented in the module docstring: the value on week `t` is recorded *before* any trade decided at the close of `t`, so a decision taken at `t` (including `weights_fn(t)`) never earns the return of week `t`. Metrics come from `app.engine.metrics` (Lane D, built in parallel); `backtest.py` always calls them as `metrics.<name>` / `metrics.REGISTRY` at call time so tests can monkeypatch them while `metrics.py` is still a stub.

**Tech Stack:** Python 3.12, uv, pandas, numpy, Pydantic v2 (contract types), pytest.

**Spec:** `docs/superpowers/specs/2026-09-29-roboadvisor-design.md` (§5.8, §7 `BacktestSettings`/`BacktestResult`, §10 backtest tests). Builds on `docs/superpowers/plans/2026-09-29-phase0-contracts.md`, as merged at tag `phase0-contracts`.

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

Lane E specifics:
- Lane E edits **only** `backend/app/engine/backtest.py`. Tests live in `backend/tests/engine_e/` (new, with an empty `__init__.py`). Do not edit `metrics.py`, `types.py`, `config.py`, `tests/conftest.py` or any other lane's file. If a contract looks wrong, stop and escalate to the integrator.
- The signatures and docstrings of `rebalance_dates`, `auto_benchmark` and `run` (and the `WeightsFn` alias) are copied verbatim from Phase 0 and must not change.
- **Independence from Lane D:** `backtest.run` uses `metrics.REGISTRY`, `metrics.beta`, `metrics.drawdown_series`, `metrics.rolling_vol`, `metrics.rolling_sharpe`. While Lane D is unmerged these raise `NotImplementedError` (and `REGISTRY` is `{}`), so `backend/tests/engine_e/conftest.py` installs an **autouse monkeypatch** with tiny local implementations. `backtest.py` must therefore write `from app.engine import metrics` and call `metrics.X(...)` inside functions — never `from app.engine.metrics import REGISTRY` (that would bind the stub before the patch). Task 7 (integration-time) removes the monkeypatch.
- All commands run from `backend/`: `cd backend && uv run pytest ...`. Commits run from the repo root.

## File structure

| File | Responsibility |
|---|---|
| `backend/app/engine/backtest.py` | Everything Lane E ships: `rebalance_dates`, `auto_benchmark`, `run` and private helpers. |
| `backend/tests/engine_e/__init__.py` | Empty; makes the test dir a package. |
| `backend/tests/engine_e/conftest.py` | TEMPORARY autouse fake of the five metrics `run` uses (removed in Task 7). |
| `backend/tests/engine_e/helpers.py` | Tiny hand-computable inputs: `weekly`, `zero_rf`, `fixed`, `bt`, `inverse_vol_fn`, `corrupt_after`. |
| `backend/tests/engine_e/test_rebalance_dates.py` | Task 1 |
| `backend/tests/engine_e/test_auto_benchmark.py` | Task 2 |
| `backend/tests/engine_e/test_run_basic.py` | Task 3 (buy and hold, costs, NaN, window, output shape) |
| `backend/tests/engine_e/test_run_rebalance.py` | Task 4 (periodic, threshold, costs on trades, turnover) |
| `backend/tests/engine_e/test_walk_forward.py` | Task 5 (static vs walk-forward, look-ahead) |
| `backend/tests/engine_e/test_run_output.py` | Task 6 (proxied periods, speed) |

## Timing convention (read before any task)

Window weeks are `t0 … tN` (index weeks inside `[start, end]`).

1. At the close of `t0`: `target = weights_fn(t0)`; buy it. `value[0] = 1.0` (recorded before the buy cost). Holdings after the buy: `target * (1 − bps/1e4)`.
2. For `k = 1 … N`: holdings grow by the returns of row `t_k`; `value[k] = sum(holdings)` is recorded; then, if `k < N` and a rebalance is due at `t_k`, trade at the close of `t_k`: `holdings = w_new * value[k] * (1 − bps/1e4 * Σ|w_new − w_drift|)`. The cost therefore shows up in `value[k+1]`.
3. The return in row `t0` is never earned. Nothing trades at `tN` (periodic dates exclude it by definition; threshold checks skip it too).
4. `series.dates[0] = t0`; every series has `N + 1` entries. Metrics are computed on `value.pct_change()` over `t1 … tN`, so the initial buy cost is inside the first return.
5. Turnover metric = Σ over rebalances (initial buy excluded) of one-way turnover `½ Σ|w_new − w_drift|`, divided by the window length in years `N / 52`.

---

### Task 1: `rebalance_dates`

**Files:**
- Modify: `backend/app/engine/backtest.py` (whole file rewritten; `auto_benchmark` and `run` still raise)
- Create: `backend/tests/engine_e/__init__.py` (empty)
- Test: `backend/tests/engine_e/test_rebalance_dates.py`

**Interfaces:**
- Consumes: `app.engine.types.RebalanceSettings` (`type: "none"|"periodic"|"threshold"`, `frequency: "monthly"|"quarterly"|"annual"`, `threshold: float`).
- Produces: `rebalance_dates(index: pd.DatetimeIndex, rebalance: RebalanceSettings) -> list[pd.Timestamp]` (sorted, final week excluded); module constant `LOOKAHEAD_WARNING: str`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_e/__init__.py`: empty file.

`backend/tests/engine_e/test_rebalance_dates.py`:

```python
import pandas as pd

from app.engine.backtest import rebalance_dates
from app.engine.types import RebalanceSettings

TS = pd.Timestamp


def periodic(frequency: str) -> RebalanceSettings:
    return RebalanceSettings(type="periodic", frequency=frequency)


def test_monthly_is_last_week_of_each_month_excluding_final_week():
    # Fridays 2024-01-05 .. 2024-05-17 (Jan 4, Feb 4, Mar 5, Apr 4, May 3 weeks)
    idx = pd.date_range("2024-01-05", periods=20, freq="W-FRI")
    assert rebalance_dates(idx, periodic("monthly")) == [
        TS("2024-01-26"), TS("2024-02-23"), TS("2024-03-29"), TS("2024-04-26"),
    ]  # 2024-05-17 is the last week of its (partial) month but is the final week -> excluded


def test_quarterly():
    idx = pd.date_range("2024-01-05", periods=20, freq="W-FRI")
    assert rebalance_dates(idx, periodic("quarterly")) == [TS("2024-03-29")]


def test_annual_excludes_final_week_even_when_it_is_a_year_end():
    idx = pd.date_range("2021-01-01", "2023-12-29", freq="W-FRI")
    assert rebalance_dates(idx, periodic("annual")) == [TS("2021-12-31"), TS("2022-12-30")]


def test_none_and_threshold_give_no_dates():
    idx = pd.date_range("2024-01-05", periods=20, freq="W-FRI")
    assert rebalance_dates(idx, RebalanceSettings(type="none")) == []
    assert rebalance_dates(idx, RebalanceSettings(type="threshold", threshold=0.05)) == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_e/test_rebalance_dates.py -v`
Expected: 4 FAIL with `NotImplementedError: Lane E`.

- [ ] **Step 3: Rewrite `backend/app/engine/backtest.py`**

```python
"""Lane E. Spec §5.8. Weekly backtest with drift, rebalancing and transaction costs.

Timing convention (the whole module relies on it):
- The window is the index weeks t0..tN inside [start, end].
- At the close of t0 the initial target weights_fn(t0) is bought. value[0] = 1.0, recorded before the buy cost.
- Week k >= 1: holdings grow by the returns of row t_k, value[k] is recorded, and only then, if a rebalance is
  due at t_k (never at tN), we trade at the close of t_k and pay the cost, which shows up in value[k+1].
- So a decision taken at t (including weights_fn(t)) never earns the return of week t, and weights_fn only
  ever needs data <= t. The return in row t0 is never earned.
"""

import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import pandas as pd

from app import config
from app.engine import metrics  # call metrics.X at run time (tests patch the module while Lane D is a stub)
from app.engine.errors import InvalidSettings
from app.engine.types import BacktestResult, BacktestSeries, BacktestSettings, ProxiedPeriod, RebalanceSettings

WeightsFn = Callable[[pd.Timestamp], pd.Series]

LOOKAHEAD_WARNING = "static mode: weights were chosen using data from the whole period (look-ahead bias)"
_PERIOD = {"monthly": "M", "quarterly": "Q", "annual": "Y"}


def rebalance_dates(index: pd.DatetimeIndex, rebalance: RebalanceSettings) -> list[pd.Timestamp]:
    """periodic: the last week of each month / quarter / year in index, excluding the final week.
    none / threshold: [] (threshold triggers are evaluated inside run)."""
    if rebalance.type != "periodic" or len(index) < 2:
        return []
    periods = index.to_period(_PERIOD[rebalance.frequency])
    # A week is the last of its period when the next week belongs to another period.
    # The final week has no next week, so it is never included.
    is_last = np.asarray(periods[1:] != periods[:-1])
    return list(index[:-1][is_last])


def auto_benchmark(equity: pd.Series, bonds: pd.Series, target_vol: float) -> float:
    """Equity share in [0, 1] (step 0.01) whose fixed-mix annualised vol (weekly std * sqrt(52), common non-NaN
    weeks) is closest to target_vol."""
    raise NotImplementedError("Lane E")


def run(
    returns: pd.DataFrame,
    weights_fn: WeightsFn,
    settings: BacktestSettings,
    benchmark_weights: pd.Series,
    rf: pd.Series,
    proxied: dict[str, tuple[pd.Timestamp, pd.Timestamp]],
) -> BacktestResult:
    """Simulate the portfolio and benchmark over the backtest window (spec §5.8).

    returns: weekly base-ccy returns; columns include every isin weights_fn can return and every benchmark isin.
    rf: weekly risk-free rate (annual/52) aligned to returns, for Sharpe/Sortino.
    Window: settings.start..settings.end (None -> last index week and last minus config.BACKTEST_YEARS years).
    Initial target = weights_fn(first window week); the initial buy costs bps/1e4 * 1.0.
    Each week holdings drift with returns. Rebalance on rebalance_dates (periodic) or when
    max |w_drift - target| > threshold (threshold); never for 'none'.
    On each rebalance: walk_forward -> target = weights_fn(t); static -> target stays the initial weights.
    Cost per trade = bps/1e4 * sum |w_new - w_drift|, deducted from value.
    A NaN return for a held fund counts as 0 that week and adds a warning.
    Benchmark: benchmark_weights, same rebalancing rule, static target, same costs.
    series: value starts at 1.0 on the week before the first return; rolling windows config.ROLLING_WINDOW_WEEKS.
    metrics: {'portfolio': REGISTRY + beta + turnover, 'benchmark': REGISTRY}; turnover = annualised one-way.
    weights: the initial target weights. proxied_periods: proxied ranges of held funds clipped to the window.
    static mode adds the warning
      'static mode: weights were chosen using data from the whole period (look-ahead bias)'.
    trace is left empty (the pipeline fills it).
    """
    raise NotImplementedError("Lane E")
```

The three public signatures and docstrings above are copied verbatim from Phase 0; do not edit them.

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && uv run pytest tests/engine_e/test_rebalance_dates.py -v`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/backtest.py backend/tests/engine_e/__init__.py backend/tests/engine_e/test_rebalance_dates.py
git commit -m "feat(backtest): periodic rebalance dates"
```

---

### Task 2: `auto_benchmark`

**Files:**
- Modify: `backend/app/engine/backtest.py` (replace the body of `auto_benchmark`)
- Test: `backend/tests/engine_e/test_auto_benchmark.py`

**Interfaces:**
- Consumes: `weekly_eur` fixture (session, from `tests/conftest.py`): anchors `IE00B6R52259` (EUR-view global equity) and `IE00BDBRDM35` (EUR-hedged global bonds), both fully non-NaN.
- Produces: `auto_benchmark(equity: pd.Series, bonds: pd.Series, target_vol: float) -> float` — an equity share in `{0.00, 0.01, …, 1.00}`; ties resolve to the lowest share; raises `InvalidSettings` with fewer than 2 common non-NaN weeks. The pipeline turns it into `benchmark_weights = {global_equity: s, global_bonds: 1 − s}`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_e/test_auto_benchmark.py`:

```python
import numpy as np
import pandas as pd
import pytest

from app.engine.backtest import auto_benchmark
from app.engine.errors import InvalidSettings

EQ, BD = "IE00B6R52259", "IE00BDBRDM35"


def ann_vol(s: pd.Series) -> float:
    return float(s.std() * np.sqrt(52))


def test_equity_vol_gives_all_equity(weekly_eur):
    eq, bd = weekly_eur[EQ], weekly_eur[BD]
    assert auto_benchmark(eq, bd, ann_vol(eq)) == 1.0
    assert auto_benchmark(eq, bd, 5.0) == 1.0  # unreachable target -> closest end


def test_bond_vol_gives_all_bonds(weekly_eur):
    eq, bd = weekly_eur[EQ], weekly_eur[BD]
    assert auto_benchmark(eq, bd, ann_vol(bd)) == 0.0


def test_in_between_targets_are_monotonic(weekly_eur):
    eq, bd = weekly_eur[EQ], weekly_eur[BD]
    targets = np.linspace(ann_vol(bd), ann_vol(eq), 9)
    shares = [auto_benchmark(eq, bd, t) for t in targets]
    assert shares == sorted(shares)
    assert shares[0] == 0.0 and shares[-1] == 1.0
    assert 0.0 < shares[4] < 1.0
    assert all(round(s, 2) == s for s in shares)  # 0.01 grid


def test_uses_common_non_nan_weeks_only():
    idx = pd.date_range("2024-01-05", periods=4, freq="W-FRI")
    eq = pd.Series([np.nan, 0.02, -0.01, np.nan], index=idx)
    bd = pd.Series([0.001, np.nan, 0.002, 0.0], index=idx)
    with pytest.raises(InvalidSettings):
        auto_benchmark(eq, bd, 0.1)  # only one common week
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_e/test_auto_benchmark.py -v`
Expected: 4 FAIL with `NotImplementedError: Lane E`.

- [ ] **Step 3: Implement**

Replace the body of `auto_benchmark` (keep signature and docstring):

```python
def auto_benchmark(equity: pd.Series, bonds: pd.Series, target_vol: float) -> float:
    """Equity share in [0, 1] (step 0.01) whose fixed-mix annualised vol (weekly std * sqrt(52), common non-NaN
    weeks) is closest to target_vol."""
    both = pd.concat([equity, bonds], axis=1).dropna().to_numpy(dtype=float)
    if len(both) < 2:
        raise InvalidSettings("auto benchmark needs at least 2 weeks where both anchors have returns")
    shares = np.arange(101) / 100  # 0.00, 0.01, ..., 1.00 (0 and 1 are exact)
    mixes = both[:, [0]] * shares + both[:, [1]] * (1 - shares)  # one column per candidate share
    vols = mixes.std(axis=0, ddof=1) * math.sqrt(config.PERIODS_PER_YEAR)
    return float(shares[np.argmin(np.abs(vols - target_vol))])  # argmin: ties -> lowest share
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && uv run pytest tests/engine_e/test_auto_benchmark.py -v`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/backtest.py backend/tests/engine_e/test_auto_benchmark.py
git commit -m "feat(backtest): auto benchmark equity share matching target vol"
```

---

### Task 3: `run` — buy and hold, costs, NaN handling, window, result assembly

**Files:**
- Modify: `backend/app/engine/backtest.py` (add helpers, replace the body of `run`)
- Create: `backend/tests/engine_e/conftest.py` (TEMPORARY metrics fake), `backend/tests/engine_e/helpers.py`
- Test: `backend/tests/engine_e/test_run_basic.py`

**Interfaces:**
- Consumes: `rebalance_dates` (Task 1); `metrics.REGISTRY: dict[str, Callable[[pd.Series, pd.Series], float]]`, `metrics.beta(r, benchmark) -> float`, `metrics.drawdown_series(r) -> pd.Series` (same index as `r`), `metrics.rolling_vol(r, window=156) -> pd.Series`, `metrics.rolling_sharpe(r, rf, window=156) -> pd.Series` — all faked in tests until Task 7.
- Produces (private, used by Tasks 4–6):
  - `_Path` dataclass: `value: np.ndarray`, `rebalances: list[pd.Timestamp]`, `one_way_turnover: float`, `nan_weeks: dict[str, int]`, `held: set[str]`.
  - `_window(index, settings) -> pd.DatetimeIndex`
  - `_as_array(weights: pd.Series, cols: list[str]) -> np.ndarray`
  - `_grow(hold, r, cols, nan_weeks) -> np.ndarray`
  - `_simulate(R, window, cols, target, rebalance, bps, periodic, retarget=None) -> _Path`
  - `_result(window, port, bench, rf, weights, warnings, proxied_periods) -> BacktestResult`
  - `_nan_warnings(path, prefix) -> list[str]`, `_num(x) -> float | None`
- Test helpers (`tests.engine_e.helpers`): `weekly(rows, start="2024-01-05") -> DataFrame`, `zero_rf(returns) -> Series`, `fixed(weights) -> WeightsFn`, `bt(returns, weights, bench=None, proxied=None, **settings) -> BacktestResult`, `inverse_vol_fn(returns, isins, calls=None) -> WeightsFn`, `corrupt_after(returns, t) -> DataFrame`.

- [ ] **Step 1: Write the temporary metrics fake**

`backend/tests/engine_e/conftest.py`:

```python
"""TEMPORARY — remove at integration (Lane E plan, Task 7).

Lane D builds app.engine.metrics in parallel; until it merges, those functions raise NotImplementedError and
REGISTRY is empty. backtest.run calls them as `metrics.<name>` at run time, so replacing the module attributes
here lets Lane E's tests run on their own. Keep these fakes tiny and obviously correct: they are not under test.
"""

import numpy as np
import pandas as pd
import pytest

from app.engine import metrics


def _drawdown_series(r: pd.Series) -> pd.Series:
    value = (1 + r).cumprod()
    peak = value.cummax().clip(lower=1.0)  # the starting value 1 counts as a peak
    return value / peak - 1


def _rolling_vol(r: pd.Series, window: int = 156, periods: int = 52) -> pd.Series:
    return r.rolling(window).std() * np.sqrt(periods)


def _rolling_sharpe(r: pd.Series, rf=0.0, window: int = 156, periods: int = 52) -> pd.Series:
    excess = r - rf
    return excess.rolling(window).mean() * periods / (r.rolling(window).std() * np.sqrt(periods))


def _beta(r: pd.Series, benchmark: pd.Series) -> float:
    both = pd.concat([r, benchmark], axis=1).dropna()
    var = float(both.iloc[:, 1].var())
    return float(both.cov().iloc[0, 1]) / var if var > 0 else float("nan")


_FAKE_REGISTRY = {
    "cagr": lambda r, rf: float((1 + r).prod() ** (52 / len(r)) - 1),
    "volatility": lambda r, rf: float(r.std() * np.sqrt(52)),
}


@pytest.fixture(autouse=True)
def fake_metrics(monkeypatch):
    monkeypatch.setattr(metrics, "drawdown_series", _drawdown_series)
    monkeypatch.setattr(metrics, "rolling_vol", _rolling_vol)
    monkeypatch.setattr(metrics, "rolling_sharpe", _rolling_sharpe)
    monkeypatch.setattr(metrics, "beta", _beta)
    monkeypatch.setattr(metrics, "REGISTRY", _FAKE_REGISTRY)
```

- [ ] **Step 2: Write the test helpers**

`backend/tests/engine_e/helpers.py`:

```python
"""Tiny hand-computable inputs for Lane E tests."""

import pandas as pd

from app.engine.backtest import run
from app.engine.types import BacktestResult, BacktestSettings


def weekly(rows: dict[str, list[float]], start: str = "2024-01-05") -> pd.DataFrame:
    """Weekly (W-FRI) return frame starting on `start` (a Friday).
    Row 0 is the first window week t0: its return is never earned (see the timing convention)."""
    n = len(next(iter(rows.values())))
    return pd.DataFrame(rows, index=pd.date_range(start, periods=n, freq="W-FRI"), dtype=float)


def zero_rf(returns: pd.DataFrame) -> pd.Series:
    return pd.Series(0.0, index=returns.index)


def fixed(weights: dict[str, float]):
    s = pd.Series(weights, dtype=float)
    return lambda t: s


def bt(returns, weights, bench=None, proxied=None, **settings) -> BacktestResult:
    """run() with constant weights, zero rf and the given BacktestSettings fields."""
    return run(
        returns, fixed(weights), BacktestSettings(**settings),
        pd.Series(bench or weights, dtype=float), zero_rf(returns), proxied or {},
    )


def inverse_vol_fn(returns: pd.DataFrame, isins: list[str], calls: list | None = None):
    """The pattern the pipeline's walk-forward weights_fn must follow: slice to rows <= t FIRST,
    then estimate. Records every call date in `calls`."""

    def weights_fn(t: pd.Timestamp) -> pd.Series:
        if calls is not None:
            calls.append(t)
        past = returns.loc[:t, isins].tail(52)  # only data <= t
        inv = 1 / past.std()
        return inv / inv.sum()

    return weights_fn


def corrupt_after(returns: pd.DataFrame, t: pd.Timestamp) -> pd.DataFrame:
    """Copy of returns with every row after t replaced by garbage."""
    bad = returns.copy()
    bad.loc[bad.index > t] = 1e6
    return bad
```

- [ ] **Step 3: Write the failing tests**

`backend/tests/engine_e/test_run_basic.py`:

```python
from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.engine import metrics
from app.engine.backtest import run
from app.engine.errors import InvalidSettings
from app.engine.types import BacktestSettings
from tests.engine_e.helpers import bt, fixed, weekly, zero_rf

ANCHORS_6040 = {"IE00B6R52259": 0.6, "IE00BDBRDM35": 0.4}


def test_none_equals_buy_and_hold_minus_initial_cost():
    # Row 0 holds garbage on purpose: the return of t0 is never earned.
    r = weekly({"A": [9.99, 0.10, -0.05, 0.02], "B": [9.99, 0.01, 0.01, -0.03]})
    res = bt(r, {"A": 0.6, "B": 0.4}, transaction_cost_bps=10)
    growth = (1 + r.iloc[1:]).prod()  # A: 1.1*0.95*1.02, B: 1.01*1.01*0.97
    expected = (1 - 10 / 1e4) * (0.6 * growth["A"] + 0.4 * growth["B"])
    assert res.series.portfolio[0] == 1.0
    assert res.series.portfolio[-1] == pytest.approx(expected, rel=1e-12)
    assert res.rebalance_dates == []
    assert res.metrics["portfolio"]["turnover"] == 0.0


def test_zero_bps_equals_no_cost_path():
    r = weekly({"A": [0.0, 0.10, -0.05, 0.02], "B": [0.0, 0.01, 0.01, -0.03]})
    res = bt(r, {"A": 0.6, "B": 0.4}, transaction_cost_bps=0)
    cum = (1 + r.iloc[1:]).cumprod()
    no_cost = [1.0] + list(0.6 * cum["A"] + 0.4 * cum["B"])
    assert res.series.portfolio == pytest.approx(no_cost, rel=1e-12)


def test_nan_return_of_held_fund_counts_as_zero_and_warns():
    r = weekly({
        "A": [0.0, 0.10, np.nan, 0.10],
        "B": [0.0, 0.0, 0.0, 0.0],
        "C": [np.nan, np.nan, np.nan, np.nan],  # not held: no warning
    })
    res = bt(r, {"A": 0.5, "B": 0.5}, transaction_cost_bps=0)
    assert res.series.portfolio[-1] == pytest.approx(0.5 * 1.1 * 1.1 + 0.5)
    assert any(w.startswith("A:") and "1 week" in w for w in res.warnings)
    assert not any(w.startswith("C:") for w in res.warnings)


def test_result_shape_series_and_metrics():
    r = weekly({"A": [0.0, 0.01, -0.02, 0.03, 0.01, -0.01], "B": [0.0, 0.002, 0.001, -0.001, 0.0, 0.003]})
    res = bt(r, {"A": 0.5, "B": 0.5}, bench={"A": 1.0}, transaction_cost_bps=10)
    s = res.series
    n = len(r)
    assert len(s.dates) == len(s.portfolio) == len(s.benchmark) == len(s.drawdown) == n
    assert len(s.rolling_vol) == len(s.rolling_sharpe) == n
    assert s.dates[0] == date(2024, 1, 5)  # value 1.0 sits on the week before the first return
    assert s.portfolio[0] == 1.0 and s.benchmark[0] == 1.0 and s.drawdown[0] == 0.0
    assert all(d <= 0 for d in s.drawdown)
    assert all(v is None for v in s.rolling_vol)  # fewer than 156 weeks
    assert s.benchmark[-1] == pytest.approx((1 - 0.001) * (1 + r["A"].iloc[1:]).prod())
    assert set(res.metrics["portfolio"]) == set(metrics.REGISTRY) | {"beta", "turnover"}
    assert set(res.metrics["benchmark"]) == set(metrics.REGISTRY)
    assert res.weights == {"A": 0.5, "B": 0.5}
    assert res.trace == []


def test_window_defaults_to_last_15_years(weekly_eur):
    w = pd.Series(ANCHORS_6040)
    res = run(weekly_eur, fixed(ANCHORS_6040), BacktestSettings(transaction_cost_bps=0), w, zero_rf(weekly_eur), {})
    end = weekly_eur.index[-1]
    expected_start = weekly_eur.index[weekly_eur.index >= end - pd.DateOffset(years=15)][0]
    assert res.series.dates[0] == expected_start.date()
    assert res.series.dates[-1] == end.date()


def test_window_respects_settings(weekly_eur):
    w = pd.Series(ANCHORS_6040)
    settings = BacktestSettings(start=date(2012, 1, 1), end=date(2015, 6, 30))
    res = run(weekly_eur, fixed(ANCHORS_6040), settings, w, zero_rf(weekly_eur), {})
    assert res.series.dates[0] == date(2012, 1, 6)  # first Friday >= start
    assert res.series.dates[-1] == date(2015, 6, 26)  # last Friday <= end

    only_end = run(weekly_eur, fixed(ANCHORS_6040), BacktestSettings(end=date(2020, 12, 31)), w, zero_rf(weekly_eur), {})
    # last Friday <= 2020-12-31 is 2020-12-25; minus 15 years = 2005-12-25 (a Sunday) -> next Friday 2005-12-30
    assert only_end.series.dates[0] == date(2005, 12, 30)


def test_window_with_fewer_than_two_weeks_is_rejected():
    r = weekly({"A": [0.0, 0.01, 0.02]})
    with pytest.raises(InvalidSettings):
        bt(r, {"A": 1.0}, start=date(2024, 1, 19))
```

- [ ] **Step 4: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_e/test_run_basic.py -v`
Expected: 7 FAIL with `NotImplementedError: Lane E`.

- [ ] **Step 5: Implement helpers and `run`**

In `backend/app/engine/backtest.py`, add these helpers between `auto_benchmark` and `run`:

```python
@dataclass
class _Path:
    """One simulated path (portfolio or benchmark)."""

    value: np.ndarray  # one value per window week, value[0] == 1.0
    rebalances: list[pd.Timestamp] = field(default_factory=list)  # trades after the initial buy
    one_way_turnover: float = 0.0  # sum of ½ Σ|w_new - w_drift| over rebalances
    nan_weeks: dict[str, int] = field(default_factory=dict)  # held isin -> weeks with a missing return
    held: set[str] = field(default_factory=set)  # isins with a non-zero target at any time


def _window(index: pd.DatetimeIndex, settings: BacktestSettings) -> pd.DatetimeIndex:
    end = pd.Timestamp(settings.end) if settings.end else index[-1]
    start = pd.Timestamp(settings.start) if settings.start else end - pd.DateOffset(years=config.BACKTEST_YEARS)
    window = index[(index >= start) & (index <= end)]
    if len(window) < 2:
        raise InvalidSettings(f"the backtest window {start.date()}..{end.date()} contains fewer than 2 weeks of data")
    return window


def _as_array(weights: pd.Series, cols: list[str]) -> np.ndarray:
    """Weights as an array aligned to the returns columns (missing isins -> 0)."""
    unknown = sorted(set(weights.index) - set(cols))
    if unknown:
        raise InvalidSettings(f"weights for funds without return data: {unknown}")
    w = weights.reindex(cols).fillna(0.0).to_numpy(dtype=float)
    if abs(w.sum() - 1) > 1e-6:
        raise InvalidSettings(f"weights must sum to 1, got {w.sum():.6f}")
    return w


def _grow(hold: np.ndarray, r: np.ndarray, cols: list[str], nan_weeks: dict[str, int]) -> np.ndarray:
    """One week of drift. A missing return on a held fund counts as 0 and is tallied for a warning."""
    missing = np.isnan(r)
    for i in np.flatnonzero(missing & (hold != 0)):
        nan_weeks[cols[i]] = nan_weeks.get(cols[i], 0) + 1
    return hold * (1.0 + np.where(missing, 0.0, r))


def _simulate(
    R: np.ndarray,
    window: pd.DatetimeIndex,
    cols: list[str],
    target: np.ndarray,
    rebalance: RebalanceSettings,
    bps: float,
    periodic: set[pd.Timestamp],
    retarget: Callable[[pd.Timestamp], np.ndarray] | None = None,
) -> _Path:
    """Buy at the close of t0, then let holdings drift week by week (rebalancing arrives in Task 4)."""
    path = _Path(value=np.empty(len(window)))
    path.value[0] = 1.0
    path.held.update(c for c, x in zip(cols, target) if x != 0)
    hold = target * (1.0 - bps)  # initial buy from cash: one-way turnover 1.0, cost bps * 1.0
    for k in range(1, len(window)):
        hold = _grow(hold, R[k], cols, path.nan_weeks)
        path.value[k] = hold.sum()
    return path


def _num(x) -> float | None:
    """JSON-safe float: NaN / inf -> None."""
    x = float(x)
    return x if math.isfinite(x) else None


def _nan_warnings(path: _Path, prefix: str) -> list[str]:
    return [
        f"{prefix}{isin}: {n} week(s) with a missing return while held, counted as 0%"
        for isin, n in sorted(path.nan_weeks.items())
    ]


def _result(
    window: pd.DatetimeIndex,
    port: _Path,
    bench: _Path,
    rf: pd.Series,
    weights: dict[str, float],
    warnings: list[str],
    proxied_periods: list[ProxiedPeriod],
) -> BacktestResult:
    port_r = pd.Series(port.value, index=window).pct_change().iloc[1:]
    bench_r = pd.Series(bench.value, index=window).pct_change().iloc[1:]
    rf_w = rf.reindex(port_r.index)
    years = len(port_r) / config.PERIODS_PER_YEAR

    m_port = {name: fn(port_r, rf_w) for name, fn in metrics.REGISTRY.items()}
    m_port["beta"] = metrics.beta(port_r, bench_r)
    m_port["turnover"] = port.one_way_turnover / years
    m_bench = {name: fn(bench_r, rf_w) for name, fn in metrics.REGISTRY.items()}

    n = config.ROLLING_WINDOW_WEEKS
    return BacktestResult(
        series=BacktestSeries(
            dates=[t.date() for t in window],
            portfolio=[float(x) for x in port.value],
            benchmark=[float(x) for x in bench.value],
            # metrics work on returns (t1..tN); t0 gets the neutral value
            drawdown=[0.0] + [float(x) for x in metrics.drawdown_series(port_r)],
            rolling_vol=[None] + [_num(x) for x in metrics.rolling_vol(port_r, window=n)],
            rolling_sharpe=[None] + [_num(x) for x in metrics.rolling_sharpe(port_r, rf_w, window=n)],
        ),
        metrics={
            "portfolio": {k: _num(v) for k, v in m_port.items()},
            "benchmark": {k: _num(v) for k, v in m_bench.items()},
        },
        weights=weights,
        proxied_periods=proxied_periods,
        rebalance_dates=[t.date() for t in port.rebalances],
        warnings=warnings,
    )
```

Replace the body of `run` (keep signature and docstring):

```python
    window = _window(returns.index, settings)
    cols = list(returns.columns)
    R = returns.loc[window].to_numpy(dtype=float)
    bps = settings.transaction_cost_bps / 1e4
    periodic = set(rebalance_dates(window, settings.rebalance))

    target0 = _as_array(weights_fn(window[0]), cols)
    port = _simulate(R, window, cols, target0, settings.rebalance, bps, periodic)
    bench = _simulate(R, window, cols, _as_array(benchmark_weights, cols), settings.rebalance, bps, periodic)

    warnings = _nan_warnings(port, "") + _nan_warnings(bench, "benchmark ")
    weights = {c: float(x) for c, x in zip(cols, target0) if x != 0}
    return _result(window, port, bench, rf, weights, warnings, proxied_periods=[])
```

- [ ] **Step 6: Run to verify they pass**

Run: `cd backend && uv run pytest tests/engine_e -v`
Expected: `15 passed` (4 + 4 + 7).

- [ ] **Step 7: Commit**

```bash
git add backend/app/engine/backtest.py backend/tests/engine_e/conftest.py backend/tests/engine_e/helpers.py backend/tests/engine_e/test_run_basic.py
git commit -m "feat(backtest): buy-and-hold simulation, costs, NaN handling and result assembly"
```

---

### Task 4: Rebalancing — periodic, threshold, trade costs, turnover

**Files:**
- Modify: `backend/app/engine/backtest.py` (replace `_simulate`, add `_due`)
- Test: `backend/tests/engine_e/test_run_rebalance.py`

**Interfaces:**
- Consumes: `_Path`, `_grow`, `rebalance_dates` (Tasks 1, 3).
- Produces: final `_simulate(R, window, cols, target, rebalance, bps, periodic, retarget=None) -> _Path` — rebalances at `t_k` (1 ≤ k < N) when `_due`; with `retarget` it asks for a new target at each rebalance (used by Task 5); `_due(t, drift, target, rebalance, periodic) -> bool`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_e/test_run_rebalance.py`:

```python
from datetime import date

import pytest

from tests.engine_e.helpers import bt, weekly

MONTHLY = {"type": "periodic", "frequency": "monthly"}


def test_periodic_monthly_rebalances_on_month_end_weeks():
    # Weeks: Jan 12 (t0), Jan 19, Jan 26 (last week of January -> rebalance), Feb 2, Feb 9, Feb 16 (final)
    r = weekly({"A": [9.99, 0.10, 0.10, 0.0, 0.10, 0.0], "B": [9.99, 0.0, 0.0, 0.0, 0.0, 0.0]}, start="2024-01-12")
    res = bt(r, {"A": 0.5, "B": 0.5}, rebalance=MONTHLY, transaction_cost_bps=0)
    assert res.rebalance_dates == [date(2024, 1, 26)]
    # up to Jan 26: 0.5*1.1*1.1 + 0.5 = 1.105; reset to 50/50, then A +10%: *(0.5*1.1 + 0.5)
    assert res.series.portfolio[-1] == pytest.approx(1.105 * 1.05)
    assert res.series.portfolio[-1] != pytest.approx(0.5 * 1.1**3 + 0.5)  # buy and hold differs
    assert res.series.benchmark == res.series.portfolio  # same weights, same rule


def test_threshold_rebalances_exactly_when_drift_first_exceeds():
    # A +10% per week for 3 weeks, B flat. Drift of A from 0.5: 0.0238, 0.0475, 0.0710 -> first > 0.05 at week 3.
    r = weekly({"A": [9.99, 0.10, 0.10, 0.10, 0.0, 0.0, 0.0], "B": [9.99, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]})
    res = bt(r, {"A": 0.5, "B": 0.5}, rebalance={"type": "threshold", "threshold": 0.05}, transaction_cost_bps=0)
    assert res.rebalance_dates == [date(2024, 1, 26)]  # row 3


def test_trade_cost_is_bps_times_turnover_and_appears_next_week():
    r = weekly({"A": [9.99, 0.10, 0.0, 0.0], "B": [9.99, 0.0, 0.0, 0.0]})
    res = bt(r, {"A": 0.5, "B": 0.5}, rebalance={"type": "threshold", "threshold": 0.01}, transaction_cost_bps=100)
    drift_a = 0.55 / 1.05  # A's weight after week 1
    trade = 2 * (drift_a - 0.5)  # sum |w_new - w_drift| over both funds
    assert res.rebalance_dates == [date(2024, 1, 12)]
    assert res.series.portfolio[1] == pytest.approx(0.99 * 1.05)  # initial cost only; trade cost not yet visible
    assert res.series.portfolio[2] == pytest.approx(0.99 * 1.05 * (1 - 0.01 * trade))
    assert res.series.portfolio[-1] == pytest.approx(0.99 * 1.05 * (1 - 0.01 * trade))
    assert res.metrics["portfolio"]["turnover"] == pytest.approx((trade / 2) / (3 / 52))


def test_zero_bps_rebalancing_has_no_cost():
    r = weekly({"A": [9.99, 0.10, 0.0, 0.0], "B": [9.99, 0.0, 0.0, 0.0]})
    res = bt(r, {"A": 0.5, "B": 0.5}, rebalance={"type": "threshold", "threshold": 0.01}, transaction_cost_bps=0)
    assert res.series.portfolio == pytest.approx([1.0, 1.05, 1.05, 1.05])
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_e/test_run_rebalance.py -v`
Expected: `test_periodic_monthly_rebalances_on_month_end_weeks`, `test_threshold_rebalances_exactly_when_drift_first_exceeds` and `test_trade_cost_is_bps_times_turnover_and_appears_next_week` FAIL with `AssertionError` (`[] == [datetime.date(...)]`); `test_zero_bps_rebalancing_has_no_cost` passes already (no rebalance and no cost give the same values).

- [ ] **Step 3: Implement**

Replace `_simulate` in `backend/app/engine/backtest.py` and add `_due` right above it:

```python
def _due(
    t: pd.Timestamp, drift: np.ndarray, target: np.ndarray, rebalance: RebalanceSettings, periodic: set[pd.Timestamp]
) -> bool:
    if rebalance.type == "periodic":
        return t in periodic
    if rebalance.type == "threshold":
        return float(np.abs(drift - target).max()) > rebalance.threshold
    return False


def _simulate(
    R: np.ndarray,
    window: pd.DatetimeIndex,
    cols: list[str],
    target: np.ndarray,
    rebalance: RebalanceSettings,
    bps: float,
    periodic: set[pd.Timestamp],
    retarget: Callable[[pd.Timestamp], np.ndarray] | None = None,
) -> _Path:
    """Buy at the close of t0; each week drift, record the value, then trade if a rebalance is due.

    retarget: None keeps the initial target (static); otherwise it gives the new target at each rebalance
    (walk-forward) and is only ever called with a rebalance date.
    """
    path = _Path(value=np.empty(len(window)))
    path.value[0] = 1.0
    path.held.update(c for c, x in zip(cols, target) if x != 0)
    w = target
    hold = w * (1.0 - bps)  # initial buy from cash: one-way turnover 1.0, cost bps * 1.0
    last = len(window) - 1
    for k in range(1, len(window)):
        hold = _grow(hold, R[k], cols, path.nan_weeks)
        v = hold.sum()
        path.value[k] = v  # recorded before any trade at the close of this week
        if k == last:
            break  # never trade in the final week
        t = window[k]
        drift = hold / v
        if not _due(t, drift, w, rebalance, periodic):
            continue
        if retarget is not None:
            w = retarget(t)
            path.held.update(c for c, x in zip(cols, w) if x != 0)
        trade = float(np.abs(w - drift).sum())
        hold = w * v * (1.0 - bps * trade)
        path.one_way_turnover += trade / 2
        path.rebalances.append(t)
    return path
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && uv run pytest tests/engine_e -v`
Expected: `19 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/backtest.py backend/tests/engine_e/test_run_rebalance.py
git commit -m "feat(backtest): periodic and threshold rebalancing with trade costs and turnover"
```

---

### Task 5: Static vs walk-forward, look-ahead guarantees

**Files:**
- Modify: `backend/app/engine/backtest.py` (body of `run`)
- Test: `backend/tests/engine_e/test_walk_forward.py`

**Interfaces:**
- Consumes: `_simulate(..., retarget=...)` (Task 4), `LOOKAHEAD_WARNING` (Task 1), `inverse_vol_fn`, `corrupt_after` (helpers, Task 3).
- Produces: final `run` behaviour for `mode`: static → `weights_fn` called exactly once with `t0`, warning `LOOKAHEAD_WARNING` first in `warnings`; walk_forward → `weights_fn` called with `t0` then exactly each date in `rebalance_dates`, in order; `InvalidSettings` if walk_forward with `rebalance.type == "none"` (defence in depth for `model_construct`-built settings).
- Contract for Phase 2 (pipeline): a walk-forward `weights_fn(t)` must slice every input to rows `<= t` **before** estimating (see `inverse_vol_fn`). `run` itself hands the full `returns` to the simulation only; it never passes returns to `weights_fn`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_e/test_walk_forward.py`:

```python
from datetime import date

import pandas as pd
import pytest

from app.engine.backtest import LOOKAHEAD_WARNING, run
from app.engine.errors import InvalidSettings
from app.engine.types import BacktestSettings, RebalanceSettings
from tests.engine_e.helpers import corrupt_after, inverse_vol_fn, weekly, zero_rf

ISINS = ["IE00B6R52259", "IE00BDBRDM35", "SYNGOLD00001"]
BENCH = pd.Series({"IE00B6R52259": 0.6, "IE00BDBRDM35": 0.4})
WF = dict(
    mode="walk_forward", start=date(2015, 1, 1), end=date(2020, 12, 31),
    rebalance={"type": "periodic", "frequency": "quarterly"}, transaction_cost_bps=10,
)


def switch_fn(t0: pd.Timestamp):
    """100% A at t0, 100% B at every later call."""
    return lambda t: pd.Series({"A": 1.0}) if t == t0 else pd.Series({"B": 1.0})


# Weeks: Jan 19 (t0), Jan 26 (month end -> rebalance), Feb 2, Feb 9 (final)
SWITCH_R = weekly({"A": [9.99, 0.10, 0.50, 0.50], "B": [9.99, 0.0, 0.20, 0.0]}, start="2024-01-19")
MONTHLY = {"type": "periodic", "frequency": "monthly"}


def test_static_mode_warns_and_keeps_initial_weights():
    fn = switch_fn(SWITCH_R.index[0])
    s = BacktestSettings(mode="static", rebalance=MONTHLY, transaction_cost_bps=0)
    res = run(SWITCH_R, fn, s, pd.Series({"A": 1.0}), zero_rf(SWITCH_R), {})
    assert res.warnings[0] == LOOKAHEAD_WARNING
    assert res.warnings[0] == "static mode: weights were chosen using data from the whole period (look-ahead bias)"
    assert res.series.portfolio[-1] == pytest.approx(1.1 * 1.5 * 1.5)  # stays in A


def test_walk_forward_retargets_at_rebalance_and_has_no_lookahead_warning():
    fn = switch_fn(SWITCH_R.index[0])
    s = BacktestSettings(mode="walk_forward", rebalance=MONTHLY, transaction_cost_bps=0)
    res = run(SWITCH_R, fn, s, pd.Series({"A": 1.0}), zero_rf(SWITCH_R), {})
    assert LOOKAHEAD_WARNING not in res.warnings
    assert res.rebalance_dates == [date(2024, 1, 26)]
    assert res.series.portfolio == pytest.approx([1.0, 1.1, 1.1 * 1.2, 1.1 * 1.2])  # A for a week, then B
    assert res.weights == {"A": 1.0}  # initial target
    assert res.metrics["portfolio"]["turnover"] == pytest.approx(1.0 / (3 / 52))  # A -> B is 100% one-way


def test_walk_forward_calls_weights_fn_only_at_rebalance_points(weekly_eur):
    calls: list[pd.Timestamp] = []
    res = run(weekly_eur, inverse_vol_fn(weekly_eur, ISINS, calls), BacktestSettings(**WF), BENCH,
              zero_rf(weekly_eur), {})
    t0, t_end = pd.Timestamp(res.series.dates[0]), pd.Timestamp(res.series.dates[-1])
    assert calls == [t0] + [pd.Timestamp(d) for d in res.rebalance_dates]
    assert len(res.rebalance_dates) == 23  # quarter ends 2015Q1..2020Q3; 2020-12-25 is the final week
    assert max(calls) < t_end


def test_weights_fn_pattern_ignores_rows_after_t(weekly_eur):
    """The pattern the pipeline must follow: corrupting every row after t changes nothing at t."""
    calls: list[pd.Timestamp] = []
    run(weekly_eur, inverse_vol_fn(weekly_eur, ISINS, calls), BacktestSettings(**WF), BENCH, zero_rf(weekly_eur), {})
    clean = inverse_vol_fn(weekly_eur, ISINS)
    for t in calls:
        pd.testing.assert_series_equal(clean(t), inverse_vol_fn(corrupt_after(weekly_eur, t), ISINS)(t))

    # Negative control: a weights_fn that reads the whole frame is caught by the same check.
    def cheating(returns):
        return lambda t: (1 / returns[ISINS].tail(52).std()) / (1 / returns[ISINS].tail(52).std()).sum()

    t = calls[1]
    assert not cheating(weekly_eur)(t).equals(cheating(corrupt_after(weekly_eur, t))(t))


def test_full_run_unchanged_when_future_rows_are_garbage(weekly_eur):
    clean = run(weekly_eur, inverse_vol_fn(weekly_eur, ISINS), BacktestSettings(**WF), BENCH, zero_rf(weekly_eur), {})

    def garbage_fn(t):  # at each call, everything after t is garbage
        return inverse_vol_fn(corrupt_after(weekly_eur, t), ISINS)(t)

    dirty = run(weekly_eur, garbage_fn, BacktestSettings(**WF), BENCH, zero_rf(weekly_eur), {})
    assert dirty.series.portfolio == clean.series.portfolio
    assert dirty.rebalance_dates == clean.rebalance_dates
    assert dirty.weights == clean.weights


def test_walk_forward_without_rebalancing_is_rejected():
    s = BacktestSettings.model_construct(mode="walk_forward", rebalance=RebalanceSettings(type="none"))
    with pytest.raises(InvalidSettings):
        run(SWITCH_R, switch_fn(SWITCH_R.index[0]), s, pd.Series({"A": 1.0}), zero_rf(SWITCH_R), {})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_e/test_walk_forward.py -v`
Expected: FAIL — `test_static_mode_warns_and_keeps_initial_weights` (`IndexError: list index out of range`), `test_walk_forward_retargets_at_rebalance_and_has_no_lookahead_warning` (values stay in A), `test_walk_forward_calls_weights_fn_only_at_rebalance_points` (`calls == [t0]` only), `test_walk_forward_without_rebalancing_is_rejected` (`DID NOT RAISE`). The two look-ahead pattern tests may already pass (they test the helper and the static path); that is expected.

- [ ] **Step 3: Implement**

Replace the body of `run` (keep signature and docstring):

```python
    walk_forward = settings.mode == "walk_forward"
    if walk_forward and settings.rebalance.type == "none":
        raise InvalidSettings("walk_forward mode needs rebalance.type 'periodic' or 'threshold'")

    window = _window(returns.index, settings)
    cols = list(returns.columns)
    R = returns.loc[window].to_numpy(dtype=float)
    bps = settings.transaction_cost_bps / 1e4
    periodic = set(rebalance_dates(window, settings.rebalance))

    target0 = _as_array(weights_fn(window[0]), cols)
    retarget = (lambda t: _as_array(weights_fn(t), cols)) if walk_forward else None
    port = _simulate(R, window, cols, target0, settings.rebalance, bps, periodic, retarget)
    bench = _simulate(R, window, cols, _as_array(benchmark_weights, cols), settings.rebalance, bps, periodic)

    warnings = [] if walk_forward else [LOOKAHEAD_WARNING]
    warnings += _nan_warnings(port, "") + _nan_warnings(bench, "benchmark ")
    weights = {c: float(x) for c, x in zip(cols, target0) if x != 0}
    return _result(window, port, bench, rf, weights, warnings, proxied_periods=[])
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && uv run pytest tests/engine_e -v`
Expected: `25 passed`. (The Task 3 NaN test still passes: it checks warnings with `any(...)`, and the static warning comes first.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/backtest.py backend/tests/engine_e/test_walk_forward.py
git commit -m "feat(backtest): walk-forward retargeting, look-ahead warning and look-ahead tests"
```

---

### Task 6: Proxied periods and a realistic run

**Files:**
- Modify: `backend/app/engine/backtest.py` (add `_proxied_periods`, last line of `run`)
- Test: `backend/tests/engine_e/test_run_output.py`

**Interfaces:**
- Consumes: `_Path.held` (Tasks 3–4), `proxied: dict[isin, (Timestamp, Timestamp)]` (from `returns.weekly_returns` via the pipeline), `synthetic`/`weekly_eur` fixtures.
- Produces: `_proxied_periods(proxied, held, window) -> list[ProxiedPeriod]` — only funds the portfolio held at any point (benchmark funds excluded), ranges clipped to `[t0, tN]`, ranges outside the window dropped, sorted by isin.

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_e/test_run_output.py`:

```python
import time
from datetime import date

import pandas as pd

from app.engine.backtest import run
from app.engine.types import BacktestSettings
from tests.engine_e.helpers import bt, weekly

TS = pd.Timestamp


def test_proxied_periods_are_clipped_and_limited_to_held_funds():
    # Weeks: Jan 5, 12, 19, 26, Feb 2, 9, 16, 23; the window starts Jan 19
    zeros = [0.0] * 8
    r = weekly({"A": zeros, "B": zeros, "E": zeros, "C": zeros})
    proxied = {
        "A": (TS("2023-06-02"), TS("2024-01-26")),  # starts before the window -> clipped to Jan 19
        "B": (TS("2024-02-09"), TS("2024-06-28")),  # ends after the window -> clipped to Feb 23
        "E": (TS("2023-01-06"), TS("2024-01-12")),  # entirely before the window -> dropped
        "C": (TS("2024-01-05"), TS("2024-02-23")),  # not held -> dropped
    }
    res = bt(r, {"A": 0.4, "B": 0.4, "E": 0.2}, bench={"C": 1.0}, proxied=proxied, start=date(2024, 1, 19))
    assert [(p.isin, p.start, p.end) for p in res.proxied_periods] == [
        ("A", date(2024, 1, 19), date(2024, 1, 26)),
        ("B", date(2024, 2, 9), date(2024, 2, 23)),
    ]


def test_proxied_periods_include_funds_bought_later_in_walk_forward():
    r = weekly({"A": [0.0, 0.1, 0.0, 0.0], "B": [0.0, 0.0, 0.0, 0.0]}, start="2024-01-19")
    t0 = r.index[0]
    fn = lambda t: pd.Series({"A": 1.0}) if t == t0 else pd.Series({"B": 1.0})  # noqa: E731
    s = BacktestSettings(mode="walk_forward", rebalance={"type": "periodic", "frequency": "monthly"})
    res = run(r, fn, s, pd.Series({"A": 1.0}), pd.Series(0.0, index=r.index), {"B": (TS("2020-01-03"), TS("2030-01-04"))})
    assert [(p.isin, p.start, p.end) for p in res.proxied_periods] == [("B", date(2024, 1, 19), date(2024, 2, 9))]


def test_realistic_15y_run_is_fast(synthetic, weekly_eur):
    w = pd.Series({"IE00B6R52259": 0.6, "IE00BDBRDM35": 0.4})
    rf = (synthetic.weekly_rf("EUR") / 52).reindex(weekly_eur.index)
    settings = BacktestSettings(rebalance={"type": "periodic", "frequency": "quarterly"})
    start = time.perf_counter()
    res = run(weekly_eur, lambda t: w, settings, w, rf, {})
    elapsed = time.perf_counter() - start
    assert elapsed < 1.0, f"backtest took {elapsed:.2f}s"
    assert len(res.series.dates) > 770  # ~15 years of weeks
    assert len(res.rebalance_dates) > 55  # ~60 quarter ends minus the final week
    assert res.series.portfolio[-1] > 0
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/engine_e/test_run_output.py -v`
Expected: the two proxied tests FAIL with `AssertionError` (`[] == [...]`); `test_realistic_15y_run_is_fast` passes already (it guards the loop against slow rewrites).

- [ ] **Step 3: Implement**

Add above `run` in `backend/app/engine/backtest.py`:

```python
def _proxied_periods(
    proxied: dict[str, tuple[pd.Timestamp, pd.Timestamp]], held: set[str], window: pd.DatetimeIndex
) -> list[ProxiedPeriod]:
    """Proxied ranges of funds the portfolio held at any time, clipped to the window."""
    lo, hi = window[0], window[-1]
    out = []
    for isin in sorted(held & set(proxied)):
        start, end = max(pd.Timestamp(proxied[isin][0]), lo), min(pd.Timestamp(proxied[isin][1]), hi)
        if start <= end:
            out.append(ProxiedPeriod(isin=isin, start=start.date(), end=end.date()))
    return out
```

In `run`, replace the last line

```python
    return _result(window, port, bench, rf, weights, warnings, proxied_periods=[])
```

with

```python
    return _result(window, port, bench, rf, weights, warnings, _proxied_periods(proxied, port.held, window))
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && uv run pytest tests/engine_e -v`
Expected: `28 passed`.

Then the whole backend suite, to prove nothing else moved:

Run: `cd backend && uv run pytest -v`
Expected: all Lane E tests pass; `tests/test_contract.py`, `test_types.py`, `test_schema.py`, `test_health.py`, `test_synthetic.py`, `test_export_contract.py` still pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/backtest.py backend/tests/engine_e/test_run_output.py
git commit -m "feat(backtest): proxied periods of held funds and a realistic speed check"
```

---

### Task 7 (INTEGRATION-TIME — run only after Lane D is merged): remove the metrics monkeypatch

Do not execute this task inside Lane E. The integrator runs it once `app/engine/metrics.py` (Lane D) is on the branch.

**Files:**
- Delete: `backend/tests/engine_e/conftest.py`
- Test: all of `backend/tests/engine_e/`

**Interfaces:**
- Consumes: real `app.engine.metrics.{REGISTRY, beta, drawdown_series, rolling_vol, rolling_sharpe}` from Lane D.

- [ ] **Step 1: Confirm Lane D is merged**

Run: `cd backend && uv run python -c "from app.engine import metrics; import pandas as pd; print(sorted(metrics.REGISTRY)); print(metrics.drawdown_series(pd.Series([0.1, -0.2])).tolist())"`
Expected: a non-empty list of metric names and `[0.0, -0.2]` (no `NotImplementedError`).

- [ ] **Step 2: Remove the fake**

```bash
git rm backend/tests/engine_e/conftest.py
```

- [ ] **Step 3: Re-run Lane E tests against the real metrics**

Run: `cd backend && uv run pytest tests/engine_e -v`
Expected: `28 passed`. The key-set test uses `set(metrics.REGISTRY)` dynamically, so it follows Lane D's names.

If a test on a tiny series fails because a real metric **raises** on degenerate input (e.g. zero variance of the constant benchmark in `test_result_shape_series_and_metrics`, or fewer weeks than a window), do not add `try/except` in `backtest.py`: metrics must return NaN/inf for undefined values (`backtest._num` turns those into `None`). Report it to Lane D / fix it in `metrics.py` under the integrator.

- [ ] **Step 4: Run the full suite**

Run: `cd backend && uv run pytest -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "test(backtest): run Lane E tests against the real metrics module"
```
