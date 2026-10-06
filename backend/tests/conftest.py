import os

import pytest

# Tests must not start a background menu build against the real database when they create the app.
os.environ.setdefault("ROBO_WARM_MENU", "0")

from tests.fixtures.synthetic import SyntheticData


@pytest.fixture(scope="session")
def synthetic() -> SyntheticData:
    return SyntheticData()


@pytest.fixture(scope="session")
def weekly_eur(synthetic):
    return synthetic.weekly_returns("EUR")


@pytest.fixture(scope="session")
def weekly_usd(synthetic):
    return synthetic.weekly_returns("USD")
