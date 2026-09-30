# Universe Risk/Return Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A risk/return card on `/universe` placing every filtered ETF in a Model frame (CAPM, with efficient frontier) and a Realised frame (CAGR vs volatility, no curve), over a selectable period; then redeploy to Azure.

**Architecture:** One shared `filter_funds` (engine) feeds both `GET /api/universe` and the new `POST /api/universe/frontier`. `pipeline.universe_frontier` reuses `_weekly`, `risk.covariance`, `_capm`, `_curve`, `_position`, `_capital_market_line` with loose constraints. The frontend card is a recharts `ScatterChart` (item tooltips) with pure transforms in `universeFrontier.ts`.

**Tech Stack:** FastAPI, pydantic, pandas, cvxpy (backend, `uv`); React 19, recharts 3, openapi-fetch, vitest, Playwright (frontend).

**Spec:** `docs/superpowers/specs/2026-09-30-universe-frontier-design.md`

## Global Constraints

- Realised frame draws **no curve**; its caption says it is not a forecast.
- Chart follows the table filters: `asset_class`, `region`, `esg`, `ucits`, `max_ter`, `q` (same semantics as `GET /api/universe`, unknown TER kept).
- `period_years` 1–15 (UI 1/3/5/10, default 5); `points` 5–40 (UI 12); `base_currency` EUR|USD from `profile.base_currency`.
- JSON responses are NaN-free.
- Charts with hoverable markers use `ScatterChart`, never `ComposedChart` (recharts 3 ComposedChart only has axis tooltips).
- Performance: full universe, 12 points, warm ≤ 3 s locally (real DB).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

Commands: backend `cd backend && uv run pytest -q`; frontend `cd frontend && npm run typecheck && npm test`; e2e `cd frontend && npx playwright test`.

---

### Task 1: Shared `filter_funds`

**Files:**
- Modify: `backend/app/engine/universe.py` (add function at end)
- Modify: `backend/app/engine/types.py` (add `UniverseFilters` near `Preferences`)
- Modify: `backend/app/api/universe.py:16-47` (`list_funds` calls it)
- Test: `backend/tests/integration/test_universe_frontier.py` (create)

**Interfaces:**
- Produces: `UniverseFilters(BaseModel)` fields `asset_class: str|None, region: str|None, esg: bool|None, ucits: bool|None, max_ter: float|None (ge=0), q: str|None`, all default None; `filter_funds(funds: pd.DataFrame, listings: pd.DataFrame, f: UniverseFilters) -> pd.DataFrame` (subset of `funds`, same order).

- [ ] **Step 1: failing test**

```python
from app.engine.types import UniverseFilters
from app.engine.universe import filter_funds
from app.api.universe import list_funds

CASES = [UniverseFilters(), UniverseFilters(asset_class="bond"), UniverseFilters(region="us", max_ter=0.002),
         UniverseFilters(esg=True), UniverseFilters(q="gold")]

def test_filter_funds_matches_the_table(synthetic):
    for f in CASES:
        table = [x.isin for x in list_funds(**f.model_dump(), data=synthetic)]
        assert list(filter_funds(synthetic.funds(), synthetic.listings(), f).index) == table, f
```

- [ ] **Step 2:** `uv run pytest tests/integration/test_universe_frontier.py -q` → ImportError.
- [ ] **Step 3: implement** — `UniverseFilters` in types.py; move the body of `list_funds` filtering (asset_class, region, esg, ucits, max_ter "unknown TER is kept", q over isin/name/index_name/tickers) into `filter_funds`; `list_funds` builds `UniverseFilters(...)` from its query args and calls it, keeping its signature.
- [ ] **Step 4:** tests pass, plus full backend suite.
- [ ] **Step 5:** commit `refactor(backend): shared filter_funds for the universe table and chart`.

### Task 2: `pipeline.universe_frontier`

**Files:**
- Modify: `backend/app/engine/types.py` (add `UniversePoint`, `UniverseFrontier` after `Frontier`)
- Modify: `backend/app/engine/pipeline.py` (add function after `frontier`)
- Test: `backend/tests/integration/test_universe_frontier.py`

**Interfaces:**
- Consumes: `filter_funds`, `UniverseFilters` (Task 1).
- Produces:
  - `UniversePoint`: `isin: str, name: str, asset_class: str, model: FrontierPoint, realised: FrontierPoint | None, proxied: bool`
  - `UniverseFrontier`: `curve: list[FrontierPoint], capital_market_line: list[FrontierPoint], points: list[UniversePoint], rf: float, period: dict[str, date], warnings: list[str] = []`
  - `pipeline.universe_frontier(filters: UniverseFilters, period_years: int, base: str, points: int, data: DataSource, settings: EngineSettings = EngineSettings()) -> UniverseFrontier`

Algorithm:
1. `shown = filter_funds(...)`; if empty → `UniverseFrontier(curve=[], capital_market_line=[], points=[], rf=0.0, period={}, warnings=[])` — `period` may be empty only here.
2. Rows: `universe.select(funds.loc[shown.index], listings, neutral)` where `neutral` is the profile `_listing_rows` uses (factor it out as `_neutral_profile(base)`); catch `NoEligibleFunds` → empty result; funds without a listing are named in `warnings`. Add anchors with `_extend(rows, funds, listings, base, list(config.ANCHORS[base].values()), error=InsufficientHistory, what="market anchors")`.
3. `rr = _weekly(rows, base, data)`; `cand = [i for i in shown.index if i in rr.returns.columns]`.
4. `s = settings.model_copy(update={"estimation_window_years": period_years})`; `cov, dropped = risk.covariance(rr.returns[cand], period_years)`; `cr = _capm(rr.returns, data.rf(base), config.ANCHORS[base], s, None)`; `isins = [i for i in cov.index if finite(cr.expected.get(i)) and finite(cr.beta.get(i))]`; dropped named in `warnings`.
5. Model point per isin: `vol = sqrt(cov[i,i])`, `ret = cr.expected[i]`, `sharpe = (ret-rf)/vol` or None if vol ≤ 1e-9.
6. Curve: if `len(isins) >= 2`: `cons = Constraints(target_vol=0.0, max_etfs=len(isins), min_position=0.0, max_position=1.0, ter=pd.Series(0.0, index=isins))`; `curve, skipped = _curve(cr.expected[isins], cov.loc[isins, isins], cons, cr.rf, points)`; `cml = _capital_market_line(curve, cr.rf)`; skipped > 0 → warning. Else both empty.
7. Realised per isin over `window = rr.returns.index[-period_years*52:]`: `r = rr.returns[i].reindex(window).dropna()`; `cagr = prod(1+r)**(52/len(r)) - 1`; `vol = r.std()*sqrt(52)`; `rf_mean = mean of data.rf(base) between window[0] and window[-1]`; `sharpe = (cagr-rf_mean)/vol` or None if vol ≤ 1e-9; `None` point if `len(r) < 2` or non-finite.
8. `proxied = i in rr.proxied and rr.proxied[i][1] >= window[0]`.
9. `period = {"start": window[0].date(), "end": window[-1].date()}`. Points in `shown` order.

- [ ] **Step 1: failing tests** (append)

```python
import math, json
import numpy as np
from app.engine import pipeline
from app.engine.types import UniverseFilters

def _uf(synthetic, f=UniverseFilters(), years=5, points=8):
    return pipeline.universe_frontier(f, years, "EUR", points, synthetic)

def test_curve_sorted_and_points_on_or_under_it(synthetic):
    res = _uf(synthetic)
    vols = [p.volatility for p in res.curve]
    assert len(res.curve) >= 5 and vols == sorted(vols)
    for p in res.points:
        m = p.model
        if res.curve[0].volatility <= m.volatility <= res.curve[-1].volatility:
            top = float(np.interp(m.volatility, vols, [c.expected_return for c in res.curve]))
            assert m.expected_return <= top + 5e-3, p.isin

def test_points_follow_the_filters(synthetic):
    res = _uf(synthetic, UniverseFilters(asset_class="bond"))
    assert res.points and {p.asset_class for p in res.points} == {"bond"}

def test_realised_is_cagr_and_vol_over_the_window(synthetic):
    res = _uf(synthetic, UniverseFilters(q="SYNUSEQ00001"), years=3)
    (p,) = res.points
    r = synthetic.weekly_returns("EUR")["SYNUSEQ00001"]  # perfect-proxy series; same economics
    assert p.realised is not None and math.isfinite(p.realised.expected_return)
    assert str(res.period["end"]) <= str(r.index[-1].date())

def test_single_fund_has_no_curve_and_empty_filter_is_empty(synthetic):
    one = _uf(synthetic, UniverseFilters(q="SYNGOLD00001"))
    assert len(one.points) == 1 and one.curve == [] and one.capital_market_line == []
    none = _uf(synthetic, UniverseFilters(q="no such fund"))
    assert none.points == [] and none.curve == []

def test_young_fund_is_dropped_and_named(synthetic):
    res = _uf(synthetic, years=10)
    assert "SYNYOUNG0001" not in {p.isin for p in res.points}
    assert any("SYNYOUNG0001" in w for w in res.warnings)
```

- [ ] **Step 2:** run → AttributeError `universe_frontier`.
- [ ] **Step 3:** implement per the algorithm; keep helpers private in pipeline.py.
- [ ] **Step 4:** tests + full backend suite pass. If `test_young_fund_is_dropped_and_named` fails because SYNYOUNG0001 has a proxy covering the window, replace it with a fund that has no proxy (inspect `synthetic.funds()["proxy_ticker"]`) — keep the assertion shape.
- [ ] **Step 5:** commit `feat(backend): universe risk/return frontier (model + realised)`.

### Task 3: API endpoint, contract, mock, perf test

**Files:**
- Modify: `backend/app/api/schemas.py` (re-export `UniverseFrontier`, `UniverseFilters`; add `UniverseFrontierRequest`)
- Modify: `backend/app/api/universe.py` (add POST route; it must be declared before `/{isin}` — different method, but keep it above for readability)
- Modify: `backend/scripts/export_contract.py` (write `universe_frontier.json`)
- Modify: `backend/tests/test_export_contract.py`
- Test: `backend/tests/integration/test_universe_frontier.py`

**Interfaces:**
- Produces: `POST /api/universe/frontier` body `{filters?: UniverseFilters, period_years=5 (1..15), base_currency="EUR", points=12 (5..40)}` → `UniverseFrontier`. Mock file `frontend/src/mocks/universe_frontier.json`.

- [ ] **Step 1: failing tests**

```python
def _reject(t): raise AssertionError(t)

def test_api_universe_frontier(client):
    r = client.post("/api/universe/frontier", json={"filters": {"asset_class": "equity"}, "period_years": 3, "points": 6})
    assert r.status_code == 200, r.text
    d = json.loads(r.text, parse_constant=_reject)
    assert d["points"] and d["curve"] and {p["asset_class"] for p in d["points"]} == {"equity"}

def test_api_universe_frontier_validates(client):
    assert client.post("/api/universe/frontier", json={"period_years": 0}).status_code == 422
    assert client.post("/api/universe/frontier", json={"points": 2}).status_code == 422
```

Plus in `test_export_contract.py`:

```python
def test_universe_frontier_mock(mocks):
    uf = mocks["universe_frontier"]
    assert len(uf["curve"]) >= 5 and len(uf["points"]) >= 10
```

Plus the perf test (real DB, skipped when absent):

```python
@pytest.mark.skipif(not config.DB_PATH.exists(), reason="real database not present")
def test_real_db_universe_frontier_is_fast_when_warm():
    from app.api.deps import get_data
    data = get_data()
    for base in ("EUR", "USD"):
        pipeline.universe_frontier(UniverseFilters(), 5, base, 12, data)  # cold
        t = time.perf_counter()
        res = pipeline.universe_frontier(UniverseFilters(), 5, base, 12, data)
        elapsed = time.perf_counter() - t
        print(f"universe frontier {base}: {len(res.points)} points, warm {elapsed:.2f}s")
        assert len(res.points) > 100 and elapsed <= 3.0
```

(`client` fixture: check `tests/integration/conftest.py`; the existing frontier API tests use it.)

- [ ] **Step 2:** run → 404 / KeyError.
- [ ] **Step 3:** implement route (inside `ENGINE_LOCK`, like `list_funds`); add to `build_mocks` `pipeline.universe_frontier(UniverseFilters(), 5, "EUR", 12, data)` dumped as `universe_frontier`; regenerate with `uv run python -m scripts.export_contract`.
- [ ] **Step 4:** full backend suite; if the perf test misses 3 s, measure (`cProfile`) and apply spec §6 in order, re-run.
- [ ] **Step 5:** commit `feat(api): POST /api/universe/frontier`.

### Task 4: Frontend transforms and types

**Files:**
- Modify: `frontend/src/api/schema.d.ts` (`npm run gen:api`)
- Modify: `frontend/src/mocks/index.ts` (route `'POST /api/universe/frontier'`; the `/api/universe/` prefix rule must not swallow it)
- Create: `frontend/src/components/charts/universeFrontier.ts`
- Test: `frontend/src/components/charts/universeFrontier.test.ts`

**Interfaces:**
- Consumes: `Schemas['UniverseFrontier']`, `Schemas['UniversePoint']`, `FundFilters`/`filtersToQuery` from `universe.ts`, `assetClassColor`/`assetClassLabel` from `transforms.ts`.
- Produces:
  - `type UFrame = 'model' | 'realised'`
  - `interface UPoint { x: number; y: number; isin: string; label: string; assetClass: string; sharpe: number | null; proxied: boolean }`
  - `universeSeries(f, frame): { curve: XY[]; cml: XY[]; points: UPoint[]; missing: number }` — percent units; realised frame returns `curve: []`, `cml: []`, drops points with `realised == null` and counts them in `missing`.
  - `universeTable(f, frame): ChartTable` head `['Fund', 'Asset class', 'Volatility', 'Return', 'Sharpe']`.
  - `universeLegend(points: UPoint[]): Array<{ key: string; label: string; color: string }>` — one entry per asset class present, in `ASSET_CLASSES` order.
  - `universeRequest(filters: FundFilters, years: number, base: string)` → `{ filters: filtersToQuery(filters), period_years: years, base_currency: base, points: 12 }`.
  - `universeNote(frame, years): string` — model: "Forward-looking estimates. The curve is the best mix of these ETFs the model expects; it is not a forecast of any single fund." realised: "What happened over the last {N years|year}. Not a forecast. No frontier is drawn: the best past mix is only known afterwards."

- [ ] **Step 1: failing tests**

```ts
import { describe, expect, it } from 'vitest';
import type { Schemas } from '../../api/client';
import { emptyFilters } from './universe';
import { universeLegend, universeNote, universeRequest, universeSeries, universeTable } from './universeFrontier';

const pt = (volatility: number, expected_return: number, sharpe: number | null = null) => ({ volatility, expected_return, sharpe });
const f = {
  curve: [pt(0.2, 0.08), pt(0.05, 0.03)], capital_market_line: [pt(0, 0.02), pt(0.2, 0.09)],
  points: [
    { isin: 'A', name: 'Alpha', asset_class: 'equity', model: pt(0.15, 0.07, 0.33), realised: pt(0.16, 0.1, 0.5), proxied: false },
    { isin: 'B', name: 'Beta', asset_class: 'bond', model: pt(0.05, 0.03), realised: null, proxied: true },
  ],
  rf: 0.02, period: { start: '2021-01-01', end: '2025-12-31' }, warnings: [],
} as unknown as Schemas['UniverseFrontier'];

describe('universeSeries', () => {
  it('model frame: curve sorted, every point in percent', () => {
    const s = universeSeries(f, 'model');
    expect(s.curve.map((p) => p.x)).toEqual([5, 20]);
    expect(s.points).toHaveLength(2);
    expect(s.points[0]).toMatchObject({ x: 15, y: 7, isin: 'A', label: 'Alpha', assetClass: 'equity', sharpe: 0.33 });
  });
  it('realised frame: no curve, missing points counted', () => {
    const s = universeSeries(f, 'realised');
    expect(s.curve).toEqual([]);
    expect(s.cml).toEqual([]);
    expect(s.points.map((p) => p.isin)).toEqual(['A']);
    expect(s.missing).toBe(1);
  });
});

it('universeTable follows the frame', () => {
  expect(universeTable(f, 'model').head).toEqual(['Fund', 'Asset class', 'Volatility', 'Return', 'Sharpe']);
  expect(universeTable(f, 'realised').rows).toHaveLength(1);
});

it('universeLegend lists present asset classes in the standard order', () => {
  expect(universeLegend(universeSeries(f, 'model').points).map((l) => l.key)).toEqual(['equity', 'bond']);
});

it('universeRequest maps filters, period and currency', () => {
  expect(universeRequest({ ...emptyFilters, asset_class: 'bond' }, 3, 'USD'))
    .toEqual({ filters: { asset_class: 'bond' }, period_years: 3, base_currency: 'USD', points: 12 });
});

it('universeNote says realised is not a forecast and draws no frontier', () => {
  expect(universeNote('realised', 1)).toMatch(/last year\. Not a forecast\. No frontier is drawn/);
  expect(universeNote('realised', 5)).toMatch(/last 5 years/);
  expect(universeNote('model', 5)).toMatch(/Forward-looking estimates/);
});
```

- [ ] **Step 2:** `npx vitest run src/components/charts/universeFrontier.test.ts` → module not found.
- [ ] **Step 3:** implement; `npm run gen:api`; mocks route: check exact `${method} ${pathname}` in `routes` before applying the `/api/universe/{isin}` prefix rule.
- [ ] **Step 4:** `npm run typecheck && npm test` pass.
- [ ] **Step 5:** commit `feat(frontend): universe frontier transforms and API types`.

### Task 5: `UniverseFrontier` card on `/universe`

**Files:**
- Create: `frontend/src/components/charts/UniverseFrontierChart.tsx`
- Modify: `frontend/src/pages/Universe.tsx` (render card between Filters card and table; pass debounced filters)
- Test: `frontend/e2e/universe-frontier.pw.ts` (create)

**Interfaces:**
- Consumes: Task 4 transforms; `useStore` (`profile.base_currency`); `useRequest`, `Async`, `ChartFrame`, `Card`.
- Produces: `export function UniverseFrontier({ filters }: { filters: FundFilters })`.

Component contract:
- State: `years` (1|3|5|10, default 5), `frame` ('model'|'realised', default 'model').
- Request: `api.POST('/api/universe/frontier', { body: universeRequest(filters, years, base), signal })`, key `JSON.stringify({ q: filtersToQuery(filters), years, base })`.
- Controls: two radiogroups with `className="period"`, aria-labels "Period" and "Frame", labels `1y/3y/5y/10y` and `Model/Realised`.
- `ScatterChart` (comment why, as in FrontierChart): model frame draws curve + CML as line-only `Scatter`s with a no-op shape (legend "Efficient frontier", "Capital market line"); one `Scatter` per asset class (fill `assetClassColor`, r=4, `cursor: pointer`, `onClick={(p) => navigate('/universe/' + p.isin)}`).
- Tooltip `.tip`: name (`.tip-title`), asset class, volatility, return, Sharpe, "Proxied history in this period" if proxied.
- `ChartFrame` title: model "Risk and return of these ETFs: what the model expects"; realised "Risk and return of these ETFs: what happened". `note={universeNote(frame, years)}`, `table={universeTable(f, frame)}`, `description` lists count and frame.
- Under chart: `missing > 0` → "N funds have too little history in this period."; warnings as muted footnote.
- Empty: `points.length === 0` → `<p className="muted">No funds match these filters.</p>`.

- [ ] **Step 1: failing e2e**

```ts
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

test('universe: risk/return card with model and realised frames', async ({ page }) => {
  await page.goto('/universe');
  const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Risk and return' }) });
  await expect(card.locator('.recharts-surface').first()).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText(/Forward-looking estimates/)).toBeVisible();
  await expect(card.locator('.recharts-legend-item-text', { hasText: 'Efficient frontier' })).toBeVisible();
  await card.getByRole('radio', { name: 'Realised' }).check();
  await expect(card.getByText(/No frontier is drawn/)).toBeVisible();
  await expect(card.locator('.recharts-legend-item-text', { hasText: 'Efficient frontier' })).toHaveCount(0);
  const dot = card.locator('.recharts-scatter-symbol').first();
  await dot.hover();
  await expect(card.locator('.tip-title')).not.toBeEmpty();
  await expectNoHorizontalScroll(page);
});
```

- [ ] **Step 2:** run with mock server (`npm run dev:mock` on 5740, stop any other server there) → heading not found.
- [ ] **Step 3:** implement component and page wiring (`const q = useDebounced(filters.q, 300)` already exists — pass `{ ...filters, q }`).
- [ ] **Step 4:** e2e + `npm run typecheck && npm test` pass; screenshot the card at 1280 and 360 px and look at it.
- [ ] **Step 5:** commit `feat(frontend): universe risk/return card (model + realised)`.

### Task 6: Docs and redeploy

**Files:**
- Modify: `README.md` (paragraph under "Comparisons and the efficient frontier")

- [ ] **Step 1:** README paragraph: the universe chart, its two frames, why Realised has no curve, `POST /api/universe/frontier` parameters.
- [ ] **Step 2:** full verification: backend suite, frontend typecheck/unit, e2e.
- [ ] **Step 3:** commit `docs: universe risk/return chart`; `git push origin master`.
- [ ] **Step 4:** `az containerapp up --name roboadvisor --resource-group roboadvisor-rg --location westeurope --source . --ingress external --target-port 8000`.
- [ ] **Step 5:** verify `az containerapp show` still has cpu 1.0, memory 2Gi, minReplicas 1, maxReplicas 2 (restore with `az containerapp update ... --cpu 1.0 --memory 2.0Gi --min-replicas 1 --max-replicas 2` if not); `curl` `/api/health` and `POST /api/universe/frontier` on the live URL; open `/universe` in a browser and hover a point.
