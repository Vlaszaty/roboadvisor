from fastapi import APIRouter, Depends

from app.api.deps import ENGINE_LOCK, get_data
from app.api.schemas import BacktestRequest, BacktestResult
from app.engine import pipeline
from app.engine.types import DataSource

router = APIRouter(tags=["engine"])


@router.post("/backtest", response_model=BacktestResult)
def backtest(body: BacktestRequest, data: DataSource = Depends(get_data)) -> BacktestResult:
    with ENGINE_LOCK:
        return pipeline.backtest(body.profile, body.weights, body.settings, body.backtest, data)
