"""API contract: request wrappers + re-exported engine models (spec §7)."""

from datetime import date

import pandas as pd
from pydantic import BaseModel, Field, model_validator

from app.engine.types import (  # noqa: F401  (re-exported for the API layer)
    BacktestResult, BacktestSettings, Downside, EngineSettings, Frontier, FundDetail, FundSummary, Holding,
    IntakeAnswers, IntakeScore, InvestorProfile, ListingOut, PortfolioSummary, Preferences, PricePoint,
    Questionnaire, Recommendation, StepResult,
)


class PortfolioRequest(BaseModel):
    profile: InvestorProfile
    settings: EngineSettings = EngineSettings()


class FrontierRequest(BaseModel):
    profile: InvestorProfile
    settings: EngineSettings = EngineSettings()
    lookback_years: int = Field(5, ge=1, le=15)  # hindsight window for historical mean returns
    points: int = Field(20, ge=5, le=40)  # target volatilities per curve


class BacktestRequest(BaseModel):
    profile: InvestorProfile  # always needed: base currency, preferences
    weights: dict[str, float] | None = None  # static mode: isin -> weight; None -> use the recommendation
    settings: EngineSettings = EngineSettings()
    backtest: BacktestSettings = BacktestSettings()

    @model_validator(mode="after")
    def _weights_sum_to_one(self) -> "BacktestRequest":
        if self.weights is not None:
            if not self.weights:
                raise ValueError("weights must have at least one entry")
            if any(w < 0 for w in self.weights.values()):
                raise ValueError("weights must be >= 0")
            if abs(sum(self.weights.values()) - 1) > 1e-6:
                raise ValueError("weights must sum to 1")
        return self


class Health(BaseModel):
    status: str
    data_loaded: bool
    last_ingest: str | None
    n_funds: int


class MarketDefault(BaseModel):
    weights: dict[str, float]
    premium: float


class StressEvent(BaseModel):
    name: str
    start: date
    end: date


class Defaults(BaseModel):
    vol_range: tuple[float, float]
    estimation_window_years: int
    markets: dict[str, MarketDefault]
    anchors: dict[str, dict[str, str]]
    crypto_min_risk_level: float
    crypto_default_cap: float
    crypto_hard_cap: float
    drawdown_thresholds: list[float]
    mc_paths: int
    stress_events: list[StressEvent]
    backtest_years: int
    transaction_cost_bps: float
    mismatch_gap: float


def _clean(v):
    if v is None or v is pd.NA or v is pd.NaT:
        return None
    if isinstance(v, float) and pd.isna(v):
        return None
    if isinstance(v, pd.Timestamp):
        return v.date()
    return v.item() if hasattr(v, "item") else v


def fund_summary(isin: str, row: pd.Series, tickers: list[str]) -> FundSummary:
    """Build a FundSummary from a DataSource.funds() row."""
    v = {c: _clean(row[c]) for c in row.index}
    return FundSummary(
        isin=isin, name=v["name"], issuer=v["issuer"], asset_class=v["asset_class"],
        sub_class=v["sub_class"], region=v["region"], sector=v["sector"], esg=bool(v["esg"]),
        ter=v["ter"], domicile=v["domicile"], ucits=bool(v["ucits"]), wrapper=v["wrapper"] or "etf",
        distribution=v["distribution"], hedged_to=v["hedged_to"], duration=v["duration"],
        index_name=v["index_name"], inception_date=v["inception_date"],
        has_proxy=v["proxy_ticker"] is not None, tickers=tickers,
    )
