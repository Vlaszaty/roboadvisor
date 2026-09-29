import pytest

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
