"""Phase 2. Spec §5.9. The only engine module that receives a DataSource.

recommend(): universe -> returns -> covariance -> expected_returns -> constraints -> optimize -> metrics -> downside,
one Trace step per stable key (spec §5.10). backtest(): builds weights_fn from the same fitting steps (_fit).
frontier(): model efficient frontier on recommend's candidates and covariance (spec 2026-09-30 §3.2).
Lane modules are called only through their Phase 0 contracts.
"""

from dataclasses import dataclass, replace

import numpy as np
import pandas as pd

from app import config
from app.engine import backtest as bt_engine  # accessed as bt_engine.run so tests can spy on it
from app.engine import downside, expected, metrics, optimize, risk, universe
from app.engine import returns as returns_mod
from app.engine.errors import DomainError, InfeasibleConstraints, InsufficientHistory, InvalidSettings, NoEligibleFunds
from app.engine.trace import Trace
from app.engine.types import (
    BacktestResult, BacktestSettings, CapmResult, Constraints, DataSource, Downside, EngineSettings, Frontier,
    FrontierMarker, FrontierPoint, Holding, InvestorProfile, OptimizeResult, PortfolioSummary, Preferences,
    Recommendation, ReferenceResult, ReturnsResult,
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
    rr = returns_mod.weekly_returns(prices, rows, data.fx(), base)
    rr = _drop_incomplete_week(rr, prices.index.max() if len(prices) else None)
    if rr.returns.dropna(how="all").empty:
        raise InsufficientHistory("no price history loaded for the eligible funds — run the ingest")
    return rr


def _drop_incomplete_week(rr: ReturnsResult, last_data: pd.Timestamp | None) -> ReturnsResult:
    """Drop the last weekly row when the data ends before its W-FRI label (a partial, still running week).

    Proxy spans are clipped to the remaining weeks (a span that only covered the dropped week disappears).
    """
    r = rr.returns
    if not len(r) or last_data is None or pd.isna(last_data) or pd.Timestamp(last_data) >= r.index[-1]:
        return rr
    r = r.iloc[:-1]
    if not len(r):
        return ReturnsResult(returns=r, proxied={})
    last = r.index[-1]
    proxied = {i: (s, min(e, last)) for i, (s, e) in rr.proxied.items() if s <= last}
    return ReturnsResult(returns=r, proxied=proxied)


# ---------- candidate universe (pipeline rules on top of universe.select) ----------


def _own_start(rr: ReturnsResult, isin: str) -> pd.Timestamp | None:
    """Week of the fund's first own price (proxy weeks excluded); None without any data."""
    if isin in rr.proxied:
        return rr.proxied[isin][1]
    return rr.returns[isin].first_valid_index() if isin in rr.returns.columns else None


def _dedupe_same_index(
    selection: pd.DataFrame, own_start: dict[str, pd.Timestamp | None]
) -> tuple[pd.DataFrame, list[dict]]:
    """One fund per (index_name, hedged_to): lowest TER (unknown last), then longest own history, then isin.

    Funds without an index_name are never grouped. Returns (selection without the duplicates, one dict per
    group that lost funds: index_name, hedged_to, kept, removed in preference order).
    """
    latest = pd.Timestamp.max

    def rank(i: str) -> tuple:
        ter, start = selection.at[i, "ter"], own_start.get(i)
        return (pd.isna(ter), 0.0 if pd.isna(ter) else float(ter), latest if start is None else start, i)

    named = selection[selection["index_name"].notna()]
    keys = named["hedged_to"].where(named["hedged_to"].notna(), None)
    groups, drop = [], []
    seen: dict[tuple, list[str]] = {}
    for isin in named.index:
        seen.setdefault((named.at[isin, "index_name"], keys[isin]), []).append(isin)
    for (name, hedged), members in seen.items():
        if len(members) < 2:
            continue
        ordered = sorted(members, key=rank)
        groups.append({"index_name": str(name), "hedged_to": None if hedged is None else str(hedged),
                       "kept": ordered[0], "removed": ordered[1:]})
        drop.extend(ordered[1:])
    return selection.drop(index=drop), groups


def _history_needed_from(index: pd.DatetimeIndex) -> pd.Timestamp:
    """Latest allowed first-return week: the second week of a MIN_HISTORY_YEARS window ending at the last week
    (same window rule as the default backtest, whose first week's return is not earned)."""
    window = index[index >= index[-1] - pd.DateOffset(years=config.MIN_HISTORY_YEARS)]
    return window[1] if len(window) > 1 else window[0]


def _foreign_hedged_bonds(selection: pd.DataFrame, profile: InvestorProfile) -> list[str]:
    """With hedge_bonds, bond funds hedged to a currency other than the base (e.g. a EUR-hedged bond fund for a USD
    investor): their returns carry the other currency's rates, not a hedge into the investor's own currency.
    universe.select only drops unhedged siblings of a base-hedged class, so this rule lives here."""
    if not profile.preferences.hedge_bonds:
        return []
    hedged = selection["hedged_to"]
    return [i for i in selection.index if selection.at[i, "asset_class"] == "bond" and pd.notna(hedged[i])
            and str(hedged[i]) != profile.base_currency]


@dataclass
class _Universe:
    selection: pd.DataFrame  # optimisation candidates
    foreign_hedged: list[str]  # bond funds hedged to another currency, removed because of hedge_bonds
    duplicates: list[dict]  # _dedupe_same_index groups
    short_history: list[str]  # excluded for history starting after needed_from
    needed_from: pd.Timestamp
    min_history_applied: bool
    warnings: list[str]


def _candidates(selection: pd.DataFrame, rr: ReturnsResult, profile: InvestorProfile) -> _Universe:
    """Bond funds hedged to another currency out (hedge_bonds), then minimum history (non-crypto funds need
    own+proxy returns from _history_needed_from; skipped with a warning if it would leave too few funds for
    max_position), then one fund per index among the rest."""
    foreign = _foreign_hedged_bonds(selection, profile)
    selection = selection.drop(index=foreign)
    r = rr.returns
    needed_from = _history_needed_from(r.index)
    short = [i for i in selection.index if selection.at[i, "asset_class"] != "crypto"
             and ((start := r[i].first_valid_index()) is None or start > needed_from)]
    keep = selection.drop(index=short)
    warnings: list[str] = []
    applied = True
    if short and len(keep) * profile.preferences.max_position < 1 - 1e-9:
        applied = False
        warnings.append(
            f"minimum history ({config.MIN_HISTORY_YEARS} years) not applied: only {len(keep)} eligible fund(s) "
            f"have it, too few for max_position {profile.preferences.max_position:.0%}. Funds with shorter history "
            f"({', '.join(short)}) shorten the downside history and the backtest."
        )
        keep, short = selection, []
    kept, duplicates = _dedupe_same_index(keep, {i: _own_start(rr, i) for i in keep.index})
    return _Universe(selection=kept, foreign_hedged=foreign, duplicates=duplicates, short_history=short,
                     needed_from=needed_from, min_history_applied=applied, warnings=warnings)


# ---------- fitting (shared by recommend and walk-forward) ----------


def _capm(returns: pd.DataFrame, rf_daily: pd.Series, anchors: dict[str, str], settings: EngineSettings,
          end: pd.Timestamp | None) -> CapmResult:
    model = settings.expected_return_model
    market_cfg = config.MARKETS[model]
    premium = settings.market_premium if settings.market_premium is not None else market_cfg["premium"]
    market = expected.market_returns(returns, anchors, market_cfg["weights"])
    return expected.capm(returns, market, rf_daily, premium, model, settings.estimation_window_years, end=end)


def _optimize(mu_excess: pd.Series, cov: pd.DataFrame, cons: Constraints, strategy: str,
              notes: list[str]) -> OptimizeResult:
    """optimize.optimize, except hrp on a single fund: scipy's clustering needs two, and the answer is 100% anyway."""
    if strategy == "hrp" and len(cov.index) == 1:
        isin = str(cov.index[0])
        notes.append(f"hrp: a single candidate fund ({isin}) holds 100%; hierarchical clustering needs at least two.")
        return OptimizeResult(weights=pd.Series({isin: 1.0}), achieved_vol=float(np.sqrt(cov.iat[0, 0])))
    return optimize.optimize(mu_excess, cov, cons, strategy)


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
    opt = _optimize(mu - cr.rf, cov, cons, settings.strategy, notes)
    return _Fit(cov=cov, dropped=list(dropped), weeks_used=weeks_used, n_cov_funds=n_cov_funds, capm=cr, mu=mu, target_vol=target,
                constraints=cons, opt=opt, notes=notes)


# ---------- trace steps ----------


def _removed_counts(selection: pd.DataFrame) -> dict[str, int]:
    """Funds removed per universe filter, as reported by universe.select in result.attrs['removed']."""
    return {str(k): int(v) for k, v in selection.attrs["removed"].items()}


def _universe_step(trace: Trace, funds: pd.DataFrame, profile: InvestorProfile, selection: pd.DataFrame,
                   cand: "_Universe | None" = None) -> None:
    """selection: universe.select's result; cand: the pipeline's candidate rules applied on top of it."""
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
    removed = _removed_counts(selection)
    foreign = cand.foreign_hedged if cand is not None else []
    removed["foreign_hedged_bonds"] = len(foreign)
    if foreign:
        notes.append("Bond funds hedged to another currency removed (hedge_bonds): " + ", ".join(
            f"{i} hedged to {selection.at[i, 'hedged_to']}" for i in foreign) + ".")
    duplicates = cand.duplicates if cand is not None else []
    n_dup = sum(len(g["removed"]) for g in duplicates)
    removed["same_index_duplicates"] = n_dup
    for g in duplicates:
        notes.append(f"Same index ({g['index_name']}{', hedged to ' + g['hedged_to'] if g['hedged_to'] else ''}): "
                     f"kept {g['kept']} (lowest TER), removed {', '.join(g['removed'])}.")
    eligible = selection.drop(index=[*foreign, *(i for g in duplicates for i in g["removed"])])
    trace.add("universe", {
        "base_currency": base,
        "n_funds": int(len(funds)),
        "n_eligible": int(len(eligible)),
        "removed": removed,
        "same_index_duplicates": duplicates,
        "foreign_hedged_bonds": list(foreign),
        "ucits_only": bool(ucits_only),
        "by_asset_class": {str(k): int(v) for k, v in eligible["asset_class"].value_counts().items()},
    }, notes)


def _returns_step(trace: Trace, rr: ReturnsResult, selection: pd.DataFrame, anchors: dict[str, str],
                  cand: "_Universe | None" = None) -> None:
    r = rr.returns
    proxied = {i: [_day(s), _day(e)] for i, (s, e) in rr.proxied.items()}
    no_data = [i for i in selection.index if i in r.columns and r[i].isna().all()]
    outside = [i for i in anchors.values() if i not in (cand.selection.index if cand is not None else selection.index)]
    notes = [f"{i} uses proxy returns from {s} to {e}." for i, (s, e) in proxied.items()]
    if outside:
        notes.append(f"Market anchors outside the eligible universe (used for CAPM only): {', '.join(outside)}.")
    if no_data:
        notes.append(f"No price data: {', '.join(no_data)}.")
    summary = {
        "frequency": "W-FRI",
        "weeks": int(len(r)),
        "start": _day(r.index[0]) if len(r) else None,
        "end": _day(r.index[-1]) if len(r) else None,
        "n_series": int(r.shape[1]),
        "anchors": dict(anchors),
        "anchors_outside_universe": outside,
        "proxied": proxied,
        "no_data": no_data,
    }
    if cand is not None:
        summary.update({
            "min_history_years": config.MIN_HISTORY_YEARS,
            "history_needed_from": _day(cand.needed_from),
            "min_history_applied": cand.min_history_applied,
            "short_history_excluded": list(cand.short_history),
            "n_candidates": int(len(cand.selection)),
        })
        if cand.short_history:
            notes.append(f"Excluded (returns start after {_day(cand.needed_from)}, need {config.MIN_HISTORY_YEARS} "
                         f"years; crypto exempt): {', '.join(cand.short_history)}.")
        notes.extend(cand.warnings)
    trace.add("returns", summary, notes)


# ---------- public API ----------


def _check_preferences(p: Preferences) -> None:
    """Preference combinations the solver would only reject with an opaque error (Preferences itself is frozen)."""
    if p.min_position > p.max_position + 1e-12:
        raise InvalidSettings(
            f"min_position {p.min_position:.0%} is above max_position {p.max_position:.0%}: no fund could be held. "
            f"Lower min_position or raise max_position."
        )


def _ignored_target_note(strategy: str, achieved_vol: float, when: str = "") -> str:
    return (f"strategy {strategy} does not target your risk level; achieved volatility {achieved_vol:.1%}{when}. "
            f"Use target_vol to size the portfolio to your risk level.")


@dataclass
class _Prepared:
    """recommend()'s inputs up to and including the optimisation (shared with frontier())."""
    selection: pd.DataFrame  # optimisation candidates (after the pipeline's candidate rules)
    rows: pd.DataFrame  # listing rows behind rr: eligible funds + market anchors
    rr: ReturnsResult  # weekly base-currency returns of rows
    cand: _Universe
    rf_daily: pd.Series
    anchors: dict[str, str]
    fit: _Fit
    trace: Trace  # universe and returns steps so far
    warnings: list[str]


def _prepare(profile: InvestorProfile, settings: EngineSettings, data: DataSource) -> _Prepared:
    """universe -> weekly returns -> candidate rules -> _fit (covariance, CAPM, constraints, optimize)."""
    _check_preferences(profile.preferences)
    trace, warnings = Trace(), []
    base = profile.base_currency
    anchors = config.ANCHORS[base]
    funds, listings = data.funds(), data.listings()

    # universe, returns (eligible funds + anchors, which the CAPM market always needs), candidate rules
    eligible = universe.select(funds, listings, profile)
    rows = _extend(eligible, funds, listings, base, list(anchors.values()), error=InsufficientHistory,
                   what="market anchors (check config.ANCHORS against the database)")
    rr = _weekly(rows, base, data)
    cand = _candidates(eligible, rr, profile)
    warnings.extend(cand.warnings)
    _universe_step(trace, funds, profile, eligible, cand)
    _returns_step(trace, rr, eligible, anchors, cand)

    # covariance -> expected returns -> constraints -> optimize
    rf_daily = data.rf(base)
    fit = _fit(rr.returns, cand.selection, rf_daily, anchors, profile, settings, end=None)
    return _Prepared(selection=cand.selection, rows=rows, rr=rr, cand=cand, rf_daily=rf_daily, anchors=anchors,
                     fit=fit, trace=trace, warnings=warnings)


def recommend(profile: InvestorProfile, settings: EngineSettings, data: DataSource) -> Recommendation:
    prep = _prepare(profile, settings, data)
    trace, warnings, anchors = prep.trace, prep.warnings, prep.anchors
    rr, selection, fit = prep.rr, prep.selection, prep.fit
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
    if settings.strategy != "target_vol":
        opt_warnings.append(_ignored_target_note(settings.strategy, fit.opt.achieved_vol))
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


def _static_start(
    returns: pd.DataFrame, held: list[str], bt: BacktestSettings, t0: pd.Timestamp, warnings: list[str]
) -> tuple[BacktestSettings, bool]:
    """Static mode: if a held fund has no returns yet at the start of the window, start the window one week before
    the first week where every held fund has a return (t0's own return is not earned), with a warning, instead of
    letting backtest.run count the missing weeks as 0%. Returns (settings, whether the start moved)."""
    idx = returns.index
    end = pd.Timestamp(bt.end) if bt.end else idx[-1]
    firsts = {i: returns.loc[t0:end, i].first_valid_index() for i in held}
    never = [i for i, f in firsts.items() if f is None]
    if never:
        raise InvalidSettings(f"no return data inside the backtest window for: {', '.join(never)}")
    first = max(firsts.values())
    pos = idx.get_loc(first)
    if pos == 0 or idx[pos - 1] <= t0:
        return bt, False
    start = idx[pos - 1]
    late = sorted(i for i, f in firsts.items() if f > idx[idx.get_loc(t0) + 1])
    warnings.append(
        f"static backtest starts {_day(start)} instead of {_day(t0)}: no return data before then for "
        f"{', '.join(late)} (missing weeks are not counted as 0%)."
    )
    return bt.model_copy(update={"start": start.date()}), True


def _ex_ante_vol(returns: pd.DataFrame, weights: pd.Series, window_years: int) -> float:
    """Ex-ante volatility sqrt(w'Σw) of given weights, with the optimizer's covariance estimator."""
    cov, dropped = risk.covariance(returns[list(weights.index)], window_years)
    if dropped:
        raise InsufficientHistory(
            f"not enough history in the {window_years}-year window to size the auto benchmark: {', '.join(dropped)}"
        )
    w = weights.reindex(cov.index).to_numpy(dtype=float)
    return float(np.sqrt(w @ cov.to_numpy() @ w))


# ---------- reference indices (spec 2026-09-30 §2) ----------


def _with_references(rows: pd.DataFrame, funds: pd.DataFrame, listings: pd.DataFrame, base: str) -> pd.DataFrame:
    """rows plus a listing row for each config.REFERENCES isin, chosen with the neutral profile of _listing_rows
    (so the investor's filters never remove a yardstick). An isin without a fund or listing is left out here;
    _references reports it."""
    for ref in config.REFERENCES.values():
        try:
            rows = _extend(rows, funds, listings, base, [ref["isin"]], error=DomainError, what="reference")
        except DomainError:
            pass
    return rows


def _num(x) -> float | None:
    """JSON-safe float: NaN / inf / missing -> None."""
    v = _opt(x)
    return None if v is None or not np.isfinite(float(v)) else float(v)


def _references(
    returns: pd.DataFrame, rows: pd.DataFrame, dates: list, rf_weekly: pd.Series
) -> tuple[list[ReferenceResult], list[str]]:
    """Buy-and-hold growth of 1.0 for each config.REFERENCES fund over the backtest's dates, no costs.

    Same timing as backtest.run: dates[0] is t0 (value 1.0), the return of week k is earned between dates[k-1] and
    dates[k]. A reference whose first return in the window comes later starts at the week before that return (its
    first price week): 1.0 there, None before, never zero-filled. Missing returns after the start count as 0% in the
    growth series (metrics skip them). Metrics: metrics.REGISTRY on the reference's own returns with the portfolio's
    weekly rf. Returns (results, warnings); a reference without a listing or without data in the window is skipped.
    """
    results: list[ReferenceResult] = []
    warnings: list[str] = []
    index = pd.DatetimeIndex([pd.Timestamp(d) for d in dates])
    for key, ref in config.REFERENCES.items():
        isin = ref["isin"]
        if isin not in rows.index or isin not in returns.columns:
            warnings.append(f"reference {key} ({isin}) skipped: no fund with a listing in the database.")
            continue
        r = returns[isin].reindex(index).iloc[1:]  # t0's return is not earned
        first = r.first_valid_index()
        if first is None:
            warnings.append(f"reference {key} ({isin}) skipped: no return data inside the backtest window.")
            continue
        k0 = index.get_loc(first) - 1  # the week before the first return: value 1.0
        r = r.loc[first:]
        growth = (1.0 + r.fillna(0.0)).cumprod()
        values: list[float | None] = [None] * k0 + [1.0] + [float(v) for v in growth]
        rf = rf_weekly.reindex(r.index)
        results.append(ReferenceResult(
            key=key, label=ref["label"], isin=isin, ticker=str(rows.at[isin, "ticker"]), start=index[k0].date(),
            values=values, metrics={name: _num(fn(r, rf)) for name, fn in metrics.REGISTRY.items()},
        ))
    return results, warnings


def backtest(
    profile: InvestorProfile,
    weights: dict[str, float] | None,
    settings: EngineSettings,
    bt: BacktestSettings,
    data: DataSource,
) -> BacktestResult:
    """static: fixed target weights (the recommendation when weights is None), chosen with the whole history.
    walk_forward: at t0 and every rebalance date t, re-run _fit on rows <= t only (no look-ahead).
    Benchmark 'auto': the base currency's two anchors mixed to the INITIAL ex-ante portfolio vol, measured on the
    same estimation window as that vol (the last estimation_window_years of weeks ending at t0 for walk-forward,
    at the last week for static), so portfolio and benchmark are compared at the same risk."""
    _check_preferences(profile.preferences)
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

    # 2. returns for holdings + anchors + benchmark legs (run() needs every held and benchmark isin as a column)
    bench_isins = list(anchors.values()) if bt.benchmark == "auto" else list(bt.benchmark)
    rows = _extend(selection, funds, listings, base, list(anchors.values()), error=InsufficientHistory,
                   what="market anchors (check config.ANCHORS against the database)")
    rows = _extend(rows, funds, listings, base, bench_isins, error=InvalidSettings, what="benchmark")
    rows = _with_references(rows, funds, listings, base)  # yardsticks: columns of rr.returns, never held
    rr = _weekly(rows, base, data)
    if bt.mode == "walk_forward":  # same candidate rules as recommend (min history, one fund per index)
        cand = _candidates(selection, rr, profile)
        warnings.extend(cand.warnings)
        _universe_step(trace, funds, profile, selection, cand)
        _returns_step(trace, rr, selection, anchors, cand)
        selection = cand.selection
    elif weights is not None:  # recommend() already traced its own returns step
        _returns_step(trace, rr, selection, anchors)
    t0 = _window_start(rr.returns.index, bt)
    late_start = False
    if bt.mode == "static":
        bt, late_start = _static_start(rr.returns, list(static_w.index), bt, t0, warnings)
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
    bench_hist: pd.DatetimeIndex | None = None
    if bt.benchmark == "auto":
        window = settings.estimation_window_years * config.PERIODS_PER_YEAR
        if bt.mode == "walk_forward":
            weights_fn(t0)
            target_vol = float(fits[t0].opt.achieved_vol)
            hist = rr.returns.loc[:t0].tail(window)  # the t0 fit's window: no look-ahead in the benchmark mix either
        else:
            # after a late start, size the benchmark on the weeks where every held fund has data
            sized_on = rr.returns.loc[t0:] if late_start else rr.returns
            target_vol = rec_vol if rec_vol is not None else _ex_ante_vol(
                sized_on, static_w, settings.estimation_window_years)
            hist = sized_on.tail(window)  # the window the portfolio vol was estimated on
        bench_hist = hist.index
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
    if fits and settings.strategy != "target_vol":
        first = min(fits)
        msg = _ignored_target_note(settings.strategy, float(fits[first].opt.achieved_vol),
                                   f" at the first rebalance ({_day(first)})")
        warnings.append(msg)
        notes.append(msg)
    dates = result.series.dates
    references, ref_warnings = _references(rr.returns, rows, dates, rf_weekly)
    warnings.extend(ref_warnings)
    notes.append("references: " + (", ".join(f"{r.key} from {r.start}" for r in references) or "none") + ".")
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
        "benchmark_sized_on": None if bench_hist is None or not len(bench_hist) else {
            "start": _day(bench_hist[0]), "end": _day(bench_hist[-1]), "weeks": int(len(bench_hist))},
        "n_fits": len(fits),
        "estimation_window_years": settings.estimation_window_years,
    }, notes)
    return result.model_copy(update={"warnings": [*warnings, *result.warnings], "trace": trace.steps,
                                     "references": references})


# ---------- efficient frontier (spec 2026-09-30 §3.2) ----------

FRONTIER_STRATEGIES = {
    "min_variance": "Minimum variance",
    "max_sharpe": "Maximum Sharpe",
    "risk_parity": "Risk parity",
    "hrp": "Hierarchical risk parity",
}


def _position(weights: pd.Series, mu_total: pd.Series, cov: pd.DataFrame, rf: float) -> FrontierPoint:
    """Where a portfolio sits in a (volatility, expected return) frame: vol = sqrt(w'Σw), return = w·mu (total,
    incl. rf), Sharpe = (return - rf) / vol (None at ~0 vol)."""
    w = weights.reindex(cov.index).fillna(0.0).to_numpy(dtype=float)
    vol = float(np.sqrt(max(w @ cov.to_numpy() @ w, 0.0)))
    ret = float(w @ mu_total.reindex(cov.index).to_numpy(dtype=float))
    return FrontierPoint(volatility=vol, expected_return=ret, sharpe=(ret - rf) / vol if vol > 1e-9 else None)


def _curve(
    mu_total: pd.Series, cov: pd.DataFrame, cons: Constraints, rf: float, points: int
) -> tuple[list[FrontierPoint], int]:
    """Efficient frontier for expected returns mu_total under the portfolio's constraints (cardinality included).

    The volatility range runs from the minimum-variance portfolio (a target far below it) to the maximum-return
    portfolio (a target far above it); each of `points` evenly spaced targets is one target_vol optimisation.
    A target the solver cannot meet is skipped. Returns (points sorted by volatility, number skipped).
    """
    excess = mu_total - rf  # optimize() always takes excess returns

    def best_at(target: float) -> OptimizeResult:
        return optimize.optimize(excess, cov, replace(cons, target_vol=target), "target_vol")

    lowest, highest = best_at(1e-6).achieved_vol, best_at(10.0).achieved_vol
    curve, skipped = [], 0
    for target in np.linspace(lowest, highest, points):
        try:
            curve.append(_position(best_at(float(target)).weights, mu_total, cov, rf))
        except (InfeasibleConstraints, InsufficientHistory):
            skipped += 1
    curve.sort(key=lambda p: p.volatility)
    unique = [p for k, p in enumerate(curve) if k == 0 or p.volatility - curve[k - 1].volatility > 1e-6]
    return unique, skipped


def _capital_market_line(model_curve: list[FrontierPoint], rf: float) -> list[FrontierPoint]:
    """From (0, rf) through the model curve's best-Sharpe point, extended to the curve's highest volatility."""
    best = max((p for p in model_curve if p.sharpe is not None), key=lambda p: p.sharpe, default=None)
    if best is None:
        return []
    end_vol = model_curve[-1].volatility
    return [FrontierPoint(volatility=0.0, expected_return=rf, sharpe=None),
            FrontierPoint(volatility=end_vol, expected_return=rf + best.sharpe * end_vol, sharpe=best.sharpe)]


def _strategy_weights(strategy: str, prep: _Prepared) -> pd.Series:
    """The strategy's weights on the candidates, as recommend would pick them (risk_parity/hrp drop cash like _fit)."""
    fit = prep.fit
    isins = list(fit.cov.index)
    if strategy in ("risk_parity", "hrp"):
        cash = [i for i in isins if prep.selection.at[i, "asset_class"] == "cash"]
        if cash and len(cash) < len(isins):
            isins = [i for i in isins if i not in cash]
    return _optimize(fit.mu[isins] - fit.capm.rf, fit.cov.loc[isins, isins], fit.constraints, strategy, []).weights


def _reference_markers(
    prep: _Prepared, profile: InvestorProfile, settings: EngineSettings, data: DataSource,
) -> tuple[list[FrontierMarker], list[str]]:
    """config.REFERENCES as single-fund markers, from their OWN weekly returns (anchors + references only), so a
    reference never changes the candidate set, covariance or estimation window of the frontier itself.

    vol: std of weekly returns over the estimation window ending at the frontier's last week, x sqrt(52). model
    return: rf + beta x premium (expected.capm with the investor's market).
    """
    base = profile.base_currency
    funds, listings = data.funds(), data.listings()
    anchor_rows = prep.rows.loc[list(dict.fromkeys(prep.anchors.values()))]
    rows = _with_references(anchor_rows, funds, listings, base)
    end = prep.rr.returns.index[-1]
    returns = _weekly(rows, base, data).returns.loc[:end]
    cr = _capm(returns, prep.rf_daily, prep.anchors, settings, end)
    window = returns.tail(settings.estimation_window_years * config.PERIODS_PER_YEAR)
    rf = prep.fit.capm.rf
    markers, warnings = [], []
    for key, ref in config.REFERENCES.items():
        isin = ref["isin"]
        if isin not in returns.columns:
            warnings.append(f"reference {key} ({isin}) skipped: no fund with a listing in the database.")
            continue
        vol = float(window[isin].std() * np.sqrt(config.PERIODS_PER_YEAR))
        model_ret = float(cr.expected.get(isin, np.nan))
        if not all(np.isfinite([vol, model_ret])) or vol <= 1e-9:
            warnings.append(f"reference {key} ({isin}) skipped: not enough return data in the estimation window.")
            continue
        point = FrontierPoint(volatility=vol, expected_return=model_ret, sharpe=(model_ret - rf) / vol)
        markers.append(FrontierMarker(key=key, label=ref["label"], kind="reference", model=point))
    return markers, warnings


def frontier(profile: InvestorProfile, settings: EngineSettings, points: int, data: DataSource) -> Frontier:
    """Model efficient frontier for this investor's candidate funds (spec 2026-09-30 §3.2).

    The curve uses recommend's candidates, covariance, constraints and the CAPM expected returns the portfolio was
    optimised with (so the portfolio sits on it). Markers show where the portfolio, the reference indices, the
    comparison strategies and every candidate fund sit under those same estimates. No realised-return ("hindsight")
    frame: weights chosen on a period always look good on that period.
    """
    # 1. recommend's inputs: candidates, covariance, CAPM expected returns, constraints, the portfolio
    prep = _prepare(profile, settings, data)
    fit, trace, warnings = prep.fit, prep.trace, list(prep.warnings)
    cov, rf, mu_model, cons = fit.cov, fit.capm.rf, fit.mu, fit.constraints
    isins = list(cov.index)

    # 2. the curve
    model_curve, model_skipped = _curve(mu_model, cov, cons, rf, points)
    if model_skipped:
        warnings.append(f"frontier: skipped {model_skipped} target(s) the solver could not reach.")

    # 3. markers: portfolio, references, strategies, candidate funds
    def marker(key: str, label: str, kind: str, weights: pd.Series) -> FrontierMarker:
        return FrontierMarker(key=key, label=label, kind=kind, model=_position(weights, mu_model, cov, rf))

    markers = [marker("portfolio", "Your portfolio", "portfolio", fit.opt.weights)]
    ref_markers, ref_warnings = _reference_markers(prep, profile, settings, data)
    markers += ref_markers
    warnings += ref_warnings
    for strategy, label in FRONTIER_STRATEGIES.items():
        try:
            markers.append(marker(strategy, label, "strategy", _strategy_weights(strategy, prep)))
        except DomainError as e:
            warnings.append(f"frontier: strategy {strategy} skipped ({e}).")
    for isin in isins:
        markers.append(marker(f"fund:{isin}", str(prep.selection.at[isin, "name"]), "fund", pd.Series({isin: 1.0})))

    trace.add("frontier", {
        "points": points,
        "model_points": len(model_curve),
        "n_candidates": len(isins),
        "n_markers": len(markers),
        "rf": _f(rf),
    }, [
        "curve: CAPM expected returns (the ones the portfolio was optimised with) and the recommend covariance and "
        "constraints.",
        "references: vol from their own weekly returns over the estimation window; they are not candidates.",
        "curve points maximise expected return net of the TER penalty (as the portfolio does) and are shown at their "
        "gross w·mu, so a point can sit a few bp under the true maximum of w·mu.",
    ])
    return Frontier(model_curve=model_curve, capital_market_line=_capital_market_line(model_curve, rf),
                    markers=markers, rf=float(rf), warnings=warnings, trace=trace.steps)
