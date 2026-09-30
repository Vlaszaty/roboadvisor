"""Contract types shared by engine, API and frontend (via OpenAPI).

Pydantic models are the JSON contract. Dataclasses are engine-internal results carrying pandas objects.
Undefined floats (NaN) serialise as JSON null; frontend code must treat numeric fields as possibly null.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Annotated, Any, Literal, Protocol

import pandas as pd
from pydantic import BaseModel, Field, model_validator

from app import config

Currency = Literal["EUR", "USD"]
ExpectedReturnModel = Literal["capm_equity", "capm_multi_asset"]
Strategy = Literal["target_vol", "min_variance", "max_sharpe", "risk_parity", "hrp"]

FUND_COLUMNS = [
    "name", "issuer", "asset_class", "sub_class", "region", "sector", "esg", "ter", "domicile",
    "ucits", "wrapper", "distribution", "hedged_to", "duration", "index_name", "inception_date",
    "proxy_ticker", "proxy_currency",
]
LISTING_COLUMNS = ["ticker", "isin", "exchange", "currency", "is_primary"]


class DataSource(Protocol):
    """Read access to market data. Implemented by app.data.db.SqliteData and tests.fixtures.synthetic.SyntheticData."""

    def funds(self) -> pd.DataFrame:
        """Index: isin. Columns: FUND_COLUMNS. esg/ucits are bool, ter/duration float (NaN if unknown),
        inception_date is a Timestamp (NaT if unknown), missing strings are None."""
        ...

    def listings(self) -> pd.DataFrame:
        """Columns: LISTING_COLUMNS (RangeIndex). is_primary is bool."""
        ...

    def prices(self, tickers: list[str]) -> pd.DataFrame:
        """Daily adjusted close (total return) in each ticker's own currency. DatetimeIndex: the union of dates on
        which any of the requested tickers has a price (crypto tickers add weekends); callers must not rely on a
        fixed calendar. One column per requested ticker in the requested
        order; unknown tickers give an all-NaN column.
        Proxy tickers (e.g. 'BTC-USD', 'SYN-EQ') are served the same way."""
        ...

    def fx(self) -> pd.DataFrame:
        """Daily USD per 1 unit of currency. DatetimeIndex, one column per currency, including 'USD' == 1.0."""
        ...

    def rf(self, currency: str) -> pd.Series:
        """Daily annualised risk-free rate as a fraction (0.035 = 3.5%). DatetimeIndex."""
        ...

    def last_ingest(self) -> str | None:
        """ISO date of the last ingest, or None."""
        ...


# ---------- request models ----------


class UniverseFilters(BaseModel):
    """The ETF universe page's filters (GET /api/universe query, POST /api/universe/frontier body)."""
    asset_class: str | None = None
    region: str | None = None
    esg: bool | None = None
    ucits: bool | None = None
    max_ter: float | None = Field(None, ge=0)  # unknown TER is kept
    q: str | None = None  # case-insensitive search in name, isin, ticker, index


class Preferences(BaseModel):
    hedge_bonds: bool = True
    ucits_only: bool | None = None  # None -> config.UCITS_DEFAULT[base_currency]
    regions_include: list[str] = []  # empty = all; region "global" always passes
    regions_exclude: list[str] = []
    sector_tilts: dict[str, Annotated[float, Field(ge=0, le=1)]] = {}  # sector -> minimum total weight
    sectors_exclude: list[str] = []
    esg_only: bool = False
    max_etfs: int = Field(10, ge=1, le=30)
    min_position: float = Field(0.03, ge=0, le=0.5)
    max_position: float = Field(0.40, gt=0, le=1)
    max_ter: float | None = Field(None, ge=0)
    distribution: Literal["acc", "dist", "any"] = "any"
    crypto_max: float = Field(0.0, ge=0, le=config.CRYPTO_HARD_CAP)


class InvestorProfile(BaseModel):
    risk_level: float = Field(ge=0, le=100)  # decided in intake; the engine never re-scores
    horizon_years: int = Field(ge=1, le=60)
    base_currency: Currency
    preferences: Preferences = Preferences()


class EngineSettings(BaseModel):
    expected_return_model: ExpectedReturnModel = "capm_multi_asset"
    strategy: Strategy = "target_vol"
    estimation_window_years: int = Field(config.ESTIMATION_WINDOW_YEARS, ge=1, le=20)
    market_premium: float | None = Field(None, ge=-0.1, le=0.2)  # None -> config.MARKETS[model]["premium"]
    vol_range: tuple[float, float] = config.VOL_RANGE
    drawdown_thresholds: list[Annotated[float, Field(gt=0, lt=1)]] = Field(
        default_factory=lambda: list(config.DRAWDOWN_THRESHOLDS), min_length=1
    )
    mc_paths: int = Field(config.MC_PATHS, ge=500, le=100_000)
    seed: int | None = config.MC_SEED

    @model_validator(mode="after")
    def _vol_range_ordered(self) -> EngineSettings:
        vmin, vmax = self.vol_range
        if not 0 <= vmin < vmax <= 1:
            raise ValueError("vol_range must satisfy 0 <= min < max <= 1")
        return self


class RebalanceSettings(BaseModel):
    type: Literal["none", "periodic", "threshold"] = "none"
    frequency: Literal["monthly", "quarterly", "annual"] = "quarterly"
    threshold: float = Field(0.05, gt=0, le=0.5)  # absolute weight drift, 0.05 = 5 percentage points


class BacktestSettings(BaseModel):
    mode: Literal["static", "walk_forward"] = "static"
    start: date | None = None  # None -> end minus config.BACKTEST_YEARS
    end: date | None = None  # None -> last available week
    rebalance: RebalanceSettings = RebalanceSettings()
    transaction_cost_bps: float = Field(config.TRANSACTION_COST_BPS, ge=0, le=500)
    benchmark: Literal["auto"] | dict[str, float] = "auto"  # dict = isin -> weight

    @model_validator(mode="after")
    def _walk_forward_needs_rebalancing(self) -> BacktestSettings:
        if self.mode == "walk_forward" and self.rebalance.type == "none":
            raise ValueError("walk_forward mode needs rebalance.type 'periodic' or 'threshold'")
        return self


# ---------- response models ----------


class StepResult(BaseModel):
    step: str  # stable key: universe, returns, covariance, expected_returns, constraints, optimize, metrics, downside, backtest
    summary: dict[str, Any] = {}
    notes: list[str] = []


class Holding(BaseModel):
    isin: str
    ticker: str
    exchange: str
    name: str
    weight: float
    asset_class: str
    sub_class: str | None
    region: str | None
    ter: float | None
    beta: float
    expected_return: float
    risk_contribution: float  # share of portfolio variance, sums to 1
    proxied: bool


class PortfolioSummary(BaseModel):
    expected_return: float
    volatility: float
    target_volatility: float
    sharpe: float
    beta: float
    weighted_ter: float
    annual_cost_per_10k: float
    mix: dict[str, float]  # asset_class -> weight


class ProbabilityPoint(BaseModel):
    threshold: float  # 0.3 = "-30% or worse"
    probability: float


class FanPoint(BaseModel):
    year: int
    p5: float
    p25: float
    p50: float
    p75: float
    p95: float  # value of 1.0 invested at year 0


class StressResult(BaseModel):
    event: str
    start: date
    end: date
    loss: float | None  # cumulative return over the window, negative = loss; None if no data
    proxied: bool


class NormalComparison(BaseModel):
    drawdown_probs: list[ProbabilityPoint]
    annual_loss_probs: list[ProbabilityPoint]


class Downside(BaseModel):
    drawdown_probs: list[ProbabilityPoint]
    annual_loss_probs: list[ProbabilityPoint]
    p_below_invested: float
    fan: list[FanPoint]
    stress: list[StressResult]
    normal_comparison: NormalComparison


class Recommendation(BaseModel):
    holdings: list[Holding]
    summary: PortfolioSummary
    downside: Downside
    warnings: list[str] = []
    trace: list[StepResult] = []


class ProxiedPeriod(BaseModel):
    isin: str
    start: date
    end: date


class BacktestSeries(BaseModel):
    dates: list[date]
    portfolio: list[float]  # value, starts at 1.0
    benchmark: list[float]
    drawdown: list[float]  # portfolio drawdown, <= 0
    rolling_vol: list[float | None]
    rolling_sharpe: list[float | None]


class ReferenceResult(BaseModel):
    key: str
    label: str
    isin: str
    ticker: str
    start: date  # first date of this reference's series (>= backtest start)
    values: list[float | None]  # growth of 1.0 aligned to BacktestSeries.dates; None before `start`
    metrics: dict[str, float | None]  # metrics.REGISTRY keys over the reference's own window


class BacktestResult(BaseModel):
    series: BacktestSeries
    metrics: dict[str, dict[str, float | None]]  # {"portfolio": {...}, "benchmark": {...}}
    weights: dict[str, float]  # initial target weights, isin -> weight
    proxied_periods: list[ProxiedPeriod] = []
    rebalance_dates: list[date] = []
    warnings: list[str] = []
    trace: list[StepResult] = []
    references: list[ReferenceResult] = []


# ---------- efficient frontier (spec 2026-09-30 §3.2) ----------


class FrontierPoint(BaseModel):
    volatility: float
    expected_return: float  # annual, total (incl. rf)
    sharpe: float | None


class FrontierMarker(BaseModel):
    key: str  # "portfolio" | "world" | "sp500" | "min_variance" | "max_sharpe" | "risk_parity" | "hrp" | "fund:<isin>"
    label: str
    kind: Literal["portfolio", "reference", "strategy", "fund"]
    model: FrontierPoint  # position under CAPM expected returns + covariance


class Frontier(BaseModel):
    model_curve: list[FrontierPoint]  # sorted by volatility
    capital_market_line: list[FrontierPoint]  # (0, rf) and the max-Sharpe line extended to the model curve's max vol
    markers: list[FrontierMarker]
    rf: float
    warnings: list[str] = []
    trace: list[StepResult] = []


class UniversePoint(BaseModel):
    isin: str
    name: str
    asset_class: str
    model: FrontierPoint  # CAPM expected return + Ledoit-Wolf volatility over the period
    realised: FrontierPoint | None  # CAGR + volatility of weekly returns over the period
    proxied: bool  # part of the period uses the proxy index (before the fund's inception)


class UniverseFrontier(BaseModel):
    curve: list[FrontierPoint]  # model efficient frontier of the shown funds; empty for fewer than 2
    capital_market_line: list[FrontierPoint]
    points: list[UniversePoint]
    rf: float
    period: dict[str, date]  # {"start", "end"} of the weeks used; empty when no fund matched
    warnings: list[str] = []


# ---------- intake ----------


class QuestionOption(BaseModel):
    label: str
    value: str
    points: float = 0  # 0-100 contribution for the sub-score this question feeds


class Question(BaseModel):
    id: str
    text: str
    help: str | None = None
    type: Literal["single", "number"]
    feeds: Literal["capacity", "tolerance", "horizon"]
    options: list[QuestionOption] = []  # for type "single"
    min: float | None = None  # for type "number"
    max: float | None = None
    unit: str | None = None


class Questionnaire(BaseModel):
    version: str
    questions: list[Question]


class IntakeAnswers(BaseModel):
    answers: dict[str, str | float]  # question id -> option value (single) or number


class IntakeScore(BaseModel):
    capacity: float
    tolerance: float
    suggested_risk_level: float
    limiting_factor: Literal["capacity", "tolerance", "none"]
    mismatch: bool
    explanation: str
    horizon_years: int


# ---------- universe ----------


class FundSummary(BaseModel):
    isin: str
    name: str
    issuer: str | None
    asset_class: str
    sub_class: str | None
    region: str | None
    sector: str | None
    esg: bool
    ter: float | None
    domicile: str | None
    ucits: bool
    wrapper: str
    distribution: str | None
    hedged_to: str | None
    duration: float | None
    index_name: str | None
    inception_date: date | None
    has_proxy: bool
    tickers: list[str]


class ListingOut(BaseModel):
    ticker: str
    exchange: str
    currency: str
    is_primary: bool


class PricePoint(BaseModel):
    date: date
    value: float


class FundDetail(BaseModel):
    fund: FundSummary
    listings: list[ListingOut]
    history: list[PricePoint]  # primary listing converted to base currency, weekly


# ---------- engine-internal results ----------


@dataclass
class ReturnsResult:
    returns: pd.DataFrame  # weekly base-ccy returns, columns = isin
    proxied: dict[str, tuple[pd.Timestamp, pd.Timestamp]] = field(default_factory=dict)


@dataclass
class Constraints:
    target_vol: float
    max_etfs: int
    min_position: float
    max_position: float
    ter: pd.Series  # isin -> annual TER (NaN treated as 0)
    groups: dict[str, list[str]] = field(default_factory=dict)  # "asset_class:bond" -> isins
    group_min: dict[str, float] = field(default_factory=dict)
    group_max: dict[str, float] = field(default_factory=dict)


@dataclass
class CapmResult:
    beta: pd.Series
    expected: pd.Series  # annual expected return per isin
    rf: float  # annual risk-free rate at estimation end
    premium: float
    market: str  # expected_return_model used


@dataclass
class OptimizeResult:
    weights: pd.Series  # isin -> weight, only non-zero weights, sums to 1
    achieved_vol: float
    warnings: list[str] = field(default_factory=list)


@dataclass
class SimulationResult:
    drawdown_probs: list[ProbabilityPoint]
    annual_loss_probs: list[ProbabilityPoint]
    p_below_invested: float
    fan: list[FanPoint]
