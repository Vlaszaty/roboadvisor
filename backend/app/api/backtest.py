from fastapi import APIRouter, Depends

from app.api.deps import get_data
from app.api.schemas import BacktestRequest, BacktestResult
from app.engine.types import DataSource

router = APIRouter(tags=["engine"])


@router.post("/backtest", response_model=BacktestResult)
def backtest(body: BacktestRequest, data: DataSource = Depends(get_data)) -> BacktestResult:
    raise NotImplementedError("Phase 2")
