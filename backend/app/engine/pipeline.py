"""Phase 2. Spec §5.9. The only engine module that receives a DataSource."""

from app.engine.types import BacktestResult, BacktestSettings, DataSource, EngineSettings, InvestorProfile, Recommendation


def recommend(profile: InvestorProfile, settings: EngineSettings, data: DataSource) -> Recommendation:
    raise NotImplementedError("Phase 2")


def backtest(
    profile: InvestorProfile,
    weights: dict[str, float] | None,
    settings: EngineSettings,
    bt: BacktestSettings,
    data: DataSource,
) -> BacktestResult:
    raise NotImplementedError("Phase 2")
