import numpy as np
import pytest

from app.engine.errors import InfeasibleConstraints
from app.engine.optimize import build_constraints, target_vol_from_risk
from app.engine.types import InvestorProfile, Preferences


# ---------- target_vol_from_risk


@pytest.mark.parametrize("risk_level, expected", [(0, 0.02), (100, 0.20), (50, 0.11), (25, 0.065)])
def test_target_vol_from_risk(risk_level, expected):
    assert target_vol_from_risk(risk_level, (0.02, 0.20)) == pytest.approx(expected)


# ---------- build_constraints


def profile(**preferences) -> InvestorProfile:
    return InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR", preferences=Preferences(**preferences))


def test_build_constraints_groups_bounds_and_ter(selection):
    with_unknown_ter = selection.copy()
    with_unknown_ter.loc["SYNGOLD00001", "ter"] = np.nan
    c = build_constraints(with_unknown_ter, profile(max_etfs=8, min_position=0.05, max_position=0.3,
                                                    sector_tilts={"healthcare": 0.05}, crypto_max=0.05), 0.11)
    assert c.target_vol == 0.11
    assert (c.max_etfs, c.min_position, c.max_position) == (8, 0.05, 0.3)
    assert c.groups["sector:healthcare"] == ["SYNHLTH00001"]
    assert c.groups["asset_class:crypto"] == ["SYNBTC000001"]
    assert set(c.groups["asset_class:bond"]) == {"IE00BDBRDM35", "SYNGOVS00001", "SYNGOVL00001", "SYNUSTLEH001", "SYNCORP00001"}
    assert c.group_min == {"sector:healthcare": 0.05}
    assert c.group_max == {"asset_class:crypto": 0.05}
    assert c.ter["SYNGOLD00001"] == 0.0
    assert c.ter["IE00B6R52259"] == 0.0020


def test_build_constraints_without_crypto_has_no_crypto_cap(selection):
    c = build_constraints(selection.drop(index="SYNBTC000001"), profile(), 0.1)
    assert c.group_max == {}
    assert "asset_class:crypto" not in c.groups


def test_tilt_on_missing_sector_is_infeasible(selection):
    with pytest.raises(InfeasibleConstraints, match="energy"):
        build_constraints(selection, profile(sector_tilts={"energy": 0.05}), 0.1)


def test_tilts_above_100_percent_are_infeasible(selection):
    with pytest.raises(InfeasibleConstraints, match="100%"):
        build_constraints(selection, profile(sector_tilts={"healthcare": 0.6, "technology": 0.5}), 0.1)


def test_more_tilts_than_max_etfs_is_infeasible(selection):
    with pytest.raises(InfeasibleConstraints, match="max_etfs"):
        build_constraints(selection, profile(max_etfs=1, sector_tilts={"healthcare": 0.1, "technology": 0.1}), 0.1)
