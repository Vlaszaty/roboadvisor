"""Lane C. Spec §5.5 — portfolio construction.

Solver choice: the convex problems (target_vol, min_variance, max_sharpe, risk_parity) are written directly in
cvxpy (installed with PyPortfolioOpt) rather than through pypfopt's EfficientFrontier. Reasons: the TER penalty
and the group bounds are one line each in plain cvxpy, the min-variance / max-return fallbacks for an
unreachable volatility target are explicit instead of hidden in exceptions, and the maths reads the same as
the spec. HRP has no convex formulation and is written out with SciPy's clustering.

Return-level convention: every strategy except max_sharpe is unchanged if the same constant is added to all
of mu (weights sum to 1). max_sharpe treats mu as returns in excess of the risk-free rate (rf = 0), so callers
should pass capm.expected - capm.rf for that strategy.
"""

import pandas as pd

from app.engine.errors import InfeasibleConstraints
from app.engine.types import Constraints, InvestorProfile, OptimizeResult, Strategy


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
    raise NotImplementedError("Lane C")
