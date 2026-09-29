# Phase 2 — Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the lane A–H modules into a working product: `engine/pipeline.py` (recommend + backtest with a full trace), the portfolio/backtest/universe route bodies, integration tests on the synthetic market (including a walk-forward no-look-ahead test), honest frontend mocks generated from the real engine, a real-data ingest with a golden-run regression check, a Playwright smoke test, and a `v1.0.0-rc1` tag.

**Architecture:** `pipeline.py` is the only engine module that touches a `DataSource`. It calls the lane functions strictly through their Phase 0 docstring contracts: `universe.select` → (eligible rows + anchor rows chosen with the same listing rule) → `returns.weekly_returns` → `risk.covariance` → `expected.market_returns` + `expected.capm` → `optimize.build_constraints` + `optimize.optimize` → `metrics.ex_ante` → `downside.*`, recording one `Trace` step per stable key. A private `_fit(..., end)` helper is shared by `recommend` (end = last week) and the walk-forward `weights_fn(t)` (end = t), so walk-forward can only read data ≤ t. Routes are thin wrappers; domain errors map to HTTP via the Phase 0 handler in `main.py`.

**Tech Stack:** Python 3.12, uv, FastAPI, Pydantic v2, pandas, numpy, PyPortfolioOpt, pytest; Node 25 / npm, Vite, React 19, TypeScript, openapi-typescript, vitest, `@playwright/test` (the one dependency added in this phase, after escalation).

**Spec:** `docs/superpowers/specs/2026-09-29-roboadvisor-design.md` · Contracts: `docs/superpowers/plans/2026-09-29-phase0-contracts.md`

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

Phase 2 specifics:
- Commands: backend `cd backend && uv run ...`; frontend `cd frontend && npm ...`; git from the repo root.
- The only dependency Phase 2 may add is `@playwright/test` (devDependency), and only after the escalation step in Task 7.
- Starting point: all lanes A–H merged on top of tag `phase0-contracts`. Use only the documented contracts (Phase 0 docstrings), never lane internals.
- API responses must never contain NaN/inf (Starlette serialises with `allow_nan=False` → a 500). The pipeline converts to plain Python floats and uses `None` only where the schema is Optional.
- Integrator decisions (binding, amend Phase 0 contracts): `optimize()` always receives **excess** expected returns `mu − rf`, while `Holding.expected_return` / summary report totals; `capm` uses the same `window_years`/`end` as `covariance`; `InsufficientHistory(DomainError)` (422) exists in `engine/errors.py` for "not enough overlapping history" — `NoData` (503) is only for a missing DB; `metrics.REGISTRY` keys are `cagr, volatility, sharpe, sortino, max_drawdown, max_drawdown_duration, cvar_95, calmar` (+ `beta`, `turnover` for the backtest portfolio); `ReturnsResult.proxied` end is inclusive; backtest `series.dates[0]` = t0 with value 1.0 and `rebalance_dates` excludes t0; the auto benchmark targets the initial ex-ante portfolio vol over the base currency's two anchors; `max_etfs × max_position ≥ 1` is validated before optimising; risk_parity/hrp exclude cash funds (with a trace note).

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `backend/app/engine/pipeline.py` | replace stub body | `recommend`, `backtest`, private helpers `_listing_rows`, `_extend`, `_weekly`, `_capm`, `_fit`, trace-step builders |
| `backend/app/api/portfolio.py` | body | `POST /api/portfolio` → `pipeline.recommend` |
| `backend/app/api/backtest.py` | body | `POST /api/backtest` → `pipeline.backtest` |
| `backend/app/api/universe.py` | bodies | list with filters + `q` search; detail with weekly base-ccy history; 404 |
| `backend/tests/test_health.py` | modify | delete `test_unimplemented_route_returns_501` (routes are implemented now) |
| `backend/tests/integration/__init__.py` | create | empty |
| `backend/tests/integration/conftest.py` | create | `client` fixture (SyntheticData via `dependency_overrides[get_data]`) |
| `backend/tests/integration/helpers.py` | create | `profile()`, `FAST`, cached `recommend()` / `post_backtest()` |
| `backend/tests/integration/test_pipeline_recommend.py` | create | engine-level recommend tests |
| `backend/tests/integration/test_pipeline_backtest.py` | create | engine-level backtest tests, no-look-ahead test |
| `backend/tests/integration/test_api_portfolio.py` | create | API portfolio tests + performance |
| `backend/tests/integration/test_api_backtest.py` | create | API backtest tests |
| `backend/tests/integration/test_api_universe.py` | create | universe list/filter/detail/404 |
| `backend/tests/integration/test_api_errors.py` | create | 422/503 mapping |
| `backend/scripts/export_contract.py` | modify | mocks from real implementations |
| `backend/tests/test_export_contract.py` | modify | assert mocks come from the real engine |
| `backend/scripts/golden.py` | create | golden run on the real DB (`--write`) |
| `backend/tests/integration/golden_eur_50.json` | generate | recorded key numbers |
| `backend/tests/integration/test_golden.py` | create | drift check, skipped without a real DB |
| `frontend/playwright.config.ts`, `frontend/e2e/smoke.pw.ts` | create | Playwright smoke test in mock mode |
| `frontend/package.json` | modify | `@playwright/test` devDependency, `e2e` script |
| `README.md` | modify | how to run everything |

---

### Task 1: `pipeline.recommend`

**Files:**
- Modify: `backend/app/engine/pipeline.py` (replace the whole stub file)
- Create: `backend/tests/integration/__init__.py`, `backend/tests/integration/test_pipeline_recommend.py`

**Interfaces:**
- Consumes (Phase 0 contracts, implemented by lanes B/C/D): `universe.select(funds, listings, profile) -> DataFrame` (index isin, fund columns + `ticker, exchange, currency`); `returns.weekly_returns(prices, selection, fx, base) -> ReturnsResult`; `risk.covariance(returns, window_years, end=None) -> (cov, dropped)`; `expected.market_returns(returns, anchors, weights) -> Series`; `expected.capm(returns, market, rf, premium, model, window_years, end=None) -> CapmResult`; `optimize.target_vol_from_risk(risk_level, vol_range) -> float`; `optimize.build_constraints(selection, profile, target_vol) -> Constraints`; `optimize.optimize(mu, cov, constraints, strategy) -> OptimizeResult`; `metrics.ex_ante(weights, mu, cov, beta, ter, rf) -> dict`; `downside.portfolio_history(returns, weights, proxied) -> (Series, Series)`; `downside.simulate(port_returns, expected_return, horizon_years, thresholds, n_paths, block_weeks=..., seed=...) -> SimulationResult`; `downside.normal_comparison(mu, sigma, horizon_years, thresholds, n_paths, seed=...) -> NormalComparison`; `downside.stress(port_returns, proxied_mask) -> list[StressResult]`; `Trace`; `config.ANCHORS`, `config.MARKETS`; `app.engine.errors.InsufficientHistory` (integrator amendment).
- Produces: `pipeline.recommend(profile: InvestorProfile, settings: EngineSettings, data: DataSource) -> Recommendation`; constants `pipeline.RECOMMEND_STEPS: tuple[str, ...]`, `pipeline.CAPM_EQUITY_BOND_NOTE: str`; private helpers reused by Task 2: `_listing_rows`, `_extend`, `_weekly`, `_fit`, `_Fit`, `_universe_step`, `_returns_step`, `_f`, `_day`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/integration/__init__.py`: empty file.

`backend/tests/integration/test_pipeline_recommend.py`:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_pipeline_recommend.py -v`
Expected: FAIL — every test errors with `NotImplementedError: Phase 2` (and `AttributeError: module 'app.engine.pipeline' has no attribute 'RECOMMEND_STEPS'`).

- [ ] **Step 3: Write `app/engine/pipeline.py`**

Replace the whole file:

```python
"""Phase 2. Spec §5.9. The only engine module that receives a DataSource.

recommend(): universe -> returns -> covariance -> expected_returns -> constraints -> optimize -> metrics -> downside,
one Trace step per stable key (spec §5.10). backtest(): builds weights_fn from the same fitting steps (_fit).
Lane modules are called only through their Phase 0 contracts.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from app import config
from app.engine import backtest as bt_engine  # accessed as bt_engine.run so tests can spy on it
from app.engine import downside, expected, metrics, optimize, risk, universe
from app.engine import returns as returns_mod
from app.engine.errors import DomainError, InfeasibleConstraints, InsufficientHistory, InvalidSettings, NoEligibleFunds
from app.engine.trace import Trace
from app.engine.types import (
    BacktestResult, BacktestSettings, CapmResult, Constraints, DataSource, Downside, EngineSettings, Holding,
    InvestorProfile, OptimizeResult, PortfolioSummary, Preferences, Recommendation, ReturnsResult,
)

RECOMMEND_STEPS = (
    "universe", "returns", "covariance", "expected_returns", "constraints", "optimize", "metrics", "downside",
)
CAPM_EQUITY_BOND_NOTE = (
    "capm_equity: the market is equities only, so bonds get a beta near 0 and an expected return near the "
    "risk-free rate; their weight comes from diversification only."
)


# ---------- small conversions (API responses must be plain, NaN-free Python values) ----------


def _f(x) -> float:
    return round(float(x), 6)


def _opt(v):
    """pandas/numpy scalar -> plain Python value; missing -> None."""
    if v is None or v is pd.NA or v is pd.NaT:
        return None
    if isinstance(v, float) and np.isnan(v):
        return None
    return v.item() if hasattr(v, "item") else v


def _day(ts) -> str:
    return str(pd.Timestamp(ts).date())


# ---------- data assembly ----------


def _listing_rows(
    funds: pd.DataFrame, listings: pd.DataFrame, base: str, isins: list[str], *, error: type[DomainError], what: str
) -> pd.DataFrame:
    """Selection-shaped rows (fund columns + ticker/exchange/currency) for specific isins.

    Uses universe.select's own listing rule with a neutral profile that disables every preference filter
    (no UCITS rule, no hedge dedup, crypto allowed), so anchors and user-given isins get the same listing
    choice as eligible funds. Raises `error` naming isins that are unknown or have no listing.
    """
    isins = list(dict.fromkeys(isins))
    known = [i for i in isins if i in funds.index]
    neutral = InvestorProfile(
        risk_level=100, horizon_years=10, base_currency=base,
        preferences=Preferences(ucits_only=False, hedge_bonds=False, crypto_max=config.CRYPTO_HARD_CAP),
    )
    rows = None
    if known:
        try:
            rows = universe.select(funds.loc[known], listings, neutral)
        except NoEligibleFunds:
            rows = None
    found = set() if rows is None else set(rows.index)
    missing = [i for i in isins if i not in found]
    if missing:
        raise error(f"{what}: no fund with a listing for {', '.join(missing)}")
    return rows.loc[isins]


def _extend(
    selection: pd.DataFrame, funds: pd.DataFrame, listings: pd.DataFrame, base: str, isins: list[str],
    *, error: type[DomainError], what: str,
) -> pd.DataFrame:
    """selection plus listing rows for isins it does not contain yet."""
    extra = [i for i in dict.fromkeys(isins) if i not in selection.index]
    if not extra:
        return selection
    return pd.concat([selection, _listing_rows(funds, listings, base, extra, error=error, what=what)])


def _weekly(rows: pd.DataFrame, base: str, data: DataSource) -> ReturnsResult:
    """Weekly base-currency returns for every row, with proxies."""
    tickers = [str(t) for t in rows["ticker"]]
    proxies = [str(t) for t in rows["proxy_ticker"].dropna().unique() if t not in tickers]
    prices = data.prices(tickers + proxies)
    return returns_mod.weekly_returns(prices, rows, data.fx(), base)


# ---------- fitting (shared by recommend and walk-forward) ----------


def _capm(returns: pd.DataFrame, rf_daily: pd.Series, anchors: dict[str, str], settings: EngineSettings,
          end: pd.Timestamp | None) -> CapmResult:
    model = settings.expected_return_model
    market_cfg = config.MARKETS[model]
    premium = settings.market_premium if settings.market_premium is not None else market_cfg["premium"]
    market = expected.market_returns(returns, anchors, market_cfg["weights"])
    return expected.capm(returns, market, rf_daily, premium, model, settings.estimation_window_years, end=end)


@dataclass
class _Fit:
    cov: pd.DataFrame
    dropped: list[str]
    weeks_used: int
    capm: CapmResult
    mu: pd.Series  # TOTAL expected return (rf + beta * premium), what the API reports
    target_vol: float
    constraints: Constraints
    opt: OptimizeResult
    notes: list[str]  # optimisation-stage notes (e.g. cash excluded for risk_parity/hrp)


def _fit(
    returns: pd.DataFrame, selection: pd.DataFrame, rf_daily: pd.Series, anchors: dict[str, str],
    profile: InvestorProfile, settings: EngineSettings, end: pd.Timestamp | None,
) -> _Fit:
    """covariance -> CAPM -> constraints -> optimize using only rows <= end (None = all rows).

    Only eligible funds (selection.index) are optimisation candidates; anchor columns in `returns`
    are used for the CAPM market only. covariance and capm use the same window_years and `end`.
    optimize() receives EXCESS expected returns (mu - rf) for every strategy (integrator decision:
    target_vol is unchanged by a constant shift, max_sharpe needs it).
    """
    notes: list[str] = []
    eligible = returns[list(selection.index)]
    cov, dropped = risk.covariance(eligible, settings.estimation_window_years, end=end)
    cr = _capm(returns, rf_daily, anchors, settings, end)
    isins = [i for i in cov.index if i in cr.expected.index and pd.notna(cr.expected[i]) and pd.notna(cr.beta.get(i))]
    if settings.strategy in ("risk_parity", "hrp"):
        cash = [i for i in isins if selection.at[i, "asset_class"] == "cash"]
        if cash and len(cash) < len(isins):
            isins = [i for i in isins if i not in cash]
            notes.append(f"{settings.strategy}: cash funds excluded ({', '.join(cash)}); near-zero volatility would "
                         f"otherwise take most of the weight.")
    if not isins:
        raise InsufficientHistory("no eligible fund has enough price history in the estimation window")
    p = profile.preferences
    reachable = min(len(isins), p.max_etfs) * p.max_position
    if reachable < 1 - 1e-9:
        raise InfeasibleConstraints(
            f"at most {min(len(isins), p.max_etfs)} fund(s) can be held ({len(isins)} eligible with enough history, "
            f"max_etfs {p.max_etfs}); with max_position {p.max_position:.0%} they cannot add up to 100%. "
            f"Loosen the filters, raise max_etfs or raise max_position."
        )
    cov = cov.loc[isins, isins]
    mu = cr.expected[isins]
    window = settings.estimation_window_years * config.PERIODS_PER_YEAR
    weeks_used = len(eligible[isins].loc[:end].tail(window).dropna())
    target = optimize.target_vol_from_risk(profile.risk_level, tuple(settings.vol_range))
    cons = optimize.build_constraints(selection.loc[isins], profile, target)
    opt = optimize.optimize(mu - cr.rf, cov, cons, settings.strategy)
    return _Fit(cov=cov, dropped=list(dropped), weeks_used=weeks_used, capm=cr, mu=mu, target_vol=target,
                constraints=cons, opt=opt, notes=notes)


# ---------- trace steps ----------


def _removed_counts(funds: pd.DataFrame, profile: InvestorProfile, selection: pd.DataFrame) -> dict[str, int]:
    """Funds removed per universe filter, in universe.select's documented order.

    Uses selection.attrs['removed'] if Lane B provides it; otherwise re-applies the documented simple filters.
    The hedge-dedup and no-listing removals are reported together as the remainder.
    """
    provided = selection.attrs.get("removed")
    if isinstance(provided, dict):
        return {str(k): int(v) for k, v in provided.items()}
    p, base = profile.preferences, profile.base_currency
    ucits_only = p.ucits_only if p.ucits_only is not None else config.UCITS_DEFAULT[base]
    f = funds
    removed: dict[str, int] = {}

    def drop(name: str, keep: pd.Series) -> None:
        nonlocal f
        keep = keep.fillna(False).astype(bool)
        removed[name] = int((~keep).sum())
        f = f[keep]

    if p.esg_only:
        drop("esg", f["esg"].astype(bool))
    if p.regions_include:
        drop("regions_include", f["region"].isin(p.regions_include) | (f["region"] == "global"))
    if p.regions_exclude:
        drop("regions_exclude", ~f["region"].isin(p.regions_exclude))
    if p.sectors_exclude:
        drop("sectors_exclude", ~f["sector"].isin(p.sectors_exclude))
    if p.max_ter is not None:
        drop("max_ter", ~(f["ter"] > p.max_ter))
    if p.distribution != "any":
        drop("distribution", f["distribution"] == p.distribution)
    if p.crypto_max == 0 or profile.risk_level < config.CRYPTO_MIN_RISK_LEVEL:
        drop("crypto", f["asset_class"] != "crypto")
    if ucits_only:
        drop("non_ucits", ~((f["wrapper"] == "etf") & ~f["ucits"].astype(bool)))
    removed["hedged_duplicates_and_unlisted"] = max(0, len(f) - len(selection))
    return removed


def _universe_step(trace: Trace, funds: pd.DataFrame, profile: InvestorProfile, selection: pd.DataFrame) -> None:
    p, base = profile.preferences, profile.base_currency
    ucits_only = p.ucits_only if p.ucits_only is not None else config.UCITS_DEFAULT[base]
    notes = []
    if ucits_only:
        why = f"default for {base}" if p.ucits_only is None else "chosen"
        notes.append(f"UCITS-only ({why}): non-UCITS ETFs removed; ETPs/ETCs pass.")
    if p.crypto_max == 0:
        notes.append("Crypto excluded: crypto_max is 0.")
    elif profile.risk_level < config.CRYPTO_MIN_RISK_LEVEL:
        notes.append(f"Crypto excluded: risk level {profile.risk_level:g} is below {config.CRYPTO_MIN_RISK_LEVEL}.")
    if p.hedge_bonds:
        notes.append(f"Bond funds with a {base}-hedged share class replace their unhedged siblings.")
    trace.add("universe", {
        "base_currency": base,
        "n_funds": int(len(funds)),
        "n_eligible": int(len(selection)),
        "removed": _removed_counts(funds, profile, selection),
        "ucits_only": bool(ucits_only),
        "by_asset_class": {str(k): int(v) for k, v in selection["asset_class"].value_counts().items()},
    }, notes)


def _returns_step(trace: Trace, rr: ReturnsResult, selection: pd.DataFrame, anchors: dict[str, str]) -> None:
    r = rr.returns
    proxied = {i: [_day(s), _day(e)] for i, (s, e) in rr.proxied.items()}
    no_data = [i for i in selection.index if i in r.columns and r[i].isna().all()]
    outside = [i for i in anchors.values() if i not in selection.index]
    notes = [f"{i} uses proxy returns from {s} to {e}." for i, (s, e) in proxied.items()]
    if outside:
        notes.append(f"Market anchors outside the eligible universe (used for CAPM only): {', '.join(outside)}.")
    if no_data:
        notes.append(f"No price data: {', '.join(no_data)}.")
    trace.add("returns", {
        "frequency": "W-FRI",
        "weeks": int(len(r)),
        "start": _day(r.index[0]) if len(r) else None,
        "end": _day(r.index[-1]) if len(r) else None,
        "n_series": int(r.shape[1]),
        "anchors": dict(anchors),
        "anchors_outside_universe": outside,
        "proxied": proxied,
        "no_data": no_data,
    }, notes)


# ---------- public API ----------


def recommend(profile: InvestorProfile, settings: EngineSettings, data: DataSource) -> Recommendation:
    trace, warnings = Trace(), []
    base = profile.base_currency
    anchors = config.ANCHORS[base]
    funds, listings = data.funds(), data.listings()

    # universe
    selection = universe.select(funds, listings, profile)
    _universe_step(trace, funds, profile, selection)

    # returns (eligible funds + anchors, which the CAPM market always needs)
    rows = _extend(selection, funds, listings, base, list(anchors.values()), error=InsufficientHistory,
                   what="market anchors (check config.ANCHORS against the database)")
    rr = _weekly(rows, base, data)
    _returns_step(trace, rr, selection, anchors)

    # covariance -> expected returns -> constraints -> optimize
    rf_daily = data.rf(base)
    fit = _fit(rr.returns, selection, rf_daily, anchors, profile, settings, end=None)
    cand = list(fit.cov.index)

    cov_notes = []
    if fit.dropped:
        cov_notes.append(
            f"Dropped {len(fit.dropped)} fund(s) with less than {config.MIN_COVERAGE:.0%} history in the "
            f"{settings.estimation_window_years}-year window: {', '.join(fit.dropped)}."
        )
    trace.add("covariance", {
        "method": "Ledoit-Wolf shrinkage, annualised x52",
        "window_years": settings.estimation_window_years,
        "end": _day(rr.returns.index[-1]),
        "weeks_used": int(fit.weeks_used),
        "n_funds": len(cand),
        "dropped": fit.dropped,
    }, cov_notes)

    w = fit.opt.weights
    held_bonds = [i for i in w.index if selection.at[i, "asset_class"] == "bond"]
    er_notes = []
    if settings.expected_return_model == "capm_equity" and held_bonds:
        er_notes.append(CAPM_EQUITY_BOND_NOTE)
        warnings.append(CAPM_EQUITY_BOND_NOTE)
    trace.add("expected_returns", {
        "model": fit.capm.market,
        "rf": _f(fit.capm.rf),
        "premium": _f(fit.capm.premium),
        "premium_source": "settings" if settings.market_premium is not None else "config",
        "market": {anchors[k]: _f(v) for k, v in config.MARKETS[settings.expected_return_model]["weights"].items()},
        "beta": {i: _f(fit.capm.beta[i]) for i in cand},
        "expected": {i: _f(fit.mu[i]) for i in cand},
    }, er_notes)

    c = fit.constraints
    trace.add("constraints", {
        "risk_level": _f(profile.risk_level),
        "vol_range": [_f(v) for v in settings.vol_range],
        "target_vol": _f(fit.target_vol),
        "n_candidates": len(cand),
        "max_etfs": int(c.max_etfs),
        "min_position": _f(c.min_position),
        "max_position": _f(c.max_position),
        "group_min": {k: _f(v) for k, v in c.group_min.items()},
        "group_max": {k: _f(v) for k, v in c.group_max.items()},
    })

    opt_warnings = list(fit.opt.warnings)
    if fit.opt.achieved_vol > fit.target_vol + 1e-4 and not opt_warnings and settings.strategy == "target_vol":
        opt_warnings.append(
            f"Achieved volatility {fit.opt.achieved_vol:.1%} is above the {fit.target_vol:.1%} target."
        )
    warnings.extend(opt_warnings)
    trace.add("optimize", {
        "strategy": settings.strategy,
        "target_vol": _f(fit.target_vol),
        "achieved_vol": _f(fit.opt.achieved_vol),
        "n_holdings": int(len(w)),
        "objective_input": "excess expected returns (mu - rf)",
        "weights": {i: _f(v) for i, v in w.items()},
    }, [*fit.notes, *opt_warnings])

    # ex-ante metrics
    idx = list(w.index)
    ea = metrics.ex_ante(w, fit.mu[idx], fit.cov.loc[idx, idx], fit.capm.beta[idx], c.ter.reindex(idx).fillna(0.0),
                         fit.capm.rf)
    rc = ea["risk_contribution"]
    trace.add("metrics", {
        "expected_return": _f(ea["expected_return"]),
        "volatility": _f(ea["volatility"]),
        "sharpe": _f(ea["sharpe"]),
        "beta": _f(ea["beta"]),
        "weighted_ter": _f(ea["weighted_ter"]),
        "annual_cost_per_10k": _f(ea["annual_cost_per_10k"]),
        "rf": _f(fit.capm.rf),
        "risk_contribution": {i: _f(v) for i, v in rc.items()},
    })

    # downside
    thresholds = list(settings.drawdown_thresholds)
    port, mask = downside.portfolio_history(rr.returns, w, rr.proxied)
    sim = downside.simulate(port, float(ea["expected_return"]), profile.horizon_years, thresholds, settings.mc_paths,
                            seed=settings.seed)
    nc = downside.normal_comparison(float(ea["expected_return"]), float(ea["volatility"]), profile.horizon_years,
                                    thresholds, settings.mc_paths, seed=settings.seed)
    stress = downside.stress(port, mask)
    proxied_weeks = int(mask.sum())
    dn_notes = [f"{proxied_weeks} of {len(port)} history weeks use proxy returns."] if proxied_weeks else []
    trace.add("downside", {
        "method": "stationary block bootstrap, mean shifted to the CAPM expected return",
        "paths": int(settings.mc_paths),
        "horizon_years": int(profile.horizon_years),
        "block_weeks": list(config.BLOCK_WEEKS),
        "seed": settings.seed,
        "history_weeks": int(len(port)),
        "history_start": _day(port.index[0]) if len(port) else None,
        "proxied_weeks": proxied_weeks,
        "expected_return": _f(ea["expected_return"]),
        "thresholds": [_f(t) for t in thresholds],
    }, dn_notes)

    holdings = []
    for isin in w.sort_values(ascending=False).index:
        row = selection.loc[isin]
        holdings.append(Holding(
            isin=isin, ticker=str(row["ticker"]), exchange=_opt(row["exchange"]) or "", name=str(row["name"]),
            weight=float(w[isin]), asset_class=str(row["asset_class"]), sub_class=_opt(row["sub_class"]),
            region=_opt(row["region"]), ter=_opt(row["ter"]), beta=_f(fit.capm.beta[isin]),
            expected_return=_f(fit.mu[isin]), risk_contribution=_f(rc.get(isin, 0.0)),
            proxied=isin in rr.proxied,
        ))
    mix: dict[str, float] = {}
    for h in holdings:
        mix[h.asset_class] = mix.get(h.asset_class, 0.0) + h.weight  # unrounded: weights sum to 1 exactly

    return Recommendation(
        holdings=holdings,
        summary=PortfolioSummary(
            expected_return=_f(ea["expected_return"]), volatility=_f(ea["volatility"]),
            target_volatility=_f(fit.target_vol), sharpe=_f(ea["sharpe"]), beta=_f(ea["beta"]),
            weighted_ter=_f(ea["weighted_ter"]), annual_cost_per_10k=_f(ea["annual_cost_per_10k"]), mix=mix,
        ),
        downside=Downside(
            drawdown_probs=sim.drawdown_probs, annual_loss_probs=sim.annual_loss_probs,
            p_below_invested=_f(sim.p_below_invested), fan=sim.fan, stress=stress, normal_comparison=nc,
        ),
        warnings=warnings,
        trace=trace.steps,
    )


def backtest(
    profile: InvestorProfile,
    weights: dict[str, float] | None,
    settings: EngineSettings,
    bt: BacktestSettings,
    data: DataSource,
) -> BacktestResult:
    raise NotImplementedError("Phase 2 — Task 2")
```

Holding weights and `mix` are deliberately not rounded (`float(...)`), so they sum to 1 within float error; every other number goes through `_f` (6 decimals).

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/integration/test_pipeline_recommend.py -v`
Expected: PASS (10 tests). If `test_anchors_filtered_out_of_universe_still_define_the_market` fails inside `expected.capm` or `market_returns`, print `rr.returns[list(config.ANCHORS["EUR"].values())].notna().sum()` — both anchor columns must be populated (proxied back to 2005 in the synthetic fixture); a failure there is a Lane B/C contract bug, escalate rather than patch in the pipeline.

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/pipeline.py backend/tests/integration/__init__.py backend/tests/integration/test_pipeline_recommend.py
git commit -m "feat(engine): pipeline.recommend with full trace"
```

---

### Task 2: `pipeline.backtest` with walk-forward and the no-look-ahead test

**Files:**
- Modify: `backend/app/engine/pipeline.py` (replace the `backtest` stub at the end of the file)
- Create: `backend/tests/integration/test_pipeline_backtest.py`

**Interfaces:**
- Consumes: Task 1 helpers (`_listing_rows`, `_extend`, `_weekly`, `_fit`, `_Fit`, `_universe_step`, `_returns_step`, `_f`, `_day`, `recommend`); `bt_engine.run(returns, weights_fn, settings, benchmark_weights, rf, proxied) -> BacktestResult`; `bt_engine.auto_benchmark(equity, bonds, target_vol) -> float`; `risk.covariance` (ex-ante vol of user-given weights for the auto benchmark).
- Produces: `pipeline.backtest(profile, weights, settings, bt, data) -> BacktestResult` whose `trace` is: static without weights → the 8 recommend steps + `backtest`; static with weights → `returns`, `backtest`; walk_forward → `universe`, `returns`, `backtest`. Warnings = pipeline warnings + `run` warnings (the look-ahead warning comes from `run` in static mode only).

- [ ] **Step 1: Write the failing tests**

`backend/tests/integration/test_pipeline_backtest.py`:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_pipeline_backtest.py -v`
Expected: FAIL — all tests raise `NotImplementedError: Phase 2 — Task 2`.

- [ ] **Step 3: Implement `backtest`**

In `backend/app/engine/pipeline.py`, replace the `backtest` stub (the last function) with:

```python
def _window_start(index: pd.DatetimeIndex, bt: BacktestSettings) -> pd.Timestamp:
    """First week of the backtest window, same rule as backtest.run (None -> last week / BACKTEST_YEARS back)."""
    end = pd.Timestamp(bt.end) if bt.end else index[-1]
    start = pd.Timestamp(bt.start) if bt.start else end - pd.DateOffset(years=config.BACKTEST_YEARS)
    inside = index[(index >= start) & (index <= end)]
    if len(inside) < 2:
        raise InsufficientHistory(f"backtest window {_day(start)}..{_day(end)} has fewer than 2 weeks of data")
    return inside[0]


def _ex_ante_vol(returns: pd.DataFrame, weights: pd.Series, window_years: int) -> float:
    """Ex-ante volatility sqrt(w'Σw) of given weights with the same covariance estimator as the optimizer."""
    cov, dropped = risk.covariance(returns[list(weights.index)], window_years)
    if dropped:
        raise InsufficientHistory(
            f"not enough history in the {window_years}-year window to size the auto benchmark: {', '.join(dropped)}"
        )
    w = weights.reindex(cov.index).to_numpy()
    return float(np.sqrt(w @ cov.to_numpy() @ w))


def backtest(
    profile: InvestorProfile,
    weights: dict[str, float] | None,
    settings: EngineSettings,
    bt: BacktestSettings,
    data: DataSource,
) -> BacktestResult:
    trace, warnings = Trace(), []
    base = profile.base_currency
    anchors = config.ANCHORS[base]
    funds, listings = data.funds(), data.listings()
    rf_daily = data.rf(base)
    fits: dict[pd.Timestamp, _Fit] = {}
    rec_vol: float | None = None

    # 1. which funds can be held
    if bt.mode == "static":
        if weights is None:
            rec = recommend(profile, settings, data)
            trace.steps.extend(rec.trace)
            warnings.extend(rec.warnings)
            static_w = pd.Series({h.isin: h.weight for h in rec.holdings}, dtype=float)
            rec_vol = rec.summary.volatility
        else:
            static_w = pd.Series(weights, dtype=float)
            static_w = static_w[static_w > 0]
        selection = _listing_rows(funds, listings, base, list(static_w.index), error=InvalidSettings,
                                  what="portfolio weights")
    else:
        selection = universe.select(funds, listings, profile)
        _universe_step(trace, funds, profile, selection)

    # 2. returns for holdings + anchors + benchmark legs
    bench_isins = list(anchors.values()) if bt.benchmark == "auto" else list(bt.benchmark)
    rows = _extend(selection, funds, listings, base, list(anchors.values()), error=InsufficientHistory,
                   what="market anchors (check config.ANCHORS against the database)")
    rows = _extend(rows, funds, listings, base, bench_isins, error=InvalidSettings, what="benchmark")
    rr = _weekly(rows, base, data)
    if not (bt.mode == "static" and weights is None):
        _returns_step(trace, rr, selection, anchors)
    t0 = _window_start(rr.returns.index, bt)

    # 3. weights_fn
    if bt.mode == "static":
        def weights_fn(t: pd.Timestamp) -> pd.Series:
            return static_w
    else:
        def weights_fn(t: pd.Timestamp) -> pd.Series:
            t = pd.Timestamp(t)
            if t not in fits:  # only rows <= t are read (covariance/capm `end`)
                fits[t] = _fit(rr.returns, selection, rf_daily, anchors, profile, settings, end=t)
            return fits[t].opt.weights

    # 4. benchmark ('auto': the base currency's two anchors, mixed to the INITIAL ex-ante portfolio vol;
    #    both anchor isins are columns of rr.returns because rows always include the anchors)
    target_vol: float | None = None
    if bt.benchmark == "auto":
        if bt.mode == "walk_forward":
            weights_fn(t0)
            target_vol = float(fits[t0].opt.achieved_vol)
            hist = rr.returns.loc[:t0]  # no look-ahead in the benchmark mix either
        else:
            target_vol = rec_vol if rec_vol is not None else _ex_ante_vol(
                rr.returns, static_w, settings.estimation_window_years)
            hist = rr.returns
        eq, bd = anchors["global_equity"], anchors["global_bonds"]
        share = float(bt_engine.auto_benchmark(hist[eq], hist[bd], target_vol))
        bench = pd.Series({eq: share, bd: 1.0 - share})
    else:
        bench = pd.Series(bt.benchmark, dtype=float)
        if abs(bench.sum() - 1) > 1e-6:
            raise InvalidSettings("benchmark weights must sum to 1")

    # 5. run
    rf_weekly = rf_daily.resample("W-FRI").last().reindex(rr.returns.index).ffill() / config.PERIODS_PER_YEAR
    result = bt_engine.run(rr.returns, weights_fn, bt, bench, rf_weekly, rr.proxied)

    warned = [(t, msg) for t, f in sorted(fits.items()) for msg in f.opt.warnings]
    if warned:
        n_dates = len({t for t, _ in warned})
        warnings.append(f"walk-forward: the optimizer warned at {n_dates} of {len(fits)} fits; "
                        f"first ({_day(warned[0][0])}): {warned[0][1]}")
    dates = result.series.dates
    notes = [
        "walk-forward: covariance, CAPM and optimisation at each rebalance date used only data up to that date."
        if bt.mode == "walk_forward" else
        "static: the same target weights for the whole period, chosen with data from the whole period."
    ]
    trace.add("backtest", {
        "mode": bt.mode,
        "start": str(dates[0]) if dates else None,
        "end": str(dates[-1]) if dates else None,
        "weeks": len(dates),
        "rebalance": bt.rebalance.model_dump(mode="json"),
        "n_rebalances": len(result.rebalance_dates),
        "transaction_cost_bps": _f(bt.transaction_cost_bps),
        "benchmark": {i: _f(v) for i, v in bench.items()},
        "benchmark_target_vol": _f(target_vol) if target_vol is not None else None,
        "n_fits": len(fits),
        "estimation_window_years": settings.estimation_window_years,
    }, notes)
    return result.model_copy(update={"warnings": [*warnings, *result.warnings], "trace": trace.steps})
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/integration/test_pipeline_backtest.py tests/integration/test_pipeline_recommend.py -v`
Expected: PASS (16 tests). If `test_walk_forward_never_reads_data_after_the_rebalance_date` fails, the assertion message names the first date where weights differ; find which call reads past `end` by temporarily replacing `rr.returns` in `_fit` with `rr.returns.loc[:t]` — if that fixes it, the offending lane function ignores its `end` argument: escalate to its lane owner (B for `covariance`, C for `capm`), do not keep the workaround silently.

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/pipeline.py backend/tests/integration/test_pipeline_backtest.py
git commit -m "feat(engine): pipeline.backtest with walk-forward weights_fn and no-look-ahead test"
```

---

### Task 3: Portfolio and backtest routes, API tests, error mapping, performance

**Files:**
- Modify: `backend/app/api/portfolio.py`, `backend/app/api/backtest.py` (bodies only; signatures frozen)
- Modify: `backend/tests/test_health.py` (delete `test_unimplemented_route_returns_501`)
- Create: `backend/tests/integration/conftest.py`, `backend/tests/integration/helpers.py`, `backend/tests/integration/test_api_portfolio.py`, `backend/tests/integration/test_api_backtest.py`, `backend/tests/integration/test_api_errors.py`

**Interfaces:**
- Consumes: `pipeline.recommend`, `pipeline.backtest`, `pipeline.RECOMMEND_STEPS`, `pipeline.CAPM_EQUITY_BOND_NOTE`; `app.api.deps.get_data`; `tests.fixtures.synthetic.SyntheticData` via the session fixture `synthetic`.
- Produces: `client` pytest fixture (function-scoped, SyntheticData override); `tests.integration.helpers.{FAST, profile, recommend, post_backtest}` used by Tasks 3–4.

- [ ] **Step 1: Write the test helpers**

`backend/tests/integration/conftest.py`:

```python
import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_data
from app.main import app


@pytest.fixture
def client(synthetic):
    app.dependency_overrides[get_data] = lambda: synthetic
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_data, None)
```

`backend/tests/integration/helpers.py`:

```python
"""Request builders with a response cache (the synthetic market is deterministic, so identical requests
give identical responses; caching keeps the suite fast)."""

import json

FAST = {"mc_paths": 1000}
_CACHE: dict[str, dict] = {}


def profile(risk: float = 50, base: str = "EUR", horizon: int = 10, **prefs) -> dict:
    return {"risk_level": risk, "horizon_years": horizon, "base_currency": base, "preferences": prefs}


def _post(client, path: str, body: dict) -> dict:
    key = path + json.dumps(body, sort_keys=True)
    if key not in _CACHE:
        r = client.post(path, json=body)
        assert r.status_code == 200, r.text
        _CACHE[key] = r.json()
    return _CACHE[key]


def recommend(client, risk: float = 50, base: str = "EUR", settings: dict | None = None, **prefs) -> dict:
    return _post(client, "/api/portfolio", {"profile": profile(risk, base, **prefs), "settings": settings or FAST})


def post_backtest(client, backtest: dict, weights: dict | None = None, risk: float = 50, base: str = "EUR") -> dict:
    body = {"profile": profile(risk, base), "settings": FAST, "backtest": backtest}
    if weights is not None:
        body["weights"] = weights
    return _post(client, "/api/backtest", body)
```

- [ ] **Step 2: Write the failing API tests**

`backend/tests/integration/test_api_portfolio.py`:

```python
import time

import pytest

from app.engine.pipeline import CAPM_EQUITY_BOND_NOTE, RECOMMEND_STEPS
from tests.integration.helpers import FAST, profile, recommend


@pytest.mark.parametrize("base", ["EUR", "USD"])
@pytest.mark.parametrize("risk", [20, 50, 80])
def test_portfolio_is_valid(client, synthetic, base, risk):
    rec = recommend(client, risk, base)
    weights = [h["weight"] for h in rec["holdings"]]
    assert abs(sum(weights) - 1) < 1e-5
    assert all(w > 0 for w in weights) and len(weights) <= 10
    target = 0.02 + risk / 100 * 0.18
    assert rec["summary"]["target_volatility"] == pytest.approx(target)
    assert rec["summary"]["volatility"] <= target + 1e-3 or rec["warnings"]
    assert [s["step"] for s in rec["trace"]] == list(RECOMMEND_STEPS)
    funds = synthetic.funds()
    if base == "EUR":  # UCITS-only by default: no non-UCITS ETF may be held
        for h in rec["holdings"]:
            f = funds.loc[h["isin"]]
            assert f["ucits"] or f["wrapper"] != "etf", h["isin"]


@pytest.mark.parametrize("base", ["EUR", "USD"])
def test_equity_share_rises_with_risk(client, base):
    shares = [recommend(client, r, base)["summary"]["mix"].get("equity", 0.0) for r in (20, 50, 80)]
    assert shares[0] <= shares[1] <= shares[2] and shares[0] < shares[2], shares


def test_no_crypto_below_min_risk_level(client):
    rec = recommend(client, 30, "EUR", crypto_max=0.05)
    assert all(h["asset_class"] != "crypto" for h in rec["holdings"])
    assert rec["trace"][0]["summary"]["removed"]["crypto"] >= 1


def test_crypto_is_capped_when_allowed(client):
    rec = recommend(client, 80, "EUR", crypto_max=0.05)
    assert sum(h["weight"] for h in rec["holdings"] if h["asset_class"] == "crypto") <= 0.05 + 1e-6


def test_esg_only_works_or_is_a_clear_422(client, synthetic):
    r = client.post("/api/portfolio", json={"profile": profile(50, "EUR", esg_only=True), "settings": FAST})
    if r.status_code == 200:
        esg = synthetic.funds()["esg"]
        assert all(bool(esg[h["isin"]]) for h in r.json()["holdings"])
    else:
        assert r.status_code == 422
        body = r.json()
        assert body["error"] in {"NoEligibleFunds", "InfeasibleConstraints", "InsufficientHistory"}
        assert len(body["detail"]) > 20


def test_expected_return_models_differ(client):
    eq = recommend(client, 50, "EUR", settings={**FAST, "expected_return_model": "capm_equity"})
    ma = recommend(client, 50, "EUR", settings={**FAST, "expected_return_model": "capm_multi_asset"})
    s_eq, s_ma = eq["trace"][3]["summary"], ma["trace"][3]["summary"]
    assert (s_eq["model"], s_eq["premium"]) == ("capm_equity", 0.05)
    assert (s_ma["model"], s_ma["premium"]) == ("capm_multi_asset", 0.035)
    assert s_eq["expected"] != s_ma["expected"]
    holds_bonds = any(h["asset_class"] == "bond" for h in eq["holdings"])
    assert (CAPM_EQUITY_BOND_NOTE in eq["warnings"]) == holds_bonds


def test_market_premium_override(client):
    rec = recommend(client, 50, "EUR", settings={**FAST, "market_premium": 0.06})
    assert rec["trace"][3]["summary"]["premium"] == 0.06
    assert rec["trace"][3]["summary"]["premium_source"] == "settings"


def test_portfolio_is_fast_enough(client):
    client.post("/api/portfolio", json={"profile": profile(40), "settings": {"mc_paths": 500}})  # warm-up: imports
    t = time.perf_counter()
    r = client.post("/api/portfolio", json={"profile": profile(60)})  # default settings: 10,000 paths
    elapsed = time.perf_counter() - t
    assert r.status_code == 200, r.text
    assert elapsed < 3.0, f"/api/portfolio took {elapsed:.2f}s"
```

`backend/tests/integration/test_api_backtest.py`:

```python
from tests.integration.helpers import FAST, post_backtest, profile

WALK_FORWARD = {"mode": "walk_forward", "start": "2018-01-01", "end": "2021-12-31",
                "rebalance": {"type": "periodic", "frequency": "quarterly"}}


def _look_ahead(body: dict) -> bool:
    return any("look-ahead" in w for w in body["warnings"])


def test_static_backtest_from_recommendation(client):
    body = post_backtest(client, {"mode": "static"})
    assert _look_ahead(body)
    assert abs(sum(body["weights"].values()) - 1) < 1e-5
    n = len(body["series"]["dates"])
    assert n > 700 and len(body["series"]["portfolio"]) == n and len(body["series"]["benchmark"]) == n
    assert body["trace"][-1]["step"] == "backtest"
    registry = {"cagr", "volatility", "sharpe", "sortino", "max_drawdown", "max_drawdown_duration", "cvar_95", "calmar"}
    assert set(body["metrics"]["benchmark"]) == registry
    assert set(body["metrics"]["portfolio"]) == registry | {"beta", "turnover"}
    assert body["series"]["portfolio"][0] == 1.0
    assert body["series"]["dates"][0] not in body["rebalance_dates"]


def test_walk_forward_quarterly(client):
    body = post_backtest(client, WALK_FORWARD)
    assert not _look_ahead(body)
    assert len(body["rebalance_dates"]) >= 12
    assert [s["step"] for s in body["trace"]] == ["universe", "returns", "backtest"]


def test_static_with_explicit_weights_and_benchmark(client):
    body = post_backtest(client, {"mode": "static", "benchmark": {"IE00B6R52259": 1.0}},
                         weights={"IE00B6R52259": 0.6, "SYNGOVS00001": 0.4})
    assert abs(body["weights"]["IE00B6R52259"] - 0.6) < 1e-9
    assert body["trace"][-1]["summary"]["benchmark"] == {"IE00B6R52259": 1.0}


def test_walk_forward_without_rebalancing_is_422(client):
    r = client.post("/api/backtest", json={"profile": profile(), "settings": FAST, "backtest": {"mode": "walk_forward"}})
    assert r.status_code == 422


def test_unknown_isin_in_weights_is_422(client):
    r = client.post("/api/backtest", json={"profile": profile(), "settings": FAST, "weights": {"NOPE00000000": 1.0}})
    assert r.status_code == 422
    assert r.json()["error"] == "InvalidSettings" and "NOPE00000000" in r.json()["detail"]
```

`backend/tests/integration/test_api_errors.py`:

```python
from fastapi.testclient import TestClient

from app import config
from app.api.deps import get_data
from app.main import app
from tests.integration.helpers import FAST, profile


def test_no_eligible_funds_is_422(client):
    r = client.post("/api/portfolio", json={"profile": profile(max_ter=0.0), "settings": FAST})
    assert r.status_code == 422
    assert r.json()["error"] == "NoEligibleFunds"


def test_invalid_profile_is_422(client):
    r = client.post("/api/portfolio", json={"profile": profile(risk=150)})
    assert r.status_code == 422


def test_crypto_above_hard_cap_is_422(client):
    r = client.post("/api/portfolio", json={"profile": profile(risk=80, crypto_max=0.2)})
    assert r.status_code == 422


def test_missing_db_is_503(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "missing.db")
    app.dependency_overrides.pop(get_data, None)
    c = TestClient(app)
    for method, path, body in [("post", "/api/portfolio", {"profile": profile()}),
                               ("post", "/api/backtest", {"profile": profile()}),
                               ("get", "/api/universe", None)]:
        r = c.post(path, json=body) if method == "post" else c.get(path)
        assert r.status_code == 503, path
        assert r.json()["error"] == "NoData" and "ingest" in r.json()["detail"]
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_api_portfolio.py tests/integration/test_api_backtest.py tests/integration/test_api_errors.py -v`
Expected: FAIL — portfolio/backtest tests get status 501 (`AssertionError: {"error":"NotImplemented","detail":"Phase 2"}`); `test_invalid_profile_is_422`, `test_crypto_above_hard_cap_is_422`, `test_walk_forward_without_rebalancing_is_422` and `test_missing_db_is_503` already PASS (validation and dependency run before the route body).

- [ ] **Step 4: Implement the route bodies**

`backend/app/api/portfolio.py`:

```python
from fastapi import APIRouter, Depends

from app.api.deps import get_data
from app.api.schemas import PortfolioRequest, Recommendation
from app.engine import pipeline
from app.engine.types import DataSource

router = APIRouter(tags=["engine"])


@router.post("/portfolio", response_model=Recommendation)
def portfolio(body: PortfolioRequest, data: DataSource = Depends(get_data)) -> Recommendation:
    return pipeline.recommend(body.profile, body.settings, data)
```

`backend/app/api/backtest.py`:

```python
from fastapi import APIRouter, Depends

from app.api.deps import get_data
from app.api.schemas import BacktestRequest, BacktestResult
from app.engine import pipeline
from app.engine.types import DataSource

router = APIRouter(tags=["engine"])


@router.post("/backtest", response_model=BacktestResult)
def backtest(body: BacktestRequest, data: DataSource = Depends(get_data)) -> BacktestResult:
    return pipeline.backtest(body.profile, body.weights, body.settings, body.backtest, data)
```

- [ ] **Step 5: Delete the obsolete Phase 0 test**

In `backend/tests/test_health.py`, delete the whole function `test_unimplemented_route_returns_501` (it overrides `get_data` with `object()` to prove the route was a stub; now the route calls `data.funds()` and would raise `AttributeError`). Keep the other two tests unchanged.

- [ ] **Step 6: Run the tests**

Run: `cd backend && uv run pytest tests/integration tests/test_health.py -v`
Expected: PASS (all). If `test_portfolio_is_fast_enough` fails, profile it:
`uv run python -m cProfile -s cumtime -m pytest tests/integration/test_api_portfolio.py::test_portfolio_is_fast_enough -q 2>&1 | head -40`
and fix the hot spot in the pipeline (e.g. calling `data.prices` more than once). If the hot spot is inside a lane function (`downside.simulate` loops in Python, `optimize` re-solving), escalate to that lane with the profile output.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/portfolio.py backend/app/api/backtest.py backend/tests/test_health.py backend/tests/integration
git commit -m "feat(api): portfolio and backtest routes with integration tests"
```

---

### Task 4: Universe routes

**Files:**
- Modify: `backend/app/api/universe.py` (bodies only; signatures frozen)
- Create: `backend/tests/integration/test_api_universe.py`

**Interfaces:**
- Consumes: `app.api.schemas.fund_summary(isin, row, tickers)`, `returns.convert_prices(prices, currencies, fx, base) -> DataFrame`, `FundDetail`, `ListingOut`, `PricePoint`.
- Produces: `GET /api/universe` (filters `asset_class, region, esg, ucits, max_ter, q`), `GET /api/universe/{isin}?base_currency=EUR|USD` → `FundDetail` with weekly (W-FRI) base-currency history of the primary listing; 404 for unknown isin.

- [ ] **Step 1: Write the failing tests**

`backend/tests/integration/test_api_universe.py`:

```python
import pandas as pd
import pytest


def test_list_all(client, synthetic):
    body = client.get("/api/universe").json()
    assert len(body) == len(synthetic.funds())
    acwi = next(f for f in body if f["isin"] == "IE00B6R52259")
    assert set(acwi["tickers"]) == {"IUSQ.DE", "SSAC.L"}
    assert acwi["has_proxy"] is True


@pytest.mark.parametrize("query,check", [
    ("asset_class=bond", lambda f: f["asset_class"] == "bond"),
    ("region=japan", lambda f: f["region"] == "japan"),
    ("esg=true", lambda f: f["esg"] is True),
    ("ucits=false", lambda f: f["ucits"] is False),
    ("max_ter=0.001", lambda f: f["ter"] is None or f["ter"] <= 0.001),
])
def test_filters(client, query, check):
    body = client.get(f"/api/universe?{query}").json()
    assert body and all(check(f) for f in body)


@pytest.mark.parametrize("q,isin", [
    ("iusq", "IE00B6R52259"),          # ticker
    ("ie00bdbrdm35", "IE00BDBRDM35"),  # isin
    ("world health", "SYNHLTH00001"),  # name
    ("s&p technology", "SYNTECH00001"),  # index name
])
def test_search(client, q, isin):
    body = client.get("/api/universe", params={"q": q}).json()
    assert isin in {f["isin"] for f in body}


def test_search_without_match_is_empty(client):
    assert client.get("/api/universe", params={"q": "zzz-no-such-fund"}).json() == []


def test_detail_uses_primary_listing_converted_weekly(client, synthetic):
    eur = client.get("/api/universe/IE00B6R52259").json()
    usd = client.get("/api/universe/IE00B6R52259", params={"base_currency": "USD"}).json()
    assert [l["ticker"] for l in eur["listings"] if l["is_primary"]] == ["IUSQ.DE"]
    dates = pd.to_datetime([p["date"] for p in eur["history"]])
    assert dates[0] >= pd.Timestamp("2011-10-21") and (dates.dayofweek == 4).all()
    assert len(eur["history"]) == len(usd["history"]) > 700
    fx_last = synthetic.fx()["EUR"].resample("W-FRI").last().loc[dates[-1]]
    assert usd["history"][-1]["value"] == pytest.approx(eur["history"][-1]["value"] * fx_last, rel=1e-4)


def test_detail_unknown_isin_is_404(client):
    r = client.get("/api/universe/XX0000000000")
    assert r.status_code == 404
    assert "XX0000000000" in r.json()["detail"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/integration/test_api_universe.py -v`
Expected: FAIL — responses are 501 (`NotImplemented`), so `.json()` has no list / `KeyError`.

- [ ] **Step 3: Implement `app/api/universe.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, Query
import pandas as pd

from app.api.deps import get_data
from app.api.schemas import FundDetail, FundSummary, fund_summary
from app.engine import returns
from app.engine.types import Currency, DataSource, ListingOut, PricePoint

router = APIRouter(prefix="/universe", tags=["universe"])


def _tickers(listings: pd.DataFrame) -> dict[str, list[str]]:
    return listings.groupby("isin")["ticker"].apply(list).to_dict()


@router.get("", response_model=list[FundSummary])
def list_funds(
    asset_class: str | None = None,
    region: str | None = None,
    esg: bool | None = None,
    ucits: bool | None = None,
    max_ter: float | None = Query(None, ge=0),
    q: str | None = Query(None, description="case-insensitive search in name, isin, ticker, index"),
    data: DataSource = Depends(get_data),
) -> list[FundSummary]:
    funds = data.funds()
    tickers = _tickers(data.listings())
    f = funds
    if asset_class:
        f = f[f["asset_class"] == asset_class]
    if region:
        f = f[f["region"] == region]
    if esg is not None:
        f = f[f["esg"].astype(bool) == esg]
    if ucits is not None:
        f = f[f["ucits"].astype(bool) == ucits]
    if max_ter is not None:
        f = f[~(f["ter"] > max_ter)]  # unknown TER is kept, as in universe.select
    if q and q.strip():
        needle = q.strip().lower()

        def hit(isin: str, row: pd.Series) -> bool:
            hay = [isin, row["name"], row["index_name"], *tickers.get(isin, [])]
            return any(needle in str(h).lower() for h in hay if h is not None and not pd.isna(h))

        f = f.loc[pd.Series([hit(i, r) for i, r in f.iterrows()], index=f.index, dtype=bool)]
    return [fund_summary(isin, row, tickers.get(isin, [])) for isin, row in f.iterrows()]


@router.get("/{isin}", response_model=FundDetail)
def fund_detail(isin: str, base_currency: Currency = "EUR", data: DataSource = Depends(get_data)) -> FundDetail:
    funds = data.funds()
    if isin not in funds.index:
        raise HTTPException(status_code=404, detail=f"unknown isin {isin}")
    listings = data.listings()
    own = listings[listings["isin"] == isin].sort_values(["is_primary", "ticker"], ascending=[False, True])
    history: list[PricePoint] = []
    if len(own):
        primary = own.iloc[0]
        px = data.prices([primary["ticker"]])
        base_px = returns.convert_prices(px, {primary["ticker"]: primary["currency"]}, data.fx(), base_currency)
        weekly = base_px[primary["ticker"]].resample("W-FRI").last().dropna()
        history = [PricePoint(date=d.date(), value=round(float(v), 6)) for d, v in weekly.items()]
    return FundDetail(
        fund=fund_summary(isin, funds.loc[isin], list(own["ticker"])),
        listings=[ListingOut(ticker=r.ticker, exchange=r.exchange or "", currency=r.currency,
                             is_primary=bool(r.is_primary)) for r in own.itertuples()],
        history=history,
    )
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/integration -v`
Expected: PASS (all integration tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/universe.py backend/tests/integration/test_api_universe.py
git commit -m "feat(api): universe list with filters and search, fund detail in base currency"
```

---

### Task 5: Contract refresh — mocks from the real engine

**Files:**
- Modify: `backend/scripts/export_contract.py` (full rewrite below)
- Modify: `backend/tests/test_export_contract.py` (full rewrite below)
- Regenerate: `backend/openapi.json`, `frontend/src/mocks/*.json`, `frontend/src/api/schema.d.ts`

**Interfaces:**
- Consumes: `pipeline.recommend`, `pipeline.backtest`, `scoring.load_questionnaire`, `scoring.score`, route functions `health`, `defaults`, `list_funds`, `fund_detail` (called directly with every argument explicit, so FastAPI `Query`/`Depends` defaults are never used), `SyntheticData`.
- Produces: `scripts.export_contract.build_mocks() -> dict` (keys `health, defaults, questionnaire, score, universe, fund, portfolio, backtest`), `DEMO_PROFILE`, `demo_answers(questionnaire) -> dict`.

- [ ] **Step 1: Re-run the existing export to confirm the baseline still works**

Run: `cd backend && uv run python -m scripts.export_contract`
Expected: `wrote .../backend/openapi.json and .../frontend/src/mocks/*.json`. Then `git status --short backend/openapi.json` — expected: no change (Phase 2 does not change schemas). If it changed, a lane edited a contract file: stop and review the diff before continuing.

- [ ] **Step 2: Write the failing test**

Replace `backend/tests/test_export_contract.py`:

```python
import json

import pytest

from app.engine import pipeline
from app.engine.types import BacktestResult, FundDetail, IntakeScore, Questionnaire, Recommendation
from scripts.export_contract import build_mocks


@pytest.fixture(scope="module")
def mocks():
    return build_mocks()


def test_mocks_validate_against_contract(mocks):
    Recommendation.model_validate(mocks["portfolio"])
    BacktestResult.model_validate(mocks["backtest"])
    Questionnaire.model_validate(mocks["questionnaire"])
    IntakeScore.model_validate(mocks["score"])
    FundDetail.model_validate(mocks["fund"])
    assert len(mocks["universe"]) >= 20
    json.dumps(mocks, allow_nan=False)  # valid JSON: no NaN/inf


def test_mocks_come_from_the_real_implementations(mocks):
    assert [s["step"] for s in mocks["portfolio"]["trace"]] == list(pipeline.RECOMMEND_STEPS)
    assert not any("Mock data" in w for w in mocks["portfolio"]["warnings"])
    assert mocks["backtest"]["trace"][-1]["step"] == "backtest"
    assert mocks["questionnaire"]["version"] != "mock" and len(mocks["questionnaire"]["questions"]) >= 5
    assert 0 <= mocks["score"]["suggested_risk_level"] <= 100
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && uv run pytest tests/test_export_contract.py -v`
Expected: `test_mocks_validate_against_contract` PASS, `test_mocks_come_from_the_real_implementations` FAIL (`assert ['universe', 'returns', ...] == ...` fails because the mock trace has no `backtest`/differs, and the warning "Mock data: ..." is present).

- [ ] **Step 4: Rewrite `scripts/export_contract.py`**

```python
"""Write backend/openapi.json and frontend/src/mocks/*.json.

Run from backend/: `uv run python -m scripts.export_contract`.
Every mock is produced by the real implementation on the deterministic SyntheticData market, so the
frontend's mock mode shows real shapes and magnitudes (re-run after any engine or intake change).
"""

import json
from pathlib import Path

from app.api.health import defaults, health
from app.api.universe import fund_detail, list_funds
from app.engine import pipeline
from app.engine.types import BacktestSettings, EngineSettings, InvestorProfile, Questionnaire
from app.intake import scoring
from app.main import app
from tests.fixtures.synthetic import SyntheticData

BACKEND = Path(__file__).resolve().parents[1]
MOCKS = BACKEND.parent / "frontend" / "src" / "mocks"

DEMO_PROFILE = InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR")
MOCK_SETTINGS = EngineSettings(mc_paths=2000)
DEMO_FUND = "IE00B6R52259"


def demo_answers(questionnaire: Questionnaire) -> dict[str, str | float]:
    """A complete, middle-of-the-road answer set: the middle option of each single-choice question,
    10 (or the midpoint of the allowed range) for number questions."""
    answers: dict[str, str | float] = {}
    for q in questionnaire.questions:
        if q.type == "single":
            answers[q.id] = q.options[len(q.options) // 2].value
        else:
            lo = q.min if q.min is not None else 0.0
            hi = q.max if q.max is not None else lo + 20
            answers[q.id] = 10.0 if lo <= 10 <= hi else (lo + hi) / 2
    return answers


def build_mocks() -> dict:
    data = SyntheticData()
    questionnaire = scoring.load_questionnaire()
    score = scoring.score(demo_answers(questionnaire), questionnaire)
    rec = pipeline.recommend(DEMO_PROFILE, MOCK_SETTINGS, data)
    bt = pipeline.backtest(DEMO_PROFILE, None, MOCK_SETTINGS, BacktestSettings(), data)
    universe = list_funds(asset_class=None, region=None, esg=None, ucits=None, max_ter=None, q=None, data=data)
    fund = fund_detail(isin=DEMO_FUND, base_currency="EUR", data=data)

    dump = lambda m: m.model_dump(mode="json")  # noqa: E731
    return {
        "health": dump(health(data=data)),
        "defaults": dump(defaults()),
        "questionnaire": dump(questionnaire),
        "score": dump(score),
        "universe": [dump(u) for u in universe],
        "fund": dump(fund),
        "portfolio": dump(rec),
        "backtest": dump(bt),
    }


def main() -> None:
    (BACKEND / "openapi.json").write_text(json.dumps(app.openapi(), indent=2))
    MOCKS.mkdir(parents=True, exist_ok=True)
    for name, body in build_mocks().items():
        (MOCKS / f"{name}.json").write_text(json.dumps(body, allow_nan=False))
    print(f"wrote {BACKEND / 'openapi.json'} and {MOCKS}/*.json")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the test, regenerate, and check the frontend**

Run: `cd backend && uv run pytest tests/test_export_contract.py -v`
Expected: PASS (2 tests).

Run: `cd backend && uv run python -m scripts.export_contract`
Expected: `wrote .../backend/openapi.json and .../frontend/src/mocks/*.json`

Run: `cd frontend && npm run gen:api && git diff --stat src/api/schema.d.ts`
Expected: no diff for `schema.d.ts` (schemas unchanged in Phase 2).

Run: `cd frontend && npm run typecheck && npm test && npm run build`
Expected: no type errors, all vitest tests pass, build succeeds.

Run: `cd frontend && npm run dev:mock`, open `http://localhost:5740/portfolio`, `/backtest`, `/universe`, `/universe/IE00B6R52259` and `/start`. Expected: every page renders real-looking data (trace list shows 8 steps, backtest chart ~15 years), no console errors. Stop the server. If a Lane G/H page breaks on the new mocks (e.g. it hard-coded a mock-only key such as a trace summary field), fix it in that page and note it in the commit message.

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/export_contract.py backend/tests/test_export_contract.py backend/openapi.json frontend/src/mocks frontend/src/api/schema.d.ts
git commit -m "feat(contract): generate frontend mocks from the real engine on synthetic data"
```

---

### Task 6: Real data — ingest, live run, golden check

**Files:**
- Create: `backend/scripts/golden.py`, `backend/tests/integration/test_golden.py`
- Generate: `backend/tests/integration/golden_eur_50.json`, `backend/data/roboadvisor.db` (git-ignored)

**Interfaces:**
- Consumes: `app.data.ingest.main`, `app.data.db.SqliteData(path)`, `pipeline.recommend`, `config.DB_PATH`.
- Produces: `scripts.golden.{PROFILE, TOLERANCES, GOLDEN_PATH, key_numbers(rec) -> dict, compute() -> dict, main(argv) -> int}`; `uv run python -m scripts.golden [--write]`.

- [ ] **Step 1: Run the real ingest (network, 20–60 minutes on first run)**

Run: `cd backend && uv run python -m app.data.ingest`
Expected: progress output, then a quality report listing issues by kind (`missing_ter`, `short_history`, `gap`, `stale`, `extreme_move`, `no_data`), exit code 0, file `backend/data/roboadvisor.db` exists.

- [ ] **Step 2: Review the quality report and the anchors**

Run:
```bash
cd backend && uv run python -c "
from app import config
from app.data.db import SqliteData
d = SqliteData(config.DB_PATH)
f = d.funds()
print('funds', len(f), 'listings', len(d.listings()))
anchors = [i for a in config.ANCHORS.values() for i in a.values()]
print('missing anchors', [i for i in anchors if i not in f.index])
l = d.listings()
for i in anchors:
    t = l[l.isin == i].ticker.tolist()
    px = d.prices(t)
    print(i, t, [str(px[c].first_valid_index())[:10] for c in t])
"
```
Expected: `funds` ≥ 300, `missing anchors []`, every anchor has at least one ticker with history (or a proxy) starting ≤ 2008.

Triage every quality issue: `no_data` / `stale` on an anchor or a proxy ticker is a blocker (fix `etfs.csv` or `config.ANCHORS`, re-ingest); other issues are accepted and listed under "Known data issues" in the README in Task 8 (one line per kind with counts and examples).

- [ ] **Step 3: Live smoke run of backend and frontend**

Terminal 1: `cd backend && uv run uvicorn app.main:app --port 8740`
Terminal 2: `cd frontend && npm run dev`

Run:
```bash
curl -s localhost:8740/api/health
curl -s -X POST localhost:8740/api/portfolio -H 'content-type: application/json' \
  -d '{"profile":{"risk_level":50,"horizon_years":10,"base_currency":"EUR"}}' \
  | python3 -c "import json,sys; r=json.load(sys.stdin); print(r['summary']); print([(h['ticker'], h['weight']) for h in r['holdings']]); print(r['warnings'])"
```
Expected: health `{"status":"ok","data_loaded":true,...}`; summary with `target_volatility` 0.11, `volatility` ≤ 0.111; plausibility band for the reference profile: equity share 0.35–0.75, expected return 0.03–0.08, `weighted_ter` < 0.004, all holdings UCITS or ETC/ETP. Anything outside the band: use superpowers:systematic-debugging on the trace (`r['trace']`) before recording the golden numbers.

Open `http://localhost:5740/`, go through the wizard, check the portfolio, backtest (static and walk-forward) and universe pages against the real backend. Stop both servers.

- [ ] **Step 4: Write the failing golden test**

`backend/tests/integration/test_golden.py`:

```python
import json

import pytest

from app import config
from scripts.golden import GOLDEN_PATH, TOLERANCES, compute

pytestmark = pytest.mark.skipif(
    not config.DB_PATH.exists(), reason="no real DB; run `uv run python -m app.data.ingest` in backend/"
)


def test_golden_eur_50_has_not_drifted():
    assert GOLDEN_PATH.exists(), "no golden file; run `uv run python -m scripts.golden --write` in backend/"
    golden = json.loads(GOLDEN_PATH.read_text())
    now = compute()
    drift = {k: {"golden": golden[k], "now": now[k], "tolerance": tol}
             for k, tol in TOLERANCES.items() if abs(now[k] - golden[k]) > tol}
    assert not drift, (
        f"golden run drifted: {drift}. If intended (new data, model change), review, then "
        f"`uv run python -m scripts.golden --write` and commit the JSON."
    )
```

Run: `cd backend && uv run pytest tests/integration/test_golden.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.golden'`.

- [ ] **Step 5: Write `scripts/golden.py`**

```python
"""Golden run of the reference EUR profile on the real DB.

`uv run python -m scripts.golden` prints the key numbers; `--write` records them in
tests/integration/golden_eur_50.json (commit it).
"""

import argparse
import json
from pathlib import Path

from app import config
from app.engine import pipeline
from app.engine.types import EngineSettings, InvestorProfile, Recommendation

GOLDEN_PATH = Path(__file__).resolve().parents[1] / "tests" / "integration" / "golden_eur_50.json"
PROFILE = InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR")
TOLERANCES = {
    "expected_return": 0.005,
    "volatility": 0.01,
    "target_volatility": 1e-9,
    "sharpe": 0.10,
    "weighted_ter": 0.0010,
    "equity_share": 0.10,
    "bond_share": 0.10,
    "p_drawdown_30": 0.05,
    "p_below_invested": 0.05,
    "n_holdings": 2,
}


def key_numbers(rec: Recommendation) -> dict:
    s = rec.summary
    dd = {p.threshold: p.probability for p in rec.downside.drawdown_probs}
    return {
        "expected_return": s.expected_return,
        "volatility": s.volatility,
        "target_volatility": s.target_volatility,
        "sharpe": s.sharpe,
        "weighted_ter": s.weighted_ter,
        "equity_share": s.mix.get("equity", 0.0),
        "bond_share": s.mix.get("bond", 0.0),
        "p_drawdown_30": dd[0.3],
        "p_below_invested": rec.downside.p_below_invested,
        "n_holdings": len(rec.holdings),
        "holdings": {h.isin: h.weight for h in rec.holdings},  # informational, not compared
    }


def compute() -> dict:
    from app.data.db import SqliteData

    return key_numbers(pipeline.recommend(PROFILE, EngineSettings(), SqliteData(config.DB_PATH)))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="record the numbers as the new golden file")
    args = parser.parse_args(argv)
    numbers = compute()
    print(json.dumps(numbers, indent=2))
    if args.write:
        GOLDEN_PATH.write_text(json.dumps(numbers, indent=2) + "\n")
        print(f"wrote {GOLDEN_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 6: Record the golden numbers and run the test**

Run: `cd backend && uv run python -m scripts.golden --write`
Expected: the JSON printed (numbers inside the Step 3 plausibility band) and `wrote .../tests/integration/golden_eur_50.json`.

Run: `cd backend && uv run pytest tests/integration/test_golden.py -v`
Expected: PASS.

Run: `cd backend && ROBO_DB_PATH=/tmp/does-not-exist.db uv run pytest tests/integration/test_golden.py -v`
Expected: `SKIPPED (no real DB; ...)`.

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/golden.py backend/tests/integration/test_golden.py backend/tests/integration/golden_eur_50.json
git commit -m "test: golden run of the reference EUR profile on real data"
```

---

### Task 7: Playwright smoke test (mock mode)

**Files:**
- Modify: `frontend/package.json` (devDependency + `e2e` script)
- Create: `frontend/playwright.config.ts`, `frontend/e2e/smoke.pw.ts`
- Modify: `frontend/.gitignore` (append Playwright output dirs)

**Interfaces:**
- Consumes: `npm run dev:mock` (Vite on 5740 with `VITE_USE_MOCKS=1`), `frontend/src/mocks/portfolio.json` (Task 5), the Lane G/H UI: landing CTA "Build my portfolio" (spec §8.2), wizard advance buttons, portfolio page showing holding names.
- Produces: `npm run e2e`.

- [ ] **Step 1: Escalate the dependency**

Global constraint: only Phase 0 adds dependencies. Ask the user: "Phase 2 needs `@playwright/test` as a frontend devDependency plus the Chromium browser (~150 MB) for the smoke test. OK to add?" Continue only after a yes. If declined, skip Task 7 and note it in the README.

- [ ] **Step 2: Install**

```bash
cd frontend
npm install -D @playwright/test
npx playwright install chromium
```

Expected: `package.json` gains `"@playwright/test"` under `devDependencies`; `npx playwright --version` prints a version.

Add to `package.json` `"scripts"`: `"e2e": "playwright test"`.

Append to `frontend/.gitignore`:

```
test-results/
playwright-report/
```

- [ ] **Step 3: Write the config**

`frontend/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

// The e2e files end in .pw.ts so vitest (which picks up *.spec.ts / *.test.ts) never runs them.
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.pw\.ts$/,
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5740', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev:mock',
    url: 'http://localhost:5740',
    reuseExistingServer: false, // a non-mock dev server on 5740 must not be reused; stop it first
    timeout: 60_000,
  },
});
```

- [ ] **Step 4: Write the smoke test**

`frontend/e2e/smoke.pw.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const portfolio = JSON.parse(readFileSync(new URL('../src/mocks/portfolio.json', import.meta.url), 'utf8')) as {
  holdings: { name: string }[];
};

// Buttons/links that move the wizard forward (landing CTA excluded; header nav "Portfolio" does not match).
const ADVANCE = /^(next|continue|confirm|use this risk level|see my risk( level)?|show my portfolio|see my portfolio|build my portfolio)\b/i;

async function answerVisibleQuestions(page: Page) {
  for (const input of await page.locator('input[type="number"]:visible').all()) {
    if (!(await input.inputValue())) {
      const min = Number((await input.getAttribute('min')) ?? '1');
      const max = Number((await input.getAttribute('max')) ?? '40');
      await input.fill(String(Math.min(Math.max(10, min), max)));
    }
  }
  for (const group of await page.getByRole('radiogroup').all()) {
    if (!(await group.isVisible())) continue;
    if (await group.getByRole('radio', { checked: true }).count()) continue;
    const radios = group.getByRole('radio');
    const n = await radios.count();
    if (n) await radios.nth(Math.floor((n - 1) / 2)).check();
  }
}

test('landing -> questionnaire -> risk -> preferences -> portfolio (mock mode)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('link', { name: /build my portfolio/i }).first().click();
  await expect(page).toHaveURL(/\/start/);

  for (let i = 0; i < 30 && !/\/portfolio/.test(page.url()); i++) {
    await answerVisibleQuestions(page);
    const advance = page.getByRole('button', { name: ADVANCE }).or(page.getByRole('link', { name: ADVANCE })).first();
    await expect(advance).toBeEnabled();
    await advance.click();
    await page.waitForTimeout(150);
  }

  await expect(page).toHaveURL(/\/portfolio/);
  await expect(page.getByText(portfolio.holdings[0].name).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(portfolio.holdings[1].name).first()).toBeVisible();
  expect(errors).toEqual([]);
});
```

- [ ] **Step 5: Run it**

Stop any dev server on 5740, then run: `cd frontend && npm run e2e`
Expected: `1 passed`. If it times out inside the loop, open the trace (`npx playwright show-trace test-results/*/trace.zip`) and look at the last screenshot: if the wizard's forward button has a label outside `ADVANCE`, add that exact label to the regex (do not add data-testids to Lane G's files without telling the lane owner). If holding names are not visible, check that the Portfolio page renders `holdings[].name` from the API response.

Also run: `cd frontend && npm test`
Expected: vitest still runs only its own tests (no `e2e/` file picked up).

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/playwright.config.ts frontend/e2e frontend/.gitignore
git commit -m "test(frontend): playwright smoke test landing -> intake -> portfolio in mock mode"
```

---

### Task 8: Final verification, README, tag

**Files:**
- Modify: `README.md` (full replacement below; fill "Known data issues" from Task 6 Step 2)

**Interfaces:**
- Consumes: everything above.
- Produces: tag `v1.0.0-rc1`.

- [ ] **Step 1: Full backend suite**

Run: `cd backend && uv run pytest -q`
Expected: all tests pass; `test_golden.py` passes (real DB present) or is skipped; no warnings about unawaited coroutines or NaN.

- [ ] **Step 2: Full frontend checks**

Run: `cd frontend && npm run typecheck && npm test && npm run build && npm run e2e`
Expected: no type errors, vitest passes, build succeeds, `1 passed` for Playwright.

- [ ] **Step 3: Contract freshness check**

Run: `cd backend && uv run python -m scripts.export_contract && cd ../frontend && npm run gen:api && cd .. && git status --short`
Expected: empty output (committed mocks, openapi.json and schema.d.ts are current).

- [ ] **Step 4: Replace `README.md`**

````markdown
# Robo-Advisor

Turns an investor profile (risk level 0–100 + preferences) into an ETF portfolio and explains it:
CAPM expected returns, Ledoit-Wolf covariance, target-volatility optimisation, Monte Carlo downside,
stress tests and backtests (static or walk-forward). Educational tool, not financial advice.

Spec: `docs/superpowers/specs/2026-09-29-roboadvisor-design.md` · Plans: `docs/superpowers/plans/`

## Quick start

```bash
# backend (port 8740)
cd backend
uv sync
uv run python -m app.data.ingest          # first run downloads all history (20-60 min); later runs are incremental
uv run uvicorn app.main:app --port 8740   # API docs: http://localhost:8740/docs

# frontend (port 5740), second terminal
cd frontend
npm install
npm run dev                               # http://localhost:5740, proxies /api to 8740
```

No data yet? `npm run dev:mock` runs the frontend on mock responses generated from the real engine on a
synthetic market. The API returns 503 with "run `python -m app.data.ingest`" until a database exists.
The backend caches the database connection: restart it after a re-ingest.

## Data

- `backend/data/etfs.csv`: the curated universe (one row per listing). `backend/data/roboadvisor.db`: SQLite, git-ignored.
- `uv run python -m app.data.ingest [--full]`: yfinance prices, FX, risk-free rates (USD ^IRX, EUR ECB €STR/EONIA),
  then a quality report. Problems are reported, never silently fixed.
- Override the DB location with `ROBO_DB_PATH=/path/to.db`.

### Known data issues (from the last ingest)

<!-- one line per quality-report kind: count and 1-3 examples, and why it is accepted -->

## Tests

```bash
cd backend && uv run pytest               # engine, data, API integration (synthetic market, no network)
cd frontend && npm run typecheck && npm test
cd frontend && npm run e2e                # Playwright smoke test, starts `npm run dev:mock` itself (stop other servers on 5740)
```

Golden run (real data): `tests/integration/test_golden.py` compares the reference EUR profile (risk 50,
horizon 10, defaults) with `tests/integration/golden_eur_50.json`; skipped when no DB exists. After an
intended change (new data, model change) review the numbers and re-record:
`cd backend && uv run python -m scripts.golden --write`.

## After changing `app/engine/types.py`, `app/api/schemas.py`, the engine or the questionnaire

```bash
cd backend && uv run python -m scripts.export_contract   # backend/openapi.json + frontend/src/mocks/*.json
cd ../frontend && npm run gen:api                        # src/api/schema.d.ts
```

## Layout

- `backend/app/engine/`: pure calculation modules; `pipeline.py` wires them (recommend, backtest) and
  records a `trace` step per stage (`universe, returns, covariance, expected_returns, constraints,
  optimize, metrics, downside, backtest`).
- `backend/app/api/`: FastAPI routes under `/api`; domain errors → 422, missing data → 503.
- `backend/app/data/`: SQLite schema, ingestion, quality report.
- `backend/tests/fixtures/synthetic.py`: deterministic synthetic market used by all tests and mocks.
- `frontend/src/`: React + Vite; `api/` typed client (+ mock mode), `state/` profile store, `pages/`, `intake/`.
````

Fill the "Known data issues" section with the triage from Task 6 Step 2 (replace the HTML comment with the list).

- [ ] **Step 5: Commit and tag**

```bash
git add README.md
git commit -m "docs: README for running backend, frontend, ingest and tests"
git tag v1.0.0-rc1
git log --oneline -1 && git tag --list 'v1*'
```

Expected: the README commit on top and `v1.0.0-rc1` listed.

---

## Self-review notes

- Spec coverage: §5.9 pipeline (Tasks 1–2), §5.10 trace keys incl. `backtest` (Tasks 1–2), §5.11 error mapping (Task 3), §7 routes (Tasks 3–4), §10 API tests + walk-forward look-ahead test + Playwright + golden run (Tasks 2, 3, 6, 7), §11 Phase 2 list: pipeline, routes, API tests, mock refresh ("turn off mock mode" = `npm run dev` against the real backend in Task 6), real ingest, Playwright, golden run. `engine/trace.py` and `/api/defaults` were already completed in Phase 0.
- Type consistency: `_fit` returns `_Fit` used by both `recommend` and the walk-forward `weights_fn`; `RECOMMEND_STEPS` / `CAPM_EQUITY_BOND_NOTE` are imported by tests under those exact names; helpers `profile/recommend/post_backtest/FAST` are defined once in `tests/integration/helpers.py`.
