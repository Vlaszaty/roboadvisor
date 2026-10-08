# Café method page: design

**Goal.** A second explanatory page in the café, `/cafe/method`, that shows step by step how one café recipe
(drink + strength) was really built by the engine, with that recipe's own numbers. It sits next to the lesson
page `/cafe/textbook`, which keeps teaching the course method on seven fixed funds. Dutch and English from the
start, through the café's existing language switch.

**Why.** The lesson page says "the recipes at the bar follow the same idea with more funds", but the recipes
differ from the lesson in six ways (fund count, shrinkage, market, premium, volatility target instead of risk
aversion, position limits and costs). Classmates should be able to see the method that is actually used.

## Data (backend, done)

The page makes two calls for the chosen `base` (`coffee` | `matcha`) and `profile_id` (1–7):

- `POST /api/menu/order` `{base, profile_id, horizon_years: 10}` → `Recommendation`: `holdings`, `summary`,
  `warnings`, and `trace`, a list of `{step, summary, notes}`. Steps used:
  - `universe`: `n_funds`, `removed` (count per rule: `esg`, `regions_include`, `regions_exclude`,
    `sectors_exclude`, `max_ter`, `distribution`, `crypto`, `non_ucits`, `not_etf`, `small_funds`,
    `hedged_duplicates_and_unlisted`, `foreign_hedged_bonds`, `same_index_duplicates`), `by_asset_class`.
  - `returns`: `frequency`, `start`, `end`, `proxied` (isin → dates), `min_history_years`,
    `short_history_excluded` (isins), `n_candidates`.
  - `covariance`: `method`, `window_years`, `weeks_used`, `n_funds`, `end`, and
    `correlation: {isins, matrix}` for the held funds, largest weight first.
  - `expected_returns`: `rf`, `premium`, `market` (isin → weight), `beta` and `expected` (isin → value, all
    candidates).
  - `constraints`: `target_vol`, `n_candidates`, `max_etfs`, `min_position`, `max_position`, `cash_max`.
  - `optimize`: `strategy`, `target_vol`, `achieved_vol`, `n_holdings`, `weights`.
  - `metrics`: `expected_return`, `volatility`, `sharpe`, `weighted_ter`, `annual_cost_per_10k`,
    `risk_contribution` (isin → share of portfolio risk).
- `POST /api/menu/frontier` `{base, profile_id}` → `Frontier`: `model_curve` (volatility, expected_return),
  `markers` (one `fund:<isin>` per candidate with name and model volatility / expected return, plus
  `portfolio`, references and strategies), `rf`.

The funnel must add up: `n_funds` − every `removed` count except `same_index_duplicates` −
`short_history_excluded.length` − `same_index_duplicates` = `n_candidates`. Rules are applied in that order.

## The page

Same look and layout as `CafeTextbook`: board with title, intro and controls on the left, steps on the right.
Controls: drink (coffee / matcha) and strength (1–7). Both start from the URL (`?base=matcha&strength=3`,
default coffee 4), so the recipe result can link straight to its own explanation.

Seven steps, each a `Step` card (plain sentences, worked example with the recipe's numbers, result, what to
notice, formula behind a disclosure):

1. **Which funds may join.** Funnel table: rule, funds removed, funds left; from all funds to the candidates.
   Only rules that removed something are shown.
2. **How they moved.** Weekly returns over the window; how many weeks; how many funds use a stand-in index for
   the years before they existed; the minimum history.
3. **How risky, and how they move together.** Volatility per held fund and the correlation table of the held
   funds. Worked example: the two largest holdings, half each, mixed volatility against the plain average.
   Explains shrinkage in one or two sentences.
4. **What each fund may earn.** The market used (names and weights), the risk-free rate, the premium; per held
   fund beta and expected return = risk-free + beta × premium, with the largest holding worked out.
5. **The house rules.** The strength's volatility target, at most N funds, each between min and max, cash
   exempt from the maximum (`cash_max`).
6. **Picking the mix.** Highest expected return after fund costs with volatility at or under the target.
   Risk-return chart: every candidate fund, the held funds marked, the frontier, the recipe, and the target as
   a vertical line. Table of weights.
7. **What you get.** Expected return, volatility, cost per year, and each fund's share of the risk next to its
   share of the money.

Tables show the held funds only; the chart shows all candidates.

## Changes

- New: `frontend/src/pages/CafeMethod.tsx`, `frontend/src/cafe/method.ts` (pure helpers) with
  `method.test.ts`, `frontend/src/cafe/methodCopy.tsx` (Dutch and English step text).
- `components/textbook/Step.tsx`: optional labels ("With your numbers", "What to notice", "Show the formula")
  and an optional switch for the Explain button, both defaulting to today's behaviour.
- `App.tsx`: route `cafe/method`. `cafe/Results.tsx`: the "how is such a mix calculated" link goes to the
  method page for that recipe. `CafeTextbook.tsx`: intro says the bar uses a stricter variant and links to it.

## Not in scope

Translating the lesson steps to Dutch. Fund names and engine warnings stay as the backend gives them.
