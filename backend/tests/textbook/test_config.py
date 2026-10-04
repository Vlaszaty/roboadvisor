from app import config
from tests.fixtures.synthetic import SYN_TEXTBOOK_FUNDS


def test_every_base_currency_has_seven_risky_funds_and_a_risk_free_fund():
    assert set(config.TEXTBOOK_FUNDS) == set(config.BASE_CURRENCIES)
    for base, cfg in config.TEXTBOOK_FUNDS.items():
        isins = [*cfg["risky"].values(), cfg["risk_free"]]
        assert len(cfg["risky"]) == 7, base
        assert len(set(isins)) == 8, base  # no fund twice
        assert config.ANCHORS[base]["global_equity"] not in isins, base  # the market is not a building block


def test_synthetic_fund_set_has_the_same_shape():
    cfg = SYN_TEXTBOOK_FUNDS["EUR"]
    assert len(cfg["risky"]) == 7 and cfg["risk_free"] not in cfg["risky"].values()


def test_risk_aversion_runs_from_cautious_to_adventurous():
    cautious, adventurous = config.TEXTBOOK_RISK_AVERSION
    assert cautious > adventurous > 0
