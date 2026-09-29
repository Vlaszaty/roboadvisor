"""Lane C. Spec §5.5 — portfolio construction.

Solver choice: the convex problems (target_vol, min_variance, max_sharpe, risk_parity) are written directly in
cvxpy (installed with PyPortfolioOpt) rather than through pypfopt's EfficientFrontier. Reasons: the TER penalty
and the group bounds are one line each in plain cvxpy, the min-variance / max-return fallbacks for an
unreachable volatility target are explicit instead of hidden in exceptions, and the maths reads the same as
the spec. HRP has no convex formulation and is written out with SciPy's clustering.

Return-level convention: every strategy except max_sharpe is unchanged if the same constant is added to all
of mu (weights sum to 1). max_sharpe treats mu as returns in excess of the risk-free rate (rf = 0); the pipeline always passes
capm.expected - capm.rf, as the optimize docstring requires.
"""

from typing import Callable

import cvxpy as cp
import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import leaves_list, linkage
from scipy.spatial.distance import squareform

from app import config
from app.engine.errors import InfeasibleConstraints
from app.engine.types import Constraints, InvestorProfile, OptimizeResult, Strategy

ZERO_WEIGHT = 1e-6  # weights below this are solver noise and treated as 0
BOUND_TOLERANCE = 1e-4  # slack when checking constraints after a solve

# A solver takes (net expected returns, covariance, constraints, per-fund floor) and returns (weights, warnings).
# The floor is 0 while the optimizer is free to choose funds, and min_position once the fund list is final.
Solver = Callable[[pd.Series, pd.DataFrame, Constraints, float], tuple[pd.Series, list[str]]]


# ---------------------------------------------------------------- risk level and constraints


def target_vol_from_risk(risk_level: float, vol_range: tuple[float, float]) -> float:
    """vmin + risk_level / 100 * (vmax - vmin)."""
    vol_min, vol_max = vol_range
    return vol_min + risk_level / 100 * (vol_max - vol_min)


def build_constraints(selection: pd.DataFrame, profile: InvestorProfile, target_vol: float) -> Constraints:
    """Constraints from the selected universe and preferences.

    groups: 'asset_class:<x>' for every asset class present and 'sector:<s>' for every sector present.
    group_min: {'sector:<s>': w} from preferences.sector_tilts. Raises InfeasibleConstraints if a tilted sector
      has no eligible fund, if the tilts sum to more than 1, or if there are more tilts than max_etfs.
    group_max: {'asset_class:crypto': preferences.crypto_max} when crypto funds are present.
    ter: selection.ter with NaN -> 0. Position bounds from preferences.
    """
    prefs = profile.preferences
    groups = _groups(selection)
    _check_sector_tilts(prefs.sector_tilts, groups, prefs.max_etfs)

    group_min = {f"sector:{sector}": weight for sector, weight in prefs.sector_tilts.items()}
    group_max = {}
    if "asset_class:crypto" in groups:
        group_max["asset_class:crypto"] = prefs.crypto_max

    return Constraints(
        target_vol=target_vol,
        max_etfs=prefs.max_etfs,
        min_position=prefs.min_position,
        max_position=prefs.max_position,
        ter=selection["ter"].astype(float).fillna(0.0),
        groups=groups,
        group_min=group_min,
        group_max=group_max,
    )


def _groups(selection: pd.DataFrame) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    for column in ("asset_class", "sector"):
        for value, members in selection.groupby(column).groups.items():  # groupby skips None/NaN
            groups[f"{column}:{value}"] = list(members)
    return groups


def _check_sector_tilts(tilts: dict[str, float], groups: dict[str, list[str]], max_etfs: int) -> None:
    missing = [sector for sector in tilts if f"sector:{sector}" not in groups]
    if missing:
        raise InfeasibleConstraints(f"no eligible fund for sector tilt(s): {', '.join(sorted(missing))}")
    if sum(tilts.values()) > 1:
        raise InfeasibleConstraints(f"sector tilts add up to {sum(tilts.values()):.0%}, more than 100%")
    if len(tilts) > max_etfs:
        raise InfeasibleConstraints(f"{len(tilts)} sector tilts need more funds than max_etfs = {max_etfs}")


# ---------------------------------------------------------------- entry point


def optimize(mu: pd.Series, cov: pd.DataFrame, constraints: Constraints, strategy: Strategy) -> OptimizeResult:
    """Long-only weights summing to 1 (spec §5.5).

    mu: annual expected EXCESS returns (CapmResult.expected - CapmResult.rf), no NaN. The pipeline always passes
      excess returns; target_vol is unaffected by the constant shift and max_sharpe needs it.
    mu and cov share the same isins (cov order is authoritative).
    Raises InfeasibleConstraints if max_position * min(max_etfs, n_funds) < 1.
    hrp is implemented with scipy clustering (pypfopt HRPOpt is incompatible with the installed scipy).
    target_vol: maximise mu.w - config.TER_PENALTY * ter.w s.t. sqrt(w'Σw) <= target_vol, position and group bounds.
      Target below the minimum-variance portfolio -> return min-variance with a warning naming the achieved vol;
      target above the maximum-return portfolio's vol -> return max-return with a warning.
    min_variance / max_sharpe / risk_parity / hrp: same bounds where the method allows; otherwise warn.
    Cardinality: drop weights < min_position, keep the top max_etfs, re-optimise on the rest
      (at most config.MAX_CARDINALITY_ROUNDS rounds). Returned weights contain only non-zero entries.
    """
    isins = list(cov.index)
    cov = _make_psd(cov.loc[isins, isins])
    ter = constraints.ter.reindex(isins).fillna(0.0)
    net_mu = mu.reindex(isins) - config.TER_PENALTY * ter  # expected return after the cost penalty
    _check_position_bounds(len(isins), constraints)

    solver = SOLVERS[strategy]
    weights, warnings = _solve_with_cardinality(solver, net_mu, cov, constraints)
    warnings += _constraint_violations(weights, constraints)
    achieved_vol = _portfolio_vol(weights, cov)
    return OptimizeResult(weights=weights[weights > 0], achieved_vol=achieved_vol, warnings=warnings)


def _make_psd(cov: pd.DataFrame) -> pd.DataFrame:
    """Symmetrise, clip negative eigenvalues (numerical noise) to 0 and add a tiny ridge so cvxpy accepts it."""
    symmetric = (cov.values + cov.values.T) / 2
    eigenvalues, eigenvectors = np.linalg.eigh(symmetric)
    clipped = eigenvectors @ np.diag(np.clip(eigenvalues, 0, None)) @ eigenvectors.T
    ridge = 1e-10 * np.eye(len(cov))
    return pd.DataFrame(clipped + ridge, index=cov.index, columns=cov.columns)


def _check_position_bounds(n_assets: int, c: Constraints) -> None:
    if c.max_position * n_assets < 1 - 1e-9:
        raise InfeasibleConstraints(
            f"{n_assets} funds with max_position {c.max_position:.0%} cannot add up to 100%"
        )
    if c.max_position * min(n_assets, c.max_etfs) < 1 - 1e-9:
        raise InfeasibleConstraints(
            f"max_etfs {c.max_etfs} funds with max_position {c.max_position:.0%} cannot add up to 100%"
        )


def _portfolio_vol(weights: pd.Series, cov: pd.DataFrame) -> float:
    w = weights.reindex(cov.index).fillna(0.0).values
    return float(np.sqrt(max(w @ cov.values @ w, 0.0)))


# ---------------------------------------------------------------- cardinality (max_etfs, min_position)


def _solve_with_cardinality(
    solver: Solver, net_mu: pd.Series, cov: pd.DataFrame, c: Constraints
) -> tuple[pd.Series, list[str]]:
    """Optimise, prune, re-optimise. The last allowed round forces every kept fund to hold >= min_position."""
    weights, warnings = solver(net_mu, cov, c, 0.0)
    for round_number in range(1, config.MAX_CARDINALITY_ROUNDS + 1):
        if _cardinality_ok(weights, c):
            break
        active = _prune(weights, c)
        floor = c.min_position if round_number == config.MAX_CARDINALITY_ROUNDS else 0.0
        weights, warnings = solver(net_mu[active], cov.loc[active, active], _restrict(c, active), floor)
    return weights.reindex(cov.index).fillna(0.0), warnings


def _cardinality_ok(weights: pd.Series, c: Constraints) -> bool:
    held = weights[weights > 0]
    return len(held) <= c.max_etfs and bool((held >= c.min_position - BOUND_TOLERANCE).all())


def _prune(weights: pd.Series, c: Constraints) -> list[str]:
    """Funds kept for the next round: the largest fund of every group with a minimum first (so a sector tilt
    cannot be pruned away), then the largest remaining weights >= min_position, up to max_etfs funds, then
    (only if needed) the next-largest funds until max_position still allows 100% invested."""
    ranked = weights.sort_values(ascending=False)
    kept: list[str] = []
    for group in c.group_min:
        members = ranked[ranked.index.isin(c.groups.get(group, []))]
        if len(members) and members.index[0] not in kept:
            kept.append(members.index[0])
    for isin, weight in ranked.items():
        if len(kept) >= c.max_etfs:
            break
        if weight >= c.min_position and isin not in kept:
            kept.append(isin)
    for isin in ranked.index:  # top up if the kept funds cannot reach 100% under max_position
        if len(kept) * c.max_position >= 1 - 1e-9:
            break
        if isin not in kept:
            kept.append(isin)
    return kept


def _restrict(c: Constraints, isins: list[str]) -> Constraints:
    """The same constraints on a smaller fund list (group member lists are cut down to it)."""
    groups = {key: [i for i in members if i in isins] for key, members in c.groups.items()}
    return Constraints(
        target_vol=c.target_vol, max_etfs=c.max_etfs, min_position=c.min_position, max_position=c.max_position,
        ter=c.ter.reindex(isins).fillna(0.0), groups=groups, group_min=c.group_min, group_max=c.group_max,
    )


# ---------------------------------------------------------------- shared cvxpy building blocks


def _feasible_set(w: cp.Variable, isins: list[str], c: Constraints, floor: float) -> list:
    """Long-only, fully invested, floor <= w <= max_position, and every group's min/max share."""
    return [cp.sum(w) == 1, w >= floor, w <= c.max_position] + _group_bounds(w, 1.0, isins, c)


def _group_bounds(w: cp.Variable, scale, isins: list[str], c: Constraints) -> list:
    """sum(w over group) >= group_min * scale and <= group_max * scale (scale is 1, or k in max_sharpe)."""
    position = {isin: n for n, isin in enumerate(isins)}

    def members(group: str) -> list[int]:
        return [position[i] for i in c.groups.get(group, []) if i in position]

    bounds = []
    for group, minimum in c.group_min.items():
        if not members(group):
            raise InfeasibleConstraints(f"{group} needs at least {minimum:.0%} but no fund of it is left")
        bounds.append(cp.sum(w[members(group)]) >= minimum * scale)
    for group, maximum in c.group_max.items():
        if members(group):
            bounds.append(cp.sum(w[members(group)]) <= maximum * scale)
    return bounds


def _solve(objective, constraints: list, w: cp.Variable, isins: list[str], what: str) -> pd.Series:
    problem = cp.Problem(objective, constraints)
    problem.solve(solver=cp.CLARABEL)
    if problem.status not in (cp.OPTIMAL, cp.OPTIMAL_INACCURATE) or w.value is None:
        raise InfeasibleConstraints(f"{what}: position and group bounds cannot be met together ({problem.status})")
    return _clean(pd.Series(w.value, index=isins))


def _clean(weights: pd.Series) -> pd.Series:
    """Zero out solver noise and rescale to sum exactly to 1."""
    weights = weights.clip(lower=0)
    weights[weights < ZERO_WEIGHT] = 0.0
    return weights / weights.sum()


def _variance(w: cp.Variable, cov: pd.DataFrame):
    return cp.quad_form(w, cp.psd_wrap(cov.values))


# ---------------------------------------------------------------- strategies


def _min_variance(net_mu: pd.Series, cov: pd.DataFrame, c: Constraints, floor: float) -> tuple[pd.Series, list[str]]:
    isins = list(cov.index)
    w = cp.Variable(len(isins))
    weights = _solve(cp.Minimize(_variance(w, cov)), _feasible_set(w, isins, c, floor), w, isins, "min_variance")
    return weights, []


def _max_return(net_mu: pd.Series, cov: pd.DataFrame, c: Constraints, floor: float) -> pd.Series:
    isins = list(cov.index)
    w = cp.Variable(len(isins))
    objective = cp.Maximize(net_mu.values @ w)
    return _solve(objective, _feasible_set(w, isins, c, floor), w, isins, "max_return")


def _target_vol(net_mu: pd.Series, cov: pd.DataFrame, c: Constraints, floor: float) -> tuple[pd.Series, list[str]]:
    """Highest net expected return with volatility <= target; min-variance / max-return if out of reach."""
    min_var_weights, _ = _min_variance(net_mu, cov, c, floor)
    min_var_vol = _portfolio_vol(min_var_weights, cov)
    if c.target_vol < min_var_vol:
        return min_var_weights, [
            f"target volatility {c.target_vol:.2%} is below the lowest reachable {min_var_vol:.2%}; "
            f"using the minimum-variance portfolio (volatility {min_var_vol:.2%})"
        ]

    max_return_weights = _max_return(net_mu, cov, c, floor)
    max_return_vol = _portfolio_vol(max_return_weights, cov)
    if c.target_vol > max_return_vol:
        return max_return_weights, [
            f"target volatility {c.target_vol:.2%} is above the highest-return portfolio's {max_return_vol:.2%}; "
            f"using the maximum-return portfolio (volatility {max_return_vol:.2%})"
        ]

    isins = list(cov.index)
    w = cp.Variable(len(isins))
    within_target = _variance(w, cov) <= c.target_vol**2
    objective = cp.Maximize(net_mu.values @ w)
    weights = _solve(objective, _feasible_set(w, isins, c, floor) + [within_target], w, isins, "target_vol")
    return weights, []


def _max_sharpe(net_mu: pd.Series, cov: pd.DataFrame, c: Constraints, floor: float) -> tuple[pd.Series, list[str]]:
    """Tangency portfolio with rf = 0 (net_mu is read as excess return).

    Convex trick (Cornuejols & Tütüncü): with y = k * w and k > 0, maximising mu.w / sqrt(w'Σw) is the same as
    minimising y'Σy subject to mu.y = 1. Every linear bound on w becomes the same bound scaled by k.
    """
    if (net_mu <= 0).all():
        weights, _ = _min_variance(net_mu, cov, c, floor)
        return weights, ["max_sharpe: no fund has a positive expected excess return; using minimum variance"]
    isins = list(cov.index)
    y = cp.Variable(len(isins))
    k = cp.Variable(nonneg=True)
    scaled = [net_mu.values @ y == 1, cp.sum(y) == k, y >= floor * k, y <= c.max_position * k]
    scaled += _group_bounds(y, k, isins, c)
    weights = _solve(cp.Minimize(_variance(y, cov)), scaled, y, isins, "max_sharpe")  # _clean divides by k
    return weights, []


def _risk_parity(net_mu: pd.Series, cov: pd.DataFrame, c: Constraints, floor: float) -> tuple[pd.Series, list[str]]:
    """Equal risk contribution (Spinu's log-barrier form): minimise ½ y'Σy − (1/n) Σ log y, then w = y / Σy.

    At the optimum every fund contributes the same share of variance. Position and group bounds are not part
    of the problem (adding them breaks the equal-contribution property), so violations are reported as warnings.
    """
    isins = list(cov.index)
    y = cp.Variable(len(isins), pos=True)
    objective = cp.Minimize(0.5 * _variance(y, cov) - cp.sum(cp.log(y)) / len(isins))
    problem = cp.Problem(objective)
    problem.solve(solver=cp.CLARABEL)
    if y.value is None:
        raise InfeasibleConstraints(f"risk_parity: solver failed ({problem.status})")
    return _clean(pd.Series(y.value, index=isins)), []


def _hrp(net_mu: pd.Series, cov: pd.DataFrame, c: Constraints, floor: float) -> tuple[pd.Series, list[str]]:
    """Hierarchical risk parity (López de Prado, 2016) from the covariance alone; bounds are not enforced.

    1. Cluster funds by correlation distance sqrt((1 - corr) / 2) (single linkage).
    2. Order funds so that similar ones sit next to each other (the dendrogram's leaf order).
    3. Recursive bisection: split the ordered list in halves and give each half a share inversely
       proportional to its variance, down to single funds.
    (Written out here because pypfopt 1.6's HRPOpt breaks on current SciPy.)
    """
    ordered = _cluster_order(cov)
    weights = pd.Series(1.0, index=ordered)
    clusters = [ordered]
    while clusters:
        clusters = [half for cluster in clusters if len(cluster) > 1
                    for half in (cluster[: len(cluster) // 2], cluster[len(cluster) // 2:])]
        for left, right in zip(clusters[::2], clusters[1::2]):
            left_variance, right_variance = _cluster_variance(cov, left), _cluster_variance(cov, right)
            left_share = 1 - left_variance / (left_variance + right_variance)
            weights[left] *= left_share
            weights[right] *= 1 - left_share
    return _clean(weights.reindex(cov.index)), []


def _cluster_order(cov: pd.DataFrame) -> list[str]:
    vols = np.sqrt(np.diag(cov.values))
    correlation = np.clip(cov.values / np.outer(vols, vols), -1, 1)
    distance = np.sqrt((1 - correlation) / 2)
    np.fill_diagonal(distance, 0.0)
    tree = linkage(squareform(distance, checks=False), method="single")
    return list(cov.index[leaves_list(tree)])


def _cluster_variance(cov: pd.DataFrame, members: list[str]) -> float:
    """Variance of the inverse-variance-weighted portfolio of `members`."""
    sub_cov = cov.loc[members, members].values
    inverse_variance = 1 / np.diag(sub_cov)
    w = inverse_variance / inverse_variance.sum()
    return float(w @ sub_cov @ w)


SOLVERS: dict[str, Solver] = {
    "target_vol": _target_vol,
    "min_variance": _min_variance,
    "max_sharpe": _max_sharpe,
    "risk_parity": _risk_parity,
    "hrp": _hrp,
}


# ---------------------------------------------------------------- honesty check


def _constraint_violations(weights: pd.Series, c: Constraints) -> list[str]:
    """Human-readable list of every bound the final weights break (empty for the cvxpy strategies)."""
    held = weights[weights > 0]
    too_small = int((held < c.min_position - BOUND_TOLERANCE).sum())
    too_large = int((held > c.max_position + BOUND_TOLERANCE).sum())
    problems = []
    if len(held) > c.max_etfs:
        problems.append(f"{len(held)} funds held, more than max_etfs = {c.max_etfs}")
    if too_small:
        problems.append(f"{too_small} position(s) below min_position {c.min_position:.0%}")
    if too_large:
        problems.append(f"{too_large} position(s) above max_position {c.max_position:.0%}")
    for group, minimum in c.group_min.items():
        share = weights.reindex(c.groups.get(group, [])).fillna(0).sum()
        if share < minimum - BOUND_TOLERANCE:
            problems.append(f"{group} holds {share:.1%}, below its minimum {minimum:.0%}")
    for group, maximum in c.group_max.items():
        share = weights.reindex(c.groups.get(group, [])).fillna(0).sum()
        if share > maximum + BOUND_TOLERANCE:
            problems.append(f"{group} holds {share:.1%}, above its maximum {maximum:.0%}")
    return [f"constraint not met: {p}" for p in problems]
