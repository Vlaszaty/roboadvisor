"""The café menu: a fixed set of risk profiles and the model portfolio behind each one.

Seven strengths x two bases (coffee = every fund, matcha = ESG-labelled funds plus cash) give 14 defined portfolios.
A strength is a target volatility; the main engine builds the portfolio for it with one fixed set of café
preferences, so everyone who lands on the same menu item gets the same funds and weights. Only the outlook
(horizon, amounts) differs per person, and the optimiser does not use those.

Past results per item come from a walk-forward backtest (weights re-estimated each quarter with only the data
known at that date), so they are not flattered by hindsight.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

import pandas as pd
from pydantic import BaseModel, Field

from app import config
from app.engine import metrics, pipeline
from app.engine.errors import InvalidSettings
from app.engine.types import (
    BacktestSettings, DataSource, EngineSettings, Holding, InvestorProfile, PortfolioSummary, Preferences,
    ProbabilityPoint, Recommendation, RebalanceSettings, VarPoint,
)

Base = Literal["coffee", "matcha"]
BASES: tuple[Base, ...] = ("coffee", "matcha")


class MenuProfile(BaseModel):
    id: int  # 1 (most careful) .. 7 (strongest)
    key: str  # stable English key, the UI translates it
    target_volatility: float
    score_min: float  # risk score band (0-100) that lands on this profile, inclusive
    score_max: float


# Even steps of two volatility points. The top stays below the ESG (matcha) universe's highest reachable
# volatility, so all seven matcha portfolios differ. Score bands split 0-100 into seven near-equal parts.
PROFILES: list[MenuProfile] = [
    MenuProfile(id=1, key="very_mild", target_volatility=0.03, score_min=0, score_max=14),
    MenuProfile(id=2, key="mild", target_volatility=0.05, score_min=15, score_max=28),
    MenuProfile(id=3, key="smooth", target_volatility=0.07, score_min=29, score_max=42),
    MenuProfile(id=4, key="balanced", target_volatility=0.09, score_min=43, score_max=57),
    MenuProfile(id=5, key="rich", target_volatility=0.11, score_min=58, score_max=71),
    MenuProfile(id=6, key="strong", target_volatility=0.13, score_min=72, score_max=85),
    MenuProfile(id=7, key="extra_strong", target_volatility=0.145, score_min=86, score_max=100),
]
PERFORMANCE_YEARS = (3, 5)


class OrderRequest(BaseModel):
    base: Base
    profile_id: int = Field(ge=1, le=len(PROFILES))
    horizon_years: int = Field(10, ge=1, le=40)
    initial_amount: float = Field(0, ge=0, le=1_000_000_000)
    monthly_amount: float = Field(0, ge=0, le=1_000_000)


class Performance(BaseModel):
    years: int
    start: date
    end: date
    total_return: float  # growth over the window, 0.25 = +25%
    annual_return: float  # compound annual growth rate
    volatility: float  # annualised, from weekly returns
    max_drawdown: float  # deepest fall from an earlier high, negative
    worst_month: float  # worst calendar month, negative


class GrowthPoint(BaseModel):
    date: date
    value: float  # growth of 1.0 since the start of the longest window


class MenuItem(BaseModel):
    base: Base
    profile_id: int
    holdings: list[Holding]
    summary: PortfolioSummary
    var_monthly: list[VarPoint]
    var_months: int
    p_below_invested: float  # after the menu's reference horizon
    outcome: dict[str, float]  # growth factor after the reference horizon: p5, p50, p95
    drawdown_probs: list[ProbabilityPoint]
    performance: list[Performance]  # one per PERFORMANCE_YEARS that the data covers
    growth: list[GrowthPoint]  # month-end values over the longest performance window
    warnings: list[str] = []


class Menu(BaseModel):
    profiles: list[MenuProfile]
    items: list[MenuItem]
    horizon_years: int  # reference horizon for p_below_invested and outcome
    min_fund_size_eur: float
    data_as_of: str | None


def profile_for_score(score: float) -> MenuProfile:
    """The menu profile whose band holds this 0-100 risk score (scores between bands round down)."""
    if not 0 <= score <= 100:
        raise InvalidSettings(f"risk score must be between 0 and 100, got {score:g}")
    for p in reversed(PROFILES):
        if score >= p.score_min:
            return p
    return PROFILES[0]


def profile_by_id(profile_id: int) -> MenuProfile:
    for p in PROFILES:
        if p.id == profile_id:
            return p
    raise InvalidSettings(f"unknown menu profile {profile_id}")


def risk_level(profile: MenuProfile, settings: EngineSettings | None = None) -> float:
    """The engine risk level (0-100) whose target volatility is the profile's (linear map onto vol_range)."""
    lo, hi = (settings or EngineSettings()).vol_range
    return round((profile.target_volatility - lo) / (hi - lo) * 100, 6)


def investor_profile(base: Base, profile: MenuProfile, horizon_years: int = 10, initial_amount: float = 0,
                     monthly_amount: float = 0) -> InvestorProfile:
    """The café's fixed preferences: EUR, UCITS ETFs only, no crypto, funds of at least MIN_FUND_SIZE_EUR,
    and no position limit on the cash fund."""
    return InvestorProfile(
        risk_level=risk_level(profile), horizon_years=horizon_years, base_currency="EUR",
        initial_amount=initial_amount, monthly_amount=monthly_amount,
        preferences=Preferences(
            esg_only=base == "matcha", ucits_only=True, etfs_only=True, crypto_max=0.0, hedge_bonds=True,
            min_fund_size_eur=config.MIN_FUND_SIZE_EUR, max_etfs=10, min_position=0.03, max_position=0.4,
            cash_max=1.0,  # cash is the risk-free part: the mildest strengths need more of it than max_position
        ),
    )


def order(req: OrderRequest, data: DataSource) -> Recommendation:
    """One menu item for a person's own horizon and amounts. Same weights as the menu (the optimiser ignores
    horizon and amounts); the outlook and money figures are theirs."""
    p = investor_profile(req.base, profile_by_id(req.profile_id), req.horizon_years, req.initial_amount,
                         req.monthly_amount)
    return pipeline.recommend(p, EngineSettings(), data)


def _performance(values: pd.Series, years: int) -> Performance | None:
    """Window metrics over the last `years` of a weekly growth series; None if the series is shorter."""
    end = values.index[-1]
    start_at = end - pd.DateOffset(years=years)
    if values.index[0] > start_at + pd.Timedelta(days=7):
        return None
    v = values[values.index >= start_at]
    v = v / v.iloc[0]
    r = v.pct_change().dropna()
    months = metrics.monthly(r)
    return Performance(
        years=years, start=v.index[0].date(), end=v.index[-1].date(),
        total_return=round(float(v.iloc[-1] - 1), 6), annual_return=round(metrics.cagr(r), 6),
        volatility=round(metrics.volatility(r), 6), max_drawdown=round(metrics.max_drawdown(r), 6),
        worst_month=round(float(months.min()), 6) if len(months) else 0.0,
    )


def build_item(base: Base, profile: MenuProfile, data: DataSource, horizon_years: int = 10) -> MenuItem:
    p = investor_profile(base, profile, horizon_years)
    settings = EngineSettings()
    rec = pipeline.recommend(p, settings, data)
    longest = max(PERFORMANCE_YEARS)
    bt = pipeline.backtest(p, None, settings, BacktestSettings(
        mode="walk_forward", rebalance=RebalanceSettings(type="periodic", frequency="quarterly"),
        start=(data.rf("EUR").index[-1] - pd.DateOffset(years=longest, weeks=2)).date(),
    ), data)
    values = pd.Series(bt.series.portfolio, index=pd.DatetimeIndex(bt.series.dates))
    perf = [x for x in (_performance(values, y) for y in PERFORMANCE_YEARS) if x is not None]
    monthly_values = values.groupby(values.index.to_period("M")).last()
    growth = [GrowthPoint(date=d.to_timestamp(how="end").date(), value=round(float(v), 6))
              for d, v in monthly_values.items()]
    last = rec.downside.fan[-1]
    return MenuItem(
        base=base, profile_id=profile.id, holdings=rec.holdings, summary=rec.summary,
        var_monthly=rec.downside.var_monthly, var_months=rec.downside.var_months,
        p_below_invested=rec.downside.p_below_invested,
        outcome={"p5": last.p5, "p50": last.p50, "p95": last.p95},
        drawdown_probs=rec.downside.drawdown_probs, performance=perf, growth=growth,
        warnings=list(dict.fromkeys([*rec.warnings, *(w for w in bt.warnings if "walk-forward" not in w)])),
    )


def build(data: DataSource, horizon_years: int = 10) -> Menu:
    items = [build_item(b, p, data, horizon_years) for b in BASES for p in PROFILES]
    return Menu(profiles=PROFILES, items=items, horizon_years=horizon_years,
                min_fund_size_eur=config.MIN_FUND_SIZE_EUR, data_as_of=data.last_ingest())
