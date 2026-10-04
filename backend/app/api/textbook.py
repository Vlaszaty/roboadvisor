from fastapi import APIRouter, Depends

from app.api.deps import ENGINE_LOCK, get_data
from app.api.schemas import TextbookPortfolio, TextbookRequest
from app.engine import textbook
from app.engine.types import DataSource

router = APIRouter(tags=["engine"])


@router.post("/textbook", response_model=TextbookPortfolio)
def textbook_portfolio(body: TextbookRequest, data: DataSource = Depends(get_data)) -> TextbookPortfolio:
    with ENGINE_LOCK:
        return textbook.textbook(body.base_currency, body.risk_level, body.return_model, body.market_premium, data)
