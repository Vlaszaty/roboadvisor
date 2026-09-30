from fastapi import APIRouter, Depends

from app.api.deps import ENGINE_LOCK, get_data
from app.api.schemas import PortfolioRequest, Recommendation
from app.engine import pipeline
from app.engine.types import DataSource

router = APIRouter(tags=["engine"])


@router.post("/portfolio", response_model=Recommendation)
def portfolio(body: PortfolioRequest, data: DataSource = Depends(get_data)) -> Recommendation:
    with ENGINE_LOCK:
        return pipeline.recommend(body.profile, body.settings, data)
