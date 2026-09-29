"""Validates the committed catalogue backend/data/etfs.csv. Runs offline; ticker/ISIN correctness against
the real world is checked by hand (see the plan), the rules below catch structural mistakes."""

import pandas as pd
import pytest

from app import config
from app.data import ingest

MIN_LISTINGS = 40  # raised to 300 when the catalogue is extended
REQUIRED_EXCHANGES = {"NYSE", "NASDAQ", "XETRA", "LSE", "EURONEXT", "SIX"}
LONG_HISTORY_ANCHORS = ["SPY", "IVV", "EFA", "EEM", "AGG", "BND", "TLT", "IEF", "SHY", "LQD", "HYG", "TIP",
                        "GLD", "VNQ", "ACWI"]
EXTERNAL_PROXIES = {"BTC-USD", "ETH-USD"}  # not tradable listings, prices only


@pytest.fixture(scope="module")
def raw() -> pd.DataFrame:
    return ingest.read_csv(config.ETFS_CSV)


def test_validation_rules_pass(raw):
    assert ingest.validate(raw) == []


def test_enough_listings(raw):
    assert len(raw) >= MIN_LISTINGS


def test_every_config_anchor_is_in_the_catalogue_with_a_proxy(raw):
    funds = raw.drop_duplicates("isin").set_index("isin")
    for currency, anchors in config.ANCHORS.items():
        for key, isin in anchors.items():
            assert isin in funds.index, f"anchor {currency}/{key} {isin} missing from etfs.csv"
            assert funds.at[isin, "proxy_ticker"] != "", f"anchor {isin} is young and needs a proxy_ticker"
    assert funds.at[config.ANCHORS["EUR"]["global_bonds"], "hedged_to"] == "EUR"
    assert funds.at[config.ANCHORS["USD"]["global_bonds"], "hedged_to"] == "USD"
    assert funds.at[config.ANCHORS["EUR"]["global_equity"], "region"] == "global"
    assert funds.at[config.ANCHORS["USD"]["global_equity"], "region"] == "global"


def test_long_history_anchor_tickers_present(raw):
    assert set(LONG_HISTORY_ANCHORS) <= set(raw["ticker"])


def test_proxies_resolve_and_currencies_agree(raw):
    listing_ccy = dict(zip(raw["ticker"], raw["currency"]))
    for r in raw[raw["proxy_ticker"] != ""].itertuples():
        assert r.proxy_ticker in listing_ccy or r.proxy_ticker in EXTERNAL_PROXIES, f"{r.ticker}: unknown proxy"
        if r.proxy_ticker in listing_ccy:
            assert listing_ccy[r.proxy_ticker] == r.proxy_currency, f"{r.ticker}: proxy currency differs"
        assert r.proxy_ticker != r.ticker


def test_coverage_checklist(raw):
    funds = raw.drop_duplicates("isin")
    assert set(ingest.ASSET_CLASSES) <= set(funds["asset_class"])
    assert REQUIRED_EXCHANGES <= set(raw["exchange"])
    assert {"global", "us", "europe", "em", "japan"} <= set(funds["region"])
    assert {"etf", "etp"} <= set(funds["wrapper"])
    assert (funds["esg"] == "1").any()
    assert {"technology", "healthcare"} <= set(funds["sector"])
    bonds = funds[funds["asset_class"] == "bond"]
    for sub in ("gov_short", "gov_long", "corp_ig", "high_yield", "inflation_linked", "em_debt", "broad"):
        assert sub in set(bonds["sub_class"]), f"no bond fund with sub_class {sub}"
    assert (raw["distribution"] == "acc").any() and (raw["distribution"] == "dist").any()


def test_hedged_and_unhedged_share_classes_share_an_index_name(raw):
    """universe.select drops unhedged siblings by matching index_name, so the names must match exactly."""
    bonds = raw[raw["asset_class"] == "bond"].drop_duplicates("isin")
    hedged = set(bonds[bonds["hedged_to"] != ""]["index_name"])
    unhedged = set(bonds[bonds["hedged_to"] == ""]["index_name"])
    assert hedged & unhedged, "need at least one index with both hedged and unhedged share classes"
    for name in hedged & unhedged:
        group = bonds[bonds["index_name"] == name]
        assert group["hedged_to"].nunique() > 1


def test_primary_listing_currency_is_a_real_trading_currency(raw):
    assert set(raw["currency"]) <= {"USD", "EUR", "GBP", "CHF", "CAD", "AUD", "JPY"}
