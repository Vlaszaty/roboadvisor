"""Phase 2. Spec §5.9. The only engine module that receives a DataSource.

recommend(): universe -> returns -> covariance -> expected_returns -> constraints -> optimize -> metrics -> downside,
one Trace step per stable key (spec §5.10). backtest(): builds weights_fn from the same fitting steps (_fit).
Lane modules are called only through their Phase 0 contracts.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from app import config
from app.engine import backtest as bt_engine  # accessed as bt_engine.run so tests can spy on it
from app.engine import downside, expected, metrics, optimize, risk, universe
from app.engine import returns as returns_mod
from app.engine.errors import DomainError, InfeasibleConstraints, InsufficientHistory, InvalidSettings, NoEligibleFunds
from app.engine.trace import Trace
from app.engine.types import (
    BacktestResult, BacktestSettings, CapmResult, Constraints, DataSource, Downside, EngineSettings, Holding,
    InvestorProfile, OptimizeResult, PortfolioSummary, Preferences, Recommendation, ReturnsResult,
)

RECOMMEND_STEPS = (
    "universe", "returns", "covariance", "expected_returns", "constraints", "optimize", "metrics", "downside",
)
CAPM_EQUITY_BOND_NOTE = (
    "capm_equity: the market is equities only, so bonds get a beta near 0 and an expected return near the "
    "risk-free rate; their weight comes from diversification only."
)

SHARPE_UNDEFINED_NOTE = "volatility is ~0, Sharpe ratio undefined (reported as 0)."


# ---------- small conversions (API responses must be plain, NaN-free Python values) ----------


def _f(x) -> float:
    return round(float(x), 6)


def _opt(v):
    """pandas/numpy scalar -> plain Python value; missing -> None."""
    if v is None or v is pd.NA or v is pd.NaT:
        return None
    if isinstance(v, float) and np.isnan(v):
        return None
    return v.item() if hasattr(v, "item") else v


def _day(ts) -> str:
    return str(pd.Timestamp(ts).date())


# ---------- data assembly ----------


def _listing_rows(
    funds: pd.DataFrame, listings: pd.DataFrame, base: str, isins: list[str], *, error: type[DomainError], what: str
) -> pd.DataFrame:
    """Selection-shaped rows (fund columns + ticker/exchange/currency) for specific isins.

    Uses universe.select's own listing rule with a neutral profile that disables every preference filter
    (no UCITS rule, no hedge dedup, crypto allowed), so anchors and user-given isins get the same listing
    choice as eligible funds. Raises `error` naming isins that are unknown or have no listing.
    """
    isins = list(dict.fromkeys(isins))
    known = [i for i in isins if i in funds.index]
    neutral = InvestorProfile(
        risk_level=100, horizon_years=10, base_currency=base,
        preferences=Preferences(ucits_only=False, hedge_bonds=False, crypto_max=config.CRYPTO_HARD_CAP),
    )
    rows = None
    if known:
        try:
            rows = universe.select(funds.loc[known], listings, neutral)
        except NoEligibleFunds:
            rows = None
    found = set() if rows is None else set(rows.index)
    missing = [i for i in isins if i not in found]
    if missing:
        raise error(f"{what}: no fund with a listing for {', '.join(missing)}")
    return rows.loc[isins]


def _extend(
    selection: pd.DataFrame, funds: pd.DataFrame, listings: pd.DataFrame, base: str, isins: list[str],
    *, error: type[DomainError], what: str,
) -> pd.DataFrame:
    """selection plus listing rows for isins it does not contain yet."""
    extra = [i for i in dict.fromkeys(isins) if i not in selection.index]
    if not extra:
        return selection
    return pd.concat([selection, _listing_rows(funds, listings, base, extra, error=error, what=what)])


def _weekly(rows: pd.DataFrame, base: str, data: DataSource) -> ReturnsResult:
    """Weekly base-currency returns for every row, with proxies."""
    tickers = [str(t) for t in rows["ticker"]]
    proxies = [str(t) for t in rows["proxy_ticker"].dropna().unique() if t not in tickers]
    prices = data.prices(tickers + proxies)
    return returns_mod.weekly_returns(prices, rows, data.fx(), base)


# ---------- fitting (shared by recommend and walk-forward) ----------


def _capm(returns: pd.DataFrame, rf_daily: pd.Series, anchors: dict[str, str], settings: EngineSettings,
          end: pd.Timestamp | None) -> CapmResult:
    model = settings.expected_return_model
    market_cfg = config.MARKETS[model]
    premium = settings.market_premium if settings.market_premium is not None else market_cfg["premium"]
    market = expected.market_returns(returns, anchors, market_cfg["weights"])
    return expected.capm(returns, market, rf_daily, premium, model, settings.estimation_window_years, end=end)


@dataclass
class _Fit:
    cov: pd.DataFrame
    dropped: list[str]
    weeks_used: int  # complete weeks in the covariance window, over the covariance fund set
    n_cov_funds: int  # funds covariance was estimated on (eligible minus dropped), before candidate filtering
    capm: CapmResult
    mu: pd.Series  # TOTAL expected return (rf + beta * premium), what the API reports
    target_vol: float
    constraints: Constraints
    opt: OptimizeResult
    notes: list[str]  # optimisation-stage notes (e.g. cash excluded for risk_parity/hrp)


def _fit(
    returns: pd.DataFrame, selection: pd.DataFrame, rf_daily: pd.Series, anchors: dict[str, str],
    profile: InvestorProfile, settings: EngineSettings, end: pd.Timestamp | None,
) -> _Fit:
    """covariance -> CAPM -> constraints -> optimize using only rows <= end (None = all rows).

    Only eligible funds (selection.index) are optimisation candidates; anchor columns in `returns`
    are used for the CAPM market only. covariance and capm use the same window_years and `end`.
    optimize() receives EXCESS expected returns (mu - rf) for every strategy (integrator decision:
    target_vol is unchanged by a constant shift, max_sharpe needs it).
    """
    notes: list[str] = []
    eligible = returns[list(selection.index)]
    cov, dropped = risk.covariance(eligible, settings.estimation_window_years, end=end)
    cr = _capm(returns, rf_daily, anchors, settings, end)
    isins = [i for i in cov.index if i in cr.expected.index and pd.notna(cr.expected[i]) and pd.notna(cr.beta.get(i))]
    if settings.strategy in ("risk_parity", "hrp"):
        cash = [i for i in isins if selection.at[i, "asset_class"] == "cash"]
        if cash and len(cash) < len(isins):
            isins = [i for i in isins if i not in cash]
            notes.append(f"{settings.strategy}: cash funds excluded ({', '.join(cash)}); near-zero volatility would "
                         f"otherwise take most of the weight.")
    if not isins:
        raise InsufficientHistory("no eligible fund has enough price history in the estimation window")
    p = profile.preferences
    if len(isins) * p.max_position < 1 - 1e-9:
        raise InfeasibleConstraints(
            f"too few funds: only {len(isins)} eligible fund(s) with enough history, and with max_position "
            f"{p.max_position:.0%} they cannot add up to 100%. Loosen the filters or raise max_position."
        )
    if p.max_etfs * p.max_position < 1 - 1e-9:
        raise InfeasibleConstraints(
            f"max_etfs {p.max_etfs} x max_position {p.max_position:.0%} is below 100%: that many funds cannot "
            f"add up to a full portfolio. Raise max_etfs or max_position."
        )
    window = settings.estimation_window_years * config.PERIODS_PER_YEAR
    # complete weeks covariance estimated on: its own fund set (eligible minus dropped), same window
    weeks_used = len(eligible[list(cov.index)].loc[:end].tail(window).dropna())
    n_cov_funds = len(cov.index)
    cov = cov.loc[isins, isins]
    mu = cr.expected[isins]
    target = optimize.target_vol_from_risk(profile.risk_level, tuple(settings.vol_range))
    cons = optimize.build_constraints(selection.loc[isins], profile, target)
    opt = optimize.optimize(mu - cr.rf, cov, cons, settings.strategy)
    return _Fit(cov=cov, dropped=list(dropped), weeks_used=weeks_used, n_cov_funds=n_cov_funds, capm=cr, mu=mu, target_vol=target,
                constraints=cons, opt=opt, notes=notes)


# ---------- trace steps ----------


def _removed_counts(selection: pd.DataFrame) -> dict[str, int]:
    """Funds removed per universe filter, as reported by universe.select in result.attrs['removed']."""
    return {str(k): int(v) for k, v in selection.attrs["removed"].items()}


def _universe_step(trace: Trace, funds: pd.DataFrame, profile: InvestorProfile, selection: pd.DataFrame) -> None:
    p, base = profile.preferences, profile.base_currency
    ucits_only = p.ucits_only if p.ucits_only is not None else config.UCITS_DEFAULT[base]
    notes = []
    if ucits_only:
        why = f"default for {base}" if p.ucits_only is None else "chosen"
        notes.append(f"UCITS-only ({why}): non-UCITS ETFs removed; ETPs/ETCs pass.")
    if p.crypto_max == 0:
        notes.append("Crypto excluded: crypto_max is 0.")
    elif profile.risk_level < config.CRYPTO_MIN_RISK_LEVEL:
        notes.append(f"Crypto excluded: risk level {profile.risk_level:g} is below {config.CRYPTO_MIN_RISK_LEVEL}.")
    if p.hedge_bonds:
        notes.append(f"Bond funds with a {base}-hedged share class replace their unhedged siblings.")
    trace.add("universe", {
        "base_currency": base,
        "n_funds": int(len(funds)),
        "n_eligible": int(len(selection)),
        "removed": _removed_counts(selection),
        "ucits_only": bool(ucits_only),
        "by_asset_class": {str(k): int(v) for k, v in selection["asset_class"].value_counts().items()},
    }, notes)


def _returns_step(trace: Trace, rr: ReturnsResult, selection: pd.DataFrame, anchors: dict[str, str]) -> None:
    r = rr.returns
    proxied = {i: [_day(s), _day(e)] for i, (s, e) in rr.proxied.items()}
    no_data = [i for i in selection.index if i in r.columns and r[i].isna().all()]
    outside = [i for i in anchors.values() if i not in selection.index]
    notes = [f"{i} uses proxy returns from {s} to {e}." for i, (s, e) in proxied.items()]
    if outside:
        notes.append(f"Market anchors outside the eligible universe (used for CAPM only): {', '.join(outside)}.")
    if no_data:
        notes.append(f"No price data: {', '.join(no_data)}.")
    trace.add("returns", {
        "frequency": "W-FRI",
        "weeks": int(len(r)),
        "start": _day(r.index[0]) if len(r) else None,
        "end": _day(r.index[-1]) if len(r) else None,
        "n_series": int(r.shape[1]),
        "anchors": dict(anchors),
        "anchors_outside_universe": outside,
        "proxied": proxied,
        "no_data": no_data,
    }, notes)


# ---------- public API ----------


def recommend(profile: InvestorProfile, settings: EngineSettings, data: DataSource) -> Recommendation:
    trace, warnings = Trace(), []
    base = profile.base_currency
    anchors = config.ANCHORS[base]
    funds, listings = data.funds(), data.listings()

    # universe
    selection = universe.select(funds, listings, profile)
    _universe_step(trace, funds, profile, selection)

    # returns (eligible funds + anchors, which the CAPM market always needs)
    rows = _extend(selection, funds, listings, base, list(anchors.values()), error=InsufficientHistory,
                   what="market anchors (check config.ANCHORS against the database)")
    rr = _weekly(rows, base, data)
    _returns_step(trace, rr, selection, anchors)

    # covariance -> expected returns -> constraints -> optimize
    rf_daily = data.rf(base)
    fit = _fit(rr.returns, selection, rf_daily, anchors, profile, settings, end=None)
    cand = list(fit.cov.index)

    cov_notes = []
    if fit.dropped:
        cov_notes.append(
            f"Dropped {len(fit.dropped)} fund(s) with less than {config.MIN_COVERAGE:.0%} history in the "
            f"{settings.estimation_window_years}-year window: {', '.join(fit.dropped)}."
        )
    trace.add("covariance", {
        "method": "Ledoit-Wolf shrinkage, annualised x52",
        "window_years": settings.estimation_window_years,
        "end": _day(rr.returns.index[-1]),
        "weeks_used": int(fit.weeks_used),
        "n_funds": int(fit.n_cov_funds),
        "dropped": fit.dropped,
    }, cov_notes)

    w = fit.opt.weights
    held_bonds = [i for i in w.index if selection.at[i, "asset_class"] == "bond"]
    er_notes = []
    if settings.expected_return_model == "capm_equity" and held_bonds:
        er_notes.append(CAPM_EQUITY_BOND_NOTE)
        warnings.append(CAPM_EQUITY_BOND_NOTE)
    trace.add("expected_returns", {
        "model": fit.capm.market,
        "rf": _f(fit.capm.rf),
        "premium": _f(fit.capm.premium),
        "premium_source": "settings" if settings.market_premium is not None else "config",
        "market": {anchors[k]: _f(v) for k, v in config.MARKETS[settings.expected_return_model]["weights"].items()},
        "beta": {i: _f(fit.capm.beta[i]) for i in cand},
        "expected": {i: _f(fit.mu[i]) for i in cand},
    }, er_notes)

    c = fit.constraints
    trace.add("constraints", {
        "risk_level": _f(profile.risk_level),
        "vol_range": [_f(v) for v in settings.vol_range],
        "target_vol": _f(fit.target_vol),
        "n_candidates": len(cand),
        "max_etfs": int(c.max_etfs),
        "min_position": _f(c.min_position),
        "max_position": _f(c.max_position),
        "group_min": {k: _f(v) for k, v in c.group_min.items()},
        "group_max": {k: _f(v) for k, v in c.group_max.items()},
    })

    opt_warnings = list(fit.opt.warnings)
    if fit.opt.achieved_vol > fit.target_vol + 1e-4 and not opt_warnings and settings.strategy == "target_vol":
        opt_warnings.append(
            f"Achieved volatility {fit.opt.achieved_vol:.1%} is above the {fit.target_vol:.1%} target."
        )
    warnings.extend(opt_warnings)
    trace.add("optimize", {
        "strategy": settings.strategy,
        "target_vol": _f(fit.target_vol),
        "achieved_vol": _f(fit.opt.achieved_vol),
        "n_holdings": int(len(w)),
        "objective_input": "excess expected returns (mu - rf)",
        "weights": {i: _f(v) for i, v in w.items()},
    }, [*fit.notes, *opt_warnings])

    # ex-ante metrics
    idx = list(w.index)
    ea = metrics.ex_ante(w, fit.mu[idx], fit.cov.loc[idx, idx], fit.capm.beta[idx], c.ter.reindex(idx).fillna(0.0),
                         fit.capm.rf)
    rc = ea["risk_contribution"]
    sharpe, metrics_notes = _f(ea["sharpe"]), []
    if not np.isfinite(sharpe):  # ex_ante returns NaN at ~0 volatility; responses must be NaN-free
        sharpe, metrics_notes = 0.0, [SHARPE_UNDEFINED_NOTE]
        warnings.append(SHARPE_UNDEFINED_NOTE)
    trace.add("metrics", {
        "expected_return": _f(ea["expected_return"]),
        "volatility": _f(ea["volatility"]),
        "sharpe": sharpe,
        "beta": _f(ea["beta"]),
        "weighted_ter": float(ea["weighted_ter"]),  # unrounded: TERs are ~1e-3, 6 dp would skew cost_per_10k
        "annual_cost_per_10k": _f(ea["annual_cost_per_10k"]),
        "rf": _f(fit.capm.rf),
        "risk_contribution": {i: _f(v) for i, v in rc.items()},
    }, metrics_notes)

    # downside
    thresholds = list(settings.drawdown_thresholds)
    port, mask = downside.portfolio_history(rr.returns, w, rr.proxied)
    sim = downside.simulate(port, float(ea["expected_return"]), profile.horizon_years, thresholds, settings.mc_paths,
                            seed=settings.seed)
    nc = downside.normal_comparison(float(ea["expected_return"]), float(ea["volatility"]), profile.horizon_years,
                                    thresholds, settings.mc_paths, seed=settings.seed)
    stress = downside.stress(port, mask)
    proxied_weeks = int(mask.sum())
    dn_notes = [f"{proxied_weeks} of {len(port)} history weeks use proxy returns."] if proxied_weeks else []
    trace.add("downside", {
        "method": "stationary block bootstrap, mean shifted to the CAPM expected return",
        "paths": int(settings.mc_paths),
        "horizon_years": int(profile.horizon_years),
        "block_weeks": list(config.BLOCK_WEEKS),
        "seed": settings.seed,
        "history_weeks": int(len(port)),
        "history_start": _day(port.index[0]) if len(port) else None,
        "proxied_weeks": proxied_weeks,
        "expected_return": _f(ea["expected_return"]),
        "thresholds": [_f(t) for t in thresholds],
    }, dn_notes)

    holdings = []
    for isin in w.sort_values(ascending=False).index:
        row = selection.loc[isin]
        holdings.append(Holding(
            isin=isin, ticker=str(row["ticker"]), exchange=_opt(row["exchange"]) or "", name=str(row["name"]),
            weight=float(w[isin]), asset_class=str(row["asset_class"]), sub_class=_opt(row["sub_class"]),
            region=_opt(row["region"]), ter=_opt(row["ter"]), beta=_f(fit.capm.beta[isin]),
            expected_return=_f(fit.mu[isin]), risk_contribution=_f(rc.get(isin, 0.0)),
            proxied=isin in rr.proxied,
        ))
    mix: dict[str, float] = {}
    for h in holdings:
        mix[h.asset_class] = mix.get(h.asset_class, 0.0) + h.weight  # unrounded: weights sum to 1 exactly

    return Recommendation(
        holdings=holdings,
        summary=PortfolioSummary(
            expected_return=_f(ea["expected_return"]), volatility=_f(ea["volatility"]),
            target_volatility=_f(fit.target_vol), sharpe=sharpe, beta=_f(ea["beta"]),
            weighted_ter=float(ea["weighted_ter"]), annual_cost_per_10k=_f(ea["annual_cost_per_10k"]), mix=mix,
        ),
        downside=Downside(
            drawdown_probs=sim.drawdown_probs, annual_loss_probs=sim.annual_loss_probs,
            p_below_invested=_f(sim.p_below_invested), fan=sim.fan, stress=stress, normal_comparison=nc,
        ),
        warnings=warnings,
        trace=trace.steps,
    )


def _window_start(index: pd.DatetimeIndex, bt: BacktestSettings) -> pd.Timestamp:
    """First week (t0) of the backtest window, same rule as backtest.run: None start -> BACKTEST_YEARS before the
    last data week <= end."""
    # Mirrors the frozen backtest.run docstring ("Window: settings.start..settings.end (None -> last index week and
    # last minus config.BACKTEST_YEARS years)") and its _window(); keep the two in sync or the walk-forward t0 fit
    # and the auto benchmark would be computed for a different week than the one run() starts at.
    end = pd.Timestamp(bt.end) if bt.end else index[-1]
    if bt.start:
        start = pd.Timestamp(bt.start)
    else:
        last = index[index <= end]
        start = (last[-1] if len(last) else end) - pd.DateOffset(years=config.BACKTEST_YEARS)
    inside = index[(index >= start) & (index <= end)]
    if len(inside) < 2:
        raise InvalidSettings(f"the backtest window {_day(start)}..{_day(end)} contains fewer than 2 weeks of data")
    return inside[0]


def _ex_ante_vol(returns: pd.DataFrame, weights: pd.Series, window_years: int) -> float:
    """Ex-ante volatility sqrt(w'Σw) of given weights, with the optimizer's covariance estimator."""
    cov, dropped = risk.covariance(returns[list(weights.index)], window_years)
    if dropped:
        raise InsufficientHistory(
            f"not enough history in the {window_years}-year window to size the auto benchmark: {', '.join(dropped)}"
        )
    w = weights.reindex(cov.index).to_numpy(dtype=float)
    return float(np.sqrt(w @ cov.to_numpy() @ w))


def backtest(
    profile: InvestorProfile,
    weights: dict[str, float] | None,
    settings: EngineSettings,
    bt: BacktestSettings,
    data: DataSource,
) -> BacktestResult:
    """static: fixed target weights (the recommendation when weights is None), chosen with the whole history.
    walk_forward: at t0 and every rebalance date t, re-run _fit on rows <= t only (no look-ahead).
    Benchmark 'auto': the base currency's two anchors mixed to the INITIAL ex-ante portfolio vol."""
    trace, warnings = Trace(), []
    base = profile.base_currency
    anchors = config.ANCHORS[base]
    funds, listings = data.funds(), data.listings()
    rf_daily = data.rf(base)
    fits: dict[pd.Timestamp, _Fit] = {}
    rec_vol: float | None = None

    # 1. which funds can be held
    if bt.mode == "static":
        if weights is None:
            rec = recommend(profile, settings, data)
            trace.steps.extend(rec.trace)
            warnings.extend(rec.warnings)
            static_w = pd.Series({h.isin: h.weight for h in rec.holdings}, dtype=float)
            rec_vol = rec.summary.volatility
        else:
            static_w = pd.Series(weights, dtype=float)
            negative = static_w.index[static_w < 0].tolist()
            if negative:
                raise InvalidSettings(f"portfolio weights must not be negative: {', '.join(negative)}")
            static_w = static_w[static_w > 0]
            if static_w.empty:
                raise InvalidSettings("portfolio weights are empty")
        selection = _listing_rows(funds, listings, base, list(static_w.index), error=InvalidSettings,
                                  what="portfolio weights")
    else:
        if weights is not None:
            warnings.append("walk-forward: the given portfolio weights are ignored in walk-forward mode; weights "
                            "are re-optimised at each rebalance date.")
        selection = universe.select(funds, listings, profile)
        _universe_step(trace, funds, profile, selection)

    # 2. returns for holdings + anchors + benchmark legs (run() needs every held and benchmark isin as a column)
    bench_isins = list(anchors.values()) if bt.benchmark == "auto" else list(bt.benchmark)
    rows = _extend(selection, funds, listings, base, list(anchors.values()), error=InsufficientHistory,
                   what="market anchors (check config.ANCHORS against the database)")
    rows = _extend(rows, funds, listings, base, bench_isins, error=InvalidSettings, what="benchmark")
    rr = _weekly(rows, base, data)
    if not (bt.mode == "static" and weights is None):  # recommend() already traced its own returns step
        _returns_step(trace, rr, selection, anchors)
    t0 = _window_start(rr.returns.index, bt)

    # 3. weights_fn
    if bt.mode == "static":
        def weights_fn(t: pd.Timestamp) -> pd.Series:
            return static_w
    else:
        def weights_fn(t: pd.Timestamp) -> pd.Series:
            t = pd.Timestamp(t)
            if t not in fits:  # covariance and capm read only rows <= t (their `end`)
                try:
                    fits[t] = _fit(rr.returns, selection, rf_daily, anchors, profile, settings, end=t)
                except (InsufficientHistory, InfeasibleConstraints) as e:
                    raise type(e)(
                        f"walk-forward rebalance {_day(t)}: {e} — choose a later start (each rebalance needs at "
                        f"least {config.PERIODS_PER_YEAR} complete weeks, and uses up to "
                        f"{settings.estimation_window_years} years, of history before it)"
                    ) from e
            return fits[t].opt.weights

    # 4. benchmark (anchor isins are always columns of rr.returns)
    target_vol: float | None = None
    if bt.benchmark == "auto":
        if bt.mode == "walk_forward":
            weights_fn(t0)
            target_vol = float(fits[t0].opt.achieved_vol)
            hist = rr.returns.loc[:t0]  # no look-ahead in the benchmark mix either
        else:
            target_vol = rec_vol if rec_vol is not None else _ex_ante_vol(
                rr.returns, static_w, settings.estimation_window_years)
            hist = rr.returns
        eq, bd = anchors["global_equity"], anchors["global_bonds"]
        share = float(bt_engine.auto_benchmark(hist[eq], hist[bd], target_vol))
        bench = pd.Series({eq: share, bd: 1.0 - share})
    else:
        bench = pd.Series(bt.benchmark, dtype=float)
        if (bench < 0).any():
            raise InvalidSettings("benchmark weights must not be negative")
        if abs(bench.sum() - 1) > 1e-6:
            raise InvalidSettings(f"benchmark weights must sum to 1, got {bench.sum():.6f}")

    # 5. run
    rf_weekly = rf_daily.resample("W-FRI").last().reindex(rr.returns.index, method="ffill") / config.PERIODS_PER_YEAR
    result = bt_engine.run(rr.returns, weights_fn, bt, bench, rf_weekly, rr.proxied)

    notes = [
        "walk-forward: covariance, CAPM and optimisation at each rebalance date used only data up to that date."
        if bt.mode == "walk_forward" else
        "static: the same target weights for the whole period, chosen with data from the whole period."
    ]
    warned = [(t, msg) for t, f in sorted(fits.items()) for msg in f.opt.warnings]
    if warned:
        n_dates = len({t for t, _ in warned})
        msg = (f"walk-forward: the optimizer warned at {n_dates} of {len(fits)} fits; "
               f"first ({_day(warned[0][0])}): {warned[0][1]}")
        warnings.append(msg)
        notes.append(msg)
    fit_notes = sorted({n for f in fits.values() for n in f.notes})
    notes.extend(fit_notes)
    dates = result.series.dates
    trace.add("backtest", {
        "mode": bt.mode,
        "start": str(dates[0]) if dates else None,
        "end": str(dates[-1]) if dates else None,
        "weeks": len(dates),
        "rebalance": bt.rebalance.model_dump(mode="json"),
        "n_rebalances": len(result.rebalance_dates),
        "transaction_cost_bps": _f(bt.transaction_cost_bps),
        "benchmark": {str(i): _f(v) for i, v in bench.items()},
        "benchmark_target_vol": _f(target_vol) if target_vol is not None else None,
        "n_fits": len(fits),
        "estimation_window_years": settings.estimation_window_years,
    }, notes)
    return result.model_copy(update={"warnings": [*warnings, *result.warnings], "trace": trace.steps})
