from fastapi import APIRouter, Depends, HTTPException, Query
import pandas as pd

from app.api.deps import ENGINE_LOCK, get_data
from app.api.schemas import FundDetail, FundSummary, UniverseFrontier, UniverseFrontierRequest, fund_summary
from app.engine import pipeline, returns
from app.engine.universe import filter_funds
from app.engine.types import Currency, DataSource, ListingOut, PricePoint, UniverseFilters

router = APIRouter(prefix="/universe", tags=["universe"])


def _tickers(listings: pd.DataFrame) -> dict[str, list[str]]:
    return listings.groupby("isin")["ticker"].apply(list).to_dict()


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
    with ENGINE_LOCK:
        listings = data.listings()
        tickers = _tickers(listings)
        filters = UniverseFilters(asset_class=asset_class, region=region, esg=esg, ucits=ucits, max_ter=max_ter, q=q)
        f = filter_funds(data.funds(), listings, filters)
        return [fund_summary(isin, row, tickers.get(isin, [])) for isin, row in f.iterrows()]


@router.post("/frontier", response_model=UniverseFrontier)
def universe_frontier(body: UniverseFrontierRequest, data: DataSource = Depends(get_data)) -> UniverseFrontier:
    with ENGINE_LOCK:
        return pipeline.universe_frontier(body.filters, body.period_years, body.base_currency, body.points, data)


@router.get("/{isin}", response_model=FundDetail)
def fund_detail(isin: str, base_currency: Currency = "EUR", data: DataSource = Depends(get_data)) -> FundDetail:
    with ENGINE_LOCK:
        funds = data.funds()
        if isin not in funds.index:
            raise HTTPException(status_code=404, detail=f"unknown isin {isin}")
        listings = data.listings()
        own = listings[listings["isin"] == isin].sort_values(["is_primary", "ticker"], ascending=[False, True])
        history: list[PricePoint] = []
        if len(own):
            primary = own.iloc[0]
            px = data.prices([primary["ticker"]])
            base_px = returns.convert_prices(px, {primary["ticker"]: primary["currency"]}, data.fx(), base_currency)
            weekly = base_px[primary["ticker"]].resample("W-FRI").last().dropna()
            history = [PricePoint(date=d.date(), value=round(float(v), 6)) for d, v in weekly.items()]
        return FundDetail(
            fund=fund_summary(isin, funds.loc[isin], list(own["ticker"])),
            listings=[ListingOut(ticker=r.ticker, exchange=r.exchange if isinstance(r.exchange, str) else "", currency=r.currency,
                                 is_primary=bool(r.is_primary)) for r in own.itertuples()],
            history=history,
        )
