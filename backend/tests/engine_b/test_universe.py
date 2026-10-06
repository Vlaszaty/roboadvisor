import numpy as np
import pandas as pd
import pytest

from app.engine.errors import NoEligibleFunds
from app.engine.types import FUND_COLUMNS, InvestorProfile, Preferences
from app.engine.universe import select

EUR_DEFAULT = {
    "IE00B6R52259", "IE00BDBRDM35", "SYNEUEQ00001", "SYNEMEQ00001", "SYNJPEQ00001", "SYNESGEQ0001",
    "SYNHLTH00001", "SYNGOVS00001", "SYNGOVL00001", "SYNUSTLEH001", "SYNCORP00001", "SYNCASH00001",
    "SYNYOUNG0001", "SYNGOLD00001",
}
US_ETFS = {
    "US4642882579", "US92206C5655", "SYNUSEQ00001", "SYNTECH00001", "SYNUSTL00001", "SYNHY0000001",
    "SYNREIT00001", "SYNIBIT00001",
}
CRYPTO = {"SYNBTC000001", "SYNIBIT00001"}


def profile(base="EUR", risk=50.0, **prefs) -> InvestorProfile:
    return InvestorProfile(
        risk_level=risk, horizon_years=10, base_currency=base, preferences=Preferences(**prefs)
    )


def pick(synthetic, base="EUR", risk=50.0, funds=None, listings=None, **prefs) -> pd.DataFrame:
    return select(
        synthetic.funds() if funds is None else funds,
        synthetic.listings() if listings is None else listings,
        profile(base, risk, **prefs),
    )


def test_esg_only_keeps_only_the_esg_fund(synthetic):
    assert list(pick(synthetic, esg_only=True).index) == ["SYNESGEQ0001"]
    assert list(pick(synthetic, "USD", esg_only=True).index) == ["SYNESGEQ0001"]


def test_eur_default_is_ucits_only_with_hedged_bonds(synthetic):
    sel = pick(synthetic)
    assert set(sel.index) == EUR_DEFAULT
    assert not set(sel.index) & US_ETFS
    assert "SYNGOLD00001" in sel.index  # ETC passes the UCITS filter
    assert "SYNUSTLEH001" in sel.index and "SYNUSTLUH001" not in sel.index
    assert "SYNBTC000001" not in sel.index  # crypto_max == 0


def test_usd_default_keeps_us_funds_and_both_ust_share_classes(synthetic):
    sel = pick(synthetic, "USD")
    assert set(sel.index) == set(synthetic.funds().index) - CRYPTO
    # no share class is hedged to USD, so hedge_bonds drops nothing
    assert {"SYNUSTLEH001", "SYNUSTLUH001"} <= set(sel.index)


def test_ucits_only_override(synthetic):
    eur = pick(synthetic, ucits_only=False)
    assert {"US4642882579", "SYNUSTL00001"} <= set(eur.index)
    assert "SYNUSTLUH001" not in eur.index  # hedge rule still applies
    usd = pick(synthetic, "USD", ucits_only=True)
    assert not set(usd.index) & US_ETFS


@pytest.mark.parametrize(
    "risk, crypto_max, expect_btc",
    [(60.0, 0.0, False), (39.9, 0.05, False), (40.0, 0.05, True), (60.0, 0.05, True)],
)
def test_crypto_rules(synthetic, risk, crypto_max, expect_btc):
    sel = pick(synthetic, risk=risk, crypto_max=crypto_max)
    assert ("SYNBTC000001" in sel.index) is expect_btc
    assert "SYNIBIT00001" not in sel.index  # US ETF, not UCITS


def test_crypto_kept_for_usd_at_risk_60(synthetic):
    sel = pick(synthetic, "USD", risk=60.0, crypto_max=0.05)
    assert CRYPTO <= set(sel.index)


def test_removed_counts_for_the_trace(synthetic):
    removed = pick(synthetic).attrs["removed"]
    assert set(removed) == {
        "esg", "regions_include", "regions_exclude", "sectors_exclude", "max_ter", "distribution", "crypto",
        "non_ucits", "not_etf", "small_funds", "hedged_duplicates_and_unlisted",
    }
    assert removed["crypto"] == 2  # crypto_max == 0
    assert removed["non_ucits"] == 7  # the US-domiciled etfs left after the crypto filter
    assert removed["hedged_duplicates_and_unlisted"] == 1  # SYNUSTLUH001
    assert sum(removed.values()) == len(synthetic.funds()) - len(EUR_DEFAULT)


def test_hedge_bonds_off_keeps_both_share_classes(synthetic):
    sel = pick(synthetic, hedge_bonds=False)
    assert {"SYNUSTLEH001", "SYNUSTLUH001"} <= set(sel.index)


def test_hedge_rule_runs_after_other_filters(synthetic):
    # max_ter 0.0008 removes the hedged class (0.0010) first, so the unhedged one (0.0007) survives.
    assert set(pick(synthetic, max_ter=0.0008).index) == {"SYNUSTLUH001"}


def test_regions_include_lets_global_pass(synthetic):
    sel = pick(synthetic, regions_include=["europe"])
    assert set(sel.index) == {
        "SYNEUEQ00001", "SYNGOVS00001", "SYNGOVL00001", "SYNCORP00001", "SYNCASH00001",  # europe
        "IE00B6R52259", "IE00BDBRDM35", "SYNESGEQ0001", "SYNHLTH00001", "SYNYOUNG0001", "SYNGOLD00001",  # global
    }
    usd = pick(synthetic, "USD", regions_include=["us"])
    assert set(usd["region"]) == {"us", "global"}
    assert "SYNUSEQ00001" in usd.index


def test_regions_exclude(synthetic):
    sel = pick(synthetic, regions_exclude=["em", "japan"])
    assert not {"SYNEMEQ00001", "SYNJPEQ00001"} & set(sel.index)
    assert len(sel) == len(EUR_DEFAULT) - 2


def test_sectors_exclude(synthetic):
    assert "SYNTECH00001" in pick(synthetic, "USD").index
    sel = pick(synthetic, "USD", sectors_exclude=["technology"])
    assert "SYNTECH00001" not in sel.index and "SYNHLTH00001" in sel.index
    assert len(sel) == 21
    assert "SYNHLTH00001" not in pick(synthetic, sectors_exclude=["healthcare"]).index


def test_max_ter_and_unknown_ter_kept(synthetic):
    sel = pick(synthetic, max_ter=0.0015)
    assert set(sel.index) == {
        "IE00BDBRDM35", "SYNEUEQ00001", "SYNJPEQ00001", "SYNGOVS00001", "SYNGOVL00001",
        "SYNUSTLEH001", "SYNCASH00001", "SYNGOLD00001",
    }  # SYNJPEQ00001 and SYNGOVS00001 sit exactly at 0.0015: kept
    funds = synthetic.funds()
    funds.loc["SYNEMEQ00001", "ter"] = np.nan
    assert "SYNEMEQ00001" in pick(synthetic, funds=funds, max_ter=0.0015).index


def test_distribution(synthetic):
    assert set(pick(synthetic, distribution="dist").index) == {"SYNEUEQ00001"}
    assert set(pick(synthetic, distribution="acc").index) == EUR_DEFAULT - {"SYNEUEQ00001"}
    assert set(pick(synthetic, "USD", distribution="dist").index) == US_ETFS - {"SYNIBIT00001"} | {"SYNEUEQ00001"}


@pytest.mark.parametrize(
    "base, isin, prefs, ticker, currency",
    [
        ("EUR", "IE00B6R52259", {}, "IUSQ.DE", "EUR"),
        ("USD", "IE00B6R52259", {}, "SSAC.L", "USD"),
        ("EUR", "SYNEMEQ00001", {}, "SEME.DE", "EUR"),
        ("USD", "SYNEMEQ00001", {}, "SEME.L", "USD"),
        ("EUR", "SYNUSTLUH001", {"hedge_bonds": False}, "SUSU.DE", "EUR"),  # base ccy beats is_primary
        ("USD", "SYNUSTLUH001", {}, "SUSU.L", "USD"),
        ("USD", "SYNEUEQ00001", {}, "SEUE.DE", "EUR"),  # no USD listing: fall back to the only one
    ],
)
def test_listing_choice(synthetic, base, isin, prefs, ticker, currency):
    sel = pick(synthetic, base, **prefs)
    assert sel.loc[isin, "ticker"] == ticker
    assert sel.loc[isin, "currency"] == currency


def test_listing_tie_break_is_primary_then_ticker(synthetic):
    listings = synthetic.listings()
    listings = listings[listings["isin"] != "SYNJPEQ00001"]
    extra = pd.DataFrame(
        [("ZZZ.DE", "SYNJPEQ00001", "XETRA", "EUR", False), ("AAA.DE", "SYNJPEQ00001", "XETRA", "EUR", False)],
        columns=listings.columns,
    )
    sel = pick(synthetic, listings=pd.concat([listings, extra], ignore_index=True))
    assert sel.loc["SYNJPEQ00001", "ticker"] == "AAA.DE"


def test_output_shape(synthetic):
    sel = pick(synthetic)
    assert sel.index.name == "isin" and sel.index.is_unique
    assert list(sel.columns) == FUND_COLUMNS + ["ticker", "exchange", "currency"]
    lst = synthetic.listings().set_index("ticker")
    assert (lst.loc[sel["ticker"], "isin"].to_numpy() == sel.index.to_numpy()).all()


def test_funds_without_listing_are_dropped(synthetic):
    listings = synthetic.listings()
    sel = pick(synthetic, listings=listings[listings["isin"] != "SYNJPEQ00001"])
    assert "SYNJPEQ00001" not in sel.index


def test_no_eligible_funds(synthetic):
    with pytest.raises(NoEligibleFunds):
        pick(synthetic, esg_only=True, regions_exclude=["global"])
    with pytest.raises(NoEligibleFunds):
        pick(synthetic, max_ter=0.0)


def test_etfs_only_drops_etps_and_etcs(synthetic):
    funds = synthetic.funds()
    sel = pick(synthetic, "USD", risk=60.0, crypto_max=0.05, etfs_only=True)
    assert set(funds.loc[sel.index, "wrapper"]) == {"etf"}
    assert sel.attrs["removed"]["not_etf"] > 0


def test_min_fund_size_drops_known_small_funds_and_keeps_unknown(synthetic):
    funds, listings = synthetic.funds(), synthetic.listings()
    everyone = pick(synthetic)
    small, big = everyone.index[0], everyone.index[1]
    stats = pd.DataFrame({"fund_size_eur": [5e7, 5e8], "daily_value_eur": [1e5, 1e6]}, index=[small, big])
    profile = InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR",
                              preferences=Preferences(min_fund_size_eur=1e8))
    sel = select(funds, listings, profile, stats)
    assert small not in sel.index and big in sel.index
    assert sel.attrs["removed"]["small_funds"] == 1
    assert len(sel) == len(everyone) - 1  # funds without figures stay
