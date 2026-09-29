from fastapi import APIRouter, Depends, HTTPException, Query
import pandas as pd

from app.api.deps import get_data
from app.api.schemas import FundDetail, FundSummary, fund_summary
from app.engine import returns
from app.engine.types import Currency, DataSource, ListingOut, PricePoint

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
    funds = data.funds()
    tickers = _tickers(data.listings())
    f = funds
    if asset_class:
        f = f[f["asset_class"] == asset_class]
    if region:
        f = f[f["region"] == region]
    if esg is not None:
        f = f[f["esg"].astype(bool) == esg]
    if ucits is not None:
        f = f[f["ucits"].astype(bool) == ucits]
    if max_ter is not None:
        f = f[~(f["ter"] > max_ter)]  # unknown TER is kept, as in universe.select
    if q and q.strip():
        needle = q.strip().lower()

        def hit(isin: str, row: pd.Series) -> bool:
            hay = [isin, row["name"], row["index_name"], *tickers.get(isin, [])]
            return any(needle in str(h).lower() for h in hay if h is not None and not pd.isna(h))

        f = f.loc[pd.Series([hit(i, r) for i, r in f.iterrows()], index=f.index, dtype=bool)]
    return [fund_summary(isin, row, tickers.get(isin, [])) for isin, row in f.iterrows()]


@router.get("/{isin}", response_model=FundDetail)
def fund_detail(isin: str, base_currency: Currency = "EUR", data: DataSource = Depends(get_data)) -> FundDetail:
    funds = data.funds()
    if isin not in funds.index:
        raise HTTPException(status_code=404, detail=f"unknown isin {isin}")
    listings = data.listings()
    own = listings[listings["isin"] == isin].sort_values(["is_primary", "ticker"], ascending=[False, True])
    history: list[PricePoint] = []
    if len(own):
        primary = own.iloc[0]
        px = data.prices([primary["ticker"]])
        # London (.L) listings are quoted in pence (GBp) but stored as GBP: divide by 100 before conversion
        # so the history is in pounds (no 100x levels). Chosen over rebasing to keep real price levels.
        if primary["ticker"].endswith(".L") and primary["currency"] == "GBP":
            px = px / 100
        base_px = returns.convert_prices(px, {primary["ticker"]: primary["currency"]}, data.fx(), base_currency)
        weekly = base_px[primary["ticker"]].resample("W-FRI").last().dropna()
        history = [PricePoint(date=d.date(), value=round(float(v), 6)) for d, v in weekly.items()]
    return FundDetail(
        fund=fund_summary(isin, funds.loc[isin], list(own["ticker"])),
        listings=[ListingOut(ticker=r.ticker, exchange=r.exchange or "", currency=r.currency,
                             is_primary=bool(r.is_primary)) for r in own.itertuples()],
        history=history,
    )
