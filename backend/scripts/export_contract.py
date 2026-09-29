"""Write backend/openapi.json and frontend/src/mocks/*.json.

Run from backend/: `uv run python -m scripts.export_contract`. Mock numbers are plausible, not engine output.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

from app import config
from app.api.health import defaults
from app.api.schemas import Health, fund_summary
from app.engine.types import (
    BacktestResult, BacktestSeries, Downside, FanPoint, FundDetail, Holding, IntakeScore, ListingOut,
    NormalComparison, PortfolioSummary, PricePoint, ProbabilityPoint, ProxiedPeriod, Question, QuestionOption,
    Questionnaire, Recommendation, StepResult, StressResult,
)
from app.main import app
from tests.fixtures.synthetic import SyntheticData

BACKEND = Path(__file__).resolve().parents[1]
MOCKS = BACKEND.parent / "frontend" / "src" / "mocks"

WEIGHTS = {
    "IE00B6R52259": 0.30, "SYNEUEQ00001": 0.10, "SYNEMEQ00001": 0.08, "IE00BDBRDM35": 0.30,
    "SYNGOVS00001": 0.12, "SYNGOLD00001": 0.05, "SYNCASH00001": 0.05,
}


def _r(x: float) -> float:
    return round(float(x), 6)


def build_mocks() -> dict:
    data = SyntheticData()
    funds, listings = data.funds(), data.listings()
    weekly = data.weekly_returns("EUR")
    tickers = listings.groupby("isin")["ticker"].apply(list)

    w = pd.Series(WEIGHTS)
    port = (weekly[w.index] * w).sum(axis=1, min_count=len(w)).dropna()
    vol = port.std() * np.sqrt(52)
    er = 0.052

    holdings = []
    for isin, weight in WEIGHTS.items():
        f = funds.loc[isin]
        lst = listings[(listings["isin"] == isin) & listings["is_primary"]].iloc[0]
        beta = {"equity": 1.0, "bond": 0.15, "commodity": 0.1, "cash": 0.0}[f.asset_class]
        holdings.append(Holding(
            isin=isin, ticker=lst.ticker, exchange=lst.exchange, name=f["name"], weight=weight,
            asset_class=f.asset_class, sub_class=f.sub_class, region=f.region, ter=f.ter, beta=beta,
            expected_return=_r(0.02 + beta * 0.035), risk_contribution=0.0, proxied=f.proxy_ticker is not None,
        ))
    rc = np.array([h.weight * (h.beta + 0.05) for h in holdings])
    for h, c in zip(holdings, rc / rc.sum()):
        h.risk_contribution = _r(c)

    mix: dict[str, float] = {}
    for h in holdings:
        mix[h.asset_class] = round(mix.get(h.asset_class, 0) + h.weight, 4)
    wter = sum(h.weight * (h.ter or 0) for h in holdings)
    thresholds = list(config.DRAWDOWN_THRESHOLDS)
    fan = [
        FanPoint(year=y, **{f"p{p}": _r(np.exp((er - vol**2 / 2) * y + z * vol * np.sqrt(y)))
                            for p, z in zip(config.FAN_PERCENTILES, (-1.645, -0.674, 0, 0.674, 1.645))})
        for y in range(0, 11)
    ]
    stress = [StressResult(event=n, start=s, end=e, loss=loss, proxied=s < "2011-10-21")
              for (n, s, e), loss in zip(config.STRESS_EVENTS, (-0.21, -0.09, -0.14))]
    rec = Recommendation(
        holdings=holdings,
        summary=PortfolioSummary(
            expected_return=er, volatility=_r(vol), target_volatility=0.083, sharpe=_r((er - 0.03) / vol),
            beta=0.52, weighted_ter=_r(wter), annual_cost_per_10k=_r(wter * 10_000), mix=mix,
        ),
        downside=Downside(
            drawdown_probs=[ProbabilityPoint(threshold=t, probability=p) for t, p in zip(thresholds, (0.18, 0.06, 0.015))],
            annual_loss_probs=[ProbabilityPoint(threshold=t, probability=p) for t, p in zip(thresholds, (0.04, 0.01, 0.002))],
            p_below_invested=0.07, fan=fan, stress=stress,
            normal_comparison=NormalComparison(
                drawdown_probs=[ProbabilityPoint(threshold=t, probability=p) for t, p in zip(thresholds, (0.09, 0.02, 0.003))],
                annual_loss_probs=[ProbabilityPoint(threshold=t, probability=p) for t, p in zip(thresholds, (0.005, 0.0005, 0.0))],
            ),
        ),
        warnings=["Mock data: numbers are illustrative, not engine output."],
        trace=[
            StepResult(step="universe", summary={"eligible": 18, "excluded": {"non_ucits": 6}}, notes=["UCITS-only because base currency is EUR."]),
            StepResult(step="returns", summary={"weeks": 1090, "base_currency": "EUR"}, notes=["IE00B6R52259 proxied before 2011-10-21."]),
            StepResult(step="covariance", summary={"window_years": 5, "shrinkage": 0.21}, notes=[]),
            StepResult(step="expected_returns", summary={"model": "capm_multi_asset", "rf": 0.02, "premium": 0.035}, notes=[]),
            StepResult(step="constraints", summary={"target_vol": 0.083, "max_etfs": 10}, notes=[]),
            StepResult(step="optimize", summary={"strategy": "target_vol", "achieved_vol": _r(vol)}, notes=[]),
            StepResult(step="metrics", summary={"sharpe": _r((er - 0.03) / vol)}, notes=[]),
            StepResult(step="downside", summary={"paths": 10000, "horizon_years": 10}, notes=[]),
        ],
    )

    window = port.loc[port.index[-1] - pd.DateOffset(years=15):]
    bench = (0.6 * weekly["IE00B6R52259"] + 0.4 * weekly["IE00BDBRDM35"]).loc[window.index]
    value, bvalue = (1 + window).cumprod(), (1 + bench).cumprod()
    dd = value / value.cummax() - 1
    rvol = window.rolling(156).std() * np.sqrt(52)
    rsh = (window.rolling(156).mean() * 52 - 0.02) / rvol
    none_or = lambda s: [None if pd.isna(x) else _r(x) for x in s]  # noqa: E731
    bt = BacktestResult(
        series=BacktestSeries(
            dates=[d.date() for d in window.index], portfolio=[_r(x) for x in value], benchmark=[_r(x) for x in bvalue],
            drawdown=[_r(x) for x in dd], rolling_vol=none_or(rvol), rolling_sharpe=none_or(rsh),
        ),
        metrics={
            "portfolio": {"cagr": 0.051, "volatility": _r(vol), "sharpe": 0.41, "sortino": 0.6, "max_drawdown": _r(dd.min()),
                          "max_drawdown_duration": 64, "cvar_95": -0.028, "calmar": 0.3, "beta": 0.93, "turnover": 0.0},
            "benchmark": {"cagr": 0.055, "volatility": 0.095, "sharpe": 0.4, "sortino": 0.58, "max_drawdown": -0.19,
                          "max_drawdown_duration": 70, "cvar_95": -0.031, "calmar": 0.29},
        },
        weights=WEIGHTS,
        proxied_periods=[ProxiedPeriod(isin="IE00BDBRDM35", start=window.index[0].date(), end=pd.Timestamp("2017-11-17").date())],
        rebalance_dates=[],
        warnings=["static mode: weights were chosen using data from the whole period (look-ahead bias)"],
        trace=[],
    )

    questionnaire = Questionnaire(version="mock", questions=[
        Question(id="horizon", text="When will you need this money?", type="number", feeds="horizon", min=1, max=40, unit="years"),
        Question(id="drop_reaction", text="Your portfolio drops 20% in a month. What do you do?", type="single", feeds="tolerance",
                 options=[QuestionOption(label="Sell everything", value="sell", points=0),
                          QuestionOption(label="Wait it out", value="hold", points=60),
                          QuestionOption(label="Buy more", value="buy", points=100)]),
        Question(id="income", text="How stable is your income?", type="single", feeds="capacity",
                 options=[QuestionOption(label="Unstable", value="unstable", points=20),
                          QuestionOption(label="Stable", value="stable", points=70),
                          QuestionOption(label="Very stable", value="very_stable", points=100)]),
    ])
    score = IntakeScore(capacity=72, tolerance=48, suggested_risk_level=48, limiting_factor="tolerance", mismatch=True,
                        explanation="Your finances could carry more risk than you are comfortable with; we follow your comfort level.",
                        horizon_years=10)

    universe = [fund_summary(isin, row, tickers.get(isin, [])) for isin, row in funds.iterrows()]
    isin = "IE00B6R52259"
    eq_px = data.prices(["IUSQ.DE"])["IUSQ.DE"].dropna().resample("W-FRI").last()
    fund = FundDetail(
        fund=fund_summary(isin, funds.loc[isin], tickers[isin]),
        listings=[ListingOut(ticker=r.ticker, exchange=r.exchange, currency=r.currency, is_primary=bool(r.is_primary))
                  for r in listings[listings["isin"] == isin].itertuples()],
        history=[PricePoint(date=d.date(), value=_r(v)) for d, v in eq_px.items()],
    )
    health = Health(status="ok", data_loaded=True, last_ingest="2025-12-31", n_funds=len(funds))

    dump = lambda m: m.model_dump(mode="json")  # noqa: E731
    return {
        "health": dump(health), "defaults": dump(defaults()), "questionnaire": dump(questionnaire), "score": dump(score),
        "universe": [dump(u) for u in universe], "fund": dump(fund), "portfolio": dump(rec), "backtest": dump(bt),
    }


def main() -> None:
    (BACKEND / "openapi.json").write_text(json.dumps(app.openapi(), indent=2))
    MOCKS.mkdir(parents=True, exist_ok=True)
    for name, body in build_mocks().items():
        (MOCKS / f"{name}.json").write_text(json.dumps(body))
    print(f"wrote {BACKEND / 'openapi.json'} and {MOCKS}/*.json")


if __name__ == "__main__":
    main()
