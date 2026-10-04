# Textbook Portfolio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Textbook portfolio" page that builds a portfolio with only the course's method (tangent portfolio plus a risk-free fund, CAPM or historical expected returns) and explains each of seven steps with formula, slide reference, worked example and numbers.

**Architecture:** One new engine module (`engine/textbook.py`) computes everything for a fixed fund set and returns one response with a block per step; one endpoint (`POST /api/textbook`) exposes it. The frontend page renders seven sections through one reusable `Step` component; all number-to-text logic lives in pure transforms. The main pipeline is not modified; the textbook module imports four of its helpers.

**Tech Stack:** Python 3 / FastAPI / pydantic / pandas / cvxpy (via the existing `optimize` module), pytest. React 19 / TypeScript / recharts / openapi-fetch, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-textbook-portfolio-design.md`

## Global Constraints

- The main pipeline (`pipeline.recommend`, `_fit`) is not modified.
- No new dependencies, backend or frontend. Formulas are plain HTML with `<sub>` and `<sup>`.
- Fixed fund set from `config.TEXTBOOK_FUNDS`: 7 risky funds plus 1 risk-free fund per base currency. Investor preferences are not applied.
- Window: last `TEXTBOOK_WINDOW_YEARS` (5) × 52 weekly returns. Plain sample covariance, no shrinkage, no TER penalty, no position caps.
- Share in the tangent portfolio is clipped to [0, 1] (no borrowing).
- Risk aversion: `A = 10 − 8 × risk_level / 100` (`TEXTBOOK_RISK_AVERSION = (10.0, 2.0)`).
- Default market premium 0.05; request bound 0–0.15.
- All response floats finite (no NaN or infinity in JSON).
- Page title "Textbook portfolio", route `/textbook`, menu label "Textbook" after "Backtest".
- The explanatory text lives in the frontend; the backend sends numbers only.
- The page states that weekly returns are used where the course's examples use monthly.
- Backend commands run from `backend/` with `uv run`; frontend commands from `frontend/` with `npm`.

## Review Focus

1. Market premium input left empty or non-numeric: the request must omit `market_premium` (backend default applies), never send `NaN`. Test in Task 4 (`textbookRequest`).
2. No fund beats the risk-free rate (`tangent` is null): steps 5–7 must render an explanation, not crash. Tests in Task 3 (backend) and Task 4 (transforms with `tangent: null`).
3. Share above 100% before the cap (adventurous investor, or Historical with a high Sharpe): the page must say it was capped. Tests in Task 2 (`split`) and Task 4 (`exampleSplit`).
4. A configured ISIN missing from the database: a 422 naming the ISIN, not a 500. Test in Task 3.
5. Historical model concentrating in one fund: tangent weights of a single fund and a short frontier must still give a finite, valid response. Test in Task 3.

## Build order

- **Task 1 (contracts)** first.
- Then two lanes in parallel, no shared files: **Lane B** (backend) = Tasks 2–3, **Lane F** (frontend) = Tasks 4–5.
- **Task 6 (integration)** after both lanes.

## File map

| File | Task | Responsibility |
|---|---|---|
| `backend/app/config.py` | 1 | fund set and textbook constants |
| `backend/app/engine/types.py` | 1 | response models |
| `backend/app/api/schemas.py` | 1 | request model, re-export |
| `backend/app/api/textbook.py` | 1 | route |
| `backend/app/main.py` | 1 | register router |
| `backend/app/engine/textbook.py` | 1 stub, 2, 3 | the calculation |
| `backend/tests/fixtures/synthetic.py` | 1 | synthetic fund set |
| `backend/tests/textbook/test_config.py` | 1 | config shape |
| `backend/tests/textbook/test_math.py` | 2 | pure functions |
| `backend/tests/textbook/test_pipeline.py` | 3 | `textbook()` on synthetic and real data |
| `backend/tests/integration/test_api_textbook.py` | 1, 3 | endpoint |
| `frontend/src/components/textbook/textbook.ts` (+ `.test.ts`) | 4 | pure transforms |
| `frontend/src/components/textbook/Step.tsx`, `copy.tsx`, `TextbookChart.tsx`, `textbook.css` | 5 | layout, text, charts |
| `frontend/src/pages/Textbook.tsx`, `App.tsx`, `components/Layout.tsx` | 5 | page, route, menu |
| `backend/scripts/export_contract.py`, `frontend/src/mocks/*`, `frontend/e2e/textbook.pw.ts`, `README.md` | 6 | mock, browser test, docs |

---

### Task 1: Contracts

**Files:**
- Modify: `backend/app/config.py` (append after `REFERENCES`)
- Modify: `backend/app/engine/types.py` (insert before the `# ---------- intake ----------` comment)
- Modify: `backend/app/api/schemas.py`
- Create: `backend/app/engine/textbook.py` (stub)
- Create: `backend/app/api/textbook.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/fixtures/synthetic.py`
- Create: `backend/tests/textbook/__init__.py` (empty), `backend/tests/textbook/test_config.py`
- Create: `backend/tests/integration/test_api_textbook.py`
- Regenerate: `backend/openapi.json`, `frontend/src/api/schema.d.ts`

**Interfaces:**
- Produces: `config.TEXTBOOK_FUNDS`, `TEXTBOOK_WINDOW_YEARS`, `TEXTBOOK_PREMIUM`, `TEXTBOOK_RISK_AVERSION`, `TEXTBOOK_FRONTIER_POINTS`.
- Produces: pydantic models `TextbookFund`, `TextbookRiskFree`, `TextbookInputs`, `TextbookCorrelation`, `TextbookMix`, `TextbookSplit`, `TextbookPortfolio`; type `TextbookReturnModel`; request `TextbookRequest`.
- Produces: `app.engine.textbook.textbook(base: str, risk_level: float, return_model: str, market_premium: float | None, data: DataSource) -> TextbookPortfolio` (stub raising `NotImplementedError`).
- Produces: `tests.fixtures.synthetic.SYN_TEXTBOOK_FUNDS`.
- Produces: TypeScript `Schemas['TextbookPortfolio']`, `Schemas['TextbookRequest']` and the `/api/textbook` path in `schema.d.ts`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/textbook/test_config.py`:

```python
from app import config
from tests.fixtures.synthetic import SYN_TEXTBOOK_FUNDS


def test_every_base_currency_has_seven_risky_funds_and_a_risk_free_fund():
    assert set(config.TEXTBOOK_FUNDS) == set(config.BASE_CURRENCIES)
    for base, cfg in config.TEXTBOOK_FUNDS.items():
        isins = [*cfg["risky"].values(), cfg["risk_free"]]
        assert len(cfg["risky"]) == 7, base
        assert len(set(isins)) == 8, base  # no fund twice
        assert config.ANCHORS[base]["global_equity"] not in isins, base  # the market is not a building block


def test_synthetic_fund_set_has_the_same_shape():
    cfg = SYN_TEXTBOOK_FUNDS["EUR"]
    assert len(cfg["risky"]) == 7 and cfg["risk_free"] not in cfg["risky"].values()


def test_risk_aversion_runs_from_cautious_to_adventurous():
    cautious, adventurous = config.TEXTBOOK_RISK_AVERSION
    assert cautious > adventurous > 0
```

`backend/tests/integration/test_api_textbook.py`:

```python
def test_api_textbook_validates(client):
    assert client.post("/api/textbook", json={"risk_level": 101}).status_code == 422
    assert client.post("/api/textbook", json={"market_premium": 0.5}).status_code == 422
    assert client.post("/api/textbook", json={"return_model": "guess"}).status_code == 422
    assert client.post("/api/textbook", json={"base_currency": "GBP"}).status_code == 422
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/textbook tests/integration/test_api_textbook.py -q`
Expected: FAIL (`AttributeError: module 'app.config' has no attribute 'TEXTBOOK_FUNDS'`, `ImportError` for `SYN_TEXTBOOK_FUNDS`, 404 instead of 422).

- [ ] **Step 3: Add the config block**

Append to `backend/app/config.py`:

```python
# Textbook portfolio (spec 2026-10-04): fixed building blocks per base currency, by ISIN. Every fund has its own
# prices in the base-currency listing for the whole window (checked 2026-10-04), so no proxy returns are used.
TEXTBOOK_FUNDS = {
    "EUR": {
        "risky": {
            "US equities": "IE00B52SFT06",  # iShares MSCI USA
            "European equities": "IE00B1YZSC51",  # iShares Core MSCI Europe
            "Emerging market equities": "IE00BKM4GZ66",  # iShares Core MSCI EM IMI
            "Government bonds": "LU0290355717",  # Xtrackers Eurozone Government Bond
            "Corporate bonds": "IE00B3F81R35",  # iShares Core Euro Corporate Bond
            "Gold": "IE00B579F325",  # Invesco Physical Gold
            "Real estate": "IE00B0M63284",  # iShares European Property Yield
        },
        "risk_free": "LU0290358497",  # Xtrackers EUR Overnight Rate Swap
    },
    "USD": {
        "risky": {
            "US equities": "US9229087690",  # Vanguard Total Stock Market (VTI)
            "Developed ex-US equities": "US9219438580",  # Vanguard FTSE Developed Markets (VEA)
            "Emerging market equities": "US9220428588",  # Vanguard FTSE Emerging Markets (VWO)
            "Government bonds": "US4642874402",  # iShares 7-10 Year Treasury (IEF)
            "Corporate bonds": "US4642872422",  # iShares Investment Grade Corporate (LQD)
            "Gold": "US78463V1070",  # SPDR Gold Shares (GLD)
            "Real estate": "US9229085538",  # Vanguard Real Estate (VNQ)
        },
        "risk_free": "US78468R6633",  # SPDR 1-3 Month T-Bill (BIL)
    },
}
TEXTBOOK_WINDOW_YEARS = 5
TEXTBOOK_PREMIUM = 0.05  # default market risk premium (course: 5-7% historical, 3-5% in practice)
TEXTBOOK_RISK_AVERSION = (10.0, 2.0)  # A at risk level 0 and at risk level 100 (this tool's assumption)
TEXTBOOK_FRONTIER_POINTS = 25
```

- [ ] **Step 4: Add the response models**

In `backend/app/engine/types.py`, insert before `# ---------- intake ----------`:

```python
# ---------- textbook portfolio (spec 2026-10-04) ----------

TextbookReturnModel = Literal["capm", "historical"]


class TextbookFund(BaseModel):
    isin: str
    name: str
    ticker: str
    block: str  # building-block label from config.TEXTBOOK_FUNDS, e.g. "US equities"
    asset_class: str
    mean_return: float  # mean weekly return x 52
    volatility: float  # std of weekly returns x sqrt(52)
    beta: float
    capm_return: float  # rf + beta x premium
    expected_return: float  # the one the optimiser used: capm_return or mean_return


class TextbookRiskFree(BaseModel):
    isin: str
    name: str
    ticker: str
    volatility: float  # realised; the model treats it as 0


class TextbookInputs(BaseModel):
    window: dict[str, date]  # {"start", "end"} of the weeks used
    weeks: int
    frequency: Literal["weekly"] = "weekly"
    rf: float
    premium: float
    return_model: TextbookReturnModel
    market: dict[str, str]  # {"isin", "name"} of the CAPM market fund
    risk_aversion: float


class TextbookCorrelation(BaseModel):
    isins: list[str]  # config order
    matrix: list[list[float]]


class TextbookMix(BaseModel):
    weights: dict[str, float]  # isin -> weight, zero weights left out
    expected_return: float
    volatility: float
    sharpe: float | None


class TextbookSplit(BaseModel):
    risk_aversion: float
    risky_share_uncapped: float
    risky_share: float  # clipped to [0, 1]


class TextbookPortfolio(BaseModel):
    inputs: TextbookInputs
    funds: list[TextbookFund]  # the risky funds, config order
    risk_free_fund: TextbookRiskFree
    correlation: TextbookCorrelation
    frontier: list[FrontierPoint]  # sorted by volatility
    capital_market_line: list[FrontierPoint]  # risk-free point and tangent point; empty without a tangent
    tangent: TextbookMix | None  # None when no fund's expected return is above rf
    split: TextbookSplit
    portfolio: TextbookMix  # includes the risk-free fund
    warnings: list[str] = []
```

- [ ] **Step 5: Add the request model**

In `backend/app/api/schemas.py`, add `TextbookPortfolio, TextbookReturnModel` to the `from app.engine.types import (...)` list, and add after `FrontierRequest`:

```python
class TextbookRequest(BaseModel):
    base_currency: Currency = "EUR"
    risk_level: float = Field(50, ge=0, le=100)
    return_model: TextbookReturnModel = "capm"  # which expected return feeds the optimiser
    market_premium: float | None = Field(None, ge=0, le=0.15)  # None -> config.TEXTBOOK_PREMIUM
```

- [ ] **Step 6: Add the engine stub and the route**

`backend/app/engine/textbook.py`:

```python
"""Textbook portfolio (spec 2026-10-04): Markowitz and the CAPM as taught in the course, on a fixed fund set."""

from app.engine.types import DataSource, TextbookPortfolio


def textbook(
    base: str, risk_level: float, return_model: str, market_premium: float | None, data: DataSource
) -> TextbookPortfolio:
    raise NotImplementedError("textbook portfolio")
```

`backend/app/api/textbook.py`:

```python
from fastapi import APIRouter, Depends

from app.api.deps import ENGINE_LOCK, get_data
from app.api.schemas import TextbookPortfolio, TextbookRequest
from app.engine import textbook
from app.engine.types import DataSource

router = APIRouter(tags=["engine"])


@router.post("/textbook", response_model=TextbookPortfolio)
def textbook_portfolio(body: TextbookRequest, data: DataSource = Depends(get_data)) -> TextbookPortfolio:
    with ENGINE_LOCK:
        return textbook.textbook(body.base_currency, body.risk_level, body.return_model, body.market_premium, data)
```

In `backend/app/main.py` change the import and the loop:

```python
from app.api import backtest, frontier, health, intake, portfolio, textbook, universe
```

```python
for module in (health, intake, universe, portfolio, backtest, frontier, textbook):
```

- [ ] **Step 7: Add the synthetic fund set**

In `backend/tests/fixtures/synthetic.py`, after the `ANCHOR_ISINS = ...` line:

```python
# Stand-in for config.TEXTBOOK_FUNDS (the real ISINs are not in the synthetic market). EUR only.
SYN_TEXTBOOK_FUNDS = {
    "EUR": {
        "risky": {
            "US equities": "SYNUSEQ00001",
            "European equities": "SYNEUEQ00001",
            "Emerging market equities": "SYNEMEQ00001",
            "Government bonds": "SYNGOVL00001",
            "Corporate bonds": "SYNCORP00001",
            "Gold": "SYNGOLD00001",
            "Real estate": "SYNREIT00001",
        },
        "risk_free": "SYNCASH00001",
    },
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/textbook tests/integration/test_api_textbook.py -q`
Expected: 4 passed.

- [ ] **Step 9: Regenerate the contract files**

Run: `cd backend && uv run python -m scripts.export_contract && cd ../frontend && npm run gen:api && npm run typecheck`
Expected: `openapi.json` and `schema.d.ts` change; `grep -c TextbookPortfolio src/api/schema.d.ts` prints a number above 0; typecheck passes. The existing mock JSON files must not change (`git status --short frontend/src/mocks` prints nothing).

- [ ] **Step 10: Run the whole backend suite and commit**

Run: `cd backend && uv run pytest -q`
Expected: all pass.

```bash
git add backend/app backend/tests backend/openapi.json frontend/src/api/schema.d.ts
git commit -m "feat(api): textbook portfolio contract (types, config, stub endpoint)"
```

---

### Task 2 (Lane B): the maths as pure functions

**Files:**
- Modify: `backend/app/engine/textbook.py`
- Test: `backend/tests/textbook/test_math.py`

**Interfaces:**
- Consumes: `config.TEXTBOOK_RISK_AVERSION`, `config.PERIODS_PER_YEAR`; `optimize.optimize(mu, cov, constraints, "max_sharpe") -> OptimizeResult` (takes EXCESS returns; `.weights` holds only non-zero weights); `Constraints` dataclass.
- Produces (all in `app.engine.textbook`):
  - `window(returns: pd.DataFrame, years: int) -> pd.DataFrame`
  - `annual_stats(w: pd.DataFrame) -> tuple[pd.Series, pd.Series]` (mean, volatility)
  - `annual_covariance(w: pd.DataFrame) -> pd.DataFrame`
  - `risk_aversion(risk_level: float) -> float`
  - `loose_constraints(isins: list[str]) -> Constraints`
  - `tangent_weights(mu: pd.Series, cov: pd.DataFrame, rf: float) -> pd.Series | None`
  - `split(excess: float, variance: float, a: float) -> tuple[float, float]` (uncapped, capped)

- [ ] **Step 1: Write the failing tests**

`backend/tests/textbook/test_math.py`:

```python
import numpy as np
import pandas as pd
import pytest

from app.engine import textbook as tb
from app.engine.errors import InsufficientHistory


def _weeks(n: int, cols: list[str]) -> pd.DataFrame:
    idx = pd.date_range("2018-01-05", periods=n, freq="W-FRI")
    rng = np.random.default_rng(1)
    return pd.DataFrame(rng.normal(0.001, 0.02, (n, len(cols))), index=idx, columns=cols)


def test_window_keeps_the_last_years_and_drops_incomplete_weeks():
    r = _weeks(400, ["A", "B"])
    r.iloc[-1, 0] = np.nan
    w = tb.window(r, 5)
    assert len(w) == 259 and w.index[-1] == r.index[-2]


def test_window_needs_a_year_of_complete_weeks():
    with pytest.raises(InsufficientHistory):
        tb.window(_weeks(40, ["A"]), 5)


def test_annual_stats_by_hand():
    weekly = [0.01, -0.01, 0.03, 0.01]
    mean, vol = tb.annual_stats(pd.DataFrame({"A": weekly}))
    assert mean["A"] == pytest.approx(0.01 * 52)
    assert vol["A"] == pytest.approx(np.std(weekly, ddof=1) * np.sqrt(52))


def test_annual_covariance_diagonal_is_volatility_squared():
    w = _weeks(100, ["A", "B"])
    _, vol = tb.annual_stats(w)
    cov = tb.annual_covariance(w)
    assert np.sqrt(cov.at["A", "A"]) == pytest.approx(vol["A"])
    assert cov.at["A", "B"] == pytest.approx(cov.at["B", "A"])


def test_risk_aversion_scale():
    assert tb.risk_aversion(0) == pytest.approx(10.0)
    assert tb.risk_aversion(50) == pytest.approx(6.0)
    assert tb.risk_aversion(100) == pytest.approx(2.0)


def test_tangent_of_two_uncorrelated_funds_matches_the_closed_form():
    # tangent weights are proportional to inverse(cov) @ (mu - rf) = [0.06/0.04, 0.02/0.01] = [1.5, 2]
    cov = pd.DataFrame([[0.04, 0.0], [0.0, 0.01]], index=["A", "B"], columns=["A", "B"])
    w = tb.tangent_weights(pd.Series({"A": 0.08, "B": 0.04}), cov, rf=0.02)
    assert w["A"] == pytest.approx(3 / 7, abs=1e-3) and w["B"] == pytest.approx(4 / 7, abs=1e-3)


def test_no_tangent_when_no_fund_beats_the_risk_free_rate():
    cov = pd.DataFrame([[0.04, 0.0], [0.0, 0.01]], index=["A", "B"], columns=["A", "B"])
    assert tb.tangent_weights(pd.Series({"A": 0.02, "B": 0.01}), cov, rf=0.02) is None


def test_split_follows_the_formula_and_is_capped():
    assert tb.split(0.04, 0.0144, 10.0) == pytest.approx((0.04 / 0.144, 0.04 / 0.144))
    uncapped, capped = tb.split(0.04, 0.0144, 2.0)  # 1.39 before the cap: no borrowing
    assert uncapped == pytest.approx(0.04 / 0.0288) and capped == 1.0
    assert tb.split(-0.01, 0.0144, 5.0)[1] == 0.0


def test_split_refuses_a_tangent_without_volatility():
    with pytest.raises(InsufficientHistory):
        tb.split(0.04, 0.0, 5.0)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/textbook/test_math.py -q`
Expected: FAIL with `AttributeError: module 'app.engine.textbook' has no attribute 'window'`.

- [ ] **Step 3: Implement the functions**

Replace the contents of `backend/app/engine/textbook.py` (the `textbook` stub stays at the bottom, unchanged):

```python
"""Textbook portfolio (spec 2026-10-04): Markowitz and the CAPM as taught in the course, on a fixed fund set.

Deliberately simple: plain sample covariance, weights between 0 and 1 summing to 1, no TER penalty and no caps.
The tangent (maximum Sharpe) portfolio is mixed with a risk-free fund; risk aversion A sets the split.
"""

import numpy as np
import pandas as pd

from app import config
from app.engine import optimize
from app.engine.errors import InsufficientHistory
from app.engine.types import Constraints, DataSource, TextbookPortfolio

PERIODS = config.PERIODS_PER_YEAR
MIN_EXCESS = 1e-9  # an expected return this close to rf does not count as "above rf"
MIN_VARIANCE = 1e-12


def window(returns: pd.DataFrame, years: int) -> pd.DataFrame:
    """The last years x 52 weekly rows, without weeks where any column is missing."""
    w = returns.iloc[-years * PERIODS:].dropna()
    if len(w) < PERIODS:
        raise InsufficientHistory(f"textbook portfolio: only {len(w)} complete weeks in the last {years} years")
    return w


def annual_stats(w: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """(average return, volatility) per column, annualised: mean x 52 and standard deviation x sqrt(52)."""
    return w.mean() * PERIODS, w.std() * np.sqrt(PERIODS)


def annual_covariance(w: pd.DataFrame) -> pd.DataFrame:
    """Plain sample covariance of the weekly returns x 52 (no shrinkage)."""
    return w.cov() * PERIODS


def risk_aversion(risk_level: float) -> float:
    """A in U = E(r) - 1/2 A sigma^2: linear from the cautious end (risk level 0) to the adventurous end (100)."""
    cautious, adventurous = config.TEXTBOOK_RISK_AVERSION
    return cautious + (adventurous - cautious) * risk_level / 100


def loose_constraints(isins: list[str]) -> Constraints:
    """Only the course's constraints: weights between 0 and 1, summing to 1."""
    return Constraints(target_vol=0.0, max_etfs=len(isins), min_position=0.0, max_position=1.0,
                       ter=pd.Series(0.0, index=isins))


def tangent_weights(mu: pd.Series, cov: pd.DataFrame, rf: float) -> pd.Series | None:
    """Weights of the maximum-Sharpe portfolio; None when no fund's expected return is above rf."""
    excess = mu - rf
    if not (excess > MIN_EXCESS).any():
        return None
    return optimize.optimize(excess, cov, loose_constraints(list(cov.index)), "max_sharpe").weights


def split(excess: float, variance: float, a: float) -> tuple[float, float]:
    """Share in the tangent portfolio that maximises U: y = excess / (A x variance). Returns (y, y clipped to 0..1)."""
    if variance <= MIN_VARIANCE:
        raise InsufficientHistory("textbook portfolio: the tangent portfolio has no volatility")
    y = excess / (a * variance)
    return y, min(max(y, 0.0), 1.0)


def textbook(
    base: str, risk_level: float, return_model: str, market_premium: float | None, data: DataSource
) -> TextbookPortfolio:
    raise NotImplementedError("textbook portfolio")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/textbook/test_math.py -q`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/textbook.py backend/tests/textbook/test_math.py
git commit -m "feat(backend): textbook portfolio maths (stats, tangent, split)"
```

---

### Task 3 (Lane B): `textbook()` and the endpoint

**Files:**
- Modify: `backend/app/engine/textbook.py` (replace the stub)
- Test: `backend/tests/textbook/test_pipeline.py`
- Modify: `backend/tests/integration/test_api_textbook.py`

**Interfaces:**
- Consumes from Task 2: `window`, `annual_stats`, `annual_covariance`, `risk_aversion`, `loose_constraints`, `tangent_weights`, `split`.
- Consumes from `app.engine.pipeline` (existing, not modified):
  - `_listing_rows(funds, listings, base, isins, *, error, what) -> pd.DataFrame` (index isin, has `ticker`, `name`, `asset_class`; raises `error` naming missing isins)
  - `_weekly(rows, base, data) -> ReturnsResult` (`.returns`: weekly DataFrame, columns isin; `.proxied`: isin → (first proxied week, week of first own price))
  - `_curve(mu_total, cov, cons, rf, points) -> tuple[list[FrontierPoint], int]`
  - `_position(weights, mu_total, cov, rf) -> FrontierPoint`
- Consumes: `expected.capm(returns, market, rf, premium, model, window_years, end) -> CapmResult` (`.beta`, `.expected`, `.rf`).
- Produces: the working `textbook(base, risk_level, return_model, market_premium, data) -> TextbookPortfolio`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/textbook/test_pipeline.py`:

```python
import json
import math
import time

import pytest

from app import config
from app.engine import pipeline
from app.engine.errors import InsufficientHistory
from app.engine.textbook import textbook
from tests.fixtures.synthetic import SYN_TEXTBOOK_FUNDS

RISKY = list(SYN_TEXTBOOK_FUNDS["EUR"]["risky"].values())
RF_FUND = SYN_TEXTBOOK_FUNDS["EUR"]["risk_free"]


@pytest.fixture
def tb_funds(monkeypatch):
    monkeypatch.setattr(config, "TEXTBOOK_FUNDS", SYN_TEXTBOOK_FUNDS)


def _tb(data, risk=50.0, model="capm", premium=None):
    return textbook("EUR", risk, model, premium, data)


def test_funds_come_back_in_config_order_with_their_block(synthetic, tb_funds):
    res = _tb(synthetic)
    assert [f.isin for f in res.funds] == RISKY
    assert [f.block for f in res.funds] == list(SYN_TEXTBOOK_FUNDS["EUR"]["risky"])
    assert res.risk_free_fund.isin == RF_FUND
    assert res.inputs.frequency == "weekly" and res.inputs.weeks == 260
    assert res.inputs.market["isin"] == config.ANCHORS["EUR"]["global_equity"]


def test_stats_and_correlation_match_a_hand_computation(synthetic, tb_funds):
    res = _tb(synthetic)
    market = config.ANCHORS["EUR"]["global_equity"]
    rows = pipeline._listing_rows(synthetic.funds(), synthetic.listings(), "EUR", [*RISKY, market],
                                  error=InsufficientHistory, what="test")
    r = pipeline._weekly(rows, "EUR", synthetic).returns.iloc[-260:].dropna()
    first = res.funds[0]
    assert first.mean_return == pytest.approx(r[first.isin].mean() * 52, abs=1e-5)
    assert first.volatility == pytest.approx(r[first.isin].std() * math.sqrt(52), abs=1e-5)
    assert res.correlation.isins == RISKY
    assert res.correlation.matrix[0][1] == pytest.approx(r[RISKY[0]].corr(r[RISKY[1]]), abs=1e-5)
    assert all(res.correlation.matrix[k][k] == pytest.approx(1.0) for k in range(7))
    assert str(res.inputs.window["end"]) == str(r.index[-1].date())


def test_capm_return_is_rf_plus_beta_times_premium(synthetic, tb_funds):
    res = _tb(synthetic, premium=0.04)
    assert res.inputs.premium == 0.04
    for f in res.funds:
        assert f.capm_return == pytest.approx(res.inputs.rf + f.beta * 0.04, abs=1e-5)
        assert f.expected_return == f.capm_return


def test_default_premium_comes_from_config(synthetic, tb_funds):
    assert _tb(synthetic).inputs.premium == config.TEXTBOOK_PREMIUM


def test_historical_model_uses_the_average_return(synthetic, tb_funds):
    res = _tb(synthetic, model="historical")
    assert res.inputs.return_model == "historical"
    assert all(f.expected_return == f.mean_return for f in res.funds)
    json.dumps(res.model_dump(mode="json"), allow_nan=False)  # finite even when one fund dominates
    assert res.frontier and abs(sum(res.portfolio.weights.values()) - 1) < 1e-4


def test_tangent_has_the_best_sharpe_ratio(synthetic, tb_funds):
    res = _tb(synthetic)
    assert res.tangent is not None
    assert sum(res.tangent.weights.values()) == pytest.approx(1.0, abs=1e-4)
    assert all(w > 0 for w in res.tangent.weights.values())
    assert len(res.frontier) >= 5
    vols = [p.volatility for p in res.frontier]
    assert vols == sorted(vols)
    best_on_curve = max(p.sharpe for p in res.frontier if p.sharpe is not None)
    assert res.tangent.sharpe >= best_on_curve - 1e-3
    assert [p.volatility for p in res.capital_market_line] == [0.0, res.tangent.volatility]


def test_split_and_final_portfolio(synthetic, tb_funds):
    res = _tb(synthetic, risk=0)  # A = 10: the cautious end, share well below 100%
    t, s, p = res.tangent, res.split, res.portfolio
    assert s.risk_aversion == 10.0 == res.inputs.risk_aversion
    expected_share = (t.expected_return - res.inputs.rf) / (10.0 * t.volatility**2)
    assert s.risky_share_uncapped == pytest.approx(expected_share, abs=1e-4)
    assert 0 < s.risky_share < 1 and s.risky_share == pytest.approx(min(expected_share, 1.0), abs=1e-4)
    assert sum(p.weights.values()) == pytest.approx(1.0, abs=1e-4)
    assert p.weights[RF_FUND] == pytest.approx(1 - s.risky_share, abs=1e-4)
    assert p.volatility == pytest.approx(s.risky_share * t.volatility, abs=1e-5)
    assert p.expected_return == pytest.approx(res.inputs.rf + s.risky_share * (t.expected_return - res.inputs.rf), abs=1e-5)
    assert p.sharpe == t.sharpe


def test_adventurous_investor_is_capped_at_the_tangent_portfolio(synthetic, tb_funds):
    res = _tb(synthetic, risk=100, premium=0.15)  # A = 2 and a high premium: the formula asks for more than 100%
    assert res.split.risky_share_uncapped > 1 and res.split.risky_share == 1.0
    assert RF_FUND not in res.portfolio.weights
    assert res.portfolio.volatility == pytest.approx(res.tangent.volatility, abs=1e-5)


def test_no_fund_above_the_risk_free_rate_means_all_in_the_risk_free_fund(synthetic, tb_funds):
    res = _tb(synthetic, premium=0.0)  # CAPM with a zero premium: every fund is expected to earn rf
    assert res.tangent is None and res.capital_market_line == []
    assert res.split.risky_share == 0.0
    assert res.portfolio.weights == {RF_FUND: 1.0}
    assert res.portfolio.volatility == 0.0 and res.portfolio.sharpe is None
    assert any("risk-free" in w for w in res.warnings)


def test_missing_fund_is_named(synthetic, monkeypatch):
    broken = {"EUR": {"risky": {**SYN_TEXTBOOK_FUNDS["EUR"]["risky"], "Gold": "XX0000000000"}, "risk_free": RF_FUND}}
    monkeypatch.setattr(config, "TEXTBOOK_FUNDS", broken)
    with pytest.raises(InsufficientHistory, match="XX0000000000"):
        _tb(synthetic)


@pytest.mark.skipif(not config.DB_PATH.exists(), reason="real database not present")
def test_real_db_fund_sets_have_full_own_history_and_answer_fast():
    from app.api.deps import get_data

    data = get_data()
    for base in ("EUR", "USD"):
        textbook(base, 50, "capm", None, data)  # cold: loads the data caches
        t = time.perf_counter()
        res = textbook(base, 50, "capm", None, data)
        elapsed = time.perf_counter() - t
        assert len(res.funds) == 7 and res.inputs.weeks >= 250, base
        assert not any("proxy" in w for w in res.warnings), res.warnings
        assert elapsed <= 1.0, f"{base} warm {elapsed:.2f}s"
```

Append to `backend/tests/integration/test_api_textbook.py`:

```python
import json

import pytest

from app import config
from tests.fixtures.synthetic import SYN_TEXTBOOK_FUNDS


def _reject(token: str):
    raise AssertionError(f"non-finite JSON token {token!r} in response")


@pytest.mark.parametrize("model", ["capm", "historical"])
def test_api_textbook(client, monkeypatch, model):
    monkeypatch.setattr(config, "TEXTBOOK_FUNDS", SYN_TEXTBOOK_FUNDS)
    r = client.post("/api/textbook", json={"risk_level": 30, "return_model": model})
    assert r.status_code == 200, r.text
    d = json.loads(r.text, parse_constant=_reject)
    assert len(d["funds"]) == 7 and len(d["correlation"]["matrix"]) == 7
    assert d["inputs"]["return_model"] == model
    assert abs(sum(d["portfolio"]["weights"].values()) - 1) < 1e-4


def test_api_textbook_missing_fund_is_a_422(client, monkeypatch):
    broken = {"EUR": {"risky": {"Gold": "XX0000000000"}, "risk_free": "SYNCASH00001"}}
    monkeypatch.setattr(config, "TEXTBOOK_FUNDS", broken)
    r = client.post("/api/textbook", json={})
    assert r.status_code == 422 and "XX0000000000" in r.json()["detail"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/textbook/test_pipeline.py tests/integration/test_api_textbook.py -q`
Expected: FAIL with `NotImplementedError: textbook portfolio` (API tests: status 501).

- [ ] **Step 3: Implement `textbook()`**

In `backend/app/engine/textbook.py`, extend the imports:

```python
from app.engine import expected, optimize
from app.engine.pipeline import _curve, _listing_rows, _position, _weekly
from app.engine.types import (
    Constraints, DataSource, FrontierPoint, TextbookCorrelation, TextbookFund, TextbookInputs, TextbookMix,
    TextbookPortfolio, TextbookRiskFree, TextbookSplit,
)
```

and replace the stub with:

```python
def _r(x) -> float:
    return round(float(x), 6)


def textbook(
    base: str, risk_level: float, return_model: str, market_premium: float | None, data: DataSource
) -> TextbookPortfolio:
    """returns -> average and volatility -> correlation -> expected returns -> frontier -> tangent -> split -> portfolio."""
    cfg = config.TEXTBOOK_FUNDS[base]
    blocks = {isin: block for block, isin in cfg["risky"].items()}
    risky, rf_isin = list(blocks), cfg["risk_free"]
    market = config.ANCHORS[base]["global_equity"]
    premium = config.TEXTBOOK_PREMIUM if market_premium is None else market_premium
    years = config.TEXTBOOK_WINDOW_YEARS

    # 1. weekly base-currency returns of the building blocks, the risk-free fund and the CAPM market
    funds = data.funds()
    rows = _listing_rows(funds, data.listings(), base, [*risky, rf_isin, market], error=InsufficientHistory,
                         what="textbook funds (check config.TEXTBOOK_FUNDS against the database)")
    rr = _weekly(rows, base, data)
    w = window(rr.returns[[*risky, market]], years)
    warnings = [f"{i}: part of the window uses proxy returns, not the fund's own prices."
                for i in risky if i in rr.proxied and rr.proxied[i][1] >= w.index[0]]

    # 2-3. average return, volatility, covariance and correlation
    mean, vol = annual_stats(w[risky])
    cov = annual_covariance(w[risky])
    corr = w[risky].corr()

    # 4. expected returns: CAPM against the global equity fund, or the historical average
    end = w.index[-1]
    cr = expected.capm(w[risky], w[market], data.rf(base), premium, "capm_equity", years, end=end)
    rf = float(cr.rf)
    mu = cr.expected[risky] if return_model == "capm" else mean

    # 5. efficient frontier of the risky funds
    curve, skipped = _curve(mu, cov, loose_constraints(risky), rf, config.TEXTBOOK_FRONTIER_POINTS)
    if skipped:
        warnings.append(f"frontier: skipped {skipped} point(s) the solver could not reach.")

    # 6-8. tangent portfolio, the split with the risk-free fund, the final portfolio
    a = risk_aversion(risk_level)
    tw = tangent_weights(mu, cov, rf)
    if tw is None:
        tangent, cml, uncapped, share = None, [], 0.0, 0.0
        portfolio = TextbookMix(weights={rf_isin: 1.0}, expected_return=_r(rf), volatility=0.0, sharpe=None)
        warnings.append("No fund has an expected return above the risk-free rate, so there is no tangent "
                        "portfolio: everything goes to the risk-free fund.")
    else:
        pos = _position(tw, mu, cov, rf)
        uncapped, share = split(pos.expected_return - rf, pos.volatility**2, a)
        sharpe = _r(pos.sharpe)
        tangent = TextbookMix(weights={i: _r(v) for i, v in tw.items()}, expected_return=_r(pos.expected_return),
                              volatility=_r(pos.volatility), sharpe=sharpe)
        cml = [FrontierPoint(volatility=0.0, expected_return=_r(rf), sharpe=None),
               FrontierPoint(volatility=_r(pos.volatility), expected_return=_r(pos.expected_return), sharpe=sharpe)]
        weights = {**{i: _r(share * v) for i, v in tw.items()}, rf_isin: _r(1 - share)}
        portfolio = TextbookMix(
            weights={i: v for i, v in weights.items() if v > 0},
            expected_return=_r(rf + share * (pos.expected_return - rf)), volatility=_r(share * pos.volatility),
            sharpe=sharpe if share > 0 else None,
        )

    rf_returns = rr.returns[rf_isin].reindex(w.index).dropna()
    return TextbookPortfolio(
        inputs=TextbookInputs(
            window={"start": w.index[0].date(), "end": end.date()}, weeks=len(w), rf=_r(rf), premium=_r(premium),
            return_model=return_model, market={"isin": market, "name": str(funds.at[market, "name"])},
            risk_aversion=_r(a),
        ),
        funds=[
            TextbookFund(
                isin=i, name=str(funds.at[i, "name"]), ticker=str(rows.at[i, "ticker"]), block=blocks[i],
                asset_class=str(funds.at[i, "asset_class"]), mean_return=_r(mean[i]), volatility=_r(vol[i]),
                beta=_r(cr.beta[i]), capm_return=_r(cr.expected[i]), expected_return=_r(mu[i]),
            )
            for i in risky
        ],
        risk_free_fund=TextbookRiskFree(
            isin=rf_isin, name=str(funds.at[rf_isin, "name"]), ticker=str(rows.at[rf_isin, "ticker"]),
            volatility=_r(rf_returns.std() * np.sqrt(PERIODS)) if len(rf_returns) > 1 else 0.0,
        ),
        correlation=TextbookCorrelation(isins=risky, matrix=[[_r(v) for v in row] for row in corr.to_numpy()]),
        frontier=curve,
        capital_market_line=cml,
        tangent=tangent,
        split=TextbookSplit(risk_aversion=_r(a), risky_share_uncapped=_r(uncapped), risky_share=_r(share)),
        portfolio=portfolio,
        warnings=warnings,
    )
```

Notes for the implementer:
- `expected_return == capm_return` and `== mean_return` hold exactly in the tests because both sides are rounded by the same `_r` from the same value.
- With `premium=0` every CAPM return equals `rf`, so `tangent_weights` returns `None`; `_curve` still returns finite points.
- Do not edit `pipeline.py`. Importing its underscore helpers is intended (spec §5.2).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/textbook tests/integration/test_api_textbook.py -q`
Expected: all pass (the real-database test passes or is skipped when `backend/data/roboadvisor.db` is absent).

If `test_real_db_fund_sets_have_full_own_history_and_answer_fast` fails on a proxy warning, do not weaken the test: report the fund named in the warning.

- [ ] **Step 5: Run the whole backend suite and commit**

Run: `cd backend && uv run pytest -q`
Expected: all pass.

```bash
git add backend/app/engine/textbook.py backend/tests/textbook/test_pipeline.py backend/tests/integration/test_api_textbook.py
git commit -m "feat(backend): textbook portfolio calculation and endpoint"
```

---

### Task 4 (Lane F): transforms

**Files:**
- Create: `frontend/src/components/textbook/textbook.ts`
- Test: `frontend/src/components/textbook/textbook.test.ts`

**Interfaces:**
- Consumes: `Schemas['TextbookPortfolio']`, `Schemas['TextbookRequest']` (from Task 1's `schema.d.ts`); `ChartTable` from `../charts/ChartFrame`; `decimal`, `percent` from `../charts/format`; `MixSlice` from `../charts/transforms` (`{ key: string; label: string; value: number; color: string }`).
- Produces (all exported from `textbook.ts`): `Textbook`, `ReturnModel`, `Layer`, `XY`, `textbookRequest`, `statsTable`, `correlationRows`, `corrShade`, `expectedTable`, `usedColumn`, `chartSeries`, `chartTable`, `chartDescription`, `smlSeries`, `tangentTable`, `weightsTable`, `weightSlices`, `exampleStats`, `exampleCorrelation`, `exampleExpected`, `exampleFrontier`, `exampleTangent`, `exampleSplit`, `examplePortfolio`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/textbook/textbook.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  chartSeries, chartTable, corrShade, correlationRows, exampleCorrelation, exampleExpected, examplePortfolio,
  exampleSplit, exampleStats, exampleTangent, expectedTable, smlSeries, statsTable, tangentTable, textbookRequest,
  usedColumn, weightSlices, weightsTable, type Textbook,
} from './textbook';

const fund = (isin: string, block: string, mean: number, vol: number, beta: number, capm: number) => ({
  isin, name: `${block} fund`, ticker: isin, block, asset_class: 'equity',
  mean_return: mean, volatility: vol, beta, capm_return: capm, expected_return: capm,
});
const pt = (volatility: number, expected_return: number, sharpe: number | null = null) => ({ volatility, expected_return, sharpe });

const base = {
  inputs: {
    window: { start: '2021-01-01', end: '2025-12-26' }, weeks: 260, frequency: 'weekly', rf: 0.02, premium: 0.05,
    return_model: 'capm', market: { isin: 'M', name: 'World' }, risk_aversion: 6,
  },
  funds: [fund('A', 'US equities', 0.104, 0.16, 1.0, 0.07), fund('B', 'Government bonds', 0.01, 0.06, 0.1, 0.025)],
  risk_free_fund: { isin: 'RF', name: 'Overnight fund', ticker: 'RF', volatility: 0.002 },
  correlation: { isins: ['A', 'B'], matrix: [[1, -0.2], [-0.2, 1]] },
  frontier: [pt(0.1, 0.05, 0.3), pt(0.055, 0.03, 0.18)],
  capital_market_line: [pt(0, 0.02), pt(0.1, 0.05, 0.3)],
  tangent: { weights: { A: 0.6, B: 0.4 }, expected_return: 0.05, volatility: 0.1, sharpe: 0.3 },
  split: { risk_aversion: 6, risky_share_uncapped: 0.5, risky_share: 0.5 },
  portfolio: { weights: { A: 0.3, B: 0.2, RF: 0.5 }, expected_return: 0.035, volatility: 0.05, sharpe: 0.3 },
  warnings: [],
} as unknown as Textbook;

const noTangent = {
  ...base, tangent: null, capital_market_line: [],
  split: { risk_aversion: 6, risky_share_uncapped: 0, risky_share: 0 },
  portfolio: { weights: { RF: 1 }, expected_return: 0.02, volatility: 0, sharpe: null },
} as unknown as Textbook;

const capped = {
  ...base, split: { risk_aversion: 2, risky_share_uncapped: 1.5, risky_share: 1 },
  portfolio: { weights: { A: 0.6, B: 0.4 }, expected_return: 0.05, volatility: 0.1, sharpe: 0.3 },
} as unknown as Textbook;

describe('textbookRequest', () => {
  it('sends the premium as a fraction', () => {
    expect(textbookRequest('EUR', 40, 'capm', 4.5)).toEqual({ base_currency: 'EUR', risk_level: 40, return_model: 'capm', market_premium: 0.045 });
  });
  it('omits an invalid premium so the backend default applies', () => {
    expect(textbookRequest('EUR', 40, 'capm', Number.NaN)).not.toHaveProperty('market_premium');
    expect(textbookRequest('EUR', 40, 'capm', Number('abc'))).not.toHaveProperty('market_premium');
  });
  it('clamps the premium to the allowed range', () => {
    expect(textbookRequest('USD', 40, 'historical', 40).market_premium).toBe(0.15);
    expect(textbookRequest('USD', 40, 'historical', -3).market_premium).toBe(0);
  });
});

describe('tables', () => {
  it('stats: one row per fund', () => {
    expect(statsTable(base).rows[0]).toEqual(['US equities', 'US equities fund', '10.4%', '16.0%']);
  });
  it('correlation: labelled rows and shading by sign', () => {
    const c = correlationRows(base);
    expect(c.head).toEqual(['US equities', 'Government bonds']);
    expect(c.rows[1]).toEqual({ label: 'Government bonds', cells: [-0.2, 1] });
    expect(corrShade(0.5)).toContain('--series-1');
    expect(corrShade(-0.5)).toContain('--series-2');
  });
  it('expected returns: the used column follows the model', () => {
    expect(expectedTable(base).rows[0]).toEqual(['US equities', '1.00', '7.0%', '10.4%']);
    expect(usedColumn(base)).toBe(2);
    expect(usedColumn({ ...base, inputs: { ...base.inputs, return_model: 'historical' } } as Textbook)).toBe(3);
  });
  it('tangent and final weights', () => {
    expect(tangentTable(base).rows).toEqual([['US equities', '60.0%'], ['Government bonds', '40.0%']]);
    expect(weightsTable(base).rows).toEqual([
      ['US equities', 'US equities fund', '30.0%'], ['Government bonds', 'Government bonds fund', '20.0%'],
      ['Risk-free fund', 'Overnight fund', '50.0%'],
    ]);
    expect(weightSlices(base).map((s) => s.value)).toEqual([0.3, 0.2, 0.5]);
    expect(weightsTable(noTangent).rows).toEqual([['Risk-free fund', 'Overnight fund', '100.0%']]);
    expect(tangentTable(noTangent).rows).toEqual([]);
  });
});

describe('chartSeries', () => {
  it('adds one layer per step', () => {
    const frontier = chartSeries(base, 'frontier');
    expect(frontier.funds).toHaveLength(2);
    expect(frontier.frontier.map((p) => p.x)).toEqual([5.5, 10]); // sorted, percent
    expect(frontier.tangent).toEqual([]);
    expect(frontier.riskFree).toEqual([]);
    const tangent = chartSeries(base, 'tangent');
    expect(tangent.tangent[0]).toMatchObject({ x: 10, y: 5, label: 'Tangent portfolio' });
    expect(tangent.riskFree[0]).toMatchObject({ x: 0, y: 2 });
    expect(tangent.cml).toHaveLength(2);
    expect(tangent.investor).toEqual([]);
    expect(chartSeries(base, 'split').investor[0]).toMatchObject({ x: 5, y: 3.5, label: 'Your portfolio' });
  });
  it('survives a missing tangent portfolio', () => {
    const s = chartSeries(noTangent, 'split');
    expect(s.tangent).toEqual([]);
    expect(s.cml).toEqual([]);
    expect(s.investor[0]).toMatchObject({ x: 0, y: 2 });
    expect(chartTable(noTangent, 'split').rows.at(-1)?.[0]).toBe('Your portfolio');
  });
  it('security market line runs through rf at beta 0', () => {
    const s = smlSeries(base);
    expect(s.line[0]).toEqual({ x: 0, y: 2 });
    expect(s.funds[0]).toMatchObject({ x: 1, y: 7, label: 'US equities' });
  });
});

describe('worked examples', () => {
  it('fill the formulas with the numbers', () => {
    expect(exampleStats(base)).toContain('0.20%');
    expect(exampleStats(base)).toContain('10.4%');
    expect(exampleCorrelation(base)).toContain('−0.20');
    expect(exampleExpected(base)).toBe('US equities: 2.0% + 1.00 × 5.0% = 7.0%.');
    expect(exampleTangent(base)).toBe('(5.0% − 2.0%) / 10.0% = 0.30');
    expect(exampleSplit(base)).toBe('y = (5.0% − 2.0%) / (6.0 × 10.0%²) = 50%.');
    expect(examplePortfolio(base)).toContain('2.0% + 50% × (5.0% − 2.0%) = 3.5%');
  });
  it('say when the share was capped', () => {
    expect(exampleSplit(capped)).toContain('150%');
    expect(exampleSplit(capped)).toContain('capped at 100%');
  });
  it('explain a missing tangent portfolio', () => {
    expect(exampleTangent(noTangent)).toContain('no tangent portfolio');
    expect(exampleSplit(noTangent)).toContain('risk-free fund');
    expect(examplePortfolio(noTangent)).toContain('2.0%');
  });
  it('historical model: the example shows the average, with the CAPM for comparison', () => {
    const h = { ...base, inputs: { ...base.inputs, return_model: 'historical' } } as Textbook;
    expect(exampleExpected(h)).toContain('10.4%');
    expect(exampleExpected(h)).toContain('7.0%');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- textbook`
Expected: FAIL (cannot resolve `./textbook`).

- [ ] **Step 3: Implement the transforms**

`frontend/src/components/textbook/textbook.ts`:

```ts
/** Pure transforms from the /api/textbook response to tables, chart series and worked-example text. */
import type { Schemas } from '../../api/client';
import type { ChartTable } from '../charts/ChartFrame';
import { decimal, percent } from '../charts/format';
import type { MixSlice } from '../charts/transforms';

export type Textbook = Schemas['TextbookPortfolio'];
export type ReturnModel = NonNullable<Schemas['TextbookRequest']['return_model']>;
export type Layer = 'frontier' | 'tangent' | 'split';
export interface XY { x: number; y: number; label?: string }

const WEEKS = 52;
const MAX_PREMIUM_PCT = 15;
const RISK_FREE = 'Risk-free fund';
const BLOCK_COLORS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)',
  'var(--accent)',
];
const RISK_FREE_COLOR = 'var(--ink-3)';

/** premiumPct is the percent typed by the user; NaN (empty or invalid input) leaves the field out. */
export function textbookRequest(
  base: Schemas['InvestorProfile']['base_currency'], riskLevel: number, model: ReturnModel, premiumPct: number,
): Schemas['TextbookRequest'] {
  const body: Schemas['TextbookRequest'] = { base_currency: base, risk_level: riskLevel, return_model: model };
  if (!Number.isNaN(premiumPct)) body.market_premium = Math.min(Math.max(premiumPct, 0), MAX_PREMIUM_PCT) / 100;
  return body;
}

// ---------- tables ----------

export function statsTable(t: Textbook): ChartTable {
  return {
    head: ['Building block', 'Fund', 'Average return', 'Volatility'],
    rows: t.funds.map((f) => [f.block, f.name, percent(f.mean_return), percent(f.volatility)]),
  };
}

export function correlationRows(t: Textbook): { head: string[]; rows: Array<{ label: string; cells: number[] }> } {
  const head = t.funds.map((f) => f.block);
  return { head, rows: t.correlation.matrix.map((cells, k) => ({ label: head[k], cells })) };
}

/** Cell background: blue for moving together, orange for moving apart, stronger the further from 0. */
export const corrShade = (v: number): string =>
  `color-mix(in srgb, var(${v >= 0 ? '--series-1' : '--series-2'}) ${Math.round(Math.min(Math.abs(v), 1) * 60)}%, transparent)`;

export function expectedTable(t: Textbook): ChartTable {
  return {
    head: ['Building block', 'Beta', 'CAPM return', 'Historical average'],
    rows: t.funds.map((f) => [f.block, decimal(f.beta), percent(f.capm_return), percent(f.mean_return)]),
  };
}

/** Column of expectedTable the optimiser used. */
export const usedColumn = (t: Textbook): number => (t.inputs.return_model === 'capm' ? 2 : 3);

export function tangentTable(t: Textbook): ChartTable {
  const w = t.tangent?.weights ?? {};
  return {
    head: ['Building block', 'Weight in the tangent portfolio'],
    rows: t.funds.filter((f) => (w[f.isin] ?? 0) > 0).map((f) => [f.block, percent(w[f.isin])]),
  };
}

export function weightSlices(t: Textbook): MixSlice[] {
  const w = t.portfolio.weights;
  const risky = t.funds.map((f, k) => ({ key: f.isin, label: f.block, value: w[f.isin] ?? 0, color: BLOCK_COLORS[k % BLOCK_COLORS.length] }));
  const rf = t.risk_free_fund;
  return [...risky, { key: rf.isin, label: RISK_FREE, value: w[rf.isin] ?? 0, color: RISK_FREE_COLOR }].filter((s) => s.value > 0);
}

export function weightsTable(t: Textbook): ChartTable {
  const names: Record<string, string> = { [t.risk_free_fund.isin]: t.risk_free_fund.name };
  for (const f of t.funds) names[f.isin] = f.name;
  return {
    head: ['Holding', 'Fund', 'Weight'],
    rows: weightSlices(t).map((s) => [s.label, names[s.key], percent(s.value)]),
  };
}

// ---------- chart series (percent units) ----------

/** Fraction -> percent without floating-point tails (0.07 * 100 is 7.000000000000001). */
const pc = (v: number): number => Number((v * 100).toFixed(4));
const xy = (p: { volatility: number; expected_return: number }, label?: string): XY => ({
  x: pc(p.volatility), y: pc(p.expected_return), ...(label ? { label } : {}),
});

export function chartSeries(t: Textbook, layer: Layer) {
  const tangent = layer !== 'frontier' ? t.tangent : null;
  return {
    funds: t.funds.map((f) => xy({ volatility: f.volatility, expected_return: f.expected_return }, f.block)),
    frontier: t.frontier.map((p) => xy(p)).sort((a, b) => a.x - b.x || a.y - b.y),
    riskFree: layer === 'frontier' ? [] : [{ x: 0, y: pc(t.inputs.rf), label: RISK_FREE }],
    cml: tangent ? t.capital_market_line.map((p) => xy(p)) : [],
    tangent: tangent ? [xy(tangent, 'Tangent portfolio')] : [],
    investor: layer === 'split' ? [xy(t.portfolio, 'Your portfolio')] : [],
  };
}

export function chartTable(t: Textbook, layer: Layer): ChartTable {
  const s = chartSeries(t, layer);
  const points = [...s.funds, ...s.riskFree, ...s.tangent, ...s.investor];
  return {
    head: ['Point', 'Volatility', 'Expected return'],
    rows: points.map((p) => [p.label ?? '', `${p.x.toFixed(1)}%`, `${p.y.toFixed(1)}%`]),
  };
}

export function chartDescription(layer: Layer): string {
  const base = 'Scatter chart of volatility against expected return, in percent: the seven funds and the efficient frontier of their mixes';
  if (layer === 'frontier') return `${base}.`;
  const line = `${base}, the risk-free fund, the capital market line and the tangent portfolio`;
  return layer === 'tangent' ? `${line}.` : `${line}, and your own portfolio on that line.`;
}

/** Security market line: beta against CAPM return, from the lowest to the highest beta shown (at least 0 to 1). */
export function smlSeries(t: Textbook) {
  const { rf, premium } = t.inputs;
  const betas = t.funds.map((f) => f.beta);
  const at = (beta: number): XY => ({ x: beta, y: pc(rf + beta * premium) });
  return {
    line: [at(Math.min(0, ...betas)), at(Math.max(1, ...betas))],
    funds: t.funds.map((f) => ({ x: f.beta, y: pc(f.capm_return), label: f.block })),
  };
}

// ---------- worked examples ----------

export function exampleStats(t: Textbook): string {
  const f = t.funds[0];
  return `${f.block}: the average weekly return is ${percent(f.mean_return / WEEKS, 2)}, times 52 gives ${percent(f.mean_return)} `
    + `a year. The weekly standard deviation is ${percent(f.volatility / Math.sqrt(WEEKS), 2)}, times √52 gives ${percent(f.volatility)} a year.`;
}

/** Half in each of the first two funds: the mix is less volatile than the average of the two. */
export function exampleCorrelation(t: Textbook): string {
  const [a, b] = t.funds;
  const rho = t.correlation.matrix[0][1];
  const mix = Math.sqrt(0.25 * a.volatility ** 2 + 0.25 * b.volatility ** 2 + 0.5 * rho * a.volatility * b.volatility);
  return `Half in ${a.block} (volatility ${percent(a.volatility)}) and half in ${b.block} (${percent(b.volatility)}), with a `
    + `correlation of ${decimal(rho)}: the mix has a volatility of ${percent(mix)}, against ${percent((a.volatility + b.volatility) / 2)} `
    + 'for the plain average of the two.';
}

export function exampleExpected(t: Textbook): string {
  const f = t.funds[0];
  const { rf, premium, return_model } = t.inputs;
  if (return_model === 'capm') return `${f.block}: ${percent(rf)} + ${decimal(f.beta)} × ${percent(premium)} = ${percent(f.capm_return)}.`;
  return `${f.block}: the average return over the window is ${percent(f.mean_return)}; the CAPM would say ${percent(f.capm_return)}.`;
}

export function exampleFrontier(t: Textbook): string {
  if (t.frontier.length === 0) return 'No frontier could be drawn for these funds.';
  const lowest = Math.min(...t.frontier.map((p) => p.volatility));
  const calmest = t.funds.reduce((a, b) => (b.volatility < a.volatility ? b : a));
  return `The lowest-risk mix has a volatility of ${percent(lowest)}; the calmest single fund, ${calmest.block}, has ${percent(calmest.volatility)}.`;
}

export function exampleTangent(t: Textbook): string {
  const g = t.tangent;
  if (!g) return `No fund is expected to earn more than the risk-free rate of ${percent(t.inputs.rf)}, so there is no tangent portfolio.`;
  return `(${percent(g.expected_return)} − ${percent(t.inputs.rf)}) / ${percent(g.volatility)} = ${decimal(g.sharpe)}`;
}

export function exampleSplit(t: Textbook): string {
  const g = t.tangent;
  if (!g) return 'Without a tangent portfolio there is nothing to split: everything goes to the risk-free fund.';
  const { risk_aversion, risky_share_uncapped: raw } = t.split;
  const formula = `y = (${percent(g.expected_return)} − ${percent(t.inputs.rf)}) / (${decimal(risk_aversion, 1)} × ${percent(g.volatility)}²) = ${percent(raw, 0)}`;
  if (raw > 1) return `${formula}, capped at 100% because this model does not borrow.`;
  return `${formula}.`;
}

export function examplePortfolio(t: Textbook): string {
  const g = t.tangent;
  const { rf } = t.inputs;
  if (!g) return `Everything is in the risk-free fund: the expected return is the risk-free rate of ${percent(rf)}.`;
  const y = percent(t.split.risky_share, 0);
  return `Expected return: ${percent(rf)} + ${y} × (${percent(g.expected_return)} − ${percent(rf)}) = ${percent(t.portfolio.expected_return)}. `
    + `Volatility: ${y} × ${percent(g.volatility)} = ${percent(t.portfolio.volatility)}.`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- textbook && npm run typecheck`
Expected: all textbook tests pass; typecheck passes.

Note: `Number('')` is `0`, not `NaN`. The page (Task 5) therefore converts an empty input to `NaN` itself before calling `textbookRequest`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/textbook/textbook.ts frontend/src/components/textbook/textbook.test.ts
git commit -m "feat(frontend): textbook portfolio transforms and worked examples"
```

---

### Task 5 (Lane F): components and page

**Files:**
- Create: `frontend/src/components/textbook/Step.tsx`
- Create: `frontend/src/components/textbook/copy.tsx`
- Create: `frontend/src/components/textbook/TextbookChart.tsx`
- Create: `frontend/src/components/textbook/textbook.css`
- Create: `frontend/src/pages/Textbook.tsx`
- Modify: `frontend/src/App.tsx` (import and route)
- Modify: `frontend/src/components/Layout.tsx` (menu link)
- Modify: `frontend/src/components/charts/UniverseFrontierChart.tsx:26` (export `Radio`)

**Interfaces:**
- Consumes from Task 4: everything exported by `textbook.ts`.
- Consumes (existing): `ChartFrame`, `Field`, `TableScroll`, `ChartTable` from `components/charts/ChartFrame`; `AssetMixDonut` from `components/charts/Donut`; `useRequest`, `useLastData`, `useDebounced` from `components/charts/hooks`; `ErrorBox`, `Loading` from `components/charts/Status`; `Card`, `PageHeader`, `Stat` from `components/ui`; `useStore` from `state/store`; `api` from `api/client`; `percent`, `decimal` from `components/charts/format`.
- Produces: `Step`, `DataTable` (from `Step.tsx`); `STEPS` (from `copy.tsx`); `RiskReturnChart`, `SmlChart` (from `TextbookChart.tsx`); default export `Textbook` page. The follow-up project reuses `Step` and `DataTable`.

- [ ] **Step 1: Export the radio group**

In `frontend/src/components/charts/UniverseFrontierChart.tsx`, change `function Radio<T extends string | number>({` to `export function Radio<T extends string | number>({`.

- [ ] **Step 2: Create the step layout**

`frontend/src/components/textbook/Step.tsx`:

```tsx
import { useId, type ReactNode } from 'react';
import { TableScroll, type ChartTable } from '../charts/ChartFrame';
import type { StepCopy } from './copy';
import './textbook.css';

/**
 * One explained calculation step: what we do, the formula with its source, a worked example with real numbers,
 * the result (children), and what to notice.
 */
export function Step({ n, copy, example, children }: { n: number; copy: StepCopy; example: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="card step" aria-labelledby={id}>
      <h2 id={id}><span className="step-n">{n}</span> {copy.title}</h2>
      <p>{copy.what}</p>
      <div className="step-formula">
        <div className="formula">{copy.formula}</div>
        <div className="small muted">{copy.source}</div>
      </div>
      <p className="step-example"><strong>Worked example.</strong> {example}</p>
      {children}
      <p className="step-notice"><strong>What to notice.</strong> {copy.notice}</p>
    </section>
  );
}

/** A ChartTable as a plain visible table; `highlight` marks one column (0-based) as the one in use. */
export function DataTable({ table, label, highlight }: { table: ChartTable; label: string; highlight?: number }) {
  const cls = (ci: number) => [ci > 0 ? 'num' : '', ci === highlight ? 'used' : ''].join(' ').trim() || undefined;
  return (
    <TableScroll label={label}>
      <table className="table">
        <thead>
          <tr>{table.head.map((h, ci) => <th key={h} scope="col" className={cls(ci)}>{h}{ci === highlight ? ' (used)' : ''}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci} className={cls(ci)}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
```

`frontend/src/components/textbook/textbook.css`:

```css
.step h2 { display: flex; align-items: baseline; gap: var(--space-3); }
.step-n { font-family: var(--font-mono); font-size: 0.8em; color: var(--ink-3); }
.step-formula { border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); padding: var(--space-3) var(--space-4); margin: var(--space-4) 0; overflow-x: auto; }
.formula { font-family: var(--font-display); font-size: 1.1rem; display: grid; gap: var(--space-2); }
.step-example, .step-notice { border-left: 3px solid var(--line); padding-left: var(--space-3); }
.step-notice { border-left-color: var(--accent); }
.table th.used, .table td.used { background: var(--surface-2); font-weight: 600; }
.corr td.num { text-align: center; min-width: 56px; }
.textbook-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-4); align-items: end; }
.textbook-controls input[type='range'] { width: 100%; }
.textbook-stale { opacity: 0.6; }
```

- [ ] **Step 3: Create the explanatory text**

`frontend/src/components/textbook/copy.tsx`:

```tsx
import type { ReactNode } from 'react';

export interface StepCopy {
  title: string;
  what: string;
  formula: ReactNode;
  source: string;
  notice: string;
}

export type StepKey = 'stats' | 'correlation' | 'expected' | 'frontier' | 'tangent' | 'split' | 'portfolio';

/** Explanatory text per step, in the course's notation (spec 2026-10-04 §6.3). */
export const STEPS: Record<StepKey, StepCopy> = {
  stats: {
    title: 'Returns and risk per fund',
    what: 'We start from five years of weekly returns for seven funds, one per asset class. For each fund we take the average return and the standard deviation, and scale both to a year.',
    formula: (
      <>
        <div>E[R] = average of R<sub>t</sub> × 52</div>
        <div>SD(R) = √Var(R<sub>t</sub>) × √52</div>
      </>
    ),
    source: 'Week 4, slides 52–54',
    notice: 'Funds with a higher average return tend to have a higher volatility, but not one for one. Five years is a short sample: these averages say more about the recent past than about the future.',
  },
  correlation: {
    title: 'How the funds move together',
    what: 'Risk in a portfolio depends on how the funds move together, not only on each fund’s own volatility. The correlation between two funds runs from −1 (opposite) to +1 (in step).',
    formula: (
      <div>
        Var(R<sub>P</sub>) = x<sub>1</sub><sup>2</sup>σ<sub>1</sub><sup>2</sup> + x<sub>2</sub><sup>2</sup>σ<sub>2</sub><sup>2</sup> + 2x<sub>1</sub>x<sub>2</sub>ρ<sub>12</sub>σ<sub>1</sub>σ<sub>2</sub>
      </div>
    ),
    source: 'Week 4, slides 60–63',
    notice: 'As long as a correlation is below 1, mixing two funds gives less risk than the average of the two. The lowest numbers in the table are where diversification helps most.',
  },
  expected: {
    title: 'Expected returns',
    what: 'The optimiser needs an expected return per fund. The CAPM says a fund earns the risk-free rate plus a reward for the market risk it carries, measured by its beta. The alternative is to assume the past average repeats.',
    formula: (
      <>
        <div>E[R<sub>i</sub>] = r<sub>f</sub> + β<sub>i</sub> × (E[R<sub>Mkt</sub>] − r<sub>f</sub>)</div>
        <div>β<sub>i</sub> = Cov(R<sub>i</sub>, R<sub>Mkt</sub>) / Var(R<sub>Mkt</sub>)</div>
      </>
    ),
    source: 'Week 4, slide 69; week 5, slides 6–28',
    notice: 'Compare the two columns. CAPM returns stay in a narrow, plausible range; historical averages swing widely, and some are negative. Switch the model at the top and watch what the rest of the page does.',
  },
  frontier: {
    title: 'The efficient frontier',
    what: 'For every level of expected return there is one mix of the seven funds with the lowest possible risk. Those best mixes together form the efficient frontier. Weights are between 0 and 1 and add up to 1.',
    formula: <div>minimise SD(R<sub>P</sub>) for each E[R<sub>P</sub>], with Σx<sub>i</sub> = 1 and 0 ≤ x<sub>i</sub> ≤ 1</div>,
    source: 'Week 4, slides 64–65',
    notice: 'The curve lies to the left of the individual funds: a mix reaches the same return with less risk. Any portfolio below the curve can be improved without giving anything up.',
  },
  tangent: {
    title: 'The tangent portfolio',
    what: 'Add a risk-free fund and every investor can do better than the frontier alone: combine the risk-free fund with the one mix that has the highest Sharpe ratio. The straight line through both is the capital market line.',
    formula: <div>Sharpe ratio = (E[R<sub>P</sub>] − r<sub>f</sub>) / SD(R<sub>P</sub>)</div>,
    source: 'Week 4, slide 66',
    notice: 'The line touches the frontier in exactly one point. Every investor holds the same mix of risky funds; only the amount differs. Under the CAPM this mix sits close to the market itself.',
  },
  split: {
    title: 'Your split',
    what: 'How much goes into the tangent portfolio depends on your risk aversion A. Maximising utility along the capital market line gives the share y; the rest goes to the risk-free fund.',
    formula: (
      <>
        <div>U = E(r<sub>p</sub>) − ½Aσ<sup>2</sup></div>
        <div>y = (E[R<sub>T</sub>] − r<sub>f</sub>) / (A × σ<sub>T</sub><sup>2</sup>)</div>
      </>
    ),
    source: 'Week 4, slides 64 and 66',
    notice: 'A lower A (more appetite for risk) or a better tangent portfolio raises the share. The theory would let y go above 100% by borrowing at the risk-free rate; this tool stops at 100%.',
  },
  portfolio: {
    title: 'Your textbook portfolio',
    what: 'Multiply the tangent weights by your share and put the remainder in the risk-free fund. Because that fund has no volatility in the model, risk and excess return both scale with the share.',
    formula: (
      <>
        <div>E[R] = r<sub>f</sub> + y × (E[R<sub>T</sub>] − r<sub>f</sub>)</div>
        <div>SD(R) = y × σ<sub>T</sub></div>
      </>
    ),
    source: 'Week 4, slide 66',
    notice: 'Your Sharpe ratio equals the tangent portfolio’s whatever your share: moving along the line changes how much risk you take, not how well it is rewarded.',
  },
};
```

- [ ] **Step 4: Create the charts**

`frontend/src/components/textbook/TextbookChart.tsx`:

```tsx
import { CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from '../charts/ChartFrame';
import { chartDescription, chartSeries, chartTable, smlSeries, type Layer, type Textbook, type XY } from './textbook';

const AXIS_TICK = { fill: 'var(--ink-3)', fontSize: 12 };
const pct = (v: number) => `${v.toFixed(1)}%`;
const LEGEND = { paddingBottom: 8, fontSize: 13 };
const legendText = (v: unknown) => <span style={{ color: 'var(--ink-2)' }}>{String(v)}</span>;
/** Lines are Scatter series without a point shape, so they never catch the hover. */
const NoPoint = () => <g />;

function PointTip({ active, payload, xName, xFormat }: {
  active?: boolean; payload?: ReadonlyArray<{ payload?: XY }>; xName: string; xFormat: (v: number) => string;
}) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p?.label) return null;
  return (
    <div className="tip">
      <div className="tip-title">{p.label}</div>
      <div>{xName}: <span className="num">{xFormat(p.x)}</span></div>
      <div>Expected return: <span className="num">{pct(p.y)}</span></div>
    </div>
  );
}

/** Funds and frontier; from 'tangent' also the risk-free fund, capital market line and tangent; from 'split' your portfolio. */
export function RiskReturnChart({ t, layer, title }: { t: Textbook; layer: Layer; title: string }) {
  const s = chartSeries(t, layer);
  return (
    <ChartFrame title={title} description={chartDescription(layer)} table={chartTable(t, layer)}>
      <ResponsiveContainer width="100%" height={360}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x" type="number" domain={[0, 'auto']} tickFormatter={pct} tick={AXIS_TICK} stroke="var(--line)"
            name="Volatility" tickCount={6}
            label={{ value: 'Volatility (per year)', position: 'insideBottom', offset: -10, fill: 'var(--ink-3)', fontSize: 12 }}
          />
          <YAxis dataKey="y" type="number" domain={['auto', 'auto']} tickFormatter={pct} tick={AXIS_TICK} stroke="var(--line)" width={56} name="Expected return" />
          <Tooltip content={<PointTip xName="Volatility" xFormat={pct} />} cursor={false} />
          <Legend verticalAlign="top" wrapperStyle={LEGEND} itemSorter={null} formatter={legendText} />
          <Scatter
            data={s.frontier} dataKey="y" name="Efficient frontier" legendType="plainline" fill="var(--ink-2)"
            line={{ stroke: 'var(--ink-2)', strokeWidth: 2 }} shape={NoPoint} isAnimationActive={false}
          />
          {s.cml.length > 0 && (
            <Scatter
              data={s.cml} dataKey="y" name="Capital market line" legendType="plainline" fill="var(--ink-3)"
              line={{ stroke: 'var(--ink-3)', strokeWidth: 1.5, strokeDasharray: '2 4' }} shape={NoPoint} isAnimationActive={false}
            />
          )}
          <Scatter data={s.funds} dataKey="y" name="Funds" fill="var(--series-1)" isAnimationActive={false} />
          {s.riskFree.length > 0 && <Scatter data={s.riskFree} dataKey="y" name="Risk-free fund" shape="square" fill="var(--ink-3)" isAnimationActive={false} />}
          {s.tangent.length > 0 && <Scatter data={s.tangent} dataKey="y" name="Tangent portfolio" shape="diamond" fill="var(--series-2)" isAnimationActive={false} />}
          {s.investor.length > 0 && <Scatter data={s.investor} dataKey="y" name="Your portfolio" shape="star" fill="var(--series-3)" isAnimationActive={false} />}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

const beta = (v: number) => v.toFixed(2);

/** Security market line: every fund's CAPM return lies on the line through (0, rf) with slope = market premium. */
export function SmlChart({ t }: { t: Textbook }) {
  const s = smlSeries(t);
  return (
    <ChartFrame
      title="Security market line"
      description="Scatter chart of beta against CAPM expected return in percent; all seven funds lie on one straight line."
    >
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x" type="number" domain={['auto', 'auto']} tickFormatter={beta} tick={AXIS_TICK} stroke="var(--line)" name="Beta"
            label={{ value: 'Beta', position: 'insideBottom', offset: -10, fill: 'var(--ink-3)', fontSize: 12 }}
          />
          <YAxis dataKey="y" type="number" domain={['auto', 'auto']} tickFormatter={pct} tick={AXIS_TICK} stroke="var(--line)" width={56} name="Expected return" />
          <Tooltip content={<PointTip xName="Beta" xFormat={beta} />} cursor={false} />
          <Scatter
            data={s.line} dataKey="y" name="Security market line" fill="var(--ink-2)"
            line={{ stroke: 'var(--ink-2)', strokeWidth: 2 }} shape={NoPoint} isAnimationActive={false}
          />
          <Scatter data={s.funds} dataKey="y" name="Funds" fill="var(--series-1)" isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
```

- [ ] **Step 5: Create the page**

`frontend/src/pages/Textbook.tsx`:

```tsx
import { useState } from 'react';
import { api } from '../api/client';
import { Field } from '../components/charts/ChartFrame';
import { AssetMixDonut } from '../components/charts/Donut';
import { decimal, percent } from '../components/charts/format';
import { useDebounced, useLastData, useRequest } from '../components/charts/hooks';
import { ErrorBox, Loading } from '../components/charts/Status';
import { Radio } from '../components/charts/UniverseFrontierChart';
import { Card, PageHeader, Stat } from '../components/ui';
import { STEPS } from '../components/textbook/copy';
import { DataTable, Step } from '../components/textbook/Step';
import { RiskReturnChart, SmlChart } from '../components/textbook/TextbookChart';
import {
  corrShade, correlationRows, exampleCorrelation, exampleExpected, exampleFrontier, examplePortfolio, exampleSplit,
  exampleStats, exampleTangent, expectedTable, statsTable, tangentTable, textbookRequest, usedColumn, weightSlices,
  weightsTable, type ReturnModel, type Textbook as TextbookData,
} from '../components/textbook/textbook';
import { useStore } from '../state/store';
import '../components/charts/results.css';
import '../components/textbook/textbook.css';

const MODELS: readonly ReturnModel[] = ['capm', 'historical'];
const MODEL_LABEL: Record<ReturnModel, string> = { capm: 'CAPM', historical: 'Historical average' };
const Note = ({ children }: { children: string }) => <p className="small muted">{children}</p>;

function Steps({ t }: { t: TextbookData }) {
  const corr = correlationRows(t);
  const capm = t.inputs.return_model === 'capm';
  return (
    <div className="stack">
      {(t.warnings ?? []).length > 0 && (
        <div className="banner"><ul>{(t.warnings ?? []).map((w) => <li key={w}>{w}</li>)}</ul></div>
      )}

      <Step n={1} copy={STEPS.stats} example={exampleStats(t)}>
        <DataTable table={statsTable(t)} label="Average return and volatility per fund" />
        <Note>{`Based on ${t.inputs.weeks} weekly returns from ${t.inputs.window.start} to ${t.inputs.window.end}. The course’s examples use monthly returns; weekly gives more observations with the same method.`}</Note>
      </Step>

      <Step n={2} copy={STEPS.correlation} example={exampleCorrelation(t)}>
        <div className="table-scroll" role="region" aria-label="Correlation between the funds" tabIndex={0}>
          <table className="table corr">
            <thead>
              <tr><th scope="col" />{corr.head.map((h) => <th key={h} scope="col" className="num">{h}</th>)}</tr>
            </thead>
            <tbody>
              {corr.rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {r.cells.map((v, k) => <td key={k} className="num" style={{ background: corrShade(v) }}>{decimal(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Step>

      <Step n={3} copy={STEPS.expected} example={exampleExpected(t)}>
        <DataTable table={expectedTable(t)} label="Beta and expected return per fund" highlight={usedColumn(t)} />
        {capm && <SmlChart t={t} />}
        <Note>{`Risk-free rate ${percent(t.inputs.rf)}, market premium ${percent(t.inputs.premium)}, market: ${t.inputs.market.name}. Betas come from weekly returns; the course’s examples use monthly.`}</Note>
        {!capm && <Note>Five years of averages are noisy. Watch how the tangent portfolio below concentrates in whatever did best recently.</Note>}
      </Step>

      <Step n={4} copy={STEPS.frontier} example={exampleFrontier(t)}>
        <RiskReturnChart t={t} layer="frontier" title="The seven funds and their efficient frontier" />
      </Step>

      <Step n={5} copy={STEPS.tangent} example={exampleTangent(t)}>
        <RiskReturnChart t={t} layer="tangent" title="The capital market line and the tangent portfolio" />
        {t.tangent && <DataTable table={tangentTable(t)} label="Weights of the tangent portfolio" />}
      </Step>

      <Step n={6} copy={STEPS.split} example={exampleSplit(t)}>
        <div className="row" style={{ gap: 'var(--space-6)' }}>
          <Stat label="Risk aversion A" value={decimal(t.split.risk_aversion, 1)} />
          <Stat label="Share from the formula" value={percent(t.split.risky_share_uncapped, 0)} />
          <Stat label="Share used" value={percent(t.split.risky_share, 0)} hint="between 0% and 100%" />
        </div>
        <RiskReturnChart t={t} layer="split" title="Your portfolio on the capital market line" />
        <Note>The scale for A (10 for the most cautious investor, 2 for the most adventurous) is this tool’s assumption; the slides give no numbers.</Note>
        <Note>What counts as risk-free depends on the horizon. Over a single period it is a T-bill; for a ten-year goal a ten-year government bond held to maturity is closer. This model takes the one-period view.</Note>
      </Step>

      <Step n={7} copy={STEPS.portfolio} example={examplePortfolio(t)}>
        <div className="row" style={{ gap: 'var(--space-6)' }}>
          <Stat label="Expected return" value={percent(t.portfolio.expected_return)} />
          <Stat label="Volatility" value={percent(t.portfolio.volatility)} />
          <Stat label="Sharpe ratio" value={decimal(t.portfolio.sharpe)} />
        </div>
        <AssetMixDonut slices={weightSlices(t)} />
        <DataTable table={weightsTable(t)} label="Weights of your textbook portfolio" />
        <Note>{`The risk-free fund (${t.risk_free_fund.name}) had a volatility of ${percent(t.risk_free_fund.volatility, 2)} over the window; the model treats it as zero.`}</Note>
      </Step>
    </div>
  );
}

export default function Textbook() {
  const [{ profile }] = useStore();
  const [risk, setRisk] = useState(profile.risk_level);
  const [model, setModel] = useState<ReturnModel>('capm');
  const [premium, setPremium] = useState('5');
  const body = textbookRequest(profile.base_currency, risk, model, premium.trim() === '' ? Number.NaN : Number(premium));
  const key = useDebounced(JSON.stringify(body), 300);
  const { state, reload } = useRequest(
    (signal) => api.POST('/api/textbook', { body: JSON.parse(key) as typeof body, signal }),
    key,
  );
  const last = useLastData(state, key);

  return (
    <>
      <PageHeader
        title="Textbook portfolio"
        lead="The portfolio you get from portfolio theory and the CAPM alone, built step by step from seven funds and a risk-free fund. It ignores your preferences and the main engine’s refinements."
      />
      <div className="stack">
        <Card title="Inputs">
          <div className="textbook-controls">
            <Field label={`Risk level: ${Math.round(risk)}`} hint="0 is the most cautious, 100 the most adventurous">
              <input type="range" min={0} max={100} step={1} value={risk} onChange={(e) => setRisk(Number(e.target.value))} />
            </Field>
            <div className="field">
              <span className="small muted">Expected returns</span>
              <Radio<ReturnModel> label="Expected returns" options={MODELS} value={model} onChange={setModel} fmt={(m) => MODEL_LABEL[m]} />
            </div>
            <Field label="Market premium (%)" hint="0 to 15; the slides give 5–7% historical, 3–5% in practice">
              <input type="number" min={0} max={15} step={0.5} value={premium} onChange={(e) => setPremium(e.target.value)} />
            </Field>
          </div>
        </Card>
        {state.status === 'error' && <ErrorBox message={state.message} onRetry={reload} />}
        {last
          ? <div className={state.status === 'loading' ? 'textbook-stale' : undefined}><Steps t={last.data} /></div>
          : state.status === 'loading' && <Loading />}
      </div>
    </>
  );
}
```

- [ ] **Step 6: Add the route and the menu link**

In `frontend/src/App.tsx`, import the page next to the other page imports, in the same style they use (plain or lazy), and add the route after the backtest route:

```tsx
        <Route path="textbook" element={<Textbook />} />
```

In `frontend/src/components/Layout.tsx`, after the Backtest link:

```tsx
          <NavLink to="/textbook">Textbook</NavLink>
```

- [ ] **Step 7: Typecheck, test and build**

Run: `cd frontend && npm run typecheck && npm test && npm run build`
Expected: all pass. Fix type errors in the new files only; do not change `schema.d.ts` by hand.

Known typing points:
- recharts `Scatter` `shape` accepts `"square" | "diamond" | "star"` and a component; if `shape={NoPoint}` is rejected, copy the exact pattern used in `UniverseFrontierChart.tsx`.
- `t.portfolio.sharpe` may be `null`; `decimal` accepts null and prints `–`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/textbook frontend/src/pages/Textbook.tsx frontend/src/App.tsx frontend/src/components/Layout.tsx frontend/src/components/charts/UniverseFrontierChart.tsx
git commit -m "feat(frontend): textbook portfolio page with seven explained steps"
```

---

### Task 6: Integration

**Files:**
- Modify: `backend/scripts/export_contract.py`
- Modify: `backend/tests/test_export_contract.py`
- Create (generated): `frontend/src/mocks/textbook.json`
- Modify: `frontend/src/mocks/index.ts`
- Create: `frontend/e2e/textbook.pw.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `textbook.textbook(...)` (Task 3), `SYN_TEXTBOOK_FUNDS` (Task 1), the page at `/textbook` (Task 5).
- Produces: the `textbook` mock served for `POST /api/textbook` in mock mode.

- [ ] **Step 1: Write the failing mock test**

In `backend/tests/test_export_contract.py`, add `TextbookPortfolio` to the `from app.engine.types import ...` line and append:

```python
def test_textbook_mock(mocks):
    tb = TextbookPortfolio.model_validate(mocks["textbook"])
    assert len(tb.funds) == 7 and tb.tangent is not None and len(tb.frontier) >= 5
    assert 0 < tb.split.risky_share < 1  # the demo shows a real split, not a corner
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && uv run pytest tests/test_export_contract.py::test_textbook_mock -q`
Expected: FAIL with `KeyError: 'textbook'`.

- [ ] **Step 3: Export the mock**

In `backend/scripts/export_contract.py`:

```python
from app.engine import pipeline, textbook
```

```python
from tests.fixtures.synthetic import SYN_TEXTBOOK_FUNDS, SyntheticData
```

In `build_mocks`, after the `universe_frontier = ...` line:

```python
    with mock.patch.object(config, "TEXTBOOK_FUNDS", SYN_TEXTBOOK_FUNDS):
        textbook_portfolio = textbook.textbook("EUR", DEMO_PROFILE.risk_level, "capm", None, data)
```

and in the returned dict:

```python
        "textbook": dump(textbook_portfolio),
```

- [ ] **Step 4: Run the test, then generate the files**

Run: `cd backend && uv run pytest tests/test_export_contract.py -q && uv run python -m scripts.export_contract`
Expected: tests pass; `frontend/src/mocks/textbook.json` exists.

If `0 < risky_share < 1` fails because the synthetic market gives a share of 100% at risk level 50, lower the demo risk level in the `textbook.textbook(...)` call (for example to 20) until it holds, and keep the assertion.

- [ ] **Step 5: Serve the mock**

In `frontend/src/mocks/index.ts`:

```ts
import textbook from './textbook.json';
```

and in `routes`:

```ts
  'POST /api/textbook': textbook,
```

- [ ] **Step 6: Write the browser test**

`frontend/e2e/textbook.pw.ts`:

```ts
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

for (const width of [1280, 360]) {
  test(`textbook: seven explained steps at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/textbook');
    await expect(page.getByRole('heading', { name: 'Textbook portfolio' })).toBeVisible();
    await expect(page.locator('.step')).toHaveCount(7, { timeout: 20_000 });
    await expect(page.locator('.step h2')).toContainText([
      'Returns and risk per fund', 'How the funds move together', 'Expected returns', 'The efficient frontier',
      'The tangent portfolio', 'Your split', 'Your textbook portfolio',
    ]);
    await expect(page.locator('.step .step-formula')).toHaveCount(7);
    await expect(page.getByText('Worked example.')).toHaveCount(7);
    await expect(page.locator('.step').nth(3).locator('.recharts-scatter .recharts-symbols').first()).toBeVisible();
    await expect(page.locator('.corr tbody tr')).toHaveCount(7);
    await expect(page.locator('th.used')).toContainText('CAPM return');
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}

test('textbook: the menu links to the page and the controls keep it alive', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Textbook' }).click();
  await expect(page).toHaveURL(/\/textbook/);
  await expect(page.locator('.step')).toHaveCount(7, { timeout: 20_000 });
  await page.getByRole('radio', { name: 'Historical average' }).check();
  await page.getByLabel('Market premium (%)').fill('');
  await page.getByLabel(/Risk level/).press('ArrowRight'); // a range input cannot be filled
  await expect(page.locator('.step')).toHaveCount(7);
  expect(errors).toEqual([]);
});
```

The mock always returns the CAPM answer, so the browser test cannot see the highlighted column move; that is covered by `usedColumn` in the Vitest suite.

- [ ] **Step 7: Run the browser tests**

Run: `cd frontend && npm run e2e -- textbook`
Expected: 3 passed. A failure of `expectNoHorizontalScroll` at 360 px is a real layout bug: fix the CSS in `textbook.css` (the formula box and tables already scroll inside themselves), not the test.

- [ ] **Step 8: Check the real page once**

Run the backend (`cd backend && uv run python -m app.main`) and the frontend (`cd frontend && npm run dev`), open `http://localhost:5740/textbook` and confirm: seven steps render with real funds; dragging the risk slider keeps the old result visible (dimmed) until the new one arrives; switching to Historical moves the "(used)" column and changes the tangent weights; clearing the premium field does not produce an error. If there is no local database, say so in the report instead of claiming this step.

- [ ] **Step 9: Document**

In `README.md`, add after the "Comparisons and the efficient frontier" section:

```markdown
## Textbook portfolio

The Textbook page (`/textbook`) builds a portfolio with only the method from the course: average returns,
volatilities and correlations of seven funds, expected returns from the CAPM (or historical averages), the
efficient frontier, the tangent (maximum Sharpe) portfolio, and a split between that portfolio and a risk-free
fund set by risk aversion `A = 10 − 8 × risk level / 100`. Each step shows the formula, the slide it comes from,
a worked example and the numbers.

It differs from the main engine on purpose: a fixed fund set (`TEXTBOOK_FUNDS` in `backend/app/config.py`), plain
sample covariance, no cost penalty, no position limits and no investor preferences. It uses weekly returns over the
last five years, where the course's examples use monthly data.
```

- [ ] **Step 10: Run everything and commit**

Run: `cd backend && uv run pytest -q && cd ../frontend && npm run typecheck && npm test && npm run build`
Expected: all pass.

```bash
git add backend/scripts/export_contract.py backend/tests/test_export_contract.py backend/openapi.json frontend/src/mocks frontend/e2e/textbook.pw.ts README.md
git commit -m "feat: textbook portfolio mock, browser tests and docs"
```
