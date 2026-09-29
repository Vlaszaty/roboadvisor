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
    assert set(raw["currency"]) <= {"USD", "EUR", "GBP", "GBX", "CHF", "CAD", "AUD", "JPY"}



FINAL_MIN_LISTINGS = 300
FINAL_MIN_FUNDS = 250
REGION_MIN = {"us": 15, "global": 12, "europe": 8, "em": 8, "japan": 4, "uk": 2, "pacific_ex_japan": 2,
              "world_ex_us": 3, "canada": 3, "australia": 3, "china": 2, "india": 1}
EXCHANGE_MIN_LISTINGS = {"XETRA": 50, "LSE": 40, "EURONEXT": 15, "SIX": 10, "TSX": 5, "ASX": 5, "TSE": 3}
BOND_SUBCLASS_MIN = {"gov_short": 3, "gov_intermediate": 3, "gov_long": 3, "corp_ig": 3, "high_yield": 3,
                     "inflation_linked": 3, "em_debt": 3, "broad": 5}
FACTOR_SUBCLASSES = {"value", "growth", "momentum", "quality", "min_vol", "dividend", "multi_factor"}


def test_final_coverage_targets(raw):
    """Spec section 4.2 coverage, as numbers. Counts are unique funds (ISIN) unless stated."""
    funds = raw.drop_duplicates("isin")
    assert len(raw) >= FINAL_MIN_LISTINGS and len(funds) >= FINAL_MIN_FUNDS
    regions = funds["region"].value_counts()
    for region, n in REGION_MIN.items():
        assert regions.get(region, 0) >= n, f"region {region}: {regions.get(region, 0)} < {n}"
    listings = raw["exchange"].value_counts()
    for exchange, n in EXCHANGE_MIN_LISTINGS.items():
        assert listings.get(exchange, 0) >= n, f"exchange {exchange}: {listings.get(exchange, 0)} < {n}"
    assert listings.get("NYSE", 0) + listings.get("NASDAQ", 0) >= 80
    equity = funds[funds["asset_class"] == "equity"]
    assert equity["sub_class"].isin(FACTOR_SUBCLASSES).sum() >= 8, "need at least 8 factor funds"
    sectors = equity[equity["sub_class"] == "sector"]["sector"].value_counts()
    for sector in ingest.SECTORS:
        assert sectors.get(sector, 0) >= 2, f"sector {sector}: {sectors.get(sector, 0)} < 2"
    assert (funds["esg"] == "1").sum() >= 15
    bonds = funds[funds["asset_class"] == "bond"]
    for sub, n in BOND_SUBCLASS_MIN.items():
        assert (bonds["sub_class"] == sub).sum() >= n, f"bond {sub}: fewer than {n}"
    assert (bonds["hedged_to"] == "EUR").sum() >= 8 and (bonds["hedged_to"] == "USD").sum() >= 3
    classes = funds["asset_class"].value_counts()
    assert classes.get("commodity", 0) >= 6 and classes.get("real_estate", 0) >= 5
    assert classes.get("cash", 0) >= 4 and classes.get("crypto", 0) >= 6
    assert (funds["sub_class"] == "gold").sum() >= 3
    assert (funds["sub_class"] == "bitcoin").sum() >= 3 and (funds["sub_class"] == "ethereum").sum() >= 2


# Documented exceptions to "domicile equals the ISIN country prefix": none today. Add (isin) here with a reason.
DOMICILE_ISIN_EXCEPTIONS: set[str] = set()


def test_domicile_matches_isin_country(raw):
    bad = raw[(raw["domicile"] != raw["isin"].str[:2]) & ~raw["isin"].isin(DOMICILE_ISIN_EXCEPTIONS)]
    assert bad.empty, list(zip(bad["ticker"], bad["isin"], bad["domicile"]))
