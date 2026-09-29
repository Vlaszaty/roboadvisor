"""Lane C. Spec §5.5."""

import pandas as pd

from app.engine.types import Constraints, InvestorProfile, OptimizeResult, Strategy


def target_vol_from_risk(risk_level: float, vol_range: tuple[float, float]) -> float:
    """vmin + risk_level / 100 * (vmax - vmin)."""
    raise NotImplementedError("Lane C")


def build_constraints(selection: pd.DataFrame, profile: InvestorProfile, target_vol: float) -> Constraints:
    """Constraints from the selected universe and preferences.

    groups: 'asset_class:<x>' for every asset class present and 'sector:<s>' for every sector present.
    group_min: {'sector:<s>': w} from preferences.sector_tilts. Raises InfeasibleConstraints if a tilted sector
      has no eligible fund, if the tilts sum to more than 1, or if there are more tilts than max_etfs.
    group_max: {'asset_class:crypto': preferences.crypto_max} when crypto funds are present.
    ter: selection.ter with NaN -> 0. Position bounds from preferences.
    """
    raise NotImplementedError("Lane C")


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
