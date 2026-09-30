# Comparisons, 5-Year View and Efficient Frontier — Design Spec

Date: 2026-09-30
Status: approved in brainstorming (approach A)
Builds on: `2026-09-29-roboadvisor-design.md` (v1, tag `v1.0.0-rc2`)

## 1. Goal

Give every number a yardstick and explain *why* the portfolio was chosen:

1. Show the portfolio next to two reference indices — **World equities** and the **S&P 500** — with the
   same metrics, everywhere a backtest is shown.
2. A **"Last N years"** section on the Portfolio page (default 5 years) with a growth chart and metrics.
3. A short plain-language **"How to read these numbers"** guide (Sharpe, volatility, drawdown, CAGR)
   next to the live reference values.
4. An **efficient frontier** chart with two curves — **model** (CAPM expected returns, what the optimizer
   uses) and **hindsight** (historical mean returns over the last N years) — plus markers for the
   portfolio, the references, the comparison strategies and the individual eligible funds.
5. Fixes: the backtest **drawdown chart** plots the wrong series (axis 60–180%); the **holdings table**
   is too narrow and needs horizontal scrolling on a laptop.

Non-goals: new reference indices beyond World and S&P 500; persisting results; changing how the
portfolio is chosen.

## 2. Reference indices

Config (`app/config.py`), by ISIN, used for both base currencies (prices are converted like any fund):

```python
REFERENCES = {
    "world": {"label": "World equities (MSCI World)", "isin": "IE00B4L5Y983"},   # iShares Core MSCI World, from 2009-09
    "sp500": {"label": "S&P 500", "isin": "IE00B5BMR087"},                        # iShares Core S&P 500, from 2010-05
}
```

- Both ISINs exist in `etfs.csv`; a test asserts that. Listing choice uses the same rule as any fund
  (base-currency listing first, then primary).
- Reference series are **buy-and-hold of the single ETF, no costs**, over the same window as the
  portfolio. If the ETF's history (own + proxy) starts after the window start, the reference series
  starts later and the result carries `start` accordingly (never zero-filled).
- References are independent of the investor's filters (ESG, UCITS, regions…): they are yardsticks,
  not candidates.

## 3. API changes (additive only)

### 3.1 `BacktestResult.references` (new optional field)

```python
class ReferenceResult(BaseModel):
    key: str            # "world" | "sp500"
    label: str
    isin: str
    ticker: str
    start: date         # first date of this reference's series (≥ backtest start)
    values: list[float | None]   # growth of 1.0, aligned to BacktestSeries.dates; None before `start`
    metrics: dict[str, float | None]   # same REGISTRY keys as the portfolio (cagr, volatility, sharpe,
                                       # sortino, max_drawdown, max_drawdown_duration, cvar_95, calmar)
                                       # computed over the reference's own window

class BacktestResult(BaseModel):
    ...existing fields...
    references: list[ReferenceResult] = []
```

- Filled by `pipeline.backtest` for every mode. Metrics use the same weekly rf as the portfolio.
- Adding a field changes `openapi.json` → regenerate it, the mocks and `schema.d.ts`; the drift test
  keeps them in sync.

### 3.2 `POST /api/frontier` (new)

Request: `FrontierRequest { profile: InvestorProfile, settings: EngineSettings = {}, lookback_years: int = 5 (1..15), points: int = 20 (5..40) }`

Response `Frontier`:

```python
class FrontierPoint(BaseModel):
    volatility: float
    expected_return: float        # annual, total (incl. rf)
    sharpe: float | None

class FrontierMarker(BaseModel):
    key: str                      # "portfolio" | "world" | "sp500" | "min_variance" | "max_sharpe" |
                                  # "risk_parity" | "hrp" | "fund:<isin>"
    label: str
    kind: Literal["portfolio", "reference", "strategy", "fund"]
    model: FrontierPoint          # position under CAPM expected returns + covariance
    hindsight: FrontierPoint      # position under historical mean returns (lookback) + covariance

class Frontier(BaseModel):
    model_curve: list[FrontierPoint]      # sorted by volatility
    hindsight_curve: list[FrontierPoint]
    capital_market_line: list[FrontierPoint]   # two points: (0, rf) and max-Sharpe on the model curve, extended to max vol
    markers: list[FrontierMarker]
    rf: float
    lookback: dict[str, date]             # {"start": ..., "end": ...} of the hindsight window
    warnings: list[str] = []
    trace: list[StepResult] = []
```

Computation (`pipeline.frontier`), reusing the recommend steps (universe, candidates incl. dedupe and
min-history, weekly returns, covariance, CAPM, constraints):

- **Model curve:** for `points` target vols evenly spaced between the min-variance vol and the
  max-return vol (same constraints as the portfolio, cardinality included), run `optimize(mu_excess, cov,
  constraints, "target_vol")`; record ex-ante vol and total expected return (excess + rf).
- **Hindsight curve:** same procedure with `mu_hist` = annualised mean weekly return over the last
  `lookback_years` (minus rf for the optimizer, plus rf for display), same covariance.
- **Markers:** portfolio (the recommendation's weights), references (single-fund weights; their
  model/hindsight expected return from their own CAPM beta / historical mean, vol from their own weekly
  returns over the estimation window — references may be outside the candidate set), each comparison
  strategy's weights, and each candidate fund.
- A `target_vol` that the solver cannot reach is skipped (not an error); curves may have fewer points.
- Must finish in ≤ 3 s warm on the real DB (≈80 EUR candidates).

## 4. Frontend

### 4.1 Portfolio page

Order: summary cards → mix donut → **holdings (full width)** → **Last N years** → **Efficient frontier**
→ downside panel → trace.

- **Holdings table:** full-width row (no shared grid column); name column wraps; numeric columns
  compact; no horizontal scroll at ≥ 1024 px; still scrolls inside its card at 360 px.
- **Last N years:** period switch 1/3/5/10/15 years (default 5) → `POST /api/backtest` static,
  start = today − N years; growth chart with three lines (portfolio, World, S&P 500 — series tokens,
  legend, table view); metrics table with columns Portfolio / World / S&P 500 and rows CAGR,
  volatility, Sharpe, max drawdown; short text when a reference starts late.
- **How to read these numbers** (collapsible, open by default on first view): 4 plain sentences —
  Sharpe (return above cash per unit of risk; long-run world equities ≈ 0.3–0.5; above 1 sustained is
  rare), volatility (typical yearly swing; world equities ≈ 15%), max drawdown (worst fall from a peak;
  world equities fell ≈ 34% in 2020 and ≈ 55% in 2008–09), CAGR (average yearly growth). The table
  next to it provides the live reference values for the chosen period.
- **Efficient frontier:** scatter/line chart (x = volatility, y = expected return, both %): model curve
  (solid), hindsight curve (dashed), capital market line (dotted), portfolio (large marker), references
  and strategies (labelled markers), funds (small faint dots, toggle "Show individual funds").
  A switch "Positions: model / hindsight" moves markers between their two frames. Lookback selector
  1/3/5/10 years. Caption (2–3 sentences): the portfolio sits on the model curve by construction;
  the hindsight curve shows what would have been best with perfect knowledge; the gap is the price of
  not knowing the future. Table view lists every marker with both positions.
  Loaded independently (own loading/error state) so the page renders first.

### 4.2 Backtest page

- Growth chart: add World and S&P 500 lines (after `start`).
- Metrics table: add World and S&P 500 columns.
- **Drawdown chart bug:** the chart shows values on a 60–180% axis — it must show the portfolio's
  drawdown series (≤ 0%). Root-cause it (series selection / axis formatting) and add a transform test.

### 4.3 Accessibility and design

Same tokens, chart frames (title, description, table fallback), keyboard-reachable controls; chart
colours from the validated palette (portfolio = series-1, World = series-2, S&P 500 = series-3,
strategies = series-4/5/6, funds = ink-3 at low opacity).

## 5. Testing

- Backend: references present for static and walk-forward, aligned to dates, None before `start`,
  metrics keys equal REGISTRY keys; references ignore investor filters (ESG-only profile still gets
  both); `/api/frontier` on synthetic data: curves sorted by vol, model curve monotone non-decreasing
  in return, portfolio marker lies on/under the model curve within tolerance, hindsight curve ≥ model
  curve positions of the same weights under hindsight returns (sanity), markers include all kinds,
  no NaN (allow_nan=False); performance on real DB (skipped without DB) ≤ 3 s warm.
- Contract: openapi drift + signature snapshot updated deliberately (new route/model), mocks
  regenerated (add `frontier.json` mock and route in `mocks/index.ts`).
- Frontend: transform tests (reference rows, frontier point mapping, drawdown series), e2e: Portfolio
  page shows the 5-year chart with 3 lines and the frontier chart; holdings table has no horizontal
  scroll at 1280 px; drawdown chart axis ≤ 0%.
