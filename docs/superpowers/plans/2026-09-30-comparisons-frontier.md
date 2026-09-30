# Comparisons, 5-Year View and Efficient Frontier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the portfolio next to World equities and the S&P 500 everywhere a backtest is shown, add a "Last N years" section and a reading guide to the Portfolio page, add a model-vs-hindsight efficient frontier, and fix the drawdown chart and the narrow holdings table.

**Architecture:** Backend adds one optional field (`BacktestResult.references`) and one route (`POST /api/frontier`), both computed in `app/engine/pipeline.py` from the existing recommend steps. The frontend gets a comparison section and a frontier chart on the Portfolio page, reference lines/columns on the Backtest page, and two fixes. Contract changes are additive; openapi, mocks and TS types are regenerated.

**Tech Stack:** Python 3.12, uv, FastAPI, Pydantic v2, pandas, numpy, cvxpy (via the existing optimizer), pytest; React 19, TypeScript, Recharts, openapi-fetch/openapi-typescript, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-comparisons-frontier-design.md` (read it first; this plan argues from it)

## Global Constraints

- uv only for Python (`cd backend && uv run …`), npm for the frontend; no new dependencies.
- Backend port 8740, frontend 5740 (strictPort). All routes under `/api`.
- Engine modules other than `pipeline.py` do not change (`universe, returns, risk, expected, optimize, metrics, downside, backtest`). New logic lives in `pipeline.py`.
- Contract changes are exactly those in spec §3: new models `ReferenceResult`, `FrontierPoint`, `FrontierMarker`, `Frontier` in `app/engine/types.py`; new field `BacktestResult.references`; new `FrontierRequest` in `app/api/schemas.py`; new route module `app/api/frontier.py` registered in `app/main.py`; new constant `REFERENCES` in `app/config.py`. Nothing else in contract files changes.
- After any contract change: `cd backend && uv run python -m scripts.export_contract` and `cd frontend && npm run gen:api`; the openapi drift test and signature snapshot (`tests/test_contract.py`) are updated deliberately for the new route/function only.
- API responses never contain NaN/inf (use `None` in Optional fields).
- Engine routes run under `app.api.deps.ENGINE_LOCK` (see `api/portfolio.py`); the new route must too.
- Do not edit `tests/fixtures/synthetic.py`. In tests, point `config.REFERENCES` at synthetic ISINs with `monkeypatch` (World → `IE00B6R52259`, S&P 500 → `SYNUSEQ00001`).
- Frontend: use tokens from `tokens.css` only; charts through `ChartFrame` (title, description, table view); portfolio = `--series-1`, World = `--series-2`, S&P 500 = `--series-3`, strategies = `--series-4..6`, funds = `--ink-3` at low opacity. Numeric API fields may be `null`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `backend/app/config.py` | add `REFERENCES` | reference index ISINs + labels |
| `backend/app/engine/types.py` | add models | `ReferenceResult`, `BacktestResult.references`, `FrontierPoint`, `FrontierMarker`, `Frontier` |
| `backend/app/api/schemas.py` | add `FrontierRequest` | request body |
| `backend/app/engine/pipeline.py` | add `_references`, `_prepare`, `frontier` | reference series; shared recommend prep; frontier |
| `backend/app/api/frontier.py` + `app/main.py` | new route | `POST /api/frontier` |
| `backend/scripts/export_contract.py`, `tests/test_export_contract.py` | frontier mock | mock + validation |
| `backend/tests/integration/test_references.py`, `test_frontier.py`, `tests/data/test_anchors.py` | tests | |
| `frontend/src/pages/Backtest.tsx`, `components/charts/*` | references, drawdown fix | |
| `frontend/src/components/charts/PortfolioView.tsx`, `HoldingsTable.tsx`, `results.css` | layout | full-width holdings |
| `frontend/src/components/charts/Comparison.tsx`, `ReadingGuide.tsx`, `Frontier.tsx` (+ `frontier.ts` transforms + tests) | new | Portfolio page sections |
| `frontend/src/mocks/index.ts`, `frontier.json` | mock route | |
| `frontend/e2e/*.pw.ts` | e2e | |

---

### Task 1: Reference indices in every backtest

**Files:**
- Modify: `backend/app/config.py`, `backend/app/engine/types.py`, `backend/app/engine/pipeline.py`
- Modify: `backend/tests/data/test_anchors.py` (reference ISINs exist in `data/etfs.csv`)
- Create: `backend/tests/integration/test_references.py`
- Regenerate: `backend/openapi.json`, `frontend/src/mocks/*.json`, `frontend/src/api/schema.d.ts`

**Interfaces:**
- Produces: `config.REFERENCES: dict[str, dict[str, str]]` (`key -> {"label", "isin"}`); `types.ReferenceResult`; `BacktestResult.references: list[ReferenceResult] = []`; `pipeline._references(returns: pd.DataFrame, rows: pd.DataFrame, dates: list[date], rf_weekly: pd.Series) -> tuple[list[ReferenceResult], list[str]]` (results, warnings).

- [ ] **Step 1: Config and models**

`app/config.py` (append):

```python
# Yardsticks shown next to every backtest (spec 2026-09-30 §2). By ISIN; converted to the base currency
# like any fund. Buy-and-hold of the single ETF, no costs; independent of the investor's filters.
REFERENCES = {
    "world": {"label": "World equities (MSCI World)", "isin": "IE00B4L5Y983"},
    "sp500": {"label": "S&P 500", "isin": "IE00B5BMR087"},
}
```

`app/engine/types.py` (next to `BacktestResult`):

```python
class ReferenceResult(BaseModel):
    key: str
    label: str
    isin: str
    ticker: str
    start: date  # first date of this reference's series (>= backtest start)
    values: list[float | None]  # growth of 1.0 aligned to BacktestSeries.dates; None before `start`
    metrics: dict[str, float | None]  # metrics.REGISTRY keys over the reference's own window
```

and add `references: list[ReferenceResult] = []` as the last field of `BacktestResult`.

- [ ] **Step 2: Failing tests** — `tests/integration/test_references.py`:
  1. `test_static_backtest_has_both_references` (monkeypatch `config.REFERENCES` to the synthetic ISINs, EUR risk 50, static): `[r.key for r in res.references] == ["world", "sp500"]`; each `len(values) == len(series.dates)`; the first non-None value is 1.0 at `start`; `set(metrics) == set(metrics_mod.REGISTRY)`.
  2. `test_walk_forward_backtest_has_references` (quarterly).
  3. `test_references_ignore_investor_filters`: `esg_only=True` with `max_position=1.0, max_etfs=1` still returns both references.
  4. `test_reference_starting_late_is_none_before_start`: a custom `bt.start` before the reference's first own+proxy data → values `None` before `start`, never 0.
  5. `test_missing_reference_isin_is_skipped_with_warning`: point one key at an ISIN not in the data → that reference absent, a warning names it, the request still succeeds.
  6. `test_references_serialise_without_nan` (`json.dumps(res.model_dump(mode="json"), allow_nan=False)`).
  7. `tests/data/test_anchors.py`: add `test_reference_isins_are_in_catalogue` reading `data/etfs.csv`.

Run: `cd backend && uv run pytest tests/integration/test_references.py -q` → FAIL (no `references`).

- [ ] **Step 3: Implement `_references` in `pipeline.py`**

Approach (write it clearly, it's teaching code):
- In `backtest()`, extend the listing rows with the reference ISINs via the existing `_listing_rows`/`_extend` helpers (neutral profile, so investor filters do not apply) before `_weekly`, so their weekly base-currency returns sit in the same `rr.returns` frame as the portfolio and benchmark.
- After `backtest.run(...)` returns, for each reference: take its weekly returns over the result's `series.dates` window (the first date is t0, value 1.0; returns from the second date), find the first week with data (`start`), build the growth-of-1 series from `start` (1.0 at `start`, `None` before), and compute `{k: _opt(fn(r_ref, rf_weekly_aligned)) for k, fn in metrics.REGISTRY.items()}` over `start..end`. Skip (warning) any reference whose ISIN has no listing or no data in the window.
- Append a trace note in the existing `backtest` step: `references: world from <start>, sp500 from <start>`.

- [ ] **Step 4: Run tests** → PASS; full suite `uv run pytest -q` green (the drift test will fail until Step 5).

- [ ] **Step 5: Contract refresh** — `uv run python -m scripts.export_contract`; `cd ../frontend && npm run gen:api && npm run typecheck && npm test`; `cd ../backend && uv run pytest -q` → all green.

- [ ] **Step 6: Commit** — `feat(engine): World and S&P 500 reference series in every backtest`.

---

### Task 2: `POST /api/frontier`

**Files:**
- Modify: `backend/app/engine/types.py` (models), `backend/app/api/schemas.py` (`FrontierRequest`), `backend/app/engine/pipeline.py` (`_prepare`, `frontier`), `backend/app/main.py` (register router), `backend/tests/test_contract.py` (add `pipeline.frontier` to EXPECTED_FUNCS + its signature to the snapshot, `/api/frontier` to the path list), `backend/scripts/export_contract.py` + `backend/tests/test_export_contract.py` (frontier mock), `frontend/src/mocks/index.ts` (route `POST /api/frontier`)
- Create: `backend/app/api/frontier.py`, `backend/tests/integration/test_frontier.py`

**Interfaces:**
- Produces: `FrontierPoint`, `FrontierMarker`, `Frontier` exactly as spec §3.2; `FrontierRequest {profile, settings = EngineSettings(), lookback_years: int = Field(5, ge=1, le=15), points: int = Field(20, ge=5, le=40)}`; `pipeline.frontier(profile, settings, lookback_years, points, data) -> Frontier`; route `POST /api/frontier` (response_model `Frontier`, `with ENGINE_LOCK:`).

- [ ] **Step 1: Failing tests** — `tests/integration/test_frontier.py` on synthetic data (monkeypatch `config.REFERENCES` as in Task 1):
  1. curves sorted by volatility, ≥ 5 points each, all values finite.
  2. model curve expected return non-decreasing in volatility (tolerance 1e-4).
  3. the `portfolio` marker's model position lies on/under the model curve: its return ≤ the curve's interpolated return at its volatility + 1e-3, and ≥ it − 5e-3 (it was optimised on that curve).
  4. markers include exactly one `portfolio`, both references (`world`, `sp500`), the four strategies (`min_variance`, `max_sharpe`, `risk_parity`, `hrp`), and one `fund:<isin>` per candidate.
  5. capital market line has two points, first at volatility 0 with return = `rf`.
  6. `lookback` spans `lookback_years` years ending at the last complete week.
  7. hindsight sanity: for the `portfolio` marker, `hindsight.expected_return` equals `w · mu_hist` recomputed in the test from the synthetic weekly returns over the lookback (tolerance 1e-9).
  8. API: `POST /api/frontier` returns 200 and serialises without NaN (`parse_constant` raising).
  9. Real DB performance (skip if `config.DB_PATH` missing): EUR risk 50, second call ≤ 3 s.
  Run → FAIL.

- [ ] **Step 2: Extract `_prepare` in `pipeline.py`** — move the part of `recommend()` that builds selection → rows → weekly returns → candidates → `_fit` into `_prepare(profile, settings, data) -> _Prepared` (dataclass with `selection, rows, rr, cand, rf_daily, anchors, fit, trace, warnings`), and make `recommend()` call it. Behaviour must be byte-identical: `test_pipeline_recommend.py`, the golden test and the API tests stay green without edits.

- [ ] **Step 3: Implement `frontier()`**

```python
def frontier(profile, settings, lookback_years, points, data) -> Frontier:
    """Model vs hindsight efficient frontier for this investor's candidate funds (spec 2026-09-30 §3.2)."""
```

Algorithm (clear names, teaching code):
1. `prep = _prepare(profile, settings.model_copy(update={"mc_paths": 500}), data)`; `cov = prep.fit.cov`; `isins = list(cov.index)`; `rf = prep.fit.capm.rf`; `mu_model = prep.fit.mu` (total).
2. Hindsight means: `hist = prep.rr.returns[isins].tail(lookback_years * 52)`; `mu_hist = hist.mean() * 52` (annualised arithmetic, total); `lookback = {"start": hist.index[0], "end": hist.index[-1]}`.
3. `curve(mu_total)`: `lo = optimize(mu_total - rf, cov, replace(cons, target_vol=1e-6), "target_vol").achieved_vol`, `hi = … target_vol=10.0 …`; for `t in np.linspace(lo, hi, points)`: `w = optimize(mu_total - rf, cov, replace(cons, target_vol=t), "target_vol").weights`; point = `_position(w, mu_total, cov, rf)`; skip on `InfeasibleConstraints`/`InsufficientHistory`; sort by vol; drop duplicates within 1e-6 vol.
4. `_position(w, mu_total, cov, rf) -> FrontierPoint`: `vol = sqrt(w'Σw)`, `ret = w·mu_total`, `sharpe = (ret - rf)/vol if vol > 1e-9 else None`.
5. Markers: portfolio (`prep.fit.opt.weights`), strategies (`optimize(mu_model - rf, cov, cons, s)` for `min_variance, max_sharpe, risk_parity, hrp`, skip on domain errors with a warning), funds (unit weight each), references (from their own weekly returns in base currency: vol = std over the estimation window × √52; model return = `rf + beta × premium` using `expected.capm` on a frame containing the reference column plus the anchors; hindsight = mean over the lookback × 52). Each marker gets both `model` and `hindsight` positions.
6. CML: `[(0, rf), (max_vol_on_model_curve, rf + slope × max_vol)]` with slope from the max-Sharpe point of the model curve.
7. Trace steps: reuse prep.trace, add `frontier` step (`points`, `lookback`, `n_markers`, timings).

- [ ] **Step 4: Route** — `app/api/frontier.py` with `router = APIRouter(tags=["engine"])`, `@router.post("/frontier", response_model=Frontier)` taking `body: FrontierRequest, data = Depends(get_data)` and returning `pipeline.frontier(...)` under `ENGINE_LOCK`; include in `main.py`.

- [ ] **Step 5: Tests green; contract refresh** — update `tests/test_contract.py` deliberately (new path + `pipeline.frontier` signature); add a `frontier` mock to `scripts/export_contract.py` (real engine on SyntheticData, `points=12`, monkeypatched references as in tests) and to `test_export_contract.py`; add the `POST /api/frontier` route to `frontend/src/mocks/index.ts`; `npm run gen:api && npm run typecheck && npm test`; full backend suite green.

- [ ] **Step 6: Commit** — `feat(api): model vs hindsight efficient frontier`.

---

### Task 3: Drawdown chart bug and full-width holdings

**Files:** `frontend/src/pages/Backtest.tsx`, `frontend/src/components/charts/transforms.ts` (+ test), `frontend/src/components/charts/PortfolioView.tsx`, `HoldingsTable.tsx`, `results.css`

- [ ] **Step 1: Root-cause the drawdown chart** (systematic debugging): the rendered axis runs 60–180%, i.e. growth values, not drawdowns. Trace which series `Backtest.tsx` passes to the drawdown chart (around line 204) and how the transform builds it; write a failing transform test that the drawdown rows equal `series.drawdown` (all ≤ 0) and the axis formatter shows negative percentages; fix at the source.
- [ ] **Step 2: Holdings full width** — move `HoldingsTable` out of the shared grid into its own full-width card; name column wraps (`white-space: normal`, min-width), numeric columns compact and right-aligned; keep the `.table-scroll` wrapper for narrow screens. Verify with the headless browser (playwright-core is available via `npm run e2e` infra): at 1280 px the table's `scrollWidth <= clientWidth`; at 360 px the page has no horizontal scroll.
- [ ] **Step 3:** `npm run typecheck && npm test && npm run build && npm run e2e` green; commit `fix(frontend): drawdown chart shows drawdowns; full-width holdings table`.

---

### Task 4: References on the Backtest page and "Last N years" + reading guide on the Portfolio page

**Files:** `frontend/src/pages/Backtest.tsx`, `components/charts/MetricsTable.tsx`, `components/charts/transforms.ts` (+ tests), create `components/charts/Comparison.tsx`, `components/charts/ReadingGuide.tsx`, modify `PortfolioView.tsx` / `pages/Portfolio.tsx`, `results.css`

- [ ] **Step 1: Transforms (TDD, vitest)** — `growthRows(result)` returns rows `{t, portfolio, benchmark?, world?, sp500?}` with `null` before a reference's start; `comparisonColumns(result)` returns metric columns for Portfolio / World / S&P 500 (and Benchmark on the Backtest page) using the existing metric labels/units.
- [ ] **Step 2: Backtest page** — growth chart gets World and S&P 500 lines; metrics table gets their columns; a note when a reference starts after the window start.
- [ ] **Step 3: `Comparison` section on the Portfolio page** — period switch 1/3/5/10/15 years (default 5, segmented control, keyboard-accessible); calls `POST /api/backtest` static with `start = today − N years` using the store's profile/settings; growth chart (3 lines) + metrics table (CAGR, volatility, Sharpe, max drawdown; columns Portfolio / World / S&P 500); own loading/error state.
- [ ] **Step 4: `ReadingGuide`** — collapsible `<details open>` with the four plain-language sentences from spec §4.1 (Sharpe, volatility, max drawdown, CAGR). Copy is final in the spec; keep it short.
- [ ] **Step 5:** order of sections per spec §4.1; `typecheck/test/build` green; commit `feat(frontend): World and S&P 500 comparisons, last-N-years view and reading guide`.

---

### Task 5: Efficient frontier chart

**Files:** create `components/charts/Frontier.tsx`, `components/charts/frontier.ts` (+ `frontier.test.ts`), modify `PortfolioView.tsx`, `results.css`

- [ ] **Step 1: Transforms (TDD)** — `frontierSeries(f, frame: 'model' | 'hindsight', showFunds)` → `{modelCurve, hindsightCurve, cml, markers: {x, y, label, kind}[]}` in percent units; markers use the chosen frame; funds excluded unless `showFunds`.
- [ ] **Step 2: Component** — Recharts `ComposedChart` with numeric x (volatility %) and y (expected return %): model curve (solid, series-1), hindsight curve (dashed, series-2), CML (dotted, ink-3), portfolio (large series-1 dot, labelled), references (series-2/3), strategies (series-4..6, labelled), funds (small ink-3 dots at low opacity). Controls: frame switch (model/hindsight), lookback (1/3/5/10), "Show individual funds" checkbox. Caption from spec §4.1. `ChartFrame` table view lists every marker with both positions. Calls `POST /api/frontier` with the store's profile/settings; own loading/error state; renders after the rest of the page.
- [ ] **Step 3:** `typecheck/test/build` green; headless check at 1280 and 360 px (no horizontal scroll, labels readable); commit `feat(frontend): efficient frontier chart (model vs hindsight)`.

---

### Task 6: E2E, docs and verification

**Files:** `frontend/e2e/*.pw.ts`, `README.md`

- [ ] **Step 1: E2E** — Portfolio page (mock mode, after the wizard): the "Last 5 years" chart has 3 legend entries (Portfolio, World, S&P 500) and the metrics table has those columns; the frontier chart renders with a visible "Your portfolio" marker label and a working frame switch; holdings table has no horizontal overflow at 1280 px; Backtest page drawdown axis ticks are ≤ 0%.
- [ ] **Step 2: README** — short section "Comparisons and the efficient frontier" (what the two curves mean; why the portfolio sits on the model curve but can lag in hindsight; references are yardsticks, not candidates).
- [ ] **Step 3: Verification** — backend `uv run pytest -q` (with the real DB present), frontend `npm run typecheck && npm test && npm run build && npm run e2e`, all pristine; live check against the running backend: `POST /api/frontier` EUR risk 50 returns within 3 s warm, portfolio on the model curve.
- [ ] **Step 4:** commit `docs: comparisons and efficient frontier`; local annotated tag `v1.1.0-rc1` (no push).
