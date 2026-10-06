# Café interface — immersive working slice

The additive `/cafe` route is a Dutch, sunny Amsterdam coffee/matcha scene. The classic routes and risk questionnaire remain available. The café deliberately offers an educational preset exploration, **not an equivalent replacement for the full questionnaire or a suitability assessment**.

## Order and mapping

Six choices, shown one at a time, with a permanent menu board (sidebar on wide screens, a folded bar that opens as a sheet on phones) that lists every answer, what it means, and the recipe strength so far.

| Step | Café question | Feeds | Points |
|---|---|---|---|
| 1 | Coffee or matcha | fund selection | coffee: every fund; matcha: ESG-labelled funds only |
| 2 | Time (1 to 40 years) | capacity | the classic questionnaire's horizon bands: up to 2 years 0, 5 years 25, 10 years 50, 20 years 75, longer 100 |
| 3 | Savings jar: months of fixed costs saved | capacity | 12+ months 100, 6 to 12 months 70, 3 to 6 months 35, under 3 months 0 |
| 3 | Costly debt (credit card, overdraft, personal loan) | capacity | none 100, some 0 |
| 4 | Experience (stamp card) | tolerance | first visit 0, under 3 years 35, 3 to 10 years 70, over 10 years 100 |
| 5 | Milk: financial room for losses | capacity | 100, 75, 50, 25, 0 |
| 6 | Sugar: one-year loss that still feels acceptable | tolerance | more than 30%: 100, up to 30%: 85, up to 20%: 65, up to 10%: 35, no loss: 0 |

Capacity is the mean of its answers, tolerance the mean of its answers, and the risk score is the lower of the two. This is the same method as the classic questionnaire (`backend/app/intake/scoring.py`). "Extra sweet" (no loss accepted) always gives the mildest profile and needs an explicit consent before any request. The board names which side sets the strength and warns when the two differ by more than 20 points. A nearly empty savings jar, costly debt or a horizon of 2 years or less show a nudge; they are not scored twice.

### The menu: 7 profiles x 2 bases = 14 defined portfolios

The score picks one of seven profiles (`backend/app/engine/menu.py`). Each profile is a fixed target volatility for the main engine:

| Profile | Name (NL / EN) | Score band | Target volatility |
|---|---|---|---|
| 1 | Heel zacht / Very mild | 0 to 14 | 3% |
| 2 | Zacht / Mild | 15 to 28 | 5% |
| 3 | Rond / Smooth | 29 to 42 | 7% |
| 4 | In balans / Balanced | 43 to 57 | 9% |
| 5 | Vol / Rich | 58 to 71 | 11% |
| 6 | Sterk / Strong | 72 to 85 | 13% |
| 7 | Extra sterk / Extra strong | 86 to 100 | 14.5% |

The top stays at 14.5% because the ESG (matcha) universe cannot go much higher; this keeps all seven matcha portfolios different. Every menu item uses the same café preferences: EUR, UCITS ETFs only (no ETPs or ETCs), no crypto, bonds hedged to euro where possible, at most 10 funds, positions of 3 to 40%, and funds of at least EUR 100 million (funds whose size Yahoo does not report are kept). So everyone on the same item gets the same funds and weights; horizon and amounts only change the outlook.

Seven ESG-labelled euro bond ETFs were added to `backend/data/etfs.csv` (corporate, short corporate, government climate, green and global aggregate bonds). Without them every matcha portfolio was 100% shares. Before their own history starts they use proxies (iShares Core EUR Corp Bond, Xtrackers Eurozone Government Bond, Xtrackers Eurozone Government 1-3, or AGG).

API: `GET /api/menu` returns the 14 items with holdings, mix, model return and volatility, monthly VaR, the 10-year outlook for a one-off amount, and 3- and 5-year walk-forward results (weights re-estimated every quarter with only the data known at that date). It is built once per data version and warmed at server start (`ROBO_WARM_MENU=0` turns that off). `POST /api/menu/order` returns one item for a person's horizon, one-off and monthly amounts.

The page `/cafe/menu` shows all seven strengths per base side by side: a growth chart and a table with 3- and 5-year returns, deepest fall, worst month, 95% and 99% monthly VaR, swing, model return and the 10-year outlook.

### Fund size and trading volume

The ingest now also reads `totalAssets` and `averageVolume` from Yahoo for every listing (`fund_stats` table; `--skip-stats` skips it). Fund size is converted to EUR at the latest stored rate; trading volume is summed over all listings as euros traded per day. On the last ingest Yahoo reported a size for 251 of 326 funds and a volume for all of them.

### Value at Risk

Every recommendation carries monthly VaR at 95% and 99%, by the historical method (quantile of past monthly returns) and the variance-covariance method (normal curve), over the portfolio's own and proxy history.

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

- Café-only Dutch/English language switch on an opaque in-scene paper tab, with accessible pressed state and 44px controls. Dutch remains the default; the chosen language is validated and saved under the separate `roboadvisor.cafe.language.v1` key. Switching keeps the current step, choices, consent, result and expanded disclosures intact, without another API request. The classic interface is unchanged.
- Both languages cover questions, all five milk/sugar names and financial explanations, serving sentence, receipts, model cautions, local errors, chart axes/accessible descriptions, tables, loading states and footer. Fund names, ISINs and original engine warnings/trace notes are preserved rather than translating financial identifiers or arbitrary backend messages. Original English engine notes have their own language annotation.
- Number, euro and chart formatting uses `nl-NL` or `en-GB`; the investment currency remains EUR. The optional starting amount accepts both `10.000,50` and `10,000.50`, with consistent interpretation even when the language changes. Malformed grouping, scientific notation, negative values and amounts above €1 billion remain rejected.
- Own full-viewport `/cafe` route/layout; no external brand header, introduction or classic-interface link. The classic header still gets one Café link.
- Native radio inputs behind the drawn tins, glasses and sugar cubes. Exact financial meaning is announced and shown for the selected preset.
- Own storage key `roboadvisor.cafe.v1`; no overwrite of `roboadvisor.state.v1`. Saved values are validated. Consent and results are not restored automatically.
- Explicit loading/error/retry states. Changes abort pending requests and remove old results. Amount-only changes scale the existing result without changing the model.
- Choices sit on the illustrated bar. The order lives on the menu board beside the scene. The starting amount, the monthly amount and the no-loss/mock consent sit under the last choice; the next/back buttons are on the board on wide screens and in a sticky bar at the bottom on phones.
- The choice objects sit on an opaque warm linen placemat with a subtle weave, stitched edges and contact shadow. Opaque cream name cards and a paper explanation strip keep text independent of the busy background. Choice text is 14px on desktop and at least 12px on tablet/mobile. Selected objects lift slightly, with a dark green card and a decorative check mark; native radio checked state remains the accessible source of truth. SVG glass/sugar contours are strengthened. Dialogue and step-navigation paper are also opaque; the café background is not dimmed or blurred.
- On phones the menu board folds into a bar at the top with one chip per answer; the Menu button opens the full board as a sheet (Escape closes it).
- Barista blinks and uses existing poses during loading. Reduced-motion and page visibility stop decorative animation. The base `bar-clear.png` is a cup-free edit of the original scene, so there is no duplicate drink. Canvas masks composite only local eye/arm regions from the existing poses, leaving the background stable. Dedicated transparent matcha/coffee cutouts match the scene's ceramic, contours and lighting. No full sprite pack was generated. Exact prompts: `cafe-art-prompts.md`.
- Results replace the choice objects inside the same scene, without changing route. The barista serves the selected coffee/matcha with one conversational milk/sugar sentence, rather than a large ingredient list. A small drawn clock beside the cup shows the **returned** horizon. The cup is a mood illustration, **not a visualization of fund weights or exact milk/sugar quantities**; its latte art is not dynamically repainted per preset.
- A till receipt lists **all returned holdings** with their actual weights, grouped into equity funds, bond funds and any other returned asset classes. These are funds, not fabricated individual shares. The primary receipt shows expected annual model return, estimated annual volatility and the modeled probability of finishing below the initial investment after the returned horizon. No hardcoded investment outcomes.
- The sweet–bitter pointer follows **achieved volatility**, not the requested risk level or sugar preset. It is normalized against the unchanged engine's 2–20% reference range; only the artwork is clamped outside that range, never the displayed percentage. This is a visual metaphor for estimated fluctuations, not a full risk assessment, return guarantee or maximum-loss limit. Visible text identifies model uncertainty and that reported returns do not deduct fund costs, tax or inflation.
- A single native details control, closed initially, reveals the full calculation, target volatility, TER costs, actual mix percentages, full engine warnings, the scenario chart, fund identifiers and nested technical disclosures. The concise demo-source label, important risk-target mismatch summary and educational/loss notice remain visible before expansion. The fixed fixture has its own serving sentence and never attributes its recipe to selected milk/sugar.
- On phones the result receipt flows below the served cup and scrolls with the page, rather than clipping the funds into a small internal panel. The illustrated upper scene stays 480px high, continuing into a warm counter surface behind the receipt, so a longer result does not enlarge the barista behind the drink. On larger screens the receipt and drink sit alongside each other on the same bar.
- The receipt leads with three euro outcomes (5th, 50th and 95th percentile) after the horizon, for the person's one-off and monthly amounts or for a EUR 10,000 example, then a dip warning (model chance of a 30% fall from an earlier high), the mix and funds with region, fund size and volume, monthly VaR, and the profile's past results. The scenario chart and the fund table sit in the closed calculation details.
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

The live-client café browser tests use port 5742 and their own `test-results-cafe` directory. They intercept API responses to verify input mapping, no-loss consent, mobile persistence, errors/retry, result invalidation, full-viewport layout and closed-then-expanded calculations. Result checks cover the serving sentence, returned horizon, every holding and weight, visible modeled return/volatility/loss probability, achieved-risk pointer and additional asset classes. Long phone receipts at 390×844 and 320×640 remain scrollable with reachable details/edit controls and no drink/receipt overlap. A readability check covers all milk/sugar presets at 1440, 768, 390 and 320px: text size ≥12px, text-to-surface contrast ≥4.5:1, selection indicator, no horizontal overflow and no mobile question/choice overlap. A short-phone check covers a long order with consent and expanded optional settings. This is a targeted text/layout check, not a full accessibility certification. The classic mock suite uses 5740 and includes a fixed-demo honesty check. Avoid running a separate master/baseline server on that same classic port during regression tests.

As checked against snapshot `03ee864`, two pre-existing classic browser tests fail on unchanged master as well: `pages.pw.ts` “universe: table rendered” (first DOM table row is hidden), and `universe-frontier.pw.ts` “universe: the chart follows the filters” (fixed mock does not filter returned legend data). These are not repaired in the café branch.

## Next design check

Review the single-scene composition and five-position milk/sugar choices before generating more art. Remaining refinement: smoother serving choreography, dedicated object/character layers, lighter image delivery and polished Dutch engine-warning explanations. The current SVG vessels are interaction placeholders, not final hand-painted sprites.
