# Textbook Portfolio — Design Spec

Date: 2026-10-04
Status: design approved in brainstorming; awaiting review of this document
Source material: `docs/materials/MBA_AI HC week 4 2026.pptx` (slides 48–70) and `week 5` (slides 6–28)
Follow-up project (separate spec): the same explanatory layout applied to the existing engine's steps.

## 1. Goal

A page that builds a portfolio using only what the course teaches (Markowitz portfolio theory and the CAPM) and
explains every step with the formula, the slide it comes from, a worked example and the full numbers. The audience is
classmates who sat the same lectures.

The existing engine is unchanged and stays the "real" recommendation. The textbook portfolio is a second, simpler
answer that can be followed by hand.

## 2. Decisions taken

| Topic | Decision |
|---|---|
| Method | Tangent (maximum Sharpe) portfolio of risky funds, mixed with a risk-free fund (week 4, slide 66) |
| Risk dial | Risk aversion `A` in `U = E(r_p) − ½·A·σ²` (slide 64) sets the split between tangent portfolio and risk-free fund |
| Risk-free asset | A real T-bill / overnight-rate fund, not a longer bond; longer bonds are risky funds |
| Borrowing | None: the share in the tangent portfolio is capped at 100% |
| Expected returns | CAPM by default, historical averages as a switch |
| Covariance | Plain sample covariance (no shrinkage) |
| Funds | Fixed set of 7 risky building blocks plus 1 risk-free fund per base currency |
| Frequency | Weekly returns (the course's beta examples use monthly); stated on the page |
| Placement | Own page, "Textbook portfolio", route `/textbook`, menu label "Textbook" |
| Engine extras | Not applied: TER penalty, position caps, max ETFs, sector tilts, crypto, investor preferences |

## 3. Scope

In: config for the fund set, one engine module, one endpoint, one page with seven explained steps, tests, contract
mock, README paragraph.

Out: investor preferences (ESG, regions, sectors), backtest and downside analysis of the textbook portfolio,
borrowing (share above 100%), monthly returns, a window selector, user-picked funds, matching the risk-free asset to
the investment horizon (explained in a note only), explanations for the existing engine (follow-up project).

## 4. Configuration (`app/config.py`)

```python
TEXTBOOK_FUNDS = {
    "EUR": {
        "risky": {
            "US equities": "IE00B52SFT06",              # iShares MSCI USA
            "European equities": "IE00B1YZSC51",        # iShares Core MSCI Europe
            "Emerging market equities": "IE00BKM4GZ66", # iShares Core MSCI EM IMI
            "Government bonds": "LU0290355717",         # Xtrackers Eurozone Government Bond
            "Corporate bonds": "IE00B3F81R35",          # iShares Core Euro Corporate Bond
            "Gold": "IE00B579F325",                     # Invesco Physical Gold
            "Real estate": "IE00B0M63284",              # iShares European Property Yield
        },
        "risk_free": "LU0290358497",                    # Xtrackers EUR Overnight Rate Swap
    },
    "USD": {
        "risky": {
            "US equities": "US9229087690",              # Vanguard Total Stock Market (VTI)
            "Developed ex-US equities": "US9219438580", # Vanguard FTSE Developed Markets (VEA)
            "Emerging market equities": "US9220428588", # Vanguard FTSE Emerging Markets (VWO)
            "Government bonds": "US4642874402",         # iShares 7-10 Year Treasury (IEF)
            "Corporate bonds": "US4642872422",          # iShares Investment Grade Corporate (LQD)
            "Gold": "US78463V1070",                     # SPDR Gold Shares (GLD)
            "Real estate": "US9229085538",              # Vanguard Real Estate (VNQ)
        },
        "risk_free": "US78468R6633",                    # SPDR 1-3 Month T-Bill (BIL)
    },
}
TEXTBOOK_WINDOW_YEARS = 5
TEXTBOOK_PREMIUM = 0.05              # default market risk premium (course: 5-7% historical, 3-5% in practice)
TEXTBOOK_RISK_AVERSION = (10.0, 2.0) # A at risk level 0 and at risk level 100
TEXTBOOK_FRONTIER_POINTS = 25
```

Checked against the database on 2026-10-04: every fund above has its own prices in the base-currency listing for the
whole 5-year window, so no proxy returns are used. The EUR real-estate block is the European fund because the global
one (`IE00B5L01S80`) has a EUR listing only since 2023.

Market portfolio for the CAPM: `config.ANCHORS[base]["global_equity"]` (already in config).

## 5. Backend

### 5.1 Endpoint

`POST /api/textbook`, body `TextbookRequest`:

| field | type | default | notes |
|---|---|---|---|
| `base_currency` | `"EUR" \| "USD"` | `"EUR"` | |
| `risk_level` | float | 50 | 0–100 |
| `return_model` | `"capm" \| "historical"` | `"capm"` | which expected return feeds the optimiser |
| `market_premium` | float \| None | None | 0–0.15; None uses `TEXTBOOK_PREMIUM` |

Response `TextbookPortfolio` (all floats finite, as for the other endpoints):

- `inputs`: `window` (`start`, `end` dates), `weeks`, `frequency` (`"weekly"`), `rf`, `premium`, `return_model`,
  `market` (`isin`, `name`), `risk_aversion`.
- `funds: list[TextbookFund]`, one per risky fund in config order: `isin`, `name`, `ticker`, `block` (the config
  label), `asset_class`, `mean_return`, `volatility`, `beta`, `capm_return`, `expected_return` (the one used:
  `capm_return` or `mean_return`).
- `risk_free_fund`: `isin`, `name`, `ticker`, `volatility` (its realised volatility, shown for honesty).
- `correlation`: `isins` (config order) and `matrix` (list of rows).
- `frontier: list[FrontierPoint]`, sorted by volatility.
- `capital_market_line: list[FrontierPoint]`: the risk-free point and the tangent point; empty without a tangent.
- `tangent`: `weights` (isin → weight, zeros left out), `expected_return`, `volatility`, `sharpe`; `None` when no
  fund's expected return is above `rf`.
- `split`: `risk_aversion`, `risky_share_uncapped`, `risky_share`.
- `portfolio`: `weights` (isin → weight, includes the risk-free fund), `expected_return`, `volatility`, `sharpe`.
- `warnings: list[str]`.

`FrontierPoint` is the existing type. Both `beta`/`capm_return` and `mean_return` are always returned, so the page
can show them side by side whichever model is selected.

### 5.2 Computation (`app/engine/textbook.py`)

One public function `textbook(request fields, data) -> TextbookPortfolio`, built from small pure functions that each
take and return pandas objects, so they can be tested without a database.

1. **Returns.** Weekly base-currency returns for the 7 risky funds, the risk-free fund and the market anchor, using
   the existing listing and weekly-returns helpers. Window: the last `TEXTBOOK_WINDOW_YEARS × 52` weeks; weeks where
   any of the 7 funds or the market is missing are dropped. Fewer than 52 remaining weeks → `InsufficientHistory`.
   A fund whose proxy span overlaps the window adds a warning (not expected with the configured funds).
2. **Average return and volatility.** `mean_return` = mean weekly return × 52 (arithmetic, as on slide 52).
   `volatility` = standard deviation of weekly returns × √52.
3. **Covariance and correlation.** Sample covariance of the weekly returns × 52; correlation from it.
4. **Expected returns.** `rf` = last value of the risk-free series. Beta and `capm_return = rf + beta × premium` via
   the existing `expected.capm`, with the market being 100% the global equity anchor and the same window.
   `expected_return` = `capm_return` or `mean_return` according to `return_model`.
5. **Efficient frontier.** `TEXTBOOK_FRONTIER_POINTS` points, long-only, weights summing to 1, no other limits and no
   TER penalty, using the existing frontier helper with loose constraints (as the universe chart does).
6. **Tangent portfolio.** Maximum Sharpe with the same loose constraints, on excess returns `expected_return − rf`.
   If no fund has `expected_return > rf`: no tangent, `risky_share = 0`, a warning explains why.
7. **Split.** `A = A₀ + (A₁₀₀ − A₀) × risk_level / 100` with `TEXTBOOK_RISK_AVERSION`.
   `risky_share_uncapped = (E[R_T] − rf) / (A × σ_T²)`; `risky_share` = that value clipped to [0, 1].
8. **Final portfolio.** Weights = `risky_share × tangent weights`, plus `1 − risky_share` in the risk-free fund.
   `expected_return = rf + risky_share × (E[R_T] − rf)`, `volatility = risky_share × σ_T` (the risk-free fund is
   treated as zero-volatility), `sharpe` = the tangent's Sharpe, or `None` at `risky_share = 0`.

The main pipeline (`pipeline.recommend`, `_fit`) is not modified. If the textbook module needs a pipeline helper
that is currently private, the helper is made importable rather than copied.

### 5.3 Errors

Existing engine errors and their HTTP mapping are reused. A configured ISIN missing from the database →
`InsufficientHistory` naming the ISIN.

## 6. Frontend

### 6.1 Page

`pages/Textbook.tsx`, route `/textbook`, menu entry "Textbook" after "Backtest". Page title "Textbook portfolio".

Controls at the top (local state; they do not change the stored profile):

- **Risk level** slider 0–100, initial value from the stored profile.
- **Expected returns** radiogroup: CAPM / Historical average.
- **Market premium** number input (percent), default 5%. It stays active under Historical, because the CAPM column
  is still shown for comparison.

Base currency comes from the stored profile. Requests are debounced 300 ms; loading and error states via `Async`.

### 6.2 Step layout

One reusable component, `components/textbook/Step.tsx`, with four parts and a closing line:

1. **What we do**: two or three plain sentences.
2. **Formula**: course notation in plain HTML (`<sub>`, `<sup>`), with the source, e.g. "Week 4, slide 66".
3. **Worked example**: the formula filled in with real numbers for one fund (the first in the list) or the portfolio.
4. **Result**: table or chart.
5. **What to notice**: one or two sentences on the lesson.

The follow-up project reuses this component for the existing engine's steps.

### 6.3 The seven steps

| # | Title | Formula shown | Result | Source |
|---|---|---|---|---|
| 1 | Returns and risk per fund | `E[R] = average of R_t`, `SD(R) = √Var(R)`, annualised | Table: fund, average return, volatility | W4 s52–54 |
| 2 | How the funds move together | `Corr(R_i, R_j)`; two-fund `Var(R_P)` | 7×7 shaded correlation table | W4 s60–63 |
| 3 | Expected returns | `E[R_i] = r_f + β_i × (E[R_Mkt] − r_f)`; β as regression slope | Table: fund, beta, CAPM return, historical average, the one used highlighted; security market line chart under CAPM | W4 s69, W5 s6–28 |
| 4 | The efficient frontier | Minimise `SD(R_P)` for each level of `E[R_P]`, `Σx_i = 1`, `0 ≤ x_i ≤ 1` | Risk/return chart: funds and frontier | W4 s64–65 |
| 5 | The tangent portfolio | Sharpe ratio `(E[R_P] − r_f) / SD(R_P)` | Same chart plus risk-free point, capital market line, tangent point; weights table | W4 s66 |
| 6 | Your split | `U = E(r_p) − ½Aσ²` ⇒ `y = (E[R_T] − r_f) / (A·σ_T²)` | `A`, `y` before and after the cap; investor's point on the chart | W4 s64, s66 |
| 7 | Your textbook portfolio | `E[R] = r_f + y(E[R_T] − r_f)`, `SD = y·σ_T` | Weights table and donut; expected return, volatility, Sharpe | W4 s66 |

Steps 4–6 share one chart component, each step adding its layer.

Notes shown on the page:

- Step 1 and 3: weekly returns are used; the course's beta examples use monthly data.
- Step 3, Historical selected: five years of averages are noisy; watch how the tangent portfolio concentrates.
- Step 6: the scale for `A` (10 to 2) is this tool's assumption; the slides give no numbers.
- Step 6: what counts as risk-free depends on the horizon. Over one period it is a T-bill; for a ten-year goal a
  ten-year government bond held to maturity is closer. The model takes the one-period view.
- Step 7: the risk-free fund's realised volatility, shown next to the assumed zero.
- No tangent portfolio: steps 5–7 explain that no fund is expected to beat the risk-free rate, so the answer is 100%
  in the risk-free fund.

Each table has the existing "View as table" fallback where a chart is the primary view.

### 6.4 Files

- `pages/Textbook.tsx`: controls, request, the seven steps.
- `components/textbook/Step.tsx`: the layout component.
- `components/textbook/TextbookChart.tsx`: the layered risk/return chart (recharts, `ChartFrame`).
- `components/textbook/textbook.ts`: pure transforms (table rows, chart series, worked-example strings).
- `components/textbook/copy.ts`: the explanatory text per step.

## 7. Testing

Backend, synthetic data:

- Average return, volatility and one correlation match a hand computation.
- `capm_return` equals `rf + beta × premium` per fund; `expected_return` follows `return_model`.
- Tangent Sharpe ≥ the Sharpe of every frontier point (solver tolerance); tangent weights ≥ 0 and sum to 1.
- `risky_share` matches the formula; clipped at 1 for low `A` and never negative.
- Final weights sum to 1; `volatility = risky_share × σ_T`.
- No fund above `rf` → `tangent` is `None`, 100% risk-free fund, warning present.
- Risk level 0 and 100 give `A` = 10 and 2.

Backend, API: response parses with NaN rejected; request validation (risk level, premium bounds, model).

Backend, real database (skipped when absent): for EUR and USD every configured fund exists and has no proxied weeks
in the window; the endpoint answers within 1 s warm.

Frontend:

- Vitest for the transforms: worked-example strings, correlation table rows, chart series with and without a tangent.
- Playwright (mock mode): the page renders seven steps; switching to Historical changes the highlighted column;
  no horizontal scroll at 360 px.

Contract: `export_contract` gains a `textbook.json` mock; `gen:api` regenerates `schema.d.ts`.

## 8. Build order

1. **Contracts**: config block, request/response types, endpoint stub returning the mock, `textbook.json`,
   regenerated `schema.d.ts`.
2. **Two lanes in parallel**, with separate files:
   - Backend: `engine/textbook.py`, `api/textbook.py`, backend tests.
   - Frontend: page, components, transforms, copy, frontend tests (against the mock).
3. **Integration**: real endpoint behind the page, Playwright run, README paragraph.

## 9. Docs

README: a short section "Textbook portfolio" describing what the page does, how it differs from the main engine,
and where the fund set is configured.
