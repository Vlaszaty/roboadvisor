from fastapi import APIRouter, Depends

from app.api.deps import ENGINE_LOCK, get_data
from app.api.schemas import Frontier, FrontierRequest
from app.engine import pipeline
from app.engine.types import DataSource

router = APIRouter(tags=["engine"])


@router.post("/frontier", response_model=Frontier)
def frontier(body: FrontierRequest, data: DataSource = Depends(get_data)) -> Frontier:
    with ENGINE_LOCK:
        return pipeline.frontier(body.profile, body.settings, body.lookback_years, body.points, data)
