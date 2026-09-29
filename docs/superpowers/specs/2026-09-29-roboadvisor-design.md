# Robo-Advisor v1 — Design Spec

Date: 2026-09-29
Status: approved in brainstorming, pending spec review

## 1. Goal

A robo-advisor that turns an investor profile (continuous risk level + preferences) into a
recommended ETF portfolio, and proves it with explainable metrics, downside probabilities and
historical backtests. The engine and its calculations are the core of the project.

Later phases (not v1, but the design must not block them):
- **Teaching tool**: every calculation step must be inspectable so written explanations can be
  attached per step (see `trace`, §5.10).
- **Voice/avatar intake agent**: a second intake channel that fills the same `InvestorProfile`
  (see §8.1).
- Paid data feed, accounts, persisted portfolios, holdings-level sector data.

Non-goals for v1: user accounts/login, server-side persistence of results, scheduled data
updates, regulatory suitability record-keeping, i18n, mobile-optimised layouts.

## 2. Key decisions

| Topic | Decision |
|---|---|
| Users | No accounts, no login. Stateless API. |
| Data source | yfinance (free) + a curated ETF list (~300–500 funds, global). ECB API for EUR risk-free rate. |
| Ingestion | Manual CLI run, incremental. No scheduler. |
| Storage | One SQLite file. |
| History | Download the maximum available (many core ETFs go back to 2001–2004). Backtests default to the last 15 years; stress tests and bootstrap use all data. |
| Base currencies | EUR and USD. |
| Risk level | Continuous 0–100, decided in intake. The engine respects it and never re-scores. |
| Risk → portfolio | Risk level maps linearly to a target volatility (default 2%–20%). Optimizer maximises expected return at that volatility, subject to preferences. Asset mix is an output. |
| Expected returns | CAPM with two presets: `capm_equity` (equity-only market) and `capm_multi_asset` (default; equity + bond market = Black-Litterman equilibrium). |
| Covariance | Ledoit-Wolf shrinkage on weekly base-currency returns, 5-year window by default. |
| Rebalancing | A backtest option: `none` (default), `periodic`, `threshold`. |
| Crypto | Included as an asset class, opt-in, capped (default 5%), not allowed below risk level 40. |
| Costs | TER tracked per fund. Prices are already net of TER (never deducted twice). TER is used as an optimizer penalty and reported. Transaction costs are applied in backtests. |
| Stack | FastAPI + pandas/numpy + PyPortfolioOpt; React + Vite + TypeScript + Recharts. |
| Ports | Backend **8740**, frontend **5740** (Vite `strictPort: true`, proxies `/api` → 8740). |

## 3. Repository layout

```
roboadvisor/
  backend/
    pyproject.toml
    app/
      main.py            # FastAPI app, routers, domain-error handler
      config.py          # all defaults (§9)
      api/
        schemas.py       # Pydantic request/response models = the contract (§7)
        intake.py  universe.py  portfolio.py  backtest.py  health.py
      intake/
        questionnaire.json
        scoring.py
      engine/
        types.py         # dataclasses shared by engine modules (§5.0)
        errors.py        # DomainError subclasses
        universe.py  returns.py  risk.py  expected.py  optimize.py
        metrics.py  downside.py  backtest.py  trace.py  pipeline.py
      data/
        schema.sql  db.py  ingest.py  sources.py  quality.py
    data/
      etfs.csv           # curated universe, committed
      roboadvisor.db     # git-ignored
    tests/
      fixtures/synthetic.py   # synthetic funds/prices/fx/rf + fixture DB builder
  frontend/
    src/
      api/        # generated types + openapi-fetch client + mock mode
      state/      # InvestorProfile store
      intake/     # intake channels (FormWizard in v1)
      pages/      # Landing, Start, Portfolio, Backtest, Universe
      components/
      mocks/      # example API responses (JSON)
  docs/superpowers/specs/
```

## 4. Data layer

### 4.1 Schema (SQLite)

```sql
fund(
  isin TEXT PRIMARY KEY, name TEXT, issuer TEXT,
  asset_class TEXT,        -- equity | bond | commodity | real_estate | cash | crypto
  sub_class TEXT,          -- gov_short, gov_intermediate, gov_long, corp_ig, high_yield,
                           -- inflation_linked, em_debt, broad, large_cap, small_cap, sector, ...
  region TEXT,             -- global, us, europe, japan, pacific_ex_japan, em, uk, ... 
  sector TEXT NULL,        -- only for sector funds
  esg INTEGER,             -- 0/1
  ter REAL,                -- annual, e.g. 0.0020
  domicile TEXT, ucits INTEGER,
  wrapper TEXT,            -- etf | etp | etc
  distribution TEXT,       -- acc | dist
  hedged_to TEXT NULL,     -- currency code or NULL
  duration REAL NULL,      -- bonds only
  index_name TEXT, inception_date TEXT,
  proxy_ticker TEXT NULL   -- older series used before inception
)
listing(ticker TEXT PRIMARY KEY, isin TEXT REFERENCES fund, exchange TEXT,
        currency TEXT, is_primary INTEGER)
price(ticker TEXT, date TEXT, adj_close REAL, PRIMARY KEY(ticker, date))   -- local ccy, total return
fx(currency TEXT, date TEXT, usd_rate REAL, PRIMARY KEY(currency, date))   -- units of USD per 1 unit
rf_rate(currency TEXT, date TEXT, annual_rate REAL, PRIMARY KEY(currency, date))
meta(key TEXT PRIMARY KEY, value TEXT)                                     -- last_ingest etc.
```

Proxy tickers (e.g. `BTC-USD`, older index ETFs) are stored in `price` like any listing; the
`listing` table only holds tradable listings.

### 4.2 `etfs.csv`

One row per listing, with the fund columns repeated. Drafted by us (~300–500 rows), reviewed by
the user. Coverage targets: US, UCITS (Xetra, LSE, Euronext, SIX), some Canada/Australia/Japan;
equity regions and factors, sectors, ESG variants, the full bond range (gov short → long, IG, HY,
inflation-linked, EM debt) in hedged and unhedged share classes, gold/commodities, REITs,
money market/cash, crypto ETFs/ETPs. At least these long-history anchors, used as proxies and as
market/benchmark legs: SPY, IVV, EFA, EEM, AGG, BND, TLT, IEF, SHY, LQD, HYG, TIP, GLD, VNQ,
ACWI (2008) and BTC-USD/ETH-USD (2014).

### 4.3 Ingestion — `python -m app.data.ingest [--full]` (run from `backend/`)

1. Load `etfs.csv`, validate required columns, upsert `fund` and `listing`.
2. `sources.fetch_prices(tickers, start) -> DataFrame` (yfinance, batched, `auto_adjust=True`).
   Incremental: starts after the last stored date per ticker, unless `--full`.
3. FX: `EURUSD=X` etc. for every listing currency.
4. Risk-free rate: USD from `^IRX`; EUR from the ECB Data Portal (EONIA until 2019-10-01,
   then €STR; EONIA = €STR + 8.5bp).
5. `quality.report(db) -> list[Issue]`, printed at the end: missing TER, history shorter than
   1 year without a proxy, gaps > 10 trading days, stale last price (> 7 days), daily moves
   > 25%, tickers yfinance didn't return. Problems are reported, never silently fixed.

All network access goes through `sources.py` (one function per series type) so tests can
substitute fakes and a paid provider can replace it later.

## 5. Engine

Pure Python (pandas/numpy/PyPortfolioOpt). No FastAPI or SQLite imports; `pipeline.py` is the
only module that receives a data-access object. Every module is testable on synthetic data.

### 5.0 Shared types (`engine/types.py`)

Sketch; mutable defaults use `field(default_factory=...)` in the real code.

```python
@dataclass class Preferences:          # mirrors api schema
    hedge_bonds: bool = True; ucits_only: bool | None = None
    regions_include: list[str] = []; regions_exclude: list[str] = []
    sector_tilts: dict[str, float] = {}; sectors_exclude: list[str] = []
    esg_only: bool = False
    max_etfs: int = 10; min_position: float = 0.03; max_position: float = 0.40
    max_ter: float | None = None; distribution: str = "any"; crypto_max: float = 0.0

@dataclass class Profile:
    risk_level: float; horizon_years: int; base_currency: str; preferences: Preferences

@dataclass class EngineSettings:
    expected_return_model: str = "capm_multi_asset"; strategy: str = "target_vol"
    estimation_window_years: int = 5; market_premium: float | None = None
    vol_range: tuple[float, float] = (0.02, 0.20)
    drawdown_thresholds: tuple[float, ...] = (0.3, 0.4, 0.5); mc_paths: int = 10_000

@dataclass class StepResult:
    step: str                 # stable key, e.g. "expected_returns" — explanations attach to it
    summary: dict             # key inputs/outputs, JSON-serialisable
    notes: list[str]          # human-readable reasons/warnings

@dataclass class Constraints:
    target_vol: float; max_etfs: int; min_position: float; max_position: float
    group_min: dict[str, float]   # e.g. {"sector:healthcare": 0.05}
    group_max: dict[str, float]   # e.g. {"asset_class:crypto": 0.05}
    ter: pd.Series                # per isin, for the cost penalty
    groups: dict[str, list[str]]  # group key -> isins
```

All return series are **weekly** (W-FRI), indexed by date, one column per ISIN, in base currency.

### 5.1 `universe.select(funds, listings, profile) -> DataFrame`

Filters: `esg_only`; region include/exclude; `sectors_exclude`; `max_ter`; `distribution`;
crypto removed if `crypto_max == 0` or `risk_level < 40`; `ucits_only` (None → True for EUR,
False for USD); with `hedge_bonds`, a bond fund with an available hedged-to-base share class
drops its unhedged siblings (same index). Then one listing per fund: prefer listing currency ==
base, then `is_primary`. Output: one row per ISIN with fund columns + chosen `ticker`.
Raises `NoEligibleFunds` if empty.

### 5.2 `returns.weekly_returns(prices, listing_ccy, fx, base, proxies) -> DataFrame`

Local-currency adjusted closes → base currency via `fx` → weekly (last price of week) → simple
returns. Before a listing's first price, its proxy's returns (also converted) are used; the
function also returns a `proxied: dict[isin, (start, end)]` mask. Weeks where a fund has no
data (and no proxy) stay NaN.

### 5.3 `risk.covariance(returns, window_years) -> DataFrame`

Last `window_years` of weekly returns; funds with < 80% coverage in the window are dropped
(noted in trace). Ledoit-Wolf shrinkage (PyPortfolioOpt `CovarianceShrinkage`), annualised ×52.

### 5.4 `expected.capm(returns, rf, market_weights, premium) -> CapmResult`

`market_weights`: weights over anchor funds from config (§9). Market return series = weighted
sum. For each fund: β = cov(r_i, r_m)/var(r_m) on excess returns over the estimation window;
expected return = rf_now + β × premium. `CapmResult(beta: Series, expected: Series,
rf: float, premium: float, market: str)`.
- `capm_equity`: market = 100% global equity anchor, premium default 5.0%.
- `capm_multi_asset`: market = 60% global equity / 40% global aggregate bonds (hedged), premium
  default 3.5%.
If bonds are held under `capm_equity`, the trace notes that their expected return ≈ rf and that
their weight comes from diversification only.

### 5.5 `optimize.optimize(mu, cov, constraints, strategy) -> OptimizeResult`

`OptimizeResult(weights: Series, achieved_vol: float, warnings: list[str])`, long-only,
weights sum to 1.
- `optimize` receives expected **excess** returns (μ − rf).
- `target_vol` (default): maximise `μ·w − ter·w` subject to `√(wᵀΣw) ≤ target_vol`,
  position and group bounds. If infeasible because the target is too low (or too high), use
  the minimum-variance (or maximum-return) feasible portfolio and warn with the achieved
  volatility.
- `min_variance`, `max_sharpe`, `risk_parity`, `hrp`: comparison strategies with the same
  signature; they respect position bounds, crypto cap and group bounds where the method allows,
  otherwise they warn.
- Cardinality (`max_etfs`) and `min_position`: optimise → drop weights below `min_position`
  and keep the top `max_etfs` → re-optimise on the remaining funds (at most 3 rounds).
- Target volatility from risk level: `vmin + risk_level/100 × (vmax − vmin)`.

### 5.6 `metrics.py`

Pure functions over a return series (and optional benchmark/rf):
`cagr, volatility, sharpe, sortino, max_drawdown, max_drawdown_duration, cvar(0.95), calmar,
beta, turnover` plus `ex_ante(weights, mu, cov, beta, ter) -> {expected_return, volatility,
sharpe, beta, weighted_ter, risk_contribution: Series}`.
`REGISTRY: dict[str, Callable]` lists the backtest metrics; adding an indicator = one function +
one registry line.

### 5.7 `downside.py`

- `simulate(port_weekly_returns, expected_return, horizon_years, thresholds, n_paths, block_weeks=(4,13), seed)`:
  block bootstrap (random starts, uniform block lengths of 4–13 weeks) of the portfolio's historical weekly returns (all available
  history), demeaned and shifted so the mean equals `expected_return`. Returns
  `drawdown_probs {threshold: P(max drawdown over horizon ≥ threshold)}`,
  `annual_loss_probs {threshold: P(any calendar-year return ≤ −threshold)}`,
  `p_below_invested`, `fan {percentile: [value per year]}` for 5/25/50/75/95.
- `normal_comparison(mu, sigma, horizon, thresholds)`: the same probabilities from a normal
  distribution (analytic for annual loss, simulated GBM for drawdown), for teaching.
- `stress(weights, weekly_returns_all, events)`: cumulative portfolio return over each event
  window in config (§9); `proxied: bool` when proxies were used; `None` if data is missing.

### 5.8 `backtest.run(returns, weights_fn, settings, benchmark_returns) -> BacktestResult`

- `static`: `weights_fn` always returns today's recommended weights; result carries a
  look-ahead warning.
- `walk_forward`: at each rebalance date `t`, `weights_fn(t)` reruns covariance → expected →
  optimize using **only data ≤ t**. Requires `rebalance.type != none` (validated; the frontend switches rebalancing to quarterly when this mode is picked).
- Rebalancing: `none` (buy and hold, weights drift), `periodic` (monthly/quarterly/annual),
  `threshold` (any |w − target| > x).
- Transaction cost: `bps × turnover` subtracted at each trade (including the initial buy).
- Benchmark `auto`: global-equity anchor + global-aggregate-bond anchor, mixed so its ex-ante
  volatility matches the portfolio's.
- Output: `series` (portfolio value, benchmark value, drawdown, rolling 156-week volatility and
  Sharpe), `metrics` (from the registry, for both), `proxied_periods`, `rebalance_dates`,
  `warnings`.

### 5.9 `pipeline.py`

`recommend(profile, settings, data) -> Recommendation` runs universe → returns → covariance →
capm → constraints → optimize → ex-ante metrics → downside, appending a `StepResult` at each
step. `backtest(request, data) -> BacktestResult` builds `weights_fn` from the same steps.
`data` is a small protocol (`funds()`, `listings()`, `prices(tickers)`, `fx()`, `rf(ccy)`)
implemented by `app/data/db.py` and by the synthetic fixture.

### 5.10 Trace

Every response includes `trace: list[StepResult]`. Step keys are stable
(`universe, returns, covariance, expected_returns, constraints, optimize, metrics, downside,
backtest`). The teaching layer and voice agent will attach explanations to these keys; the
engine does not produce prose beyond short `notes`.

### 5.11 Errors

`engine/errors.py`: `DomainError` → `NoEligibleFunds`, `InfeasibleConstraints` (e.g. sector
tilts exceed `max_etfs`), `InsufficientHistory` (too little overlapping history), `NoData`,
`InvalidSettings`. `main.py` maps all of them to `422` with
`{error, detail}`, except `NoData` → `503` ("run `python -m app.data.ingest`"). An impossible
volatility target is a warning, not an error.

## 6. Intake

- `questionnaire.json`: ~10 questions, each `{id, text, type: single|number, options:
  [{label, value, points}], feeds: capacity|tolerance|horizon}`. All questions are
  required; the horizon answer also adds capacity points via fixed bands.
  Capacity: horizon, income stability, share of wealth, emergency buffer, need for withdrawals.
  Tolerance: reaction to a −20% drop, loss/gain trade-off, experience, self-assessment.
- `scoring.score(answers) -> {capacity: 0–100, tolerance: 0–100, suggested_risk_level:
  min(capacity, tolerance), limiting_factor, mismatch: |cap − tol| > 20, explanation,
  horizon_years}`.
- The suggested level is only a suggestion: the intake channel confirms or adjusts it, and the
  final `risk_level` goes into `InvestorProfile`. The engine never re-scores.

## 7. API (`/api`, port 8740)

Stateless. Pydantic models in `api/schemas.py` are the single source of the contract; the
frontend generates TypeScript types from `/openapi.json`.

| Method | Path | In → Out |
|---|---|---|
| GET | `/api/health` | → `{status, data_loaded, last_ingest, n_funds}` |
| GET | `/api/intake/questionnaire` | → questionnaire |
| POST | `/api/intake/score` | `{answers}` → score result (§6) |
| GET | `/api/universe` | query filters → `[FundSummary]` |
| GET | `/api/universe/{isin}` | `?base_currency` → fund, listings, price history in base ccy |
| GET | `/api/defaults` | → config defaults (§9) |
| POST | `/api/portfolio` | `{profile: InvestorProfile, settings?: EngineSettings}` → `Recommendation` |
| POST | `/api/backtest` | `{weights? , profile?, settings?, backtest: BacktestSettings}` → `BacktestResult` |

```
Recommendation
  holdings: [{isin, ticker, exchange, name, weight, asset_class, sub_class, region, ter,
              beta, expected_return, risk_contribution, proxied}]
  summary: {expected_return, volatility, target_volatility, sharpe, beta, weighted_ter,
            annual_cost_per_10k, mix: {asset_class: weight}}
  downside: {drawdown_probs, annual_loss_probs, p_below_invested, fan,
             stress: [{event, start, end, loss, proxied}], normal_comparison}
  warnings: [str]
  trace: [StepResult]

BacktestSettings
  mode: static | walk_forward = static
  start: date = today − 15y; end: date = today
  rebalance: {type: none|periodic|threshold = none, frequency: monthly|quarterly|annual,
              threshold: float}
  transaction_cost_bps: float = 10
  benchmark: "auto" | {isin: weight}

BacktestResult
  series: {dates, portfolio, benchmark, drawdown, rolling_vol, rolling_sharpe}
  metrics: {portfolio: {...}, benchmark: {...}}
  proxied_periods, rebalance_dates, warnings, trace
```

`static` needs `weights`; `walk_forward` needs `profile`. Everything runs synchronously.
FastAPI's `/docs` is the manual test UI until the frontend exists.

## 8. Frontend (port 5740)

React + Vite + TypeScript, `react-router`, Recharts, `openapi-fetch` + `openapi-typescript`
(`npm run gen:api`), plain CSS with design tokens. Visual design gets a dedicated design pass
during implementation.

### 8.1 Intake channels

One `InvestorProfile` + `EngineSettings` store (context + reducer), mirroring the API schema,
persisted in `localStorage`, exportable/importable as JSON. The v1 `FormWizard` is one intake
channel that fills it; a later voice/avatar agent is another channel filling the same store
through the same `/api/intake/*` endpoints. Result pages only read the store.

### 8.2 Pages

- `/` **Landing**: hero with a "Build my portfolio" CTA → `/start`; how it works (3 steps);
  selling points (explainable, honest about downside, low cost/TER, global incl. bonds and ESG);
  an example portfolio preview from a demo profile; repeated CTA; footer disclaimer
  ("educational tool, not personal financial advice; past performance is no guarantee").
  Placeholder brand name until the user picks one.
- `/start` **Intake wizard**: questions (rendered from the questionnaire) → risk level
  (sub-scores, mismatch explanation, 0–100 slider showing target volatility, a typical bad year
  and P(−30%)) → preferences.
- `/portfolio`: summary cards, mix donut, holdings table, downside panel (drawdown probability
  bars, fan chart, stress table, Monte Carlo vs normal), "How was this built?" trace list,
  warnings.
- `/backtest`: settings (mode, rebalancing default none, period, costs, benchmark), value vs
  benchmark, drawdown, rolling volatility/Sharpe, metrics table, proxied periods shaded,
  look-ahead banner in static mode, compare two runs side by side.
- `/universe`: filterable fund table; fund detail with price chart, listings, TER.
- Advanced settings drawer on every page for `EngineSettings`.

### 8.3 Mock mode

`VITE_USE_MOCKS=1` makes the API client return `src/mocks/*.json` (one example response per
endpoint, matching the schemas). This lets the frontend be built before the backend exists.

## 9. Configuration defaults (`app/config.py`)

```
DB_PATH = backend/data/roboadvisor.db (env ROBO_DB_PATH)
VOL_RANGE = (0.02, 0.20)
ESTIMATION_WINDOW_YEARS = 5
MARKETS = {
  "capm_equity":      {"weights": {<ACWI isin>: 1.0},                    "premium": 0.050},
  "capm_multi_asset": {"weights": {<ACWI isin>: 0.6, <global agg hedged isin>: 0.4}, "premium": 0.035},
}
CRYPTO_MIN_RISK_LEVEL = 40
CRYPTO_DEFAULT_CAP = 0.05    # UI default for crypto_max when the user opts in
CRYPTO_HARD_CAP = 0.10       # crypto_max above this is rejected (422)
TER_PENALTY = 1.0            # multiplier on TER in the objective
DRAWDOWN_THRESHOLDS = (0.3, 0.4, 0.5); MC_PATHS = 10_000; BLOCK_WEEKS = (4, 13)
STRESS_EVENTS = [
  ("GFC 2008",        "2007-10-09", "2009-03-09"),
  ("COVID 2020",      "2020-02-19", "2020-03-23"),
  ("Rate shock 2022", "2022-01-03", "2022-10-14"),
]
BACKTEST_YEARS = 15; TRANSACTION_COST_BPS = 10
MISMATCH_GAP = 20
```

## 10. Testing

- **Engine** (pytest, synthetic data with known answers):
  metrics on hand-made series; CAPM: market proxy β = 1, cash β = 0, `capm_equity` gives bonds
  ≈ rf; optimizer: volatility ≤ target, Σw = 1, every constraint holds, CML property with a cash
  fund, infeasible target → closest feasible value + warning; downside: Monte Carlo ≈ analytic on
  normal data; backtest: `none` equals buy-and-hold, threshold triggers exactly on drift, costs
  deducted, **walk-forward look-ahead test** (corrupt all data after each rebalance date → same
  weights).
- **Data**: ingestion against fake `sources`, quality checks unit-tested; no network in tests.
- **API**: TestClient against the synthetic fixture DB, contract and error cases.
- **Frontend**: `tsc`, store reducer test; Playwright smoke test landing → intake → portfolio
  once the flow exists.

## 11. Build plan for parallel agents

The work is split into lanes that share **only the contracts from Phase 0**. Each lane owns its
files exclusively, tests against synthetic fixtures or mocks, and does not need another lane's
output to finish.

**Phase 0 — Contracts (one agent, sequential, must finish first)**
- Backend skeleton: `pyproject.toml`, `main.py` (ports, health route, error handler),
  `config.py`.
- `api/schemas.py` (all models in §7), `engine/types.py`, `engine/errors.py`,
  `data/schema.sql`, the `data` protocol (§5.9).
- `tests/fixtures/synthetic.py`: ~20 synthetic funds (equity regions, bonds hedged/unhedged,
  cash, gold, crypto, one sector fund, one young fund with proxy), 20 years of prices, FX, rf;
  builds an in-memory fixture DB implementing the protocol.
- Stub every engine function with its final signature (`raise NotImplementedError`).
- Export `openapi.json`; frontend scaffold (Vite, port 5740, proxy, router, generated types,
  store, mock mode with one JSON per endpoint).

**Phase 1 — Parallel lanes**

| Lane | Owns | Depends only on |
|---|---|---|
| A. Data | `data/ingest.py, sources.py, quality.py, db.py`, `data/etfs.csv` | schema.sql, protocol |
| B. Returns & risk | `engine/universe.py, returns.py, risk.py` | types, fixtures |
| C. CAPM & optimizer | `engine/expected.py, optimize.py` | types, fixtures |
| D. Metrics & downside | `engine/metrics.py, downside.py` | types, fixtures |
| E. Backtest | `engine/backtest.py` | types, fixtures (`weights_fn` is injected, so it doesn't wait for C) |
| F. Intake | `intake/questionnaire.json, scoring.py`, `api/intake.py` | schemas |
| G. Frontend: landing + intake | `pages/Landing, Start`, `intake/` | generated types, mocks |
| H. Frontend: results | `pages/Portfolio, Backtest, Universe`, charts | generated types, mocks |

**Phase 2 — Integration (one agent)**
`engine/pipeline.py`, `engine/trace.py`, API routes `portfolio.py`, `backtest.py`,
`universe.py`, `defaults`; API tests on the fixture DB; turn off mock mode; run a real ingest;
Playwright smoke test; a golden-run check on one reference profile.

Rules for lanes: don't edit files owned by another lane or Phase 0 contracts; if a contract
must change, stop and escalate to the integrator instead of changing it locally.
