# Robo-Advisor

A robo-advisor that explains itself. It turns an investor profile (risk level 0–100 plus preferences) into an ETF
portfolio and shows the calculation behind it, so it works as a teaching tool for portfolio theory as well as a
working advisor. Educational tool, not financial advice.

## What is in the app

| Page | What it does |
|---|---|
| **Start** (`/start`) | A questionnaire scores your risk level and collects preferences (ESG, regions, sectors, costs, crypto). |
| **Portfolio** (`/portfolio`) | The recommended portfolio: holdings, asset mix, expected return and volatility, downside (Monte Carlo and stress tests), the efficient frontier, and a trace of every calculation step. |
| **Backtest** (`/backtest`) | How the portfolio would have done, static or walk-forward, next to World equities and the S&P 500. |
| **Textbook** (`/textbook`) | The portfolio you get from portfolio theory and the CAPM alone, built in seven explained steps. |
| **ETFs** (`/universe`) | The fund universe with filters, a risk/return chart and a page per fund. |

## Two ways to build a portfolio

The app has a full engine and a deliberately simple textbook version. Comparing them shows what the refinements do.

| | Main engine (Portfolio page) | Textbook (Textbook page) |
|---|---|---|
| Funds | Every fund that passes your preferences (about 320 in the universe) | 7 fixed building blocks plus a risk-free fund |
| Expected returns | CAPM against a 60/40 or all-equity market | CAPM against global equities, or historical averages |
| Covariance | Ledoit-Wolf shrinkage | Plain sample covariance |
| Risk dial | Risk level sets a target volatility of 2–20% | Risk level sets risk aversion `A`, which splits money between the tangent portfolio and the risk-free fund |
| Limits | Position size, number of funds, sector tilts, crypto cap, a cost penalty | Weights between 0 and 1 that add up to 1 |
| Strategies | Target volatility, minimum variance, maximum Sharpe, risk parity, hierarchical risk parity | Maximum Sharpe (tangent) portfolio |

Specs: [`docs/superpowers/specs/`](docs/superpowers/specs/) (start with
[`2026-09-29-roboadvisor-design.md`](docs/superpowers/specs/2026-09-29-roboadvisor-design.md)) ·
Plans: [`docs/superpowers/plans/`](docs/superpowers/plans/)

## Quick start

### Café interface preview

The additive **`/cafe`** route offers the sunny Amsterdam coffee/matcha order flow: four choices, five milk/sugar presets, a served portfolio and future-scenario placemat. The classic interface remains available.

For an interactive demo without downloading market data: run `uv run python -m scripts.cafe_preview` from `backend/`, then `npm run dev:cafe` from `frontend/`, and open **http://127.0.0.1:5741/cafe**. This uses the real engine with explicitly labeled **synthetic data**, not actual prices or ESG classifications. See [café setup, mappings and tests](docs/cafe-interface.md). The standard backend also serves the new route in a normal build.

### Existing app

```bash
# backend (port 8740)
cd backend
uv sync
uv run python -m app.data.ingest          # first run downloads all history (20-60 min); later runs are incremental
uv run uvicorn app.main:app --port 8740   # API docs: http://localhost:8740/docs

# frontend (port 5740), second terminal
cd frontend
npm install
npm run dev                               # http://localhost:5740, proxies /api to 8740
```

Mock mode: `npm run dev:mock` runs the frontend without a backend, on responses generated from the real
engine on a synthetic market. Without a database the API answers 503 ("run `python -m app.data.ingest`").

Restart the backend after pulling new code or after a re-ingest: the command above does not reload on changes,
and the backend caches its database connection.

## Textbook portfolio

The Textbook page builds a portfolio with only the method from the course, in seven steps:

1. Average return and volatility of seven funds, one per asset class.
2. How the funds move together (correlations).
3. Expected returns from the CAPM, or from historical averages.
4. The efficient frontier of the seven funds.
5. The tangent (maximum Sharpe) portfolio and the capital market line.
6. Your split between the tangent portfolio and a risk-free fund, from risk aversion `A = 10 − 8 × risk level / 100`.
7. The resulting portfolio.

Each step shows the formula in the course's notation, the slide it comes from, a worked example with the real numbers,
and the result. The controls at the top (risk level, CAPM or historical averages, market premium) recalculate the
whole page, so you can watch a change work its way through the steps.

It differs from the main engine on purpose: a fixed fund set (`TEXTBOOK_FUNDS` in `backend/app/config.py`), plain
sample covariance, no cost penalty, no position limits, no borrowing and no investor preferences. It uses weekly
returns over the last five years, where the course's examples use monthly data. `POST /api/textbook` takes
`base_currency`, `risk_level`, `return_model` (`capm` or `historical`) and an optional `market_premium` (0–0.15).

## Data and ingest

- `backend/data/etfs.csv` is the curated universe (one row per listing). `backend/data/roboadvisor.db` is SQLite and git-ignored.
- `uv run python -m app.data.ingest` fetches yfinance prices, FX and risk-free rates (USD ^IRX, EUR ECB €STR/EONIA), then prints a quality report. Problems are reported, never silently fixed.
- `--full` re-downloads the maximum history for every ticker instead of updating incrementally.
- `--check-currencies` only compares each listing's currency in the CSV with the currency Yahoo quotes it in (exit code 1 on a mismatch).
- Override the DB location with `ROBO_DB_PATH=/path/to.db`.

Last ingest: 319 funds, 469 listings. The quality report flagged 7 `extreme_move` items, all genuine crypto
crashes (BTC-USD, ETH-USD and the crypto ETPs, worst about -42% in one week, March 2020), which are accepted.

## Tests

```bash
cd backend && uv run pytest               # engine, data, API integration (synthetic market, no network)
cd frontend && npm run typecheck && npm test
cd frontend && npm run e2e                # Playwright, starts `npm run dev:mock` itself (stop other servers on 5740)
```

Golden run (real data): `backend/tests/integration/test_golden.py` compares the reference EUR profile (risk 50,
horizon 10, defaults) with `golden_eur_50.json`; it is skipped when no DB exists. After an intended change
(new data, model change) review the numbers and re-record: `cd backend && uv run python -m scripts.golden --write`.

After changing `app/engine/types.py`, `app/api/schemas.py`, the engine or the questionnaire, regenerate the contract:

```bash
cd backend && uv run python -m scripts.export_contract   # backend/openapi.json + frontend/src/mocks/*.json
cd ../frontend && npm run gen:api                        # src/api/schema.d.ts
```

## Deploy

One container serves the API and the built frontend; the SQLite database is baked into the image, so refresh the
data with the ingest locally and redeploy. Local check: `docker build -t roboadvisor . && docker run -p 8000:8000 roboadvisor`.

Azure Container Apps (builds the image in Azure, no CI/CD):

```bash
az containerapp up --name roboadvisor --resource-group roboadvisor-rg --location westeurope \
  --source . --ingress external --target-port 8000
```

Run the same command again to redeploy.

## Comparisons and the efficient frontier

The portfolio page compares your portfolio with two yardsticks: World equities and the S&P 500. They are
references to measure against, not candidates the optimizer may pick, and they never enter your holdings.
"Today's mix, applied to the last N years" shows how all three would have done over the past 1, 3, 5, 10 or 15
years. It is not a track record: today's weights were estimated on (part of) that period, so it flatters the
portfolio. The backtest page is the honest test: its walk-forward mode only uses data available at each date, and it
adds the two yardsticks as extra columns.

The efficient frontier chart plots risk (volatility) against expected return using the model's forward-looking
estimates, built from your candidate funds and constraints. With the default target-volatility strategy your portfolio
sits on the model curve by construction, because that is what the optimizer aims for; the other strategies do not aim
for it. Markers show your portfolio, the references, the four strategies and, optionally, individual funds. The dotted
line is the capital market line.

There is deliberately no "hindsight" frontier (the same curve on realised returns): portfolios judged on the period
their inputs came from always look better than they will turn out, which paints a false picture.

`POST /api/frontier` takes `profile`, `settings` and `points` on the curve (5–40, default 20; the UI asks for 12 to
keep USD requests fast).

The ETF universe page has a risk/return chart of every fund that matches the table filters, over a 1, 3, 5 or 10
year period. **Model** places each fund at its CAPM expected return and Ledoit-Wolf volatility over that period and
draws the long-only efficient frontier of the shown funds (no position caps or cost penalty). **Realised** places
each fund at its actual CAGR and volatility over the same weeks and draws no curve: a frontier through past returns is
only known afterwards. `POST /api/universe/frontier` takes `filters` (the `GET /api/universe` fields),
`period_years` (1–15, default 5), `base_currency` and `points` (5–40, default 12).

## Architecture

- `backend/app/engine/`: pure calculation modules; `pipeline.py` wires them (recommend, backtest) and records a
  `trace` step per stage (`universe, returns, covariance, expected_returns, constraints, optimize, metrics, downside, backtest`).
  `textbook.py` is the self-contained textbook calculation; it reuses the pipeline's data helpers and leaves the main engine untouched.
- `backend/app/api/`: FastAPI routes under `/api`; domain errors map to 422, missing data to 503. The API is stateless.
- `backend/app/data/`: SQLite schema, ingestion, quality report.
- `backend/tests/fixtures/synthetic.py`: deterministic synthetic market used by the tests and the mocks.
- `frontend/src/`: React + Vite; `api/` typed client (with mock mode), `state/` profile store, `pages/`, `intake/`.
  Heavy pages (portfolio, backtest, universe) are code-split.
  `components/textbook/` holds the step layout (`Step.tsx`), the explanatory text (`copy.tsx`) and the transforms.

## Known limitations / modelling notes

- **Survivorship bias.** Backtests use today's fund list at every past date, so funds that closed or merged are absent and results look better than a real investor's would.
- **Proxy history in walk-forward.** Before a share class launched, its returns come from its proxy index, so the walk-forward test can hold a fund before it existed.
- **Static backtests are look-ahead biased.** They apply today's weights over the whole past. Walk-forward (weights re-estimated using only data available at each date) is the honest test; expect it to look worse.
- **The 2008 stress test can be empty.** For conservative EUR profiles the EUR bond and cash funds lack history before 2011, so there is no 2008 result (the scenario is shown as unavailable rather than guessed).
- **TERs** were checked against justETF for only about 45 of the 319 funds; the rest come from the curated CSV and may be slightly off.
- **Yahoo data caveats.** London listings quoted in pence use the currency code GBX (prices are divided by 100 for display; returns are unaffected). Tickers that returned bad data were removed. Yahoo can revise history without notice.
- **Risk level and volatility.** Risk 0–100 maps linearly to a target volatility of 2–20% (the range is configurable). At risk 50 (an 11% target) the optimizer can hold about 80% equity, for two reasons: (a) USD equities measured in EUR have lower volatility, because the dollar tends to rise when equities fall, and (b) bonds have a low correlation with equities. Together these let the portfolio reach the 11% target with a high equity share. If you want a classic balanced mix (around 60/40), pick a lower risk level. With `hedge_bonds` on, unhedged siblings of a bond fund with a share class hedged to your currency are dropped, and so are bond funds hedged to another currency; hedged bonds are not forced in.
- **Crypto** is opt-in and capped. Its history comes from BTC-USD and ETH-USD, available from 2014.
- **Not financial advice.** Simulations and backtests use historical data and modelling assumptions; past performance is no guarantee of future results.
