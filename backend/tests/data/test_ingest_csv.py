import pandas as pd
import pytest

from app.data import ingest
from app.engine.types import FUND_COLUMNS, LISTING_COLUMNS

SPY = dict(
    ticker="SPY", isin="US78462F1030", exchange="NYSE", currency="USD", is_primary="1",
    name="SPDR S&P 500 ETF Trust", issuer="State Street", asset_class="equity", sub_class="large_cap",
    region="us", sector="", esg="0", ter="0.000945", domicile="US", ucits="0", wrapper="etf",
    distribution="dist", hedged_to="", duration="", index_name="S&P 500", inception_date="1993-01-22",
    proxy_ticker="", proxy_currency="",
)
ACWI_UCITS = dict(
    SPY, ticker="IUSQ.DE", isin="IE00B6R52259", exchange="XETRA", currency="EUR", name="iShares MSCI ACWI UCITS ETF",
    issuer="iShares", region="global", sub_class="broad", domicile="IE", ucits="1", distribution="acc",
    ter="0.0020", index_name="MSCI ACWI", inception_date="2011-10-21", proxy_ticker="SPY", proxy_currency="USD",
)
AGG_HEDGED = dict(
    SPY, ticker="AGGH.AS", isin="IE00BDBRDM35", exchange="EURONEXT", currency="EUR", asset_class="bond",
    sub_class="broad", region="global", name="iShares Core Global Aggregate Bond EUR Hedged", issuer="iShares",
    domicile="IE", ucits="1", distribution="acc", hedged_to="EUR", duration="7.0",
    index_name="Bloomberg Global Aggregate", ter="0.0010", inception_date="2017-11-21",
)


def frame(*rows: dict) -> pd.DataFrame:
    return pd.DataFrame(list(rows), columns=ingest.CSV_COLUMNS)


def errors_for(*rows: dict) -> list[str]:
    return ingest.validate(frame(*rows))


def test_column_spec_is_listing_then_fund_columns():
    assert ingest.CSV_COLUMNS == [*LISTING_COLUMNS, *FUND_COLUMNS]
    assert set(SPY) == set(ingest.CSV_COLUMNS)


def test_valid_rows_have_no_errors():
    assert errors_for(SPY, ACWI_UCITS, AGG_HEDGED) == []


def test_isin_check_digit():
    assert ingest.is_valid_isin("US0378331005")
    assert not ingest.is_valid_isin("US0378331006")
    assert not ingest.is_valid_isin("US037833100")
    assert not ingest.is_valid_isin("us0378331005")


def test_bad_isin_is_reported_with_line_number():
    (msg,) = errors_for(dict(SPY, isin="US78462F1031"))
    assert msg.startswith("line 2 (SPY):") and "not a valid ISIN" in msg


def test_missing_or_extra_columns():
    df = frame(SPY).drop(columns=["ter"])
    (msg,) = ingest.validate(df)
    assert "missing ['ter']" in msg
    assert "unexpected ['x']" in ingest.validate(frame(SPY).assign(x="1"))[0]


@pytest.mark.parametrize(
    "overrides, fragment",
    [
        ({"name": ""}, "name is required"),
        ({"asset_class": "stocks"}, "asset_class"),
        ({"sub_class": "gov_long"}, "sub_class 'gov_long' not allowed for equity"),
        ({"region": "mars"}, "region"),
        ({"exchange": "NASDAQ2"}, "exchange"),
        ({"currency": "usd"}, "currency"),
        ({"esg": "yes"}, "esg must be 0 or 1"),
        ({"ter": "0.2"}, "ter"),
        ({"ter": "abc"}, "not a number"),
        ({"wrapper": "fund"}, "wrapper"),
        ({"distribution": ""}, "distribution is required"),
        ({"inception_date": "01/02/2020"}, "inception_date"),
        ({"sector": "technology"}, "sector must be blank"),
        ({"sub_class": "sector"}, "sector funds need sector"),
        ({"duration": "5"}, "duration is only for bond/cash"),
        ({"hedged_to": "EUR"}, "hedged_to is only allowed for bond"),
        ({"proxy_ticker": "SPY"}, "set together"),
        ({"proxy_currency": "USD"}, "set together"),
    ],
)
def test_single_row_rules(overrides, fragment):
    msgs = errors_for(dict(SPY, **overrides))
    assert any(fragment in m for m in msgs), msgs


def test_bond_needs_index_name_and_hedge_currency_is_checked():
    msgs = errors_for(dict(AGG_HEDGED, index_name="", hedged_to="JPY"))
    assert any("index_name" in m for m in msgs) and any("hedged_to 'JPY'" in m for m in msgs)


def test_gbx_currency_is_accepted():
    assert errors_for(dict(SPY, ticker="ISF.L", currency="GBX")) == []


def test_sector_fund_with_valid_sector_passes():
    assert errors_for(dict(SPY, ticker="XLK", isin="US81369Y8030", sub_class="sector", sector="technology")) == []


def test_duplicate_ticker():
    msgs = errors_for(SPY, dict(ACWI_UCITS, ticker="SPY"))
    assert any("ticker 'SPY' appears 2 times" in m for m in msgs)


def test_fund_columns_must_agree_across_listings():
    second = dict(ACWI_UCITS, ticker="SSAC.L", exchange="LSE", currency="GBP", is_primary="0", ter="0.0025")
    msgs = errors_for(ACWI_UCITS, second)
    assert any("column ter differs" in m for m in msgs)


def test_exactly_one_primary_per_isin():
    second = dict(ACWI_UCITS, ticker="SSAC.L", exchange="LSE", currency="GBP", is_primary="1")
    assert any("exactly one listing" in m and "found 2" in m for m in errors_for(ACWI_UCITS, second))
    none = dict(SPY, is_primary="0")
    assert any("found 0" in m for m in errors_for(none))


def test_split_catalogue_types_match_the_datasource_contract():
    second = dict(ACWI_UCITS, ticker="SSAC.L", exchange="LSE", currency="GBP", is_primary="0")
    funds, listings = ingest.split_catalogue(frame(SPY, ACWI_UCITS, second, AGG_HEDGED))
    assert list(funds.columns) == FUND_COLUMNS and funds.index.name == "isin"
    assert list(funds.index) == ["US78462F1030", "IE00B6R52259", "IE00BDBRDM35"]
    assert funds["esg"].dtype == bool and funds["ucits"].dtype == bool
    assert funds.at["IE00B6R52259", "ucits"] and not funds.at["US78462F1030", "ucits"]
    assert funds["ter"].dtype == float and funds.at["IE00BDBRDM35", "duration"] == 7.0
    assert pd.isna(funds.at["US78462F1030", "duration"])
    assert funds.at["US78462F1030", "inception_date"] == pd.Timestamp("1993-01-22")
    assert pd.isna(funds.at["US78462F1030", "hedged_to"]) and funds.at["IE00BDBRDM35", "hedged_to"] == "EUR"
    assert list(listings.columns) == LISTING_COLUMNS and len(listings) == 4
    assert listings["is_primary"].tolist() == [True, True, False, True]


def test_load_catalogue_reads_a_file_and_raises_csverror(tmp_path):
    good = tmp_path / "good.csv"
    frame(SPY).to_csv(good, index=False)
    funds, listings = ingest.load_catalogue(good)
    assert len(funds) == 1 and len(listings) == 1
    bad = tmp_path / "bad.csv"
    frame(dict(SPY, isin="XX")).to_csv(bad, index=False)
    with pytest.raises(ingest.CsvError) as exc:
        ingest.load_catalogue(bad)
    assert "line 2 (SPY)" in str(exc.value)
