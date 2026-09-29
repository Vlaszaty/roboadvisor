"""Shared inputs for Lane C tests: a EUR universe, its covariance and CAPM expected returns.

The covariance is built here from the fixture's reference weekly returns (sample covariance x 52), so these
tests do not depend on Lane B's risk.covariance.
"""

import numpy as np
import pandas as pd
import pytest

from app import config
from app.engine.expected import capm, market_returns
from app.engine.types import Constraints

UNIVERSE = [
    "IE00B6R52259", "IE00BDBRDM35", "SYNEUEQ00001", "SYNEMEQ00001", "SYNJPEQ00001", "SYNHLTH00001",
    "SYNTECH00001", "SYNGOVS00001", "SYNGOVL00001", "SYNUSTLEH001", "SYNCORP00001", "SYNGOLD00001",
    "SYNCASH00001", "SYNREIT00001", "SYNBTC000001",
]
FIVE_YEARS = 5 * 52


@pytest.fixture(scope="session")
def cov(weekly_eur) -> pd.DataFrame:
    window = weekly_eur[UNIVERSE].iloc[-FIVE_YEARS:].dropna()
    return window.cov() * 52


@pytest.fixture(scope="session")
def mu(synthetic, weekly_eur) -> pd.Series:
    model = "capm_multi_asset"
    market = market_returns(weekly_eur, config.ANCHORS["EUR"], config.MARKETS[model]["weights"])
    result = capm(weekly_eur[UNIVERSE], market, synthetic.rf("EUR"), config.MARKETS[model]["premium"], model, 5)
    return result.expected


@pytest.fixture(scope="session")
def selection(synthetic) -> pd.DataFrame:
    return synthetic.funds().loc[UNIVERSE]


def make_constraints(selection: pd.DataFrame, **overrides) -> Constraints:
    """Constraints with the Preferences defaults unless overridden (no sector tilt, crypto capped at 5%)."""
    groups = {}
    for column in ("asset_class", "sector"):
        for value, members in selection.groupby(column).groups.items():
            groups[f"{column}:{value}"] = list(members)
    values = dict(
        target_vol=0.10, max_etfs=10, min_position=0.03, max_position=0.40,
        ter=selection["ter"].fillna(0.0), groups=groups, group_min={}, group_max={"asset_class:crypto": 0.05},
    )
    values.update(overrides)
    return Constraints(**values)


def no_cardinality(selection: pd.DataFrame, **overrides) -> Constraints:
    """Constraints with max_etfs/min_position switched off, for tests about the pure optimisation."""
    return make_constraints(selection, **{"max_etfs": len(selection), "min_position": 0.0, **overrides})


TOL = 1e-4
TARGETS = [0.03, 0.06, 0.10, 0.14, 0.18]  # annual volatility targets used across tests


def vol(weights: pd.Series, cov: pd.DataFrame) -> float:
    w = weights.reindex(cov.index).fillna(0.0)
    return float(np.sqrt(w @ cov @ w))


def net_return(weights: pd.Series, mu: pd.Series, ter: pd.Series) -> float:
    return float((weights * (mu - config.TER_PENALTY * ter).reindex(weights.index)).sum())


def assert_valid(result, cov, c):
    """Every rule of the contract that holds for the cvxpy-based strategies."""
    w = result.weights
    assert w.sum() == pytest.approx(1.0, abs=1e-9)
    assert (w > 0).all(), "only non-zero weights are returned"
    assert set(w.index) <= set(cov.index)
    assert result.achieved_vol == pytest.approx(vol(w, cov), abs=1e-6)
    assert w.max() <= c.max_position + TOL
    assert w.min() >= c.min_position - TOL
    assert len(w) <= c.max_etfs
    for group, minimum in c.group_min.items():
        assert w.reindex(c.groups[group]).fillna(0).sum() >= minimum - TOL
    for group, maximum in c.group_max.items():
        assert w.reindex(c.groups[group]).fillna(0).sum() <= maximum + TOL
