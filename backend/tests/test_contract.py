import inspect

from fastapi.testclient import TestClient

from app.engine import backtest, downside, expected, metrics, optimize, pipeline, returns, risk, universe
from app.intake import scoring
from app.main import app

EXPECTED_FUNCS = {
    universe: ["select"],
    returns: ["convert_prices", "weekly_returns"],
    risk: ["covariance"],
    expected: ["market_returns", "capm"],
    optimize: ["target_vol_from_risk", "build_constraints", "optimize"],
    metrics: ["cagr", "volatility", "sharpe", "sortino", "max_drawdown", "max_drawdown_duration", "cvar",
              "calmar", "beta", "drawdown_series", "rolling_vol", "rolling_sharpe", "risk_contribution", "ex_ante"],
    downside: ["portfolio_history", "simulate", "normal_comparison", "stress"],
    backtest: ["rebalance_dates", "auto_benchmark", "run"],
    pipeline: ["recommend", "backtest"],
    scoring: ["load_questionnaire", "score"],
}


def test_all_stub_functions_exist():
    for module, names in EXPECTED_FUNCS.items():
        for name in names:
            assert inspect.isfunction(getattr(module, name)), f"{module.__name__}.{name}"
    assert isinstance(metrics.REGISTRY, dict)


def test_openapi_has_all_routes():
    paths = TestClient(app).get("/openapi.json").json()["paths"]
    for p in ["/api/health", "/api/defaults", "/api/intake/questionnaire", "/api/intake/score",
              "/api/universe", "/api/universe/{isin}", "/api/portfolio", "/api/backtest"]:
        assert p in paths, p
