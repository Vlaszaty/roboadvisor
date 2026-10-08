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
    pipeline: ["recommend", "backtest", "frontier"],
    scoring: ["load_questionnaire", "score"],
}


EXPECTED_SIGNATURES = {
    "app.engine.universe.select": '(funds: pandas.core.frame.DataFrame, listings: pandas.core.frame.DataFrame, profile: app.engine.types.InvestorProfile, stats: pandas.core.frame.DataFrame | None = None) -> pandas.core.frame.DataFrame',
    "app.engine.returns.convert_prices": '(prices: pandas.core.frame.DataFrame, currencies: dict[str, str], fx: pandas.core.frame.DataFrame, base: str) -> pandas.core.frame.DataFrame',
    "app.engine.returns.weekly_returns": '(prices: pandas.core.frame.DataFrame, selection: pandas.core.frame.DataFrame, fx: pandas.core.frame.DataFrame, base: str) -> app.engine.types.ReturnsResult',
    "app.engine.risk.covariance": '(returns: pandas.core.frame.DataFrame, window_years: int, end: pandas._libs.tslibs.timestamps.Timestamp | None = None, cash: collections.abc.Iterable[str] = ()) -> tuple[pandas.core.frame.DataFrame, list[str]]',
    "app.engine.expected.market_returns": '(returns: pandas.core.frame.DataFrame, anchors: dict[str, str], weights: dict[str, float]) -> pandas.core.series.Series',
    "app.engine.expected.capm": '(returns: pandas.core.frame.DataFrame, market: pandas.core.series.Series, rf: pandas.core.series.Series, premium: float, model: str, window_years: int, end: pandas._libs.tslibs.timestamps.Timestamp | None = None) -> app.engine.types.CapmResult',
    "app.engine.optimize.target_vol_from_risk": '(risk_level: float, vol_range: tuple[float, float]) -> float',
    "app.engine.optimize.build_constraints": '(selection: pandas.core.frame.DataFrame, profile: app.engine.types.InvestorProfile, target_vol: float) -> app.engine.types.Constraints',
    "app.engine.optimize.optimize": "(mu: pandas.core.series.Series, cov: pandas.core.frame.DataFrame, constraints: app.engine.types.Constraints, strategy: Literal['target_vol', 'min_variance', 'max_sharpe', 'risk_parity', 'hrp']) -> app.engine.types.OptimizeResult",
    "app.engine.metrics.cagr": '(r: pandas.core.series.Series, periods: int = 52) -> float',
    "app.engine.metrics.volatility": '(r: pandas.core.series.Series, periods: int = 52) -> float',
    "app.engine.metrics.sharpe": '(r: pandas.core.series.Series, rf: pandas.core.series.Series | float = 0.0, periods: int = 52) -> float',
    "app.engine.metrics.sortino": '(r: pandas.core.series.Series, rf: pandas.core.series.Series | float = 0.0, periods: int = 52) -> float',
    "app.engine.metrics.max_drawdown": '(r: pandas.core.series.Series) -> float',
    "app.engine.metrics.max_drawdown_duration": '(r: pandas.core.series.Series) -> int',
    "app.engine.metrics.cvar": '(r: pandas.core.series.Series, level: float = 0.95) -> float',
    "app.engine.metrics.calmar": '(r: pandas.core.series.Series, periods: int = 52) -> float',
    "app.engine.metrics.beta": '(r: pandas.core.series.Series, benchmark: pandas.core.series.Series) -> float',
    "app.engine.metrics.drawdown_series": '(r: pandas.core.series.Series) -> pandas.core.series.Series',
    "app.engine.metrics.rolling_vol": '(r: pandas.core.series.Series, window: int = 156, periods: int = 52) -> pandas.core.series.Series',
    "app.engine.metrics.rolling_sharpe": '(r: pandas.core.series.Series, rf: pandas.core.series.Series | float = 0.0, window: int = 156, periods: int = 52) -> pandas.core.series.Series',
    "app.engine.metrics.risk_contribution": '(weights: pandas.core.series.Series, cov: pandas.core.frame.DataFrame) -> pandas.core.series.Series',
    "app.engine.metrics.ex_ante": '(weights: pandas.core.series.Series, mu: pandas.core.series.Series, cov: pandas.core.frame.DataFrame, beta: pandas.core.series.Series, ter: pandas.core.series.Series, rf: float) -> dict',
    "app.engine.downside.portfolio_history": '(returns: pandas.core.frame.DataFrame, weights: pandas.core.series.Series, proxied: dict[str, tuple[pandas._libs.tslibs.timestamps.Timestamp, pandas._libs.tslibs.timestamps.Timestamp]]) -> tuple[pandas.core.series.Series, pandas.core.series.Series]',
    "app.engine.downside.simulate": '(port_returns: pandas.core.series.Series, expected_return: float, horizon_years: int, thresholds: list[float], n_paths: int, block_weeks: tuple[int, int] = (4, 13), seed: int | None = 42, initial_amount: float = 0.0, monthly_amount: float = 0.0) -> app.engine.types.SimulationResult',
    "app.engine.downside.normal_comparison": '(mu: float, sigma: float, horizon_years: int, thresholds: list[float], n_paths: int, seed: int | None = 42) -> app.engine.types.NormalComparison',
    "app.engine.downside.stress": "(port_returns: pandas.core.series.Series, proxied_mask: pandas.core.series.Series, events: list[tuple[str, str, str]] = [('GFC 2008', '2007-10-09', '2009-03-09'), ('COVID 2020', '2020-02-19', '2020-03-23'), ('Rate shock 2022', '2022-01-03', '2022-10-14')]) -> list[app.engine.types.StressResult]",
    "app.engine.backtest.rebalance_dates": '(index: pandas.core.indexes.datetimes.DatetimeIndex, rebalance: app.engine.types.RebalanceSettings) -> list[pandas._libs.tslibs.timestamps.Timestamp]',
    "app.engine.backtest.auto_benchmark": '(equity: pandas.core.series.Series, bonds: pandas.core.series.Series, target_vol: float) -> float',
    "app.engine.backtest.run": '(returns: pandas.core.frame.DataFrame, weights_fn: Callable[[pandas._libs.tslibs.timestamps.Timestamp], pandas.core.series.Series], settings: app.engine.types.BacktestSettings, benchmark_weights: pandas.core.series.Series, rf: pandas.core.series.Series, proxied: dict[str, tuple[pandas._libs.tslibs.timestamps.Timestamp, pandas._libs.tslibs.timestamps.Timestamp]]) -> app.engine.types.BacktestResult',
    "app.engine.pipeline.recommend": '(profile: app.engine.types.InvestorProfile, settings: app.engine.types.EngineSettings, data: app.engine.types.DataSource) -> app.engine.types.Recommendation',
    "app.engine.pipeline.backtest": '(profile: app.engine.types.InvestorProfile, weights: dict[str, float] | None, settings: app.engine.types.EngineSettings, bt: app.engine.types.BacktestSettings, data: app.engine.types.DataSource) -> app.engine.types.BacktestResult',
    "app.engine.pipeline.frontier": '(profile: app.engine.types.InvestorProfile, settings: app.engine.types.EngineSettings, points: int, data: app.engine.types.DataSource) -> app.engine.types.Frontier',
    "app.intake.scoring.load_questionnaire": '() -> app.engine.types.Questionnaire',
    "app.intake.scoring.score": '(answers: dict[str, str | float], questionnaire: app.engine.types.Questionnaire) -> app.engine.types.IntakeScore',
}


def test_function_signatures_frozen():
    actual = {f"{m.__name__}.{n}": str(inspect.signature(getattr(m, n))) for m, ns in EXPECTED_FUNCS.items() for n in ns}
    assert actual == EXPECTED_SIGNATURES



def test_all_stub_functions_exist():
    for module, names in EXPECTED_FUNCS.items():
        for name in names:
            assert inspect.isfunction(getattr(module, name)), f"{module.__name__}.{name}"
    assert isinstance(metrics.REGISTRY, dict)


def test_openapi_has_all_routes():
    paths = TestClient(app).get("/openapi.json").json()["paths"]
    for p in ["/api/health", "/api/defaults", "/api/intake/questionnaire", "/api/intake/score",
              "/api/universe", "/api/universe/{isin}", "/api/portfolio", "/api/backtest", "/api/frontier"]:
        assert p in paths, p


def test_openapi_json_matches_app():
    import json
    from pathlib import Path

    committed = json.loads((Path(__file__).resolve().parent.parent / "openapi.json").read_text())
    assert committed == app.openapi()
