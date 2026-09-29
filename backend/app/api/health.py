from fastapi import APIRouter, Depends

from app import config
from app.api.deps import get_data_optional
from app.api.schemas import Defaults, Health, MarketDefault, StressEvent
from app.engine.types import DataSource

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=Health)
def health(data: DataSource | None = Depends(get_data_optional)) -> Health:
    if data is None:
        return Health(status="ok", data_loaded=False, last_ingest=None, n_funds=0)
    return Health(status="ok", data_loaded=True, last_ingest=data.last_ingest(), n_funds=len(data.funds()))


@router.get("/defaults", response_model=Defaults)
def defaults() -> Defaults:
    return Defaults(
        vol_range=config.VOL_RANGE,
        estimation_window_years=config.ESTIMATION_WINDOW_YEARS,
        markets={k: MarketDefault(**v) for k, v in config.MARKETS.items()},
        anchors=config.ANCHORS,
        crypto_min_risk_level=config.CRYPTO_MIN_RISK_LEVEL,
        crypto_default_cap=config.CRYPTO_DEFAULT_CAP,
        crypto_hard_cap=config.CRYPTO_HARD_CAP,
        drawdown_thresholds=list(config.DRAWDOWN_THRESHOLDS),
        mc_paths=config.MC_PATHS,
        stress_events=[StressEvent(name=n, start=s, end=e) for n, s, e in config.STRESS_EVENTS],
        backtest_years=config.BACKTEST_YEARS,
        transaction_cost_bps=config.TRANSACTION_COST_BPS,
        mismatch_gap=config.MISMATCH_GAP,
    )
