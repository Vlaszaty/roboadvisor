# Café interface — immersive working slice

The additive `/cafe` route is a Dutch, sunny Amsterdam coffee/matcha scene. The classic routes and risk questionnaire remain available. The café deliberately offers an educational preset exploration, **not an equivalent replacement for the full questionnaire or a suitability assessment**.

## Order and mapping

Four choices: coffee/matcha, horizon (1–40 years), one of five milk presets and one of five sugar presets. An optional positive starting amount changes only the displayed euro values and cost estimate. No monthly contributions.

Milk is self-reported need for financial caution: scores `[100, 75, 50, 25, 0]`, from no milk to extra milk. Sugar is self-reported one-year loss comfort: scores `[100, 85, 65, 35, 0]`, corresponding to more than 30%, up to 30%, up to 20%, up to 10%, and no acceptable loss. These sugar points originate in `max_loss`, but treating that single answer as a ceiling is a new design rule, not the old tolerance calculation.

`profile.risk_level = min(milk.score, sugar.score)`.

The 25 combinations produce eight distinct risk levels. A more cautious milk or sugar choice never increases risk; sometimes the other choice already limits it. The UI explains which choice limits the recipe. No third strength input in this slice.

Coffee means no ESG filter, not non-ESG-only. Matcha means `esg_only=true`, not a sustainability guarantee. Defaults: EUR, main engine, target volatility, multi-asset CAPM, bond hedging, UCITS filter, crypto off, no region/sector filter, 10 funds maximum, 3–40% positions. No fabricated income, experience, buffer, wealth or withdrawal answers; `/api/intake/score` is not called.

“Extra sweet” blocks submission until the user explicitly chooses an educational example with possible loss. Level 0 is still a risky investment example, not savings or a capital guarantee. Short horizons with a strong recipe show a warning; horizon is not a new automatic risk ceiling.

## Local interactive preview

No market ingest or database is needed for this **synthetic** preview. Use two terminals:

```sh
cd backend
uv sync --frozen
uv run python -m scripts.cafe_preview
```

```sh
cd frontend
npm ci
npm run dev:cafe
```

Open **http://127.0.0.1:5741/cafe**. The preview API listens only on `127.0.0.1:8741`. It runs the unchanged real portfolio pipeline against the repository's deterministic synthetic test market. Four synthetic funds get illustrative ESG labels so the matcha demo has a feasible asset mix. These are not actual fund classifications or market observations. Every response carries `X-Cafe-Data: synthetic`, and the UI explicitly labels results. Missing/mismatched preview-source headers fail closed instead of presenting an unverified demo as real.

The standalone preview module is not imported by `app.main`, writes no database, does no ingestion and does not alter production source data. It exposes only health/defaults and portfolio routes, not all classic-page endpoints. Use the usual backend to work on those pages.

For the normal market-data API, run the existing production/dev backend and `npm run dev`, then open `/cafe` on port 5740. Backend errors remain visible; there is no silent fallback to demo numbers.

`npm run dev:mock` still uses the old fixed fixture. Café users must explicitly opt into that fixed demo; it is labeled risk 50, 10 years, broad selection and **not calculated for their choices**. For changing portfolios, use the interactive preview above.

## UI and results

- Own full-viewport `/cafe` route/layout; no external brand header, introduction or classic-interface link. The classic header still gets one Café link.
- Native radio inputs behind the drawn tins, glasses and sugar cubes. Exact financial meaning is announced and shown for the selected preset.
- Own storage key `roboadvisor.cafe.v1`; no overwrite of `roboadvisor.state.v1`. Saved values are validated. Consent and results are not restored automatically.
- Explicit loading/error/retry states. Changes abort pending requests and remove old results. Amount-only changes scale the existing result without changing the model.
- Choices sit on the illustrated bar, with a paper order receipt. Optional amount/model explanation and mandatory loss/mock consent live on that receipt; longer receipts scroll internally. On mobile, dialogue and choices flow together to prevent overlaps. Small viewports may scroll vertically to preserve usable controls.
- Barista blinks and uses existing poses during loading. Reduced-motion and page visibility stop decorative animation. The base `bar-clear.png` is a cup-free edit of the original scene, so there is no duplicate drink. Canvas masks composite only local eye/arm regions from the existing poses, leaving the background stable. Dedicated transparent matcha/coffee cutouts match the scene's ceramic, contours and lighting. No full sprite pack was generated. Exact prompts: `cafe-art-prompts.md`.
- Results replace the choice objects inside the same scene; there is no result-page scroll or route change. The primary view is an illustrated served drink and a short ingredient receipt with chosen milk/sugar/horizon and the computed asset-class names. The cup is a mood illustration, **not a visualization of fund weights or exact milk/sugar quantities**; its latte art is not dynamically repainted per preset.
- A single native details control, closed initially, reveals annual model return, volatility, target, TER costs, actual mix percentages, full engine warnings, the scenario chart and nested technical disclosures. A concise demo-source label, important risk-target mismatch summary and educational/loss notice remain visible before expansion. The fixed fixture never claims to reflect chosen milk/sugar; those choices are omitted from its served receipt.
- Placemat uses the returned fan's actual horizon and p5/p50/p95, in growth factors or euros. It shows a start-capital baseline and an accessible data table. No interpolation or invented return curve.
- Central 90% band is not min/max; median is not a guarantee. TER is not explicitly subtracted from reported model returns; taxation and inflation are not modeled. Loss preference is not a hard loss limit.
- Expandable holdings, drawdown probabilities and recipe assumptions. Drawdown is labeled as decline from an earlier peak during the whole horizon, not next-year loss.

## Verification

```sh
cd frontend
npm run typecheck
npm test
npm run build
npm run e2e:cafe
npm run e2e
```

```sh
cd backend
uv run pytest tests/test_cafe_preview.py -q
```

The live-client café browser tests use port 5742 and their own `test-results-cafe` directory. They intercept API responses to verify input mapping, no-loss consent, mobile persistence, errors/retry, result invalidation, full-viewport layout and closed-then-expanded calculations. The classic mock suite uses 5740 and includes a fixed-demo honesty check. Avoid running a separate master/baseline server on that same classic port during regression tests.

As checked against snapshot `03ee864`, two pre-existing classic browser tests fail on unchanged master as well: `pages.pw.ts` “universe: table rendered” (first DOM table row is hidden), and `universe-frontier.pw.ts` “universe: the chart follows the filters” (fixed mock does not filter returned legend data). These are not repaired in the café branch.

## Next design check

Review the single-scene composition and five-position milk/sugar choices before generating more art. Remaining refinement: smoother serving choreography, dedicated object/character layers, lighter image delivery and polished Dutch engine-warning explanations. The current SVG vessels are interaction placeholders, not final hand-painted sprites.
