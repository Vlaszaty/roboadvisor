"""Textbook portfolio (spec 2026-10-04): Markowitz and the CAPM as taught in the course, on a fixed fund set.

Deliberately simple: plain sample covariance, weights between 0 and 1 summing to 1, no TER penalty and no caps.
The tangent (maximum Sharpe) portfolio is mixed with a risk-free fund; risk aversion A sets the split.
"""

import numpy as np
import pandas as pd

from app import config
from app.engine import expected, optimize
from app.engine.errors import InsufficientHistory
from app.engine.pipeline import _curve, _listing_rows, _position, _weekly
from app.engine.types import (
    Constraints, DataSource, FrontierPoint, TextbookCorrelation, TextbookFund, TextbookInputs, TextbookMix,
    TextbookPortfolio, TextbookRiskFree, TextbookSplit,
)

PERIODS = config.PERIODS_PER_YEAR
MIN_EXCESS = 1e-9  # an expected return this close to rf does not count as "above rf"
MIN_VARIANCE = 1e-12


def window(returns: pd.DataFrame, years: int) -> pd.DataFrame:
    """The last years x 52 weekly rows, without weeks where any column is missing."""
    w = returns.iloc[-years * PERIODS:].dropna()
    if len(w) < PERIODS:
        raise InsufficientHistory(f"textbook portfolio: only {len(w)} complete weeks in the last {years} years")
    return w


def annual_stats(w: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """(average return, volatility) per column, annualised: mean x 52 and standard deviation x sqrt(52)."""
    return w.mean() * PERIODS, w.std() * np.sqrt(PERIODS)


def annual_covariance(w: pd.DataFrame) -> pd.DataFrame:
    """Plain sample covariance of the weekly returns x 52 (no shrinkage)."""
    return w.cov() * PERIODS


def risk_aversion(risk_level: float) -> float:
    """A in U = E(r) - 1/2 A sigma^2: linear from the cautious end (risk level 0) to the adventurous end (100)."""
    cautious, adventurous = config.TEXTBOOK_RISK_AVERSION
    return cautious + (adventurous - cautious) * risk_level / 100


def loose_constraints(isins: list[str]) -> Constraints:
    """Only the course's constraints: weights between 0 and 1, summing to 1."""
    return Constraints(target_vol=0.0, max_etfs=len(isins), min_position=0.0, max_position=1.0,
                       ter=pd.Series(0.0, index=isins))


def tangent_weights(mu: pd.Series, cov: pd.DataFrame, rf: float) -> pd.Series | None:
    """Weights of the maximum-Sharpe portfolio; None when no fund's expected return is above rf."""
    excess = mu - rf
    if not (excess > MIN_EXCESS).any():
        return None
    return optimize.optimize(excess, cov, loose_constraints(list(cov.index)), "max_sharpe").weights


def split(excess: float, variance: float, a: float) -> tuple[float, float]:
    """Share in the tangent portfolio that maximises U: y = excess / (A x variance). Returns (y, y clipped to 0..1)."""
    if variance <= MIN_VARIANCE:
        raise InsufficientHistory("textbook portfolio: the tangent portfolio has no volatility")
    y = excess / (a * variance)
    return y, min(max(y, 0.0), 1.0)


def _r(x) -> float:
    return round(float(x), 6)


def textbook(
    base: str, risk_level: float, return_model: str, market_premium: float | None, data: DataSource
) -> TextbookPortfolio:
    """returns -> average and volatility -> correlation -> expected returns -> frontier -> tangent -> split -> portfolio."""
    cfg = config.TEXTBOOK_FUNDS[base]
    blocks = {isin: block for block, isin in cfg["risky"].items()}
    risky, rf_isin = list(blocks), cfg["risk_free"]
    market = config.ANCHORS[base]["global_equity"]
    premium = config.TEXTBOOK_PREMIUM if market_premium is None else market_premium
    years = config.TEXTBOOK_WINDOW_YEARS

    # 1. weekly base-currency returns of the building blocks, the risk-free fund and the CAPM market
    funds = data.funds()
    rows = _listing_rows(funds, data.listings(), base, [*risky, rf_isin, market], error=InsufficientHistory,
                         what="textbook funds (check config.TEXTBOOK_FUNDS against the database)")
    rr = _weekly(rows, base, data)
    w = window(rr.returns[[*risky, market]], years)
    warnings = [f"{i}: part of the window uses proxy returns, not the fund's own prices."
                for i in risky if i in rr.proxied and rr.proxied[i][1] >= w.index[0]]

    # 2-3. average return, volatility, covariance and correlation
    mean, vol = annual_stats(w[risky])
    cov = annual_covariance(w[risky])
    corr = w[risky].corr()

    # 4. expected returns: CAPM against the global equity fund, or the historical average
    end = w.index[-1]
    cr = expected.capm(w[risky], w[market], data.rf(base), premium, "capm_equity", years, end=end)
    rf = float(cr.rf)
    mu = cr.expected[risky] if return_model == "capm" else mean

    # 5. efficient frontier of the risky funds
    curve, skipped = _curve(mu, cov, loose_constraints(risky), rf, config.TEXTBOOK_FRONTIER_POINTS)
    if skipped:
        warnings.append(f"frontier: skipped {skipped} point(s) the solver could not reach.")

    # 6-8. tangent portfolio, the split with the risk-free fund, the final portfolio
    a = risk_aversion(risk_level)
    tw = tangent_weights(mu, cov, rf)
    if tw is None:
        tangent, cml, uncapped, share = None, [], 0.0, 0.0
        portfolio = TextbookMix(weights={rf_isin: 1.0}, expected_return=_r(rf), volatility=0.0, sharpe=None)
        warnings.append("No fund has an expected return above the risk-free rate, so there is no tangent "
                        "portfolio: everything goes to the risk-free fund.")
    else:
        pos = _position(tw, mu, cov, rf)
        uncapped, share = split(pos.expected_return - rf, pos.volatility**2, a)
        sharpe = _r(pos.sharpe)
        tangent = TextbookMix(weights={i: _r(v) for i, v in tw.items()}, expected_return=_r(pos.expected_return),
                              volatility=_r(pos.volatility), sharpe=sharpe)
        cml = [FrontierPoint(volatility=0.0, expected_return=_r(rf), sharpe=None),
               FrontierPoint(volatility=_r(pos.volatility), expected_return=_r(pos.expected_return), sharpe=sharpe)]
        weights = {**{i: _r(share * v) for i, v in tw.items()}, rf_isin: _r(1 - share)}
        portfolio = TextbookMix(
            weights={i: v for i, v in weights.items() if v > 0},
            expected_return=_r(rf + share * (pos.expected_return - rf)), volatility=_r(share * pos.volatility),
            sharpe=sharpe if share > 0 else None,
        )

    rf_returns = rr.returns[rf_isin].reindex(w.index).dropna()
    return TextbookPortfolio(
        inputs=TextbookInputs(
            window={"start": w.index[0].date(), "end": end.date()}, weeks=len(w), rf=_r(rf), premium=_r(premium),
            return_model=return_model, market={"isin": market, "name": str(funds.at[market, "name"])},
            risk_aversion=_r(a),
        ),
        funds=[
            TextbookFund(
                isin=i, name=str(funds.at[i, "name"]), ticker=str(rows.at[i, "ticker"]), block=blocks[i],
                asset_class=str(funds.at[i, "asset_class"]), mean_return=_r(mean[i]), volatility=_r(vol[i]),
                beta=_r(cr.beta[i]), capm_return=_r(cr.expected[i]), expected_return=_r(mu[i]),
            )
            for i in risky
        ],
        risk_free_fund=TextbookRiskFree(
            isin=rf_isin, name=str(funds.at[rf_isin, "name"]), ticker=str(rows.at[rf_isin, "ticker"]),
            volatility=_r(rf_returns.std() * np.sqrt(PERIODS)) if len(rf_returns) > 1 else 0.0,
        ),
        correlation=TextbookCorrelation(isins=risky, matrix=[[_r(v) for v in row] for row in corr.to_numpy()]),
        frontier=curve,
        capital_market_line=cml,
        tangent=tangent,
        split=TextbookSplit(risk_aversion=_r(a), risky_share_uncapped=_r(uncapped), risky_share=_r(share)),
        portfolio=portfolio,
        warnings=warnings,
    )
