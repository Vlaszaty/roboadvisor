# Phase 0 — Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create every shared contract (config, types, errors, DB schema, route signatures, engine function stubs, synthetic test market, OpenAPI export, frontend scaffold with mock mode) so that lanes A–H can then be built in parallel without touching each other's files.

**Architecture:** FastAPI backend in `backend/` managed with uv; engine is pure Python over pandas. Pydantic models in `app/engine/types.py` are the JSON contract (re-exported by `app/api/schemas.py`); dataclasses carry pandas results inside the engine. Every lane-owned file is created here as a stub with its final signature. The frontend (`frontend/`, Vite + React + TS) gets generated API types, a mock mode, the profile store, routing, layout and design tokens.

**Tech Stack:** Python 3.12, uv, FastAPI, Pydantic v2, pandas, numpy, scipy, scikit-learn, PyPortfolioOpt, yfinance, httpx, pytest; Node 25 / npm, Vite, React 19, TypeScript, react-router, Recharts, openapi-fetch, openapi-typescript, vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-roboadvisor-design.md`

## Global Constraints

- Python tooling is **uv** only: `uv sync`, `uv add`, `uv run pytest`, `uv run python -m ...`. Python pinned to **3.12**. Never use pip or a hand-made venv.
- Backend port **8740**, frontend port **5740** with Vite `strictPort: true`; Vite proxies `/api` → `http://localhost:8740`.
- All API routes live under `/api`. The API is stateless.
- Engine modules (`app/engine/*`) never import FastAPI, sqlite3 or `app.data`.
- API responses never contain NaN/inf (Starlette serialises with allow_nan=False): engine code returns `None` for
  optional floats that are undefined (e.g. Sharpe with zero vol, rolling values before the window fills).
- All engine return series are **weekly (W-FRI)**, simple returns, base currency, columns = ISIN. Annualisation factor 52.
- Base currencies: `EUR`, `USD`.
- Drawdowns and losses are **negative numbers** (−0.35 = −35%). Thresholds are positive (0.3 means "−30% or worse").
- No network access in tests.
- Only Phase 0 adds Python/npm dependencies. Lanes that need one must escalate.
- Contract files created here (`config.py` structure, `engine/types.py`, `engine/errors.py`, `api/schemas.py`, `data/schema.sql`, route signatures, stub signatures) are frozen after Phase 0; changes go through the integrator.

## File ownership after Phase 0

| Owner | Files (bodies filled later) |
|---|---|
| Lane A | `backend/app/data/{db,ingest,sources,quality}.py`, `backend/data/etfs.csv`, values of `config.ANCHORS` |
| Lane B | `backend/app/engine/{universe,returns,risk}.py` |
| Lane C | `backend/app/engine/{expected,optimize}.py` |
| Lane D | `backend/app/engine/{metrics,downside}.py` |
| Lane E | `backend/app/engine/backtest.py` |
| Lane F | `backend/app/intake/{questionnaire.json,scoring.py}`, body of `backend/app/api/intake.py` |
| Lane G | `frontend/src/pages/{Landing,Start}.tsx`, `frontend/src/intake/**` |
| Lane H | `frontend/src/pages/{Portfolio,Backtest,Universe,UniverseFund}.tsx`, `frontend/src/components/SettingsDrawer.tsx`, `frontend/src/components/charts/**` |
| Phase 2 | `backend/app/engine/pipeline.py`, bodies of `backend/app/api/{portfolio,backtest,universe}.py` |

Each lane writes its own tests in new files under `backend/tests/<lane>/` or next to its frontend files.

---

### Task 1: Backend skeleton with uv, config, errors, health and defaults

**Files:**
- Create: `backend/pyproject.toml` (via uv), `backend/.python-version`
- Create: `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/main.py`
- Create: `backend/app/engine/__init__.py`, `backend/app/engine/errors.py`
- Create: `backend/app/api/__init__.py`, `backend/app/api/deps.py`, `backend/app/api/health.py`
- Create: `backend/app/api/{intake,universe,portfolio,backtest}.py` (temporary empty routers, finished in Task 4)
- Test: `backend/tests/__init__.py`, `backend/tests/test_health.py`

**Interfaces:**
- Produces: `app.config` constants (below); `app.engine.errors.{DomainError, NoEligibleFunds, InfeasibleConstraints, InvalidSettings, InsufficientHistory, NoData}`; `app.api.deps.get_data() -> DataSource`, `app.api.deps.get_data_optional() -> DataSource | None`; routes `GET /api/health`, `GET /api/defaults`.

- [ ] **Step 1: Create the uv project and dependencies**

```bash
cd backend
uv init --bare --python 3.12 --name roboadvisor
uv python pin 3.12
uv add fastapi "uvicorn[standard]" pandas numpy scipy scikit-learn pyportfolioopt yfinance httpx
uv add --dev pytest
```

Then append to `backend/pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

Run: `uv run python -c "import fastapi, pypfopt, sklearn, yfinance; print('ok')"`
Expected: `ok`

- [ ] **Step 2: Write `app/config.py`**

```python
"""All tunable defaults (spec §9). Values are modelling assumptions, not facts."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("ROBO_DB_PATH", BACKEND_DIR / "data" / "roboadvisor.db"))
ETFS_CSV = BACKEND_DIR / "data" / "etfs.csv"

API_PORT = 8740
FRONTEND_ORIGINS = ["http://localhost:5740", "http://127.0.0.1:5740"]

BASE_CURRENCIES = ("EUR", "USD")
PERIODS_PER_YEAR = 52  # the engine works on weekly returns

VOL_RANGE = (0.02, 0.20)
ESTIMATION_WINDOW_YEARS = 5
MIN_COVERAGE = 0.8  # share of non-NaN weeks a fund needs inside the estimation window

# Market anchors per base currency, by ISIN. Lane A verifies these ISINs against real data
# and may correct the values; the keys ("global_equity", "global_bonds") are fixed.
ANCHORS = {
    "EUR": {"global_equity": "IE00B6R52259", "global_bonds": "IE00BDBRDM35"},
    "USD": {"global_equity": "US4642882579", "global_bonds": "US92203J4076"},
}
MARKETS = {
    "capm_equity": {"weights": {"global_equity": 1.0}, "premium": 0.050},
    "capm_multi_asset": {"weights": {"global_equity": 0.6, "global_bonds": 0.4}, "premium": 0.035},
}

CRYPTO_MIN_RISK_LEVEL = 40
CRYPTO_DEFAULT_CAP = 0.05  # UI default for crypto_max when the user opts in
CRYPTO_HARD_CAP = 0.10  # crypto_max above this is rejected (422)
TER_PENALTY = 1.0  # multiplier on TER in the optimizer objective
MAX_CARDINALITY_ROUNDS = 3

DRAWDOWN_THRESHOLDS = (0.3, 0.4, 0.5)
MC_PATHS = 10_000
MC_SEED = 42
BLOCK_WEEKS = (4, 13)
FAN_PERCENTILES = (5, 25, 50, 75, 95)
STRESS_EVENTS = [
    ("GFC 2008", "2007-10-09", "2009-03-09"),
    ("COVID 2020", "2020-02-19", "2020-03-23"),
    ("Rate shock 2022", "2022-01-03", "2022-10-14"),
]

BACKTEST_YEARS = 15
TRANSACTION_COST_BPS = 10.0
ROLLING_WINDOW_WEEKS = 156

MISMATCH_GAP = 20
UCITS_DEFAULT = {"EUR": True, "USD": False}
```

- [ ] **Step 3: Write `app/engine/errors.py`**

```python
class DomainError(Exception):
    """An error the API turns into a readable response instead of a 500."""

    status_code = 422


class NoEligibleFunds(DomainError):
    pass


class InfeasibleConstraints(DomainError):
    pass


class InvalidSettings(DomainError):
    pass


class InsufficientHistory(DomainError):
    """Not enough overlapping weekly history for the requested calculation (422)."""


class NoData(DomainError):
    """No database loaded (503). Only for a missing/empty DB, never for thin history."""

    status_code = 503
```

- [ ] **Step 4: Write the failing health test**

`backend/tests/__init__.py`: empty file.

`backend/tests/test_health.py`:

```python
from fastapi.testclient import TestClient

from app.api.deps import get_data_optional
from app.main import app


def test_health_without_data():
    app.dependency_overrides[get_data_optional] = lambda: None
    try:
        r = TestClient(app).get("/api/health")
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "data_loaded": False, "last_ingest": None, "n_funds": 0}


def test_defaults_exposes_config():
    r = TestClient(app).get("/api/defaults")
    assert r.status_code == 200
    body = r.json()
    assert body["vol_range"] == [0.02, 0.20]
    assert body["markets"]["capm_multi_asset"]["premium"] == 0.035
    assert body["stress_events"][0]["name"] == "GFC 2008"


def test_unimplemented_route_returns_501():
    from app.api.deps import get_data

    app.dependency_overrides[get_data] = lambda: object()
    try:
        r = TestClient(app).post("/api/portfolio", json={"profile": {"risk_level": 50, "horizon_years": 10, "base_currency": "EUR"}})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 501
```

- [ ] **Step 5: Run to verify it fails**

Run: `cd backend && uv run pytest tests/test_health.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.api.deps'` (or `app.main`).

- [ ] **Step 6: Write `app/api/deps.py`**

```python
from functools import lru_cache

from app import config
from app.engine.errors import NoData
from app.engine.types import DataSource


@lru_cache(maxsize=1)
def _sqlite(path: str) -> DataSource:
    # ponytail: cached for the process lifetime; restart the server after a re-ingest.
    from app.data.db import SqliteData  # Lane A

    return SqliteData(path)


def get_data() -> DataSource:
    if not config.DB_PATH.exists():
        raise NoData("no data loaded, run `uv run python -m app.data.ingest` in backend/")
    return _sqlite(str(config.DB_PATH))


def get_data_optional() -> DataSource | None:
    try:
        return get_data()
    except (NoData, NotImplementedError):
        return None
```

(`app.engine.types` is created in Task 2; this test run happens after Task 2 is also done — if executing strictly in order, create a temporary `app/engine/types.py` containing only `from typing import Any as DataSource` and replace it in Task 2.)

- [ ] **Step 7: Write `app/api/health.py`**

```python
from fastapi import APIRouter, Depends

from app import config
from app.api.deps import get_data_optional
from app.api.schemas import Defaults, Health, MarketDefault, StressEvent
from app.engine.types import DataSource

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=Health)
def health(data: DataSource | None = Depends(get_data_optional)) -> Health:
    if data is None:
        return Health(status="ok", data_loaded=False, last_ingest=None, n_funds=0)
    return Health(status="ok", data_loaded=True, last_ingest=data.last_ingest(), n_funds=len(data.funds()))


@router.get("/defaults", response_model=Defaults)
def defaults() -> Defaults:
    return Defaults(
        vol_range=config.VOL_RANGE,
        estimation_window_years=config.ESTIMATION_WINDOW_YEARS,
        markets={k: MarketDefault(**v) for k, v in config.MARKETS.items()},
        anchors=config.ANCHORS,
        crypto_min_risk_level=config.CRYPTO_MIN_RISK_LEVEL,
        crypto_default_cap=config.CRYPTO_DEFAULT_CAP,
        crypto_hard_cap=config.CRYPTO_HARD_CAP,
        drawdown_thresholds=list(config.DRAWDOWN_THRESHOLDS),
        mc_paths=config.MC_PATHS,
        stress_events=[StressEvent(name=n, start=s, end=e) for n, s, e in config.STRESS_EVENTS],
        backtest_years=config.BACKTEST_YEARS,
        transaction_cost_bps=config.TRANSACTION_COST_BPS,
        mismatch_gap=config.MISMATCH_GAP,
    )
```

- [ ] **Step 8: Write `app/main.py`**

```python
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import config
from app.api import backtest, health, intake, portfolio, universe
from app.engine.errors import DomainError

# One schema per model (no -Input/-Output split) keeps the generated TypeScript types simple.
app = FastAPI(title="Robo-Advisor API", version="0.1.0", separate_input_output_schemas=False)
app.add_middleware(
    CORSMiddleware, allow_origins=config.FRONTEND_ORIGINS, allow_methods=["*"], allow_headers=["*"]
)
for module in (health, intake, universe, portfolio, backtest):
    app.include_router(module.router, prefix="/api")


@app.exception_handler(DomainError)
async def domain_error(_: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": type(exc).__name__, "detail": str(exc)})


@app.exception_handler(NotImplementedError)
async def not_implemented(_: Request, exc: NotImplementedError) -> JSONResponse:
    return JSONResponse(status_code=501, content={"error": "NotImplemented", "detail": str(exc) or "not built yet"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=config.API_PORT, reload=True)
```

Create `app/__init__.py`, `app/engine/__init__.py`, `app/api/__init__.py` as empty files. Create `app/api/{intake,universe,portfolio,backtest}.py` each containing only:

```python
from fastapi import APIRouter

router = APIRouter()
```

(Task 4 replaces them with full route signatures.)

- [ ] **Step 9: Continue to Task 2** — `health.py` imports `app.api.schemas` and `app.engine.types`, which Task 2 creates. The tests for this task pass at the end of Task 2 (`test_unimplemented_route_returns_501` passes at the end of Task 4).

---

### Task 2: Contract types, API schemas and trace

**Files:**
- Create: `backend/app/engine/types.py`, `backend/app/engine/trace.py`, `backend/app/api/schemas.py`
- Test: `backend/tests/test_types.py`

**Interfaces:**
- Produces (exact names used by every lane):
  - Pydantic: `Preferences, InvestorProfile, EngineSettings, RebalanceSettings, BacktestSettings, StepResult, Holding, PortfolioSummary, ProbabilityPoint, FanPoint, StressResult, NormalComparison, Downside, Recommendation, ProxiedPeriod, BacktestSeries, BacktestResult, QuestionOption, Question, Questionnaire, IntakeAnswers, IntakeScore, FundSummary, ListingOut, PricePoint, FundDetail`
  - Dataclasses: `Constraints, CapmResult, OptimizeResult, ReturnsResult, SimulationResult`
  - Protocol: `DataSource`; constants `FUND_COLUMNS`, `LISTING_COLUMNS`
  - `app.engine.trace.Trace` with `.add(step, summary, notes=())` and `.steps: list[StepResult]`
  - `app.api.schemas`: re-exports + `PortfolioRequest, BacktestRequest, Health, Defaults, MarketDefault, StressEvent, fund_summary(isin, row, tickers)`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_types.py`:

```python
import pandas as pd
import pytest
from pydantic import ValidationError

from app.api.schemas import BacktestRequest, fund_summary
from app.engine.trace import Trace
from app.engine.types import BacktestSettings, EngineSettings, InvestorProfile, Preferences


def test_profile_defaults():
    p = InvestorProfile(risk_level=55.5, horizon_years=10, base_currency="EUR")
    assert p.preferences.max_etfs == 10
    assert p.preferences.crypto_max == 0.0
    assert EngineSettings().expected_return_model == "capm_multi_asset"
    assert EngineSettings().vol_range == (0.02, 0.20)


def test_risk_level_bounds():
    with pytest.raises(ValidationError):
        InvestorProfile(risk_level=101, horizon_years=10, base_currency="EUR")


def test_crypto_hard_cap():
    with pytest.raises(ValidationError):
        Preferences(crypto_max=0.2)


def test_walk_forward_requires_rebalancing():
    with pytest.raises(ValidationError):
        BacktestSettings(mode="walk_forward")
    BacktestSettings(mode="walk_forward", rebalance={"type": "periodic", "frequency": "quarterly"})


def test_backtest_request_needs_profile():
    with pytest.raises(ValidationError):
        BacktestRequest.model_validate({"backtest": {}})


def test_trace_collects_steps():
    t = Trace()
    t.add("universe", {"n_funds": 12}, ["dropped 3 non-UCITS funds"])
    assert t.steps[0].step == "universe"
    assert t.steps[0].summary == {"n_funds": 12}


def test_fund_summary_cleans_pandas_values():
    row = pd.Series({
        "name": "X", "issuer": "I", "asset_class": "equity", "sub_class": "broad", "region": "global",
        "sector": float("nan"), "esg": pd.NA, "ter": 0.002, "domicile": "IE", "ucits": True,
        "wrapper": "etf", "distribution": "acc", "hedged_to": None, "duration": float("nan"),
        "index_name": "MSCI ACWI", "inception_date": pd.Timestamp("2011-10-21"),
        "proxy_ticker": "SYN-EQ", "proxy_currency": "USD",
    })
    s = fund_summary("IE00B6R52259", row, ["IUSQ.DE"])
    assert s.sector is None and s.duration is None and s.esg is False
    assert str(s.inception_date) == "2011-10-21"
    assert s.has_proxy is True
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_types.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.engine.types'` (or import error on the temporary stub).

- [ ] **Step 3: Write `app/engine/types.py`**

```python
"""Contract types shared by engine, API and frontend (via OpenAPI).

Pydantic models are the JSON contract. Dataclasses are engine-internal results carrying pandas objects.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal, Protocol

import pandas as pd
from pydantic import BaseModel, Field, model_validator

from app import config

Currency = Literal["EUR", "USD"]
ExpectedReturnModel = Literal["capm_equity", "capm_multi_asset"]
Strategy = Literal["target_vol", "min_variance", "max_sharpe", "risk_parity", "hrp"]

FUND_COLUMNS = [
    "name", "issuer", "asset_class", "sub_class", "region", "sector", "esg", "ter", "domicile",
    "ucits", "wrapper", "distribution", "hedged_to", "duration", "index_name", "inception_date",
    "proxy_ticker", "proxy_currency",
]
LISTING_COLUMNS = ["ticker", "isin", "exchange", "currency", "is_primary"]


class DataSource(Protocol):
    """Read access to market data. Implemented by app.data.db.SqliteData and tests.fixtures.synthetic.SyntheticData."""

    def funds(self) -> pd.DataFrame:
        """Index: isin. Columns: FUND_COLUMNS. esg/ucits are bool, ter/duration float (NaN if unknown),
        inception_date is a Timestamp (NaT if unknown), missing strings are None."""
        ...

    def listings(self) -> pd.DataFrame:
        """Columns: LISTING_COLUMNS (RangeIndex). is_primary is bool."""
        ...

    def prices(self, tickers: list[str]) -> pd.DataFrame:
        """Daily adjusted close (total return) in each ticker's own currency. DatetimeIndex (business days),
        one column per requested ticker in the requested order; unknown tickers give an all-NaN column.
        Proxy tickers (e.g. 'BTC-USD', 'SYN-EQ') are served the same way."""
        ...

    def fx(self) -> pd.DataFrame:
        """Daily USD per 1 unit of currency. DatetimeIndex, one column per currency, including 'USD' == 1.0."""
        ...

    def rf(self, currency: str) -> pd.Series:
        """Daily annualised risk-free rate as a fraction (0.035 = 3.5%). DatetimeIndex."""
        ...

    def last_ingest(self) -> str | None:
        """ISO date of the last ingest, or None."""
        ...


# ---------- request models ----------


class Preferences(BaseModel):
    hedge_bonds: bool = True
    ucits_only: bool | None = None  # None -> config.UCITS_DEFAULT[base_currency]
    regions_include: list[str] = []  # empty = all; region "global" always passes
    regions_exclude: list[str] = []
    sector_tilts: dict[str, float] = {}  # sector -> minimum total weight
    sectors_exclude: list[str] = []
    esg_only: bool = False
    max_etfs: int = Field(10, ge=1, le=30)
    min_position: float = Field(0.03, ge=0, le=0.5)
    max_position: float = Field(0.40, gt=0, le=1)
    max_ter: float | None = Field(None, ge=0)
    distribution: Literal["acc", "dist", "any"] = "any"
    crypto_max: float = Field(0.0, ge=0, le=config.CRYPTO_HARD_CAP)


class InvestorProfile(BaseModel):
    risk_level: float = Field(ge=0, le=100)  # decided in intake; the engine never re-scores
    horizon_years: int = Field(ge=1, le=60)
    base_currency: Currency
    preferences: Preferences = Preferences()


class EngineSettings(BaseModel):
    expected_return_model: ExpectedReturnModel = "capm_multi_asset"
    strategy: Strategy = "target_vol"
    estimation_window_years: int = Field(config.ESTIMATION_WINDOW_YEARS, ge=1, le=20)
    market_premium: float | None = None  # None -> config.MARKETS[model]["premium"]
    vol_range: tuple[float, float] = config.VOL_RANGE
    drawdown_thresholds: list[float] = list(config.DRAWDOWN_THRESHOLDS)
    mc_paths: int = Field(config.MC_PATHS, ge=500, le=100_000)
    seed: int | None = config.MC_SEED


class RebalanceSettings(BaseModel):
    type: Literal["none", "periodic", "threshold"] = "none"
    frequency: Literal["monthly", "quarterly", "annual"] = "quarterly"
    threshold: float = Field(0.05, gt=0, le=0.5)  # absolute weight drift, 0.05 = 5 percentage points


class BacktestSettings(BaseModel):
    mode: Literal["static", "walk_forward"] = "static"
    start: date | None = None  # None -> end minus config.BACKTEST_YEARS
    end: date | None = None  # None -> last available week
    rebalance: RebalanceSettings = RebalanceSettings()
    transaction_cost_bps: float = Field(config.TRANSACTION_COST_BPS, ge=0, le=500)
    benchmark: Literal["auto"] | dict[str, float] = "auto"  # dict = isin -> weight

    @model_validator(mode="after")
    def _walk_forward_needs_rebalancing(self) -> BacktestSettings:
        if self.mode == "walk_forward" and self.rebalance.type == "none":
            raise ValueError("walk_forward mode needs rebalance.type 'periodic' or 'threshold'")
        return self


# ---------- response models ----------


class StepResult(BaseModel):
    step: str  # stable key: universe, returns, covariance, expected_returns, constraints, optimize, metrics, downside, backtest
    summary: dict[str, Any] = {}
    notes: list[str] = []


class Holding(BaseModel):
    isin: str
    ticker: str
    exchange: str
    name: str
    weight: float
    asset_class: str
    sub_class: str | None
    region: str | None
    ter: float | None
    beta: float
    expected_return: float
    risk_contribution: float  # share of portfolio variance, sums to 1
    proxied: bool


class PortfolioSummary(BaseModel):
    expected_return: float
    volatility: float
    target_volatility: float
    sharpe: float
    beta: float
    weighted_ter: float
    annual_cost_per_10k: float
    mix: dict[str, float]  # asset_class -> weight


class ProbabilityPoint(BaseModel):
    threshold: float  # 0.3 = "-30% or worse"
    probability: float


class FanPoint(BaseModel):
    year: int
    p5: float
    p25: float
    p50: float
    p75: float
    p95: float  # value of 1.0 invested at year 0


class StressResult(BaseModel):
    event: str
    start: date
    end: date
    loss: float | None  # cumulative return over the window, negative = loss; None if no data
    proxied: bool


class NormalComparison(BaseModel):
    drawdown_probs: list[ProbabilityPoint]
    annual_loss_probs: list[ProbabilityPoint]


class Downside(BaseModel):
    drawdown_probs: list[ProbabilityPoint]
    annual_loss_probs: list[ProbabilityPoint]
    p_below_invested: float
    fan: list[FanPoint]
    stress: list[StressResult]
    normal_comparison: NormalComparison


class Recommendation(BaseModel):
    holdings: list[Holding]
    summary: PortfolioSummary
    downside: Downside
    warnings: list[str] = []
    trace: list[StepResult] = []


class ProxiedPeriod(BaseModel):
    isin: str
    start: date
    end: date


class BacktestSeries(BaseModel):
    dates: list[date]
    portfolio: list[float]  # value, starts at 1.0
    benchmark: list[float]
    drawdown: list[float]  # portfolio drawdown, <= 0
    rolling_vol: list[float | None]
    rolling_sharpe: list[float | None]


class BacktestResult(BaseModel):
    series: BacktestSeries
    metrics: dict[str, dict[str, float | None]]  # {"portfolio": {...}, "benchmark": {...}}
    weights: dict[str, float]  # initial target weights, isin -> weight
    proxied_periods: list[ProxiedPeriod] = []
    rebalance_dates: list[date] = []
    warnings: list[str] = []
    trace: list[StepResult] = []


# ---------- intake ----------


class QuestionOption(BaseModel):
    label: str
    value: str
    points: float = 0  # 0-100 contribution for the sub-score this question feeds


class Question(BaseModel):
    id: str
    text: str
    help: str | None = None
    type: Literal["single", "number"]
    feeds: Literal["capacity", "tolerance", "horizon"]
    options: list[QuestionOption] = []  # for type "single"
    min: float | None = None  # for type "number"
    max: float | None = None
    unit: str | None = None


class Questionnaire(BaseModel):
    version: str
    questions: list[Question]


class IntakeAnswers(BaseModel):
    answers: dict[str, str | float]  # question id -> option value (single) or number


class IntakeScore(BaseModel):
    capacity: float
    tolerance: float
    suggested_risk_level: float
    limiting_factor: Literal["capacity", "tolerance", "none"]
    mismatch: bool
    explanation: str
    horizon_years: int


# ---------- universe ----------


class FundSummary(BaseModel):
    isin: str
    name: str
    issuer: str | None
    asset_class: str
    sub_class: str | None
    region: str | None
    sector: str | None
    esg: bool
    ter: float | None
    domicile: str | None
    ucits: bool
    wrapper: str
    distribution: str | None
    hedged_to: str | None
    duration: float | None
    index_name: str | None
    inception_date: date | None
    has_proxy: bool
    tickers: list[str]


class ListingOut(BaseModel):
    ticker: str
    exchange: str
    currency: str
    is_primary: bool


class PricePoint(BaseModel):
    date: date
    value: float


class FundDetail(BaseModel):
    fund: FundSummary
    listings: list[ListingOut]
    history: list[PricePoint]  # primary listing converted to base currency, weekly


# ---------- engine-internal results ----------


@dataclass
class ReturnsResult:
    returns: pd.DataFrame  # weekly base-ccy returns, columns = isin
    proxied: dict[str, tuple[pd.Timestamp, pd.Timestamp]] = field(default_factory=dict)


@dataclass
class Constraints:
    target_vol: float
    max_etfs: int
    min_position: float
    max_position: float
    ter: pd.Series  # isin -> annual TER (NaN treated as 0)
    groups: dict[str, list[str]] = field(default_factory=dict)  # "asset_class:bond" -> isins
    group_min: dict[str, float] = field(default_factory=dict)
    group_max: dict[str, float] = field(default_factory=dict)


@dataclass
class CapmResult:
    beta: pd.Series
    expected: pd.Series  # annual expected return per isin
    rf: float  # annual risk-free rate at estimation end
    premium: float
    market: str  # expected_return_model used


@dataclass
class OptimizeResult:
    weights: pd.Series  # isin -> weight, only non-zero weights, sums to 1
    achieved_vol: float
    warnings: list[str] = field(default_factory=list)


@dataclass
class SimulationResult:
    drawdown_probs: list[ProbabilityPoint]
    annual_loss_probs: list[ProbabilityPoint]
    p_below_invested: float
    fan: list[FanPoint]
```

- [ ] **Step 4: Write `app/engine/trace.py`**

```python
from app.engine.types import StepResult


class Trace:
    """Collects one StepResult per pipeline step (spec §5.10)."""

    def __init__(self) -> None:
        self.steps: list[StepResult] = []

    def add(self, step: str, summary: dict, notes: list[str] | tuple[str, ...] = ()) -> None:
        self.steps.append(StepResult(step=step, summary=summary, notes=list(notes)))
```

- [ ] **Step 5: Write `app/api/schemas.py`**

```python
"""API contract: request wrappers + re-exported engine models (spec §7)."""

from datetime import date

import pandas as pd
from pydantic import BaseModel, model_validator

from app.engine.types import (  # noqa: F401  (re-exported for the API layer)
    BacktestResult, BacktestSettings, Downside, EngineSettings, FundDetail, FundSummary, Holding,
    IntakeAnswers, IntakeScore, InvestorProfile, ListingOut, PortfolioSummary, Preferences, PricePoint,
    Questionnaire, Recommendation, StepResult,
)


class PortfolioRequest(BaseModel):
    profile: InvestorProfile
    settings: EngineSettings = EngineSettings()


class BacktestRequest(BaseModel):
    profile: InvestorProfile  # always needed: base currency, preferences
    weights: dict[str, float] | None = None  # static mode: isin -> weight; None -> use the recommendation
    settings: EngineSettings = EngineSettings()
    backtest: BacktestSettings = BacktestSettings()

    @model_validator(mode="after")
    def _weights_sum_to_one(self) -> "BacktestRequest":
        if self.weights is not None and abs(sum(self.weights.values()) - 1) > 1e-6:
            raise ValueError("weights must sum to 1")
        return self


class Health(BaseModel):
    status: str
    data_loaded: bool
    last_ingest: str | None
    n_funds: int


class MarketDefault(BaseModel):
    weights: dict[str, float]
    premium: float


class StressEvent(BaseModel):
    name: str
    start: date
    end: date


class Defaults(BaseModel):
    vol_range: tuple[float, float]
    estimation_window_years: int
    markets: dict[str, MarketDefault]
    anchors: dict[str, dict[str, str]]
    crypto_min_risk_level: float
    crypto_default_cap: float
    crypto_hard_cap: float
    drawdown_thresholds: list[float]
    mc_paths: int
    stress_events: list[StressEvent]
    backtest_years: int
    transaction_cost_bps: float
    mismatch_gap: float


def _clean(v):
    if v is None or v is pd.NA or v is pd.NaT:
        return None
    if isinstance(v, float) and pd.isna(v):
        return None
    if isinstance(v, pd.Timestamp):
        return v.date()
    return v.item() if hasattr(v, "item") else v


def fund_summary(isin: str, row: pd.Series, tickers: list[str]) -> FundSummary:
    """Build a FundSummary from a DataSource.funds() row."""
    v = {c: _clean(row[c]) for c in row.index}
    return FundSummary(
        isin=isin, name=v["name"], issuer=v["issuer"], asset_class=v["asset_class"],
        sub_class=v["sub_class"], region=v["region"], sector=v["sector"], esg=bool(v["esg"]),
        ter=v["ter"], domicile=v["domicile"], ucits=bool(v["ucits"]), wrapper=v["wrapper"] or "etf",
        distribution=v["distribution"], hedged_to=v["hedged_to"], duration=v["duration"],
        index_name=v["index_name"], inception_date=v["inception_date"],
        has_proxy=v["proxy_ticker"] is not None, tickers=tickers,
    )
```

- [ ] **Step 6: Run the tests**

Run: `uv run pytest tests/test_types.py tests/test_health.py::test_health_without_data tests/test_health.py::test_defaults_exposes_config -v`
Expected: PASS (all 9).

- [ ] **Step 7: Commit**

```bash
cd .. && git add backend .gitignore
git commit -m "feat(backend): uv project, config, contract types, health and defaults routes"
```

---

### Task 3: Database schema and data-layer stubs

**Files:**
- Create: `backend/app/data/__init__.py`, `backend/app/data/schema.sql`
- Create (stubs for Lane A): `backend/app/data/db.py`, `backend/app/data/sources.py`, `backend/app/data/ingest.py`, `backend/app/data/quality.py`
- Test: `backend/tests/test_schema.py`

**Interfaces:**
- Produces: `schema.sql` (tables `fund, listing, price, fx, rf_rate, meta`), `app.data.db.SqliteData(path)` implementing `DataSource`, `app.data.db.connect(path) -> sqlite3.Connection`, `app.data.db.init_db(conn) -> None`; `app.data.sources.fetch_prices(tickers: list[str], start: date | None) -> pd.DataFrame`, `fetch_fx(currencies: list[str], start: date | None) -> pd.DataFrame`, `fetch_rf(currency: str, start: date | None) -> pd.Series`; `app.data.quality.Issue`, `app.data.quality.report(conn) -> list[Issue]`; `app.data.ingest.main(argv: list[str] | None = None) -> int`.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_schema.py`:

```python
import sqlite3
from pathlib import Path

import app.data

SCHEMA = Path(app.data.__file__).with_name("schema.sql")


def test_schema_creates_tables():
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA.read_text())
    names = {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
    assert {"fund", "listing", "price", "fx", "rf_rate", "meta"} <= names
    cols = [r[1] for r in conn.execute("pragma table_info(fund)")]
    assert cols[0] == "isin" and "proxy_currency" in cols and "wrapper" in cols
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_schema.py -v`
Expected: FAIL (`app.data` missing or `schema.sql` not found).

- [ ] **Step 3: Write `app/data/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS fund (
  isin TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  issuer TEXT,
  asset_class TEXT NOT NULL,   -- equity | bond | commodity | real_estate | cash | crypto
  sub_class TEXT,
  region TEXT,
  sector TEXT,
  esg INTEGER NOT NULL DEFAULT 0,
  ter REAL,
  domicile TEXT,
  ucits INTEGER NOT NULL DEFAULT 0,
  wrapper TEXT NOT NULL DEFAULT 'etf',  -- etf | etp | etc
  distribution TEXT,           -- acc | dist
  hedged_to TEXT,
  duration REAL,
  index_name TEXT,
  inception_date TEXT,
  proxy_ticker TEXT,
  proxy_currency TEXT
);
CREATE TABLE IF NOT EXISTS listing (
  ticker TEXT PRIMARY KEY,
  isin TEXT NOT NULL REFERENCES fund(isin),
  exchange TEXT,
  currency TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS price (
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  adj_close REAL NOT NULL,
  PRIMARY KEY (ticker, date)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS fx (
  currency TEXT NOT NULL,
  date TEXT NOT NULL,
  usd_rate REAL NOT NULL,
  PRIMARY KEY (currency, date)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rf_rate (
  currency TEXT NOT NULL,
  date TEXT NOT NULL,
  annual_rate REAL NOT NULL,
  PRIMARY KEY (currency, date)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

- [ ] **Step 4: Write the Lane A stubs**

`backend/app/data/__init__.py`: empty.

`backend/app/data/db.py`:

```python
"""SQLite access (Lane A)."""

import sqlite3
from pathlib import Path

import pandas as pd

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def connect(path: Path | str) -> sqlite3.Connection:
    raise NotImplementedError("Lane A")


def init_db(conn: sqlite3.Connection) -> None:
    """Create all tables from schema.sql (idempotent)."""
    raise NotImplementedError("Lane A")


class SqliteData:
    """DataSource over the SQLite file (see app.engine.types.DataSource for the exact contract)."""

    def __init__(self, path: Path | str) -> None:
        raise NotImplementedError("Lane A")

    def funds(self) -> pd.DataFrame: ...
    def listings(self) -> pd.DataFrame: ...
    def prices(self, tickers: list[str]) -> pd.DataFrame: ...
    def fx(self) -> pd.DataFrame: ...
    def rf(self, currency: str) -> pd.Series: ...
    def last_ingest(self) -> str | None: ...
```

`backend/app/data/sources.py`:

```python
"""All network access for ingestion (Lane A). Swappable for a paid provider later."""

from datetime import date

import pandas as pd


def fetch_prices(tickers: list[str], start: date | None) -> pd.DataFrame:
    """Daily adjusted close per ticker (yfinance, auto_adjust=True). DatetimeIndex, columns = tickers
    that returned data. start=None -> maximum history."""
    raise NotImplementedError("Lane A")


def fetch_fx(currencies: list[str], start: date | None) -> pd.DataFrame:
    """Daily USD per 1 unit for each non-USD currency (e.g. from 'EURUSD=X'). Columns = currencies."""
    raise NotImplementedError("Lane A")


def fetch_rf(currency: str, start: date | None) -> pd.Series:
    """Daily annualised risk-free rate as a fraction. USD: ^IRX / 100. EUR: ECB EONIA until 2019-09-30,
    then €STR (EONIA = €STR + 0.00085 for the overlap convention)."""
    raise NotImplementedError("Lane A")
```

`backend/app/data/quality.py`:

```python
"""Data quality report printed after ingestion (Lane A)."""

import sqlite3
from dataclasses import dataclass


@dataclass
class Issue:
    kind: str  # missing_ter | short_history | gap | stale | extreme_move | no_data
    ticker_or_isin: str
    detail: str


def report(conn: sqlite3.Connection) -> list[Issue]:
    raise NotImplementedError("Lane A")
```

`backend/app/data/ingest.py`:

```python
"""`uv run python -m app.data.ingest [--full]` (Lane A)."""

import sys


def main(argv: list[str] | None = None) -> int:
    raise NotImplementedError("Lane A")


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run the test**

Run: `uv run pytest tests/test_schema.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/data backend/tests/test_schema.py
git commit -m "feat(data): sqlite schema and data-layer stubs"
```

---

### Task 4: Engine stubs, intake stubs and full route signatures

**Files:**
- Create (stubs): `backend/app/engine/{universe,returns,risk,expected,optimize,metrics,downside,backtest,pipeline}.py`
- Create (stubs): `backend/app/intake/__init__.py`, `backend/app/intake/scoring.py`, `backend/app/intake/questionnaire.json`
- Modify: `backend/app/api/{intake,universe,portfolio,backtest}.py` (replace the empty routers)
- Test: `backend/tests/test_contract.py`

**Interfaces:**
- Produces the exact signatures below. Lanes implement bodies; signatures and docstring contracts are frozen.

- [ ] **Step 1: Write the failing contract test**

`backend/tests/test_contract.py`:

```python
import inspect

from fastapi.testclient import TestClient

from app.engine import backtest, downside, expected, metrics, optimize, pipeline, returns, risk, universe
from app.intake import scoring
from app.main import app

EXPECTED_FUNCS = {
    universe: ["select"],
    returns: ["convert_prices", "weekly_returns"],
    risk: ["covariance"],
    expected: ["market_returns", "capm"],
    optimize: ["target_vol_from_risk", "build_constraints", "optimize"],
    metrics: ["cagr", "volatility", "sharpe", "sortino", "max_drawdown", "max_drawdown_duration", "cvar",
              "calmar", "beta", "drawdown_series", "rolling_vol", "rolling_sharpe", "risk_contribution", "ex_ante"],
    downside: ["portfolio_history", "simulate", "normal_comparison", "stress"],
    backtest: ["rebalance_dates", "auto_benchmark", "run"],
    pipeline: ["recommend", "backtest"],
    scoring: ["load_questionnaire", "score"],
}


def test_all_stub_functions_exist():
    for module, names in EXPECTED_FUNCS.items():
        for name in names:
            assert inspect.isfunction(getattr(module, name)), f"{module.__name__}.{name}"
    assert isinstance(metrics.REGISTRY, dict)


def test_openapi_has_all_routes():
    paths = TestClient(app).get("/openapi.json").json()["paths"]
    for p in ["/api/health", "/api/defaults", "/api/intake/questionnaire", "/api/intake/score",
              "/api/universe", "/api/universe/{isin}", "/api/portfolio", "/api/backtest"]:
        assert p in paths, p
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_contract.py -v`
Expected: FAIL with `ImportError` for `app.engine.universe`.

- [ ] **Step 3: Write the engine stubs**

`backend/app/engine/universe.py`:

```python
"""Lane B. Spec §5.1."""

import pandas as pd

from app.engine.types import InvestorProfile


def select(funds: pd.DataFrame, listings: pd.DataFrame, profile: InvestorProfile) -> pd.DataFrame:
    """Eligible funds for this profile, one chosen listing each.

    funds / listings: as returned by DataSource.funds() / .listings().
    Returns: funds' columns (index isin) plus 'ticker', 'exchange' and 'currency' of the chosen listing.

    Filters (in this order). The result carries result.attrs["removed"] = {key: number of funds removed} with keys
    esg, regions_include, regions_exclude, sectors_exclude, max_ter, distribution, crypto, non_ucits,
    hedged_duplicates_and_unlisted (every key present, 0 when the filter did nothing), for the trace:
    - esg_only -> keep esg == True.
    - regions_include (non-empty) -> keep region in list or region == 'global'. regions_exclude -> drop region in list.
    - sectors_exclude -> drop sector in list.
    - max_ter -> drop ter > max_ter (unknown TER is kept).
    - distribution 'acc'/'dist' -> keep matching.
    - crypto: drop asset_class == 'crypto' if preferences.crypto_max == 0 or risk_level < config.CRYPTO_MIN_RISK_LEVEL.
    - ucits_only (None -> config.UCITS_DEFAULT[base]) -> drop wrapper == 'etf' funds with ucits False
      (ETPs/ETCs are not UCITS by law but are sold to EU retail, so they pass).
    - hedge_bonds -> among bond funds sharing index_name, if any is hedged_to == base, drop the others.
    - drop funds without any listing.
    Listing choice: currency == base first, then is_primary, then ticker alphabetical.
    Raises NoEligibleFunds if nothing remains.
    """
    raise NotImplementedError("Lane B")
```

`backend/app/engine/returns.py`:

```python
"""Lane B. Spec §5.2."""

import pandas as pd

from app.engine.types import ReturnsResult


def convert_prices(prices: pd.DataFrame, currencies: dict[str, str], fx: pd.DataFrame, base: str) -> pd.DataFrame:
    """Daily prices (columns = tickers, local currency) -> base currency.

    price_base = price_local * usd_rate[local] / usd_rate[base]; fx is forward-filled onto the price dates.
    currencies: ticker -> currency code. Columns keep their ticker names.
    """
    raise NotImplementedError("Lane B")


def weekly_returns(prices: pd.DataFrame, selection: pd.DataFrame, fx: pd.DataFrame, base: str) -> ReturnsResult:
    """Weekly (W-FRI, last price of week) simple returns in base currency, columns = isin.

    selection: output of universe.select (uses ticker, currency, hedged_to, proxy_ticker, proxy_currency).
    prices: daily local prices containing every selection ticker and proxy ticker.
    Before a fund's first own price, returns come from its proxy_ticker:
      - converted to base, except when the fund is hedged_to == base: then the proxy's local-currency
        returns are used unconverted (approximates a currency-hedged history).
    proxied[isin] = (first proxied week, week of the first own price), both inclusive.
    Weeks without data (and no proxy) stay NaN. The first week (no prior price) is dropped.
    """
    raise NotImplementedError("Lane B")
```

`backend/app/engine/risk.py`:

```python
"""Lane B. Spec §5.3."""

import pandas as pd


def covariance(returns: pd.DataFrame, window_years: int, end: pd.Timestamp | None = None) -> tuple[pd.DataFrame, list[str]]:
    """Ledoit-Wolf shrunk, annualised (x52) covariance of weekly returns.

    Window: the last window_years*52 weeks up to and including `end` (default: last row). Never reads rows after `end`.
    Funds with fewer than config.MIN_COVERAGE non-NaN weeks in the window are dropped; their isins are the
    second return value. Remaining rows containing any NaN are dropped before estimation.
    Raises InsufficientHistory if no fund or fewer than 52 complete weeks remain.
    Returns (cov indexed/columned by isin, dropped isins).
    """
    raise NotImplementedError("Lane B")
```

`backend/app/engine/expected.py`:

```python
"""Lane C. Spec §5.4."""

import pandas as pd

from app.engine.types import CapmResult


def market_returns(returns: pd.DataFrame, anchors: dict[str, str], weights: dict[str, float]) -> pd.Series:
    """Weekly market-portfolio return = sum(weights[key] * returns[anchors[key]]).

    anchors: key -> isin (config.ANCHORS[base]); weights: key -> weight (config.MARKETS[model]['weights']).
    Weeks where any used anchor is NaN are NaN.
    """
    raise NotImplementedError("Lane C")


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
    """
    raise NotImplementedError("Lane C")
```

`backend/app/engine/optimize.py`:

```python
"""Lane C. Spec §5.5."""

import pandas as pd

from app.engine.types import Constraints, InvestorProfile, OptimizeResult, Strategy


def target_vol_from_risk(risk_level: float, vol_range: tuple[float, float]) -> float:
    """vmin + risk_level / 100 * (vmax - vmin)."""
    raise NotImplementedError("Lane C")


def build_constraints(selection: pd.DataFrame, profile: InvestorProfile, target_vol: float) -> Constraints:
    """Constraints from the selected universe and preferences.

    groups: 'asset_class:<x>' for every asset class present and 'sector:<s>' for every sector present.
    group_min: {'sector:<s>': w} from preferences.sector_tilts. Raises InfeasibleConstraints if a tilted sector
      has no eligible fund, if the tilts sum to more than 1, or if there are more tilts than max_etfs.
    group_max: {'asset_class:crypto': preferences.crypto_max} when crypto funds are present.
    ter: selection.ter with NaN -> 0. Position bounds from preferences.
    """
    raise NotImplementedError("Lane C")


def optimize(mu: pd.Series, cov: pd.DataFrame, constraints: Constraints, strategy: Strategy) -> OptimizeResult:
    """Long-only weights summing to 1 (spec §5.5).

    mu: annual expected EXCESS returns (CapmResult.expected - CapmResult.rf), no NaN. The pipeline always passes
      excess returns; target_vol is unaffected by the constant shift and max_sharpe needs it.
    mu and cov share the same isins (cov order is authoritative).
    Raises InfeasibleConstraints if max_position * min(max_etfs, n_funds) < 1.
    hrp is implemented with scipy clustering (pypfopt HRPOpt is incompatible with the installed scipy).
    target_vol: maximise mu.w - config.TER_PENALTY * ter.w s.t. sqrt(w'Σw) <= target_vol, position and group bounds.
      Target below the minimum-variance portfolio -> return min-variance with a warning naming the achieved vol;
      target above the maximum-return portfolio's vol -> return max-return with a warning.
    min_variance / max_sharpe / risk_parity / hrp: same bounds where the method allows; otherwise warn.
    Cardinality: drop weights < min_position, keep the top max_etfs, re-optimise on the rest
      (at most config.MAX_CARDINALITY_ROUNDS rounds). Returned weights contain only non-zero entries.
    """
    raise NotImplementedError("Lane C")
```

`backend/app/engine/metrics.py`:

```python
"""Lane D. Spec §5.6. Inputs are weekly simple returns; annualisation uses periods=52.

Sign conventions: max_drawdown and cvar are negative numbers (losses).
"""

from typing import Callable

import pandas as pd


def cagr(r: pd.Series, periods: int = 52) -> float: raise NotImplementedError("Lane D")
def volatility(r: pd.Series, periods: int = 52) -> float: raise NotImplementedError("Lane D")
def sharpe(r: pd.Series, rf: pd.Series | float = 0.0, periods: int = 52) -> float:
    """Annualised mean excess return / annualised vol. rf: weekly rate series aligned to r, or a constant weekly rate."""
    raise NotImplementedError("Lane D")
def sortino(r: pd.Series, rf: pd.Series | float = 0.0, periods: int = 52) -> float: raise NotImplementedError("Lane D")
def max_drawdown(r: pd.Series) -> float:
    """Most negative peak-to-trough decline of the cumulative value (starting value 1 counts as a peak)."""
    raise NotImplementedError("Lane D")
def max_drawdown_duration(r: pd.Series) -> int:
    """Longest number of weeks spent below a previous peak (unrecovered drawdowns count to the end)."""
    raise NotImplementedError("Lane D")
def cvar(r: pd.Series, level: float = 0.95) -> float:
    """Mean of the worst (1 - level) share of weekly returns (negative number)."""
    raise NotImplementedError("Lane D")
def calmar(r: pd.Series, periods: int = 52) -> float: raise NotImplementedError("Lane D")
def beta(r: pd.Series, benchmark: pd.Series) -> float: raise NotImplementedError("Lane D")
def drawdown_series(r: pd.Series) -> pd.Series: raise NotImplementedError("Lane D")
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


# Metrics reported in backtests. Each takes (weekly returns, weekly rf series) -> float (NaN on degenerate input,
# never raises). Keys are frozen: cagr, volatility, sharpe, sortino, max_drawdown, max_drawdown_duration, cvar_95, calmar.
REGISTRY: dict[str, Callable[[pd.Series, pd.Series], float]] = {}
```

`backend/app/engine/downside.py`:

```python
"""Lane D. Spec §5.7."""

import pandas as pd

from app import config
from app.engine.types import NormalComparison, SimulationResult, StressResult


def portfolio_history(
    returns: pd.DataFrame, weights: pd.Series, proxied: dict[str, tuple[pd.Timestamp, pd.Timestamp]]
) -> tuple[pd.Series, pd.Series]:
    """Weekly fixed-weight portfolio returns (weights reset every week) over weeks where every held fund has data.
    Second value: bool Series on the same index, True where any held fund's return came from its proxy."""
    raise NotImplementedError("Lane D")


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
    Deterministic for a given seed. Raises InsufficientHistory if port_returns has fewer than 52 weeks.
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
    raise NotImplementedError("Lane D")
```

`backend/app/engine/backtest.py`:

```python
"""Lane E. Spec §5.8."""

from typing import Callable

import pandas as pd

from app.engine.types import BacktestResult, BacktestSettings, RebalanceSettings

WeightsFn = Callable[[pd.Timestamp], pd.Series]


def rebalance_dates(index: pd.DatetimeIndex, rebalance: RebalanceSettings) -> list[pd.Timestamp]:
    """periodic: the last week of each month / quarter / year in index, excluding the final week.
    none / threshold: [] (threshold triggers are evaluated inside run)."""
    raise NotImplementedError("Lane E")


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
    metrics: {'portfolio': REGISTRY + beta + turnover, 'benchmark': REGISTRY}; 
      turnover = sum over rebalances of 0.5 * sum|w_new - w_drift| (initial buy excluded) / (weeks / 52).
    Timing: series.dates[0] = t0 with value 1.0 (before the buy cost); t0's return is not earned; a trade's cost shows
      in the next week's value; no trades in the final week; rebalance_dates excludes t0.
    weights: the initial target weights. proxied_periods: proxied ranges of held funds clipped to the window.
    static mode adds the warning
      'static mode: weights were chosen using data from the whole period (look-ahead bias)'.
    trace is left empty (the pipeline fills it).
    """
    raise NotImplementedError("Lane E")
```

`backend/app/engine/pipeline.py`:

```python
"""Phase 2. Spec §5.9. The only engine module that receives a DataSource."""

from app.engine.types import BacktestResult, BacktestSettings, DataSource, EngineSettings, InvestorProfile, Recommendation


def recommend(profile: InvestorProfile, settings: EngineSettings, data: DataSource) -> Recommendation:
    raise NotImplementedError("Phase 2")


def backtest(
    profile: InvestorProfile,
    weights: dict[str, float] | None,
    settings: EngineSettings,
    bt: BacktestSettings,
    data: DataSource,
) -> BacktestResult:
    raise NotImplementedError("Phase 2")
```

- [ ] **Step 4: Write the intake stubs**

`backend/app/intake/__init__.py`: empty.

`backend/app/intake/questionnaire.json`:

```json
{"version": "0", "questions": []}
```

`backend/app/intake/scoring.py`:

```python
"""Lane F. Spec §6."""

from pathlib import Path

from app.engine.types import IntakeScore, Questionnaire

QUESTIONNAIRE_PATH = Path(__file__).with_name("questionnaire.json")


def load_questionnaire() -> Questionnaire:
    return Questionnaire.model_validate_json(QUESTIONNAIRE_PATH.read_text())


def score(answers: dict[str, str | float], questionnaire: Questionnaire) -> IntakeScore:
    """Every question is required.
    capacity = mean points of the capacity questions plus the horizon question (horizon years mapped to points by
    fixed bands defined in this module); tolerance = mean points of the tolerance questions (0-100 each).
    suggested_risk_level = min(capacity, tolerance); mismatch = |capacity - tolerance| > config.MISMATCH_GAP (strict);
    limiting_factor = the lower one ('none' if equal); horizon_years = int(horizon answer).
    Raises InvalidSettings for unknown question ids, unknown option values, missing questions, wrong answer types
    or numbers outside [min, max]. load_questionnaire stays a plain (uncached) function."""
    raise NotImplementedError("Lane F")
```

- [ ] **Step 5: Replace the four empty routers with full signatures**

`backend/app/api/intake.py`:

```python
from fastapi import APIRouter

from app.api.schemas import IntakeAnswers, IntakeScore, Questionnaire
from app.intake import scoring

router = APIRouter(prefix="/intake", tags=["intake"])


@router.get("/questionnaire", response_model=Questionnaire)
def questionnaire() -> Questionnaire:
    raise NotImplementedError("Lane F")


@router.post("/score", response_model=IntakeScore)
def score(body: IntakeAnswers) -> IntakeScore:
    raise NotImplementedError("Lane F")
```

`backend/app/api/universe.py`:

```python
from fastapi import APIRouter, Depends, Query

from app.api.deps import get_data
from app.api.schemas import FundDetail, FundSummary
from app.engine.types import Currency, DataSource

router = APIRouter(prefix="/universe", tags=["universe"])


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
    raise NotImplementedError("Phase 2")


@router.get("/{isin}", response_model=FundDetail)
def fund_detail(isin: str, base_currency: Currency = "EUR", data: DataSource = Depends(get_data)) -> FundDetail:
    raise NotImplementedError("Phase 2")
```

`backend/app/api/portfolio.py`:

```python
from fastapi import APIRouter, Depends

from app.api.deps import get_data
from app.api.schemas import PortfolioRequest, Recommendation
from app.engine.types import DataSource

router = APIRouter(tags=["engine"])


@router.post("/portfolio", response_model=Recommendation)
def portfolio(body: PortfolioRequest, data: DataSource = Depends(get_data)) -> Recommendation:
    raise NotImplementedError("Phase 2")
```

`backend/app/api/backtest.py`:

```python
from fastapi import APIRouter, Depends

from app.api.deps import get_data
from app.api.schemas import BacktestRequest, BacktestResult
from app.engine.types import DataSource

router = APIRouter(tags=["engine"])


@router.post("/backtest", response_model=BacktestResult)
def backtest(body: BacktestRequest, data: DataSource = Depends(get_data)) -> BacktestResult:
    raise NotImplementedError("Phase 2")
```

- [ ] **Step 6: Run all backend tests**

Run: `uv run pytest -v`
Expected: PASS for `test_contract.py`, `test_types.py`, `test_schema.py`, `test_health.py` (including `test_unimplemented_route_returns_501`).

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): engine, intake and route stubs with frozen signatures"
```

---

### Task 5: Synthetic market fixture

**Files:**
- Create: `backend/tests/fixtures/__init__.py`, `backend/tests/fixtures/synthetic.py`, `backend/tests/conftest.py`
- Test: `backend/tests/test_synthetic.py`

**Interfaces:**
- Produces: `tests.fixtures.synthetic.SyntheticData(seed: int = 0)` implementing `DataSource`, plus
  `.weekly_returns(base: str) -> pd.DataFrame` (reference weekly base-ccy returns per isin, independent of the engine) and
  `.weekly_rf(base: str) -> pd.Series` (annual rate, W-FRI). Module constants `DATES`, `ANCHOR_ISINS` (all four anchor isins).
  pytest fixtures `synthetic` (session-scoped `SyntheticData()`), `weekly_eur`, `weekly_usd`.
- Fund roster (lanes may rely on these ISINs in tests):
  anchors `US4642882579` (USD equity), `US92203J4076` (USD bonds), `IE00B6R52259` (EUR equity, listings IUSQ.DE EUR primary + SSAC.L USD),
  `IE00BDBRDM35` (EUR-hedged bonds); `SYNUSEQ00001` US equity; `SYNEUEQ00001` Europe equity (dist);
  `SYNEMEQ00001` EM; `SYNJPEQ00001` Japan; `SYNESGEQ0001` ESG (young, proxied); `SYNHLTH00001` healthcare sector;
  `SYNTECH00001` technology sector; `SYNGOVS00001`/`SYNGOVL00001` EUR gov short/long; `SYNUSTL00001` US treasuries (US-domiciled);
  `SYNUSTLEH001` (EUR-hedged) and `SYNUSTLUH001` (unhedged) UCITS share classes of the same index; `SYNCORP00001` EUR IG;
  `SYNHY0000001` US HY; `SYNGOLD00001` gold ETC; `SYNCASH00001` EUR money market; `SYNREIT00001` REIT;
  `SYNBTC000001` bitcoin ETP; `SYNIBIT00001` US bitcoin ETF; `SYNYOUNG0001` young fund without proxy.
- Injected crashes: equity factor −0.3%/day 2008-09-15..2009-03-09, −1.2%/day 2020-02-20..2020-03-23;
  equity and bond factors −0.08%/day 2022-01-03..2022-10-14.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_synthetic.py`:

```python
import numpy as np
import pandas as pd

from app.engine.types import FUND_COLUMNS, LISTING_COLUMNS
from tests.fixtures.synthetic import ANCHOR_ISINS


def test_shapes(synthetic):
    funds, listings = synthetic.funds(), synthetic.listings()
    assert list(funds.columns) == FUND_COLUMNS and funds.index.is_unique
    assert list(listings.columns) == LISTING_COLUMNS
    assert set(listings["isin"]) <= set(funds.index)
    assert set(ANCHOR_ISINS) <= set(funds.index)


def test_prices_and_fx(synthetic):
    px = synthetic.prices(["IUSQ.DE", "NOPE", "SYN-EQ"])
    assert list(px.columns) == ["IUSQ.DE", "NOPE", "SYN-EQ"]
    assert px["NOPE"].isna().all()
    assert px["IUSQ.DE"].first_valid_index() == pd.Timestamp("2011-10-21")
    assert px["SYN-EQ"].first_valid_index() == pd.Timestamp("2005-01-03")
    assert (synthetic.fx()["USD"] == 1.0).all()
    assert synthetic.rf("EUR").index.equals(synthetic.fx().index)


def test_gfc_crash_is_visible(synthetic):
    eq = synthetic.prices(["SYN-EQ"])["SYN-EQ"]
    assert eq["2009-03-09"] / eq["2008-09-12"] - 1 < -0.2


def test_weekly_reference(weekly_eur):
    assert weekly_eur.index.freqstr == "W-FRI"
    assert weekly_eur["SYNBTC000001"][:"2014-09-01"].isna().all()
    assert weekly_eur["SYNYOUNG0001"][:"2023-05-01"].isna().all()
    assert np.isfinite(weekly_eur["IE00B6R52259"]).all()


def test_deterministic():
    from tests.fixtures.synthetic import SyntheticData

    a, b = SyntheticData(), SyntheticData()
    pd.testing.assert_frame_equal(a.prices(["SUSE"]), b.prices(["SUSE"]))
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_synthetic.py -v`
Expected: FAIL with `fixture 'synthetic' not found` / `ModuleNotFoundError: tests.fixtures`.

- [ ] **Step 3: Write `tests/fixtures/synthetic.py`**

`backend/tests/fixtures/__init__.py`: empty.

```python
"""Deterministic synthetic market for tests. No network; identical output for a given seed.

Business days 2005-01-03..2025-12-31. Each fund's daily return, in its economic currency, is
alpha + b_eq*EQ + b_bd*BD + b_x*X + idio. EUR-native and EUR-hedged funds have economic currency EUR
(no FX effect for EUR investors); all others USD. Listing prices = economic value converted to the
listing currency. Prices before inception are NaN; proxy series (SYN-*) cover the full history.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.config import ANCHORS
from app.engine.types import FUND_COLUMNS, LISTING_COLUMNS

DATES = pd.bdate_range("2005-01-03", "2025-12-31")
BTC_START = pd.Timestamp("2014-09-17")
ANCHOR_ISINS = sorted({isin for a in ANCHORS.values() for isin in a.values()})

# isin, name, issuer, asset_class, sub_class, region, sector, esg, ter, domicile, ucits, wrapper, distribution,
# hedged_to, duration, index_name, inception_date, proxy_ticker, proxy_currency
_FUNDS = [
    ("US4642882579", "Syn ACWI (US)", "Syn Issuer", "equity", "broad", "global", None, False, 0.0032, "US", False, "etf", "dist", None, None, "MSCI ACWI", "2008-03-26", "SYN-EQ", "USD"),
    ("US92203J4076", "Syn Total World Bond (US)", "Syn Issuer", "bond", "broad", "global", None, False, 0.0005, "US", False, "etf", "dist", "USD", 6.5, "Global Aggregate USD Hedged", "2018-09-04", "SYN-BD", "USD"),
    ("IE00B6R52259", "Syn ACWI UCITS", "Syn Issuer", "equity", "broad", "global", None, False, 0.0020, "IE", True, "etf", "acc", None, None, "MSCI ACWI", "2011-10-21", "SYN-EQ", "USD"),
    ("IE00BDBRDM35", "Syn Global Agg EUR Hedged", "Syn Issuer", "bond", "broad", "global", None, False, 0.0010, "IE", True, "etf", "acc", "EUR", 6.5, "Global Aggregate EUR Hedged", "2017-11-21", "SYN-BD", "USD"),
    ("SYNUSEQ00001", "Syn US Large Cap", "Syn Issuer", "equity", "large_cap", "us", None, False, 0.0003, "US", False, "etf", "dist", None, None, "S&P 500", "2005-01-03", None, None),
    ("SYNEUEQ00001", "Syn Europe Equity", "Syn Issuer", "equity", "large_cap", "europe", None, False, 0.0012, "IE", True, "etf", "dist", None, None, "MSCI Europe", "2005-01-03", None, None),
    ("SYNEMEQ00001", "Syn EM Equity", "Syn Issuer", "equity", "broad", "em", None, False, 0.0018, "IE", True, "etf", "acc", None, None, "MSCI EM", "2006-01-02", None, None),
    ("SYNJPEQ00001", "Syn Japan Equity", "Syn Issuer", "equity", "large_cap", "japan", None, False, 0.0015, "IE", True, "etf", "acc", None, None, "MSCI Japan", "2005-01-03", None, None),
    ("SYNESGEQ0001", "Syn World ESG", "Syn Issuer", "equity", "broad", "global", None, True, 0.0020, "IE", True, "etf", "acc", None, None, "MSCI World ESG Leaders", "2015-06-01", "SYN-EQ", "USD"),
    ("SYNHLTH00001", "Syn World Healthcare", "Syn Issuer", "equity", "sector", "global", "healthcare", False, 0.0025, "IE", True, "etf", "acc", None, None, "MSCI World Health Care", "2005-01-03", None, None),
    ("SYNTECH00001", "Syn US Technology", "Syn Issuer", "equity", "sector", "us", "technology", False, 0.0010, "US", False, "etf", "dist", None, None, "S&P Technology", "2005-01-03", None, None),
    ("SYNGOVS00001", "Syn EUR Gov 1-3y", "Syn Issuer", "bond", "gov_short", "europe", None, False, 0.0015, "IE", True, "etf", "acc", None, 2.0, "EUR Gov 1-3", "2005-01-03", None, None),
    ("SYNGOVL00001", "Syn EUR Gov 15+y", "Syn Issuer", "bond", "gov_long", "europe", None, False, 0.0015, "IE", True, "etf", "acc", None, 16.0, "EUR Gov 15+", "2005-01-03", None, None),
    ("SYNUSTL00001", "Syn US Treasury 20+y (US)", "Syn Issuer", "bond", "gov_long", "us", None, False, 0.0015, "US", False, "etf", "dist", None, 17.0, "US Treasury 20+", "2005-01-03", None, None),
    ("SYNUSTLEH001", "Syn US Treasury 20+y EUR Hedged", "Syn Issuer", "bond", "gov_long", "us", None, False, 0.0010, "IE", True, "etf", "acc", "EUR", 17.0, "US Treasury 20+ UCITS", "2016-03-01", "SYN-UST", "USD"),
    ("SYNUSTLUH001", "Syn US Treasury 20+y UCITS", "Syn Issuer", "bond", "gov_long", "us", None, False, 0.0007, "IE", True, "etf", "acc", None, 17.0, "US Treasury 20+ UCITS", "2009-06-01", "SYN-UST", "USD"),
    ("SYNCORP00001", "Syn EUR Corporate IG", "Syn Issuer", "bond", "corp_ig", "europe", None, False, 0.0020, "IE", True, "etf", "acc", None, 4.5, "EUR Corporate", "2005-01-03", None, None),
    ("SYNHY0000001", "Syn US High Yield", "Syn Issuer", "bond", "high_yield", "us", None, False, 0.0040, "US", False, "etf", "dist", None, 3.5, "US High Yield", "2007-04-04", None, None),
    ("SYNGOLD00001", "Syn Physical Gold", "Syn Issuer", "commodity", "gold", "global", None, False, 0.0012, "IE", False, "etc", "acc", None, None, "Gold", "2005-01-03", None, None),
    ("SYNCASH00001", "Syn EUR Money Market", "Syn Issuer", "cash", "money_market", "europe", None, False, 0.0010, "LU", True, "etf", "acc", None, 0.1, "EUR Overnight", "2005-01-03", None, None),
    ("SYNREIT00001", "Syn US REIT", "Syn Issuer", "real_estate", "reit", "us", None, False, 0.0012, "US", False, "etf", "dist", None, None, "US REIT", "2005-01-03", None, None),
    ("SYNBTC000001", "Syn Bitcoin ETP", "Syn Issuer", "crypto", "bitcoin", "global", None, False, 0.0095, "CH", False, "etp", "acc", None, None, "Bitcoin", "2020-01-02", "SYN-BTC", "USD"),
    ("SYNIBIT00001", "Syn Bitcoin ETF (US)", "Syn Issuer", "crypto", "bitcoin", "global", None, False, 0.0025, "US", False, "etf", "acc", None, None, "Bitcoin", "2024-01-11", "SYN-BTC", "USD"),
    ("SYNYOUNG0001", "Syn Global Small Cap", "Syn Issuer", "equity", "small_cap", "global", None, False, 0.0035, "IE", True, "etf", "acc", None, None, "MSCI World Small Cap", "2023-06-01", None, None),
]

# isin -> (alpha, b_eq, b_bd, extra_factor, b_extra, idio_sigma, economic_currency)
_ECON = {
    "US4642882579": (0.0, 1.0, 0.0, None, 0.0, 0.001, "USD"),
    "US92203J4076": (0.0, 0.0, 1.0, None, 0.0, 0.0005, "USD"),
    "IE00B6R52259": (0.0, 1.0, 0.0, None, 0.0, 0.001, "USD"),
    "IE00BDBRDM35": (0.0, 0.0, 1.0, None, 0.0, 0.0005, "EUR"),
    "SYNUSEQ00001": (0.00005, 1.05, 0.0, None, 0.0, 0.003, "USD"),
    "SYNEUEQ00001": (-0.00005, 0.95, 0.0, None, 0.0, 0.004, "EUR"),
    "SYNEMEQ00001": (0.0, 1.2, 0.0, None, 0.0, 0.007, "USD"),
    "SYNJPEQ00001": (-0.00005, 0.8, 0.0, None, 0.0, 0.006, "USD"),
    "SYNESGEQ0001": (0.0, 1.0, 0.0, None, 0.0, 0.002, "USD"),
    "SYNHLTH00001": (0.00005, 0.75, 0.0, None, 0.0, 0.006, "USD"),
    "SYNTECH00001": (0.0002, 1.3, 0.0, None, 0.0, 0.008, "USD"),
    "SYNGOVS00001": (0.0, 0.0, 0.3, None, 0.0, 0.0005, "EUR"),
    "SYNGOVL00001": (0.0, -0.05, 2.2, None, 0.0, 0.002, "EUR"),
    "SYNUSTL00001": (0.0, -0.1, 2.5, None, 0.0, 0.002, "USD"),
    "SYNUSTLEH001": (0.0, -0.1, 2.5, None, 0.0, 0.002, "EUR"),
    "SYNUSTLUH001": (0.0, -0.1, 2.5, None, 0.0, 0.002, "USD"),
    "SYNCORP00001": (0.00002, 0.1, 1.2, None, 0.0, 0.001, "EUR"),
    "SYNHY0000001": (0.00005, 0.35, 0.5, None, 0.0, 0.002, "USD"),
    "SYNGOLD00001": (0.0, 0.05, 0.0, "GOLD", 1.0, 0.001, "USD"),
    "SYNCASH00001": (0.0, 0.0, 0.0, "CASH_EUR", 1.0, 0.0, "EUR"),
    "SYNREIT00001": (0.0, 1.1, 0.3, None, 0.0, 0.006, "USD"),
    "SYNBTC000001": (0.0, 0.2, 0.0, "BTC", 1.0, 0.002, "USD"),
    "SYNIBIT00001": (0.0, 0.2, 0.0, "BTC", 1.0, 0.002, "USD"),
    "SYNYOUNG0001": (0.0, 1.1, 0.0, None, 0.0, 0.004, "USD"),
}

# ticker, isin, exchange, currency, is_primary
_LISTINGS = [
    ("ACWI", "US4642882579", "NASDAQ", "USD", True),
    ("BNDW", "US92203J4076", "NASDAQ", "USD", True),
    ("IUSQ.DE", "IE00B6R52259", "XETRA", "EUR", True),
    ("SSAC.L", "IE00B6R52259", "LSE", "USD", False),
    ("EUNA.DE", "IE00BDBRDM35", "XETRA", "EUR", True),
    ("SUSE", "SYNUSEQ00001", "NYSE", "USD", True),
    ("SEUE.DE", "SYNEUEQ00001", "XETRA", "EUR", True),
    ("SEME.DE", "SYNEMEQ00001", "XETRA", "EUR", True),
    ("SEME.L", "SYNEMEQ00001", "LSE", "USD", False),
    ("SJPE.DE", "SYNJPEQ00001", "XETRA", "EUR", True),
    ("SESG.AS", "SYNESGEQ0001", "EURONEXT", "EUR", True),
    ("SHLT.DE", "SYNHLTH00001", "XETRA", "EUR", True),
    ("STEC", "SYNTECH00001", "NYSE", "USD", True),
    ("SGVS.DE", "SYNGOVS00001", "XETRA", "EUR", True),
    ("SGVL.DE", "SYNGOVL00001", "XETRA", "EUR", True),
    ("SUST", "SYNUSTL00001", "NASDAQ", "USD", True),
    ("SUSH.DE", "SYNUSTLEH001", "XETRA", "EUR", True),
    ("SUSU.L", "SYNUSTLUH001", "LSE", "USD", True),
    ("SUSU.DE", "SYNUSTLUH001", "XETRA", "EUR", False),
    ("SCRP.DE", "SYNCORP00001", "XETRA", "EUR", True),
    ("SHYG", "SYNHY0000001", "NYSE", "USD", True),
    ("SGLD.DE", "SYNGOLD00001", "XETRA", "EUR", True),
    ("SCSH.DE", "SYNCASH00001", "XETRA", "EUR", True),
    ("SRET", "SYNREIT00001", "NYSE", "USD", True),
    ("SBTC.SW", "SYNBTC000001", "SIX", "EUR", True),
    ("SBIT", "SYNIBIT00001", "NASDAQ", "USD", True),
    ("SYNG.DE", "SYNYOUNG0001", "XETRA", "EUR", True),
]

# factor, start, end, extra daily return
_SHOCKS = [
    ("EQ", "2008-09-15", "2009-03-09", -0.003),
    ("EQ", "2020-02-20", "2020-03-23", -0.012),
    ("EQ", "2022-01-03", "2022-10-14", -0.0008),
    ("BD", "2022-01-03", "2022-10-14", -0.0008),
]


def _rf_annual(currency: str) -> pd.Series:
    d = DATES
    if currency == "USD":
        v = np.select([d < "2008-12-16", d < "2016-12-15", d < "2020-03-16", d < "2022-03-17"], [0.03, 0.002, 0.015, 0.001], 0.045)
    else:
        v = np.select([d < "2008-12-10", d < "2015-03-09", d < "2022-07-27"], [0.03, 0.005, -0.004], 0.03)
    return pd.Series(v, index=d, name=currency, dtype=float)


class SyntheticData:
    def __init__(self, seed: int = 0) -> None:
        rng = np.random.default_rng(seed)
        n = len(DATES)
        f = pd.DataFrame(
            {
                "EQ": rng.normal(0.0003, 0.011, n),
                "BD": rng.normal(0.00012, 0.003, n),
                "GOLD": rng.normal(0.00025, 0.010, n),
                "BTC": rng.normal(0.0015, 0.04, n),
            },
            index=DATES,
        )
        for col, start, end, add in _SHOCKS:
            f.loc[start:end, col] += add
        f.loc[f.index < BTC_START, "BTC"] = np.nan
        self._rf = {c: _rf_annual(c) for c in ("USD", "EUR")}
        f["CASH_EUR"] = self._rf["EUR"] / 252
        self._fx = pd.DataFrame({"USD": 1.0, "EUR": 1.25 * np.exp(np.cumsum(rng.normal(0, 0.004, n)))}, index=DATES)

        self._econ: dict[str, tuple[pd.Series, str]] = {}
        for isin, (alpha, b_eq, b_bd, x, b_x, idio, ccy) in _ECON.items():
            r = alpha + b_eq * f["EQ"] + b_bd * f["BD"] + rng.normal(0, idio, n)
            if x:
                r = r + b_x * f[x]
            self._econ[isin] = (r, ccy)

        self._funds = pd.DataFrame(_FUNDS, columns=["isin", *FUND_COLUMNS]).set_index("isin")
        self._funds["inception_date"] = pd.to_datetime(self._funds["inception_date"])
        self._funds["duration"] = self._funds["duration"].astype(float)
        self._listings = pd.DataFrame(_LISTINGS, columns=LISTING_COLUMNS)

        prices: dict[str, pd.Series] = {}
        for ticker, isin, _, ccy, _ in _LISTINGS:
            r, eccy = self._econ[isin]
            px = 100 * (1 + r.fillna(0)).cumprod() * self._conv(eccy, ccy)
            px[px.index < self._funds.at[isin, "inception_date"]] = np.nan
            prices[ticker] = px
        proxies = {"SYN-EQ": f["EQ"], "SYN-BD": f["BD"], "SYN-UST": -0.1 * f["EQ"] + 2.5 * f["BD"], "SYN-BTC": f["BTC"]}
        for ticker, r in proxies.items():
            px = 100 * (1 + r.fillna(0)).cumprod()
            px[r.isna()] = np.nan
            prices[ticker] = px
        self._prices = pd.DataFrame(prices)

    def _conv(self, from_ccy: str, to_ccy: str) -> pd.Series:
        return self._fx[from_ccy] / self._fx[to_ccy]

    # ---- DataSource ----
    def funds(self) -> pd.DataFrame:
        return self._funds.copy()

    def listings(self) -> pd.DataFrame:
        return self._listings.copy()

    def prices(self, tickers: list[str]) -> pd.DataFrame:
        return self._prices.reindex(columns=list(tickers))

    def fx(self) -> pd.DataFrame:
        return self._fx.copy()

    def rf(self, currency: str) -> pd.Series:
        return self._rf[currency].copy()

    def last_ingest(self) -> str | None:
        return "2025-12-31"

    # ---- reference helpers for tests (independent of the engine) ----
    def weekly_returns(self, base: str) -> pd.DataFrame:
        """Weekly base-currency returns per isin from the economic series over the full history, as if every
        fund had a perfect proxy. Exceptions: BTC funds start 2014-09, SYNYOUNG0001 starts at inception."""
        cols = {}
        for isin, (r, eccy) in self._econ.items():
            value = (1 + r).cumprod(skipna=True) * self._conv(eccy, base)
            value[r.isna()] = np.nan
            if isin == "SYNYOUNG0001":
                value[value.index < self._funds.at[isin, "inception_date"]] = np.nan
            cols[isin] = value
        return pd.DataFrame(cols).resample("W-FRI").last().pct_change(fill_method=None).iloc[1:]

    def weekly_rf(self, base: str) -> pd.Series:
        """Annualised risk-free rate sampled W-FRI (last)."""
        return self._rf[base].resample("W-FRI").last()
```

- [ ] **Step 4: Write `tests/conftest.py`**

```python
import pytest

from tests.fixtures.synthetic import SyntheticData


@pytest.fixture(scope="session")
def synthetic() -> SyntheticData:
    return SyntheticData()


@pytest.fixture(scope="session")
def weekly_eur(synthetic):
    return synthetic.weekly_returns("EUR")


@pytest.fixture(scope="session")
def weekly_usd(synthetic):
    return synthetic.weekly_returns("USD")
```

- [ ] **Step 5: Run the tests**

Run: `uv run pytest tests/test_synthetic.py -v`
Expected: PASS (5 tests). If `test_weekly_reference` fails on the first week, check that `.iloc[1:]` drops the NaN first row.

- [ ] **Step 6: Commit**

```bash
git add backend/tests
git commit -m "test: deterministic synthetic market fixture"
```

---

### Task 6: Contract export — openapi.json and frontend mocks

**Files:**
- Create: `backend/scripts/__init__.py`, `backend/scripts/export_contract.py`
- Generates: `backend/openapi.json`, `frontend/src/mocks/{health,defaults,questionnaire,score,universe,fund,portfolio,backtest}.json`
- Test: `backend/tests/test_export_contract.py`

**Interfaces:**
- Consumes: all models from Task 2, `SyntheticData` from Task 5.
- Produces: `uv run python -m scripts.export_contract` (re-run whenever `schemas.py`/`types.py` change); mock JSON files that validate against the models.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_export_contract.py`:

```python
import json

from app.engine.types import BacktestResult, FundDetail, IntakeScore, Questionnaire, Recommendation
from scripts.export_contract import build_mocks


def test_mocks_validate_against_contract():
    mocks = build_mocks()
    Recommendation.model_validate(mocks["portfolio"])
    BacktestResult.model_validate(mocks["backtest"])
    Questionnaire.model_validate(mocks["questionnaire"])
    IntakeScore.model_validate(mocks["score"])
    FundDetail.model_validate(mocks["fund"])
    assert len(mocks["universe"]) >= 20
    json.dumps(mocks)  # serialisable
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_export_contract.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts'`.

- [ ] **Step 3: Write `scripts/export_contract.py`**

`backend/scripts/__init__.py`: empty.

```python
"""Write backend/openapi.json and frontend/src/mocks/*.json.

Run from backend/: `uv run python -m scripts.export_contract`. Mock numbers are plausible, not engine output.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

from app import config
from app.api.health import defaults
from app.api.schemas import Health, fund_summary
from app.engine.types import (
    BacktestResult, BacktestSeries, Downside, FanPoint, FundDetail, Holding, IntakeScore, ListingOut,
    NormalComparison, PortfolioSummary, PricePoint, ProbabilityPoint, ProxiedPeriod, Question, QuestionOption,
    Questionnaire, Recommendation, StepResult, StressResult,
)
from app.main import app
from tests.fixtures.synthetic import SyntheticData

BACKEND = Path(__file__).resolve().parents[1]
MOCKS = BACKEND.parent / "frontend" / "src" / "mocks"

WEIGHTS = {
    "IE00B6R52259": 0.30, "SYNEUEQ00001": 0.10, "SYNEMEQ00001": 0.08, "IE00BDBRDM35": 0.30,
    "SYNGOVS00001": 0.12, "SYNGOLD00001": 0.05, "SYNCASH00001": 0.05,
}


def _r(x: float) -> float:
    return round(float(x), 6)


def build_mocks() -> dict:
    data = SyntheticData()
    funds, listings = data.funds(), data.listings()
    weekly = data.weekly_returns("EUR")
    tickers = listings.groupby("isin")["ticker"].apply(list)

    w = pd.Series(WEIGHTS)
    port = (weekly[w.index] * w).sum(axis=1, min_count=len(w)).dropna()
    vol = port.std() * np.sqrt(52)
    er = 0.052

    holdings = []
    for isin, weight in WEIGHTS.items():
        f = funds.loc[isin]
        lst = listings[(listings["isin"] == isin) & listings["is_primary"]].iloc[0]
        beta = {"equity": 1.0, "bond": 0.15, "commodity": 0.1, "cash": 0.0}[f.asset_class]
        holdings.append(Holding(
            isin=isin, ticker=lst.ticker, exchange=lst.exchange, name=f["name"], weight=weight,
            asset_class=f.asset_class, sub_class=f.sub_class, region=f.region, ter=f.ter, beta=beta,
            expected_return=_r(0.02 + beta * 0.035), risk_contribution=0.0, proxied=f.proxy_ticker is not None,
        ))
    rc = np.array([h.weight * (h.beta + 0.05) for h in holdings])
    for h, c in zip(holdings, rc / rc.sum()):
        h.risk_contribution = _r(c)

    mix: dict[str, float] = {}
    for h in holdings:
        mix[h.asset_class] = round(mix.get(h.asset_class, 0) + h.weight, 4)
    wter = sum(h.weight * (h.ter or 0) for h in holdings)
    thresholds = list(config.DRAWDOWN_THRESHOLDS)
    fan = [
        FanPoint(year=y, **{f"p{p}": _r(np.exp((er - vol**2 / 2) * y + z * vol * np.sqrt(y)))
                            for p, z in zip(config.FAN_PERCENTILES, (-1.645, -0.674, 0, 0.674, 1.645))})
        for y in range(0, 11)
    ]
    stress = [StressResult(event=n, start=s, end=e, loss=loss, proxied=s < "2011-10-21")
              for (n, s, e), loss in zip(config.STRESS_EVENTS, (-0.21, -0.09, -0.14))]
    rec = Recommendation(
        holdings=holdings,
        summary=PortfolioSummary(
            expected_return=er, volatility=_r(vol), target_volatility=0.083, sharpe=_r((er - 0.03) / vol),
            beta=0.52, weighted_ter=_r(wter), annual_cost_per_10k=_r(wter * 10_000), mix=mix,
        ),
        downside=Downside(
            drawdown_probs=[ProbabilityPoint(threshold=t, probability=p) for t, p in zip(thresholds, (0.18, 0.06, 0.015))],
            annual_loss_probs=[ProbabilityPoint(threshold=t, probability=p) for t, p in zip(thresholds, (0.04, 0.01, 0.002))],
            p_below_invested=0.07, fan=fan, stress=stress,
            normal_comparison=NormalComparison(
                drawdown_probs=[ProbabilityPoint(threshold=t, probability=p) for t, p in zip(thresholds, (0.09, 0.02, 0.003))],
                annual_loss_probs=[ProbabilityPoint(threshold=t, probability=p) for t, p in zip(thresholds, (0.005, 0.0005, 0.0))],
            ),
        ),
        warnings=["Mock data: numbers are illustrative, not engine output."],
        trace=[
            StepResult(step="universe", summary={"eligible": 18, "excluded": {"non_ucits": 6}}, notes=["UCITS-only because base currency is EUR."]),
            StepResult(step="returns", summary={"weeks": 1090, "base_currency": "EUR"}, notes=["IE00B6R52259 proxied before 2011-10-21."]),
            StepResult(step="covariance", summary={"window_years": 5, "shrinkage": 0.21}, notes=[]),
            StepResult(step="expected_returns", summary={"model": "capm_multi_asset", "rf": 0.02, "premium": 0.035}, notes=[]),
            StepResult(step="constraints", summary={"target_vol": 0.083, "max_etfs": 10}, notes=[]),
            StepResult(step="optimize", summary={"strategy": "target_vol", "achieved_vol": _r(vol)}, notes=[]),
            StepResult(step="metrics", summary={"sharpe": _r((er - 0.03) / vol)}, notes=[]),
            StepResult(step="downside", summary={"paths": 10000, "horizon_years": 10}, notes=[]),
        ],
    )

    window = port.loc[port.index[-1] - pd.DateOffset(years=15):]
    bench = (0.6 * weekly["IE00B6R52259"] + 0.4 * weekly["IE00BDBRDM35"]).loc[window.index]
    value, bvalue = (1 + window).cumprod(), (1 + bench).cumprod()
    dd = value / value.cummax() - 1
    rvol = window.rolling(156).std() * np.sqrt(52)
    rsh = (window.rolling(156).mean() * 52 - 0.02) / rvol
    none_or = lambda s: [None if pd.isna(x) else _r(x) for x in s]  # noqa: E731
    bt = BacktestResult(
        series=BacktestSeries(
            dates=[d.date() for d in window.index], portfolio=[_r(x) for x in value], benchmark=[_r(x) for x in bvalue],
            drawdown=[_r(x) for x in dd], rolling_vol=none_or(rvol), rolling_sharpe=none_or(rsh),
        ),
        metrics={
            "portfolio": {"cagr": 0.051, "volatility": _r(vol), "sharpe": 0.41, "sortino": 0.6, "max_drawdown": _r(dd.min()),
                          "max_drawdown_duration": 64, "cvar_95": -0.028, "calmar": 0.3, "beta": 0.93, "turnover": 0.0},
            "benchmark": {"cagr": 0.055, "volatility": 0.095, "sharpe": 0.4, "sortino": 0.58, "max_drawdown": -0.19,
                          "max_drawdown_duration": 70, "cvar_95": -0.031, "calmar": 0.29},
        },
        weights=WEIGHTS,
        proxied_periods=[ProxiedPeriod(isin="IE00BDBRDM35", start=window.index[0].date(), end=pd.Timestamp("2017-11-17").date())],
        rebalance_dates=[],
        warnings=["static mode: weights were chosen using data from the whole period (look-ahead bias)"],
        trace=[],
    )

    questionnaire = Questionnaire(version="mock", questions=[
        Question(id="horizon", text="When will you need this money?", type="number", feeds="horizon", min=1, max=40, unit="years"),
        Question(id="drop_reaction", text="Your portfolio drops 20% in a month. What do you do?", type="single", feeds="tolerance",
                 options=[QuestionOption(label="Sell everything", value="sell", points=0),
                          QuestionOption(label="Wait it out", value="hold", points=60),
                          QuestionOption(label="Buy more", value="buy", points=100)]),
        Question(id="income", text="How stable is your income?", type="single", feeds="capacity",
                 options=[QuestionOption(label="Unstable", value="unstable", points=20),
                          QuestionOption(label="Stable", value="stable", points=70),
                          QuestionOption(label="Very stable", value="very_stable", points=100)]),
    ])
    score = IntakeScore(capacity=72, tolerance=48, suggested_risk_level=48, limiting_factor="tolerance", mismatch=True,
                        explanation="Your finances could carry more risk than you are comfortable with; we follow your comfort level.",
                        horizon_years=10)

    universe = [fund_summary(isin, row, tickers.get(isin, [])) for isin, row in funds.iterrows()]
    isin = "IE00B6R52259"
    eq_px = data.prices(["IUSQ.DE"])["IUSQ.DE"].dropna().resample("W-FRI").last()
    fund = FundDetail(
        fund=fund_summary(isin, funds.loc[isin], tickers[isin]),
        listings=[ListingOut(ticker=r.ticker, exchange=r.exchange, currency=r.currency, is_primary=bool(r.is_primary))
                  for r in listings[listings["isin"] == isin].itertuples()],
        history=[PricePoint(date=d.date(), value=_r(v)) for d, v in eq_px.items()],
    )
    health = Health(status="ok", data_loaded=True, last_ingest="2025-12-31", n_funds=len(funds))

    dump = lambda m: m.model_dump(mode="json")  # noqa: E731
    return {
        "health": dump(health), "defaults": dump(defaults()), "questionnaire": dump(questionnaire), "score": dump(score),
        "universe": [dump(u) for u in universe], "fund": dump(fund), "portfolio": dump(rec), "backtest": dump(bt),
    }


def main() -> None:
    (BACKEND / "openapi.json").write_text(json.dumps(app.openapi(), indent=2))
    MOCKS.mkdir(parents=True, exist_ok=True)
    for name, body in build_mocks().items():
        (MOCKS / f"{name}.json").write_text(json.dumps(body))
    print(f"wrote {BACKEND / 'openapi.json'} and {MOCKS}/*.json")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the test, then the export**

Run: `uv run pytest tests/test_export_contract.py -v`
Expected: PASS

Run: `uv run python -m scripts.export_contract`
Expected: `wrote .../backend/openapi.json and .../frontend/src/mocks/*.json`

- [ ] **Step 5: Commit**

```bash
git add backend/scripts backend/tests/test_export_contract.py backend/openapi.json frontend/src/mocks
git commit -m "feat: export openapi contract and frontend mocks"
```

---

### Task 7: Frontend scaffold — Vite, generated types, mock client, store, routing, layout, tokens

**Files:**
- Create via template: `frontend/` (Vite react-ts)
- Create/replace: `frontend/vite.config.ts`, `frontend/.env.mock`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/api/client.ts`, `frontend/src/mocks/index.ts`, `frontend/src/state/store.tsx`, `frontend/src/state/store.test.ts`, `frontend/src/styles/tokens.css`, `frontend/src/styles/base.css`, `frontend/src/components/ui.tsx`, `frontend/src/components/Layout.tsx`
- Create (stubs for lanes G/H): `frontend/src/pages/{Landing,Start,Portfolio,Backtest,Universe,UniverseFund}.tsx`, `frontend/src/components/SettingsDrawer.tsx`, `frontend/src/intake/.gitkeep`, `frontend/src/components/charts/.gitkeep`
- Generated: `frontend/src/api/schema.d.ts`

**Interfaces:**
- Produces: `api` (openapi-fetch client typed by `paths`); `Schemas` type alias (`components['schemas']`); store `StoreProvider`, `useStore(): [State, Dispatch<Action>]`, `reducer`, `initialState`, types `State`, `Action`; UI primitives `Button`, `LinkButton`, `Card`, `Stat`, `PageHeader`; CSS tokens (see tokens.css); routes `/`, `/start`, `/portfolio`, `/backtest`, `/universe`, `/universe/:isin`.

- [ ] **Step 1: Scaffold and install**

```bash
cd /Users/vlaszaty/projects/roboadvisor
mv frontend /tmp/robo-frontend-mocks   # at this point frontend/ only contains src/mocks from Task 6
npm create vite@latest frontend -- --template react-ts --no-interactive
mkdir -p frontend/src/mocks && cp /tmp/robo-frontend-mocks/src/mocks/*.json frontend/src/mocks/ && rm -rf /tmp/robo-frontend-mocks
cd frontend
npm install
npm install react-router-dom recharts openapi-fetch
npm install -D openapi-typescript vitest
rm -f src/App.css src/index.css src/assets/react.svg public/vite.svg
```

(The mock JSONs from Task 6 are moved aside because `npm create vite` refuses a non-empty directory.)

In `package.json` set `"scripts"` to:

```json
{
  "dev": "vite",
  "dev:mock": "vite --mode mock",
  "build": "tsc -b && vite build",
  "typecheck": "tsc -b --noEmit",
  "test": "vitest run",
  "gen:api": "openapi-typescript ../backend/openapi.json -o src/api/schema.d.ts",
  "preview": "vite preview"
}
```

In `tsconfig.app.json` add `"resolveJsonModule": true` to `compilerOptions`.

- [ ] **Step 2: Write `vite.config.ts` and `.env.mock`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5740,
    strictPort: true,
    proxy: { '/api': 'http://localhost:8740' },
  },
  preview: { port: 5740, strictPort: true },
});
```

`frontend/.env.mock`:

```
VITE_USE_MOCKS=1
```

- [ ] **Step 3: Generate the API types**

Run: `npm run gen:api`
Expected: `src/api/schema.d.ts` created; it contains `"/api/portfolio"` and `Recommendation`.

- [ ] **Step 4: Write `src/mocks/index.ts` and `src/api/client.ts`**

`src/mocks/index.ts`:

```ts
import health from './health.json';
import defaults from './defaults.json';
import questionnaire from './questionnaire.json';
import score from './score.json';
import universe from './universe.json';
import fund from './fund.json';
import portfolio from './portfolio.json';
import backtest from './backtest.json';

const routes: Record<string, unknown> = {
  'GET /api/health': health,
  'GET /api/defaults': defaults,
  'GET /api/intake/questionnaire': questionnaire,
  'POST /api/intake/score': score,
  'GET /api/universe': universe,
  'GET /api/universe/{isin}': fund,
  'POST /api/portfolio': portfolio,
  'POST /api/backtest': backtest,
};

const json = { 'Content-Type': 'application/json' };

/** fetch replacement used when VITE_USE_MOCKS=1: serves the JSON files exported by the backend. */
export async function mockFetch(input: Request): Promise<Response> {
  const url = new URL(input.url);
  const path = url.pathname.startsWith('/api/universe/') ? '/api/universe/{isin}' : url.pathname;
  const body = routes[`${input.method} ${path}`];
  await new Promise((r) => setTimeout(r, 200)); // make loading states visible
  if (body === undefined) {
    return new Response(JSON.stringify({ error: 'NoMock', detail: path }), { status: 404, headers: json });
  }
  return new Response(JSON.stringify(body), { status: 200, headers: json });
}
```

`src/api/client.ts`:

```ts
import createClient from 'openapi-fetch';
import type { components, paths } from './schema';
import { mockFetch } from '../mocks';

export type Schemas = components['schemas'];

const useMocks = import.meta.env.VITE_USE_MOCKS === '1';

export const api = createClient<paths>({
  baseUrl: typeof window === 'undefined' ? 'http://localhost:5740' : window.location.origin,
  ...(useMocks ? { fetch: mockFetch } : {}),
});
```

- [ ] **Step 5: Write the failing store test**

`src/state/store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { initialState, reducer } from './store';

describe('store reducer', () => {
  it('patches the profile and preferences without losing other fields', () => {
    let s = reducer(initialState, { type: 'setProfile', patch: { risk_level: 72 } });
    s = reducer(s, { type: 'setPreferences', patch: { esg_only: true } });
    expect(s.profile.risk_level).toBe(72);
    expect(s.profile.base_currency).toBe('EUR');
    expect(s.profile.preferences?.esg_only).toBe(true);
  });

  it('records answers and the intake score, and resets', () => {
    let s = reducer(initialState, { type: 'setAnswer', id: 'horizon', value: 12 });
    s = reducer(s, {
      type: 'setScore',
      score: { capacity: 70, tolerance: 40, suggested_risk_level: 40, limiting_factor: 'tolerance', mismatch: true, explanation: '', horizon_years: 12 },
    });
    expect(s.answers.horizon).toBe(12);
    expect(s.score?.suggested_risk_level).toBe(40);
    expect(reducer(s, { type: 'reset' })).toEqual(initialState);
  });
});
```

Run: `npm test`
Expected: FAIL (`Cannot find module './store'`).

- [ ] **Step 6: Write `src/state/store.tsx`**

```tsx
import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';
import type { Schemas } from '../api/client';

export type InvestorProfile = Schemas['InvestorProfile'];
export type Preferences = Schemas['Preferences'];
export type EngineSettings = Schemas['EngineSettings'];
export type IntakeScore = Schemas['IntakeScore'];

/** The single source of truth every intake channel fills (spec §8.1). */
export interface State {
  profile: InvestorProfile;
  settings: EngineSettings;
  answers: Record<string, string | number>;
  score: IntakeScore | null;
}

export type Action =
  | { type: 'setProfile'; patch: Partial<InvestorProfile> }
  | { type: 'setPreferences'; patch: Partial<Preferences> }
  | { type: 'setSettings'; patch: Partial<EngineSettings> }
  | { type: 'setAnswer'; id: string; value: string | number }
  | { type: 'setScore'; score: IntakeScore }
  | { type: 'load'; state: State }
  | { type: 'reset' };

export const initialState: State = {
  profile: { risk_level: 50, horizon_years: 10, base_currency: 'EUR', preferences: {} },
  settings: {},
  answers: {},
  score: null,
};

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setProfile':
      return { ...state, profile: { ...state.profile, ...action.patch } };
    case 'setPreferences':
      return { ...state, profile: { ...state.profile, preferences: { ...state.profile.preferences, ...action.patch } } };
    case 'setSettings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'setAnswer':
      return { ...state, answers: { ...state.answers, [action.id]: action.value } };
    case 'setScore':
      return { ...state, score: action.score };
    case 'load':
      return action.state;
    case 'reset':
      return initialState;
  }
}

const STORAGE_KEY = 'roboadvisor.state.v1';

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...initialState, ...JSON.parse(raw) } : initialState;
  } catch {
    return initialState;
  }
}

const StoreContext = createContext<[State, Dispatch<Action>] | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable: state still works in memory */
    }
  }, [state]);
  return <StoreContext.Provider value={[state, dispatch]}>{children}</StoreContext.Provider>;
}

export function useStore(): [State, Dispatch<Action>] {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
```

Run: `npm test`
Expected: PASS (2 tests).

- [ ] **Step 7: Write design tokens and base styles**

Visual direction ("Ballast", placeholder brand): calm and trustworthy, warm paper background, deep ink, a brass accent; serif display type, a clean sans for UI, tabular numbers everywhere figures appear. Lanes G/H use only these tokens.

`src/styles/tokens.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

:root {
  --font-display: 'Fraunces', Georgia, serif;
  --font-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;

  --bg: #f7f4ee;
  --surface: #ffffff;
  --surface-2: #efeae1;
  --ink: #14202e;
  --ink-2: #4a5566;
  --ink-3: #7c8594;
  --line: #ddd6c9;
  --accent: #b0822f;
  --accent-ink: #ffffff;
  --focus: #2f6fb0;
  --pos: #2e7d5b;
  --neg: #b4443a;
  --warn: #a8650f;

  /* categorical chart slots, validated with the dataviz palette validator (light, surface #fff) */
  --series-1: #2a78d6;
  --series-2: #eb6834;
  --series-3: #1baf7a;
  --series-4: #eda100;
  --series-5: #e87ba4;
  --series-6: #4a3aa7;
  --band: rgb(42 120 214 / 0.12);

  --radius: 10px;
  --radius-sm: 6px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 40px; --space-7: 64px;
  --shadow: 0 1px 2px rgb(20 32 46 / 0.06), 0 4px 16px rgb(20 32 46 / 0.06);
  --maxw: 1120px;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg: #0f1620; --surface: #16202c; --surface-2: #1d2936; --ink: #ecebe6; --ink-2: #b5bcc6; --ink-3: #8a93a0;
    --line: #2a3644; --accent: #d4a24c; --accent-ink: #14202e; --pos: #5cb88f; --neg: #e0776c; --warn: #e0a24c;
    --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; --series-4: #c98500; --series-5: #d55181; --series-6: #9085e9;
    --band: rgb(57 135 229 / 0.15);
  }
}
:root[data-theme='dark'] {
  --bg: #0f1620; --surface: #16202c; --surface-2: #1d2936; --ink: #ecebe6; --ink-2: #b5bcc6; --ink-3: #8a93a0;
  --line: #2a3644; --accent: #d4a24c; --accent-ink: #14202e; --pos: #5cb88f; --neg: #e0776c; --warn: #e0a24c;
  --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; --series-4: #c98500; --series-5: #d55181; --series-6: #9085e9;
  --band: rgb(57 135 229 / 0.15);
}
```

`src/styles/base.css`:

```css
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--ink); font: 16px/1.55 var(--font-sans); -webkit-font-smoothing: antialiased; }
h1, h2, h3 { font-family: var(--font-display); font-weight: 600; line-height: 1.15; margin: 0 0 var(--space-3); }
h1 { font-size: clamp(2rem, 4vw + 1rem, 3.5rem); }
h2 { font-size: clamp(1.5rem, 2vw + 1rem, 2.25rem); }
h3 { font-size: 1.25rem; }
a { color: inherit; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.container { max-width: var(--maxw); margin: 0 auto; padding: 0 var(--space-4); }
.muted { color: var(--ink-2); }
.btn { display: inline-flex; align-items: center; gap: var(--space-2); padding: 10px 18px; border-radius: var(--radius-sm);
  border: 1px solid var(--line); background: var(--surface); color: var(--ink); font: 500 15px var(--font-sans); cursor: pointer; text-decoration: none; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--space-5); box-shadow: var(--shadow); }
.stat-label { font-size: 13px; color: var(--ink-2); text-transform: uppercase; letter-spacing: 0.04em; }
.stat-value { font: 500 1.75rem var(--font-mono); font-variant-numeric: tabular-nums; }
.stat-hint { font-size: 13px; color: var(--ink-3); }
.site-header { border-bottom: 1px solid var(--line); background: var(--surface); }
.site-header nav { display: flex; align-items: center; gap: var(--space-5); min-height: 60px; flex-wrap: wrap; }
.site-header .brand { font: 600 1.25rem var(--font-display); text-decoration: none; margin-right: auto; }
.site-header a.active { color: var(--accent); }
.site-footer { border-top: 1px solid var(--line); margin-top: var(--space-7); padding: var(--space-5) 0; font-size: 13px; color: var(--ink-2); }
main { padding: var(--space-6) 0; }
```

- [ ] **Step 8: Write UI primitives and layout**

`src/components/ui.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Button({ variant = 'default', className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' }) {
  return <button type={type} className={`btn ${variant === 'primary' ? 'btn-primary' : ''} ${className}`} {...rest} />;
}

export function LinkButton({ to, children, variant = 'default' }: { to: string; children: ReactNode; variant?: 'default' | 'primary' }) {
  return <Link to={to} className={`btn ${variant === 'primary' ? 'btn-primary' : ''}`}>{children}</Link>;
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <header style={{ marginBottom: 'var(--space-5)' }}>
      <h1>{title}</h1>
      {lead && <p className="muted">{lead}</p>}
    </header>
  );
}

export const pct = (x: number | null | undefined, digits = 1) => (x == null ? '–' : `${(x * 100).toFixed(digits)}%`);
```

`src/components/SettingsDrawer.tsx` (stub, Lane H replaces):

```tsx
/** Advanced engine settings drawer (Lane H). */
export function SettingsDrawer() {
  return null;
}
```

`src/components/Layout.tsx`:

```tsx
import { NavLink, Outlet, Link } from 'react-router-dom';
import { SettingsDrawer } from './SettingsDrawer';

export function Layout() {
  return (
    <>
      <header className="site-header">
        <nav className="container" aria-label="Main">
          <Link to="/" className="brand">Ballast</Link>
          <NavLink to="/start">Start</NavLink>
          <NavLink to="/portfolio">Portfolio</NavLink>
          <NavLink to="/backtest">Backtest</NavLink>
          <NavLink to="/universe">ETFs</NavLink>
          <SettingsDrawer />
        </nav>
      </header>
      <main className="container">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container">
          Educational tool, not personal financial advice. Past performance is no guarantee of future results.
          Simulations and backtests are based on historical data and modelling assumptions.
        </div>
      </footer>
    </>
  );
}
```

- [ ] **Step 9: Write page stubs, App and main**

Each stub page (`Landing`, `Start`, `Portfolio`, `Backtest`, `Universe`, `UniverseFund`) in `src/pages/<Name>.tsx`, e.g. `src/pages/Portfolio.tsx`:

```tsx
/** Lane H fills this page (spec §8.2). */
export default function Portfolio() {
  return <h1>Portfolio</h1>;
}
```

(Same shape for the others, with the page name as heading; `Landing` and `Start` are Lane G.)

`src/App.tsx`:

```tsx
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import Landing from './pages/Landing';
import Start from './pages/Start';
import Portfolio from './pages/Portfolio';
import Backtest from './pages/Backtest';
import Universe from './pages/Universe';
import UniverseFund from './pages/UniverseFund';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="start" element={<Start />} />
        <Route path="portfolio" element={<Portfolio />} />
        <Route path="backtest" element={<Backtest />} />
        <Route path="universe" element={<Universe />} />
        <Route path="universe/:isin" element={<UniverseFund />} />
      </Route>
    </Routes>
  );
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { StoreProvider } from './state/store';
import './styles/tokens.css';
import './styles/base.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <App />
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

In `index.html` set `<title>Ballast</title>`. Create empty `src/intake/.gitkeep` and `src/components/charts/.gitkeep`.

- [ ] **Step 10: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: no type errors, 2 tests pass, build succeeds.

Run: `npm run dev:mock` and open `http://localhost:5740/`. Expected: the layout with nav, the "Landing" heading, the footer disclaimer, and no console errors. Stop the server.

- [ ] **Step 11: Commit**

```bash
cd .. && git add frontend
git commit -m "feat(frontend): vite scaffold on 5740, typed api client with mock mode, store, layout, tokens"
```

---

### Task 8: Developer README and Phase 0 sign-off

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# Robo-Advisor

Spec: `docs/superpowers/specs/2026-09-29-roboadvisor-design.md` · Plans: `docs/superpowers/plans/`

## Backend (port 8740)

```bash
cd backend
uv sync
uv run python -m app.data.ingest        # download data (first run: all history)
uv run uvicorn app.main:app --port 8740 --reload
uv run pytest
```

API docs: http://localhost:8740/docs

After changing `app/engine/types.py` or `app/api/schemas.py`:

```bash
uv run python -m scripts.export_contract   # backend/openapi.json + frontend mocks
cd ../frontend && npm run gen:api
```

## Frontend (port 5740)

```bash
cd frontend
npm install
npm run dev          # talks to the backend on 8740 via /api proxy
npm run dev:mock     # no backend needed, serves src/mocks/*.json
npm test && npm run typecheck
```
````

- [ ] **Step 2: Full verification**

Run: `cd backend && uv run pytest -q && cd ../frontend && npm run typecheck && npm test`
Expected: all backend tests pass; typecheck clean; frontend tests pass.

- [ ] **Step 3: Commit and tag**

```bash
cd .. && git add README.md
git commit -m "docs: developer README"
git tag phase0-contracts
```

Lanes A–H start from tag `phase0-contracts`.
