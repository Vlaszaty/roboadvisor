# Universe Risk/Return Chart — Design Spec

Date: 2026-09-30
Status: approved in brainstorming (option C: Model + Realised frames; chart follows the table filters)
Builds on: `2026-09-30-comparisons-frontier-design.md` (portfolio frontier, hindsight since removed)

## 1. Goal

On the ETF universe page, show where every ETF sits on a risk/return chart, with a period selector:

- **Model** frame: forward-looking CAPM expected return against volatility, with the efficient frontier of the
  shown ETFs drawn through them.
- **Realised** frame: what actually happened over the period (CAGR against volatility), as a scatter only.

This describes the universe; it does not judge a portfolio. That is why a realised frame is acceptable here while the
hindsight frontier on the portfolio page was removed: the realised frame draws **no curve**, because the best past mix
is only known afterwards and a curve through realised returns is exactly the hindsight frontier.

## 2. Scope

In: new endpoint, new card on `/universe`, shared filter function, tests, README paragraph.
Out: caching (only if the performance budget in §6 is missed), per-fund frontier on the fund detail page, currency
selector on the universe page (the profile's base currency is used).

## 3. Backend

### 3.1 Shared filter

Move the filter body of `GET /api/universe` (`app/api/universe.py::list_funds`) into
`filter_funds(funds, listings, filters) -> pd.DataFrame`. `list_funds` and the new endpoint both call it, so the table
and the chart always show the same set. Filters: `asset_class`, `region`, `esg`, `ucits`, `max_ter`, `q` (unchanged
semantics, including "unknown TER is kept").

### 3.2 Endpoint

`POST /api/universe/frontier`, body `UniverseFrontierRequest`:

| field | type | default | notes |
|---|---|---|---|
| `filters` | `UniverseFilters` | all empty | same fields as the `GET /api/universe` query |
| `period_years` | int | 5 | 1–15 (UI offers 1, 3, 5, 10) |
| `base_currency` | `"EUR" \| "USD"` | `"EUR"` | returns in this currency (FX applied as elsewhere) |
| `points` | int | 12 | 5–40, points on the model curve |

Response `UniverseFrontier`:

- `curve: list[FrontierPoint]`: model efficient frontier, sorted by volatility; empty when fewer than 2 funds.
- `capital_market_line: list[FrontierPoint]`: as on the portfolio frontier; empty when `curve` is empty.
- `points: list[UniversePoint]`: one per shown fund: `isin`, `name`, `asset_class`,
  `model: FrontierPoint`, `realised: FrontierPoint | None` (None when the fund has no complete-enough history in
  the period), `proxied: bool` (part of the period uses the proxy index).
- `rf: float`, `period: {start: date, end: date}`, `warnings: list[str]`.

All floats finite (no NaN in JSON), as for `/api/frontier`.

### 3.3 Computation (`pipeline.universe_frontier`)

1. `filter_funds`, then build listing rows for those funds plus the market anchors of the base currency (anchors are
   needed for beta even when filtered out; they are not returned as points unless they match the filters).
2. Weekly base-currency returns via `_weekly` (proxies included, as in `recommend`).
3. Window: the last `period_years × 52` weeks. Funds below `config.MIN_COVERAGE` in the window are dropped and named
   in `warnings`.
4. **Model**: Ledoit-Wolf covariance over the window (same estimator as `recommend`); expected return
   `rf + beta × premium` via `_capm` with `estimation_window_years = period_years` and the default settings' model and
   premium. Point = (sqrt of the fund's variance, expected return, Sharpe).
5. **Curve**: `_curve` with loose `Constraints`: long-only, weights sum to 1, `max_position = 1`, no minimum position,
   no cardinality (`max_etfs` = number of funds), no group limits, TER penalty 0. Solver misses are skipped and
   counted in `warnings`.
6. **Realised**: per fund over the window: CAGR from compounded weekly returns, volatility = std × sqrt(52),
   Sharpe = (CAGR − mean rf over the window) / vol, None when vol is ~0 (cash). `proxied` = the fund's proxy span overlaps the window.
7. Trace is not returned (the page has no trace view); notes go in `warnings` only when they matter to the reader.

Edge cases: 0 funds after filtering → 200 with empty `points` and `curve`; 1 fund → its point, no curve;
anchors missing from the database → `InsufficientHistory` (as elsewhere).

## 4. Frontend

New `UniverseFrontier` card on `pages/Universe.tsx`, between the Filters card and the table.

- Request key: debounced filters (same 300 ms debounce as the table), period, `profile.base_currency` from the store.
- Controls: **Period** radiogroup 1y/3y/5y/10y (default 5y), **Frame** radiogroup Model/Realised (default Model).
- Chart (recharts, same axes/tooltip/ChartFrame as `FrontierChart`): x volatility, y return, points coloured by
  asset class with a legend; Model frame also draws the frontier and the capital market line; Realised frame draws
  points only. Points without a realised position are left out in Realised and counted under the chart.
- Tooltip: name, volatility, return, Sharpe, "proxied before inception" when set. Clicking a point navigates to
  `/universe/:isin`.
- Captions:
  - Model: "Forward-looking estimates. The curve is the best mix of these ETFs the model expects; it is not a
    forecast of any single fund."
  - Realised: "What happened over the last N years. Not a forecast. No frontier is drawn: the best past mix is
    only known afterwards."
- `View as table` fallback: Fund, Asset class, Volatility, Return, Sharpe for the selected frame.
- Empty filter result: the existing empty state text; loading and error states via `Async`.
- Warnings shown as a muted footnote, as on the portfolio frontier.

Pure transforms live in `components/charts/universeFrontier.ts` (series, table, description, colours).

## 5. Testing

Backend (synthetic data unless noted):

- `filter_funds` gives the same ISINs as `GET /api/universe` for a few filter combinations.
- Curve sorted by volatility and finite; every model point lies on or under the curve (within solver tolerance).
- Realised CAGR and volatility match a hand computation for one fund.
- 0 and 1 fund after filtering; a fund below coverage is dropped and named.
- API response parses with NaN rejected; request validation (period, points bounds).
- Real DB, skipped when absent: all funds, EUR and USD, 5y, 12 points, warm time ≤ 3 s.

Frontend:

- Vitest for the transforms (frame switch, table rows, colours, dropped-realised count).
- Playwright (mock mode): card renders on `/universe`, frame switch changes the caption and removes the curve,
  a filter reduces the point count, no horizontal scroll at 360 px.

Contract: `export_contract` gains a `universe_frontier.json` mock; `gen:api` regenerates `schema.d.ts`.

## 6. Performance

Budget: warm ≤ 3 s for the full universe (about 300 funds) at 12 points. If missed, first measure where the time goes,
then in this order: fewer curve points for large sets; restrict the curve's optimisation to funds that are not
dominated; an in-process cache keyed on (filters, period, currency, last data date).

## 7. Docs

README: one paragraph under "Comparisons and the efficient frontier" describing the universe chart, its two frames,
and why the realised frame has no curve.
