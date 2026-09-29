from fastapi import APIRouter, Depends, Query

from app.api.deps import get_data
from app.api.schemas import FundDetail, FundSummary
from app.engine.types import Currency, DataSource

router = APIRouter(prefix="/universe", tags=["universe"])


@router.get("", response_model=list[FundSummary])
def list_funds(
    asset_class: str | None = None,
    region: str | None = None,
    esg: bool | None = None,
    ucits: bool | None = None,
    max_ter: float | None = Query(None, ge=0),
    q: str | None = Query(None, description="case-insensitive search in name, isin, ticker, index"),
    data: DataSource = Depends(get_data),
) -> list[FundSummary]:
    raise NotImplementedError("Phase 2")


@router.get("/{isin}", response_model=FundDetail)
def fund_detail(isin: str, base_currency: Currency = "EUR", data: DataSource = Depends(get_data)) -> FundDetail:
    raise NotImplementedError("Phase 2")
