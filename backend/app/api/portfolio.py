from fastapi import APIRouter, Depends

from app.api.deps import get_data
from app.api.schemas import PortfolioRequest, Recommendation
from app.engine.types import DataSource

router = APIRouter(tags=["engine"])


@router.post("/portfolio", response_model=Recommendation)
def portfolio(body: PortfolioRequest, data: DataSource = Depends(get_data)) -> Recommendation:
    raise NotImplementedError("Phase 2")
