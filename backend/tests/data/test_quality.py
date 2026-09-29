import numpy as np
import pandas as pd
import pytest

from app.data import db, quality

LAST = pd.Timestamp("2024-06-03")


@pytest.fixture()
def conn():
    c = db.connect(":memory:")
    db.init_db(c)
    yield c
    c.close()


def _fund(isin: str, ter: float | None = 0.002, proxy: str | None = None) -> pd.DataFrame:
    row = {
        "name": f"Fund {isin}", "issuer": None, "asset_class": "equity", "sub_class": "broad", "region": "us",
        "sector": None, "esg": False, "ter": np.nan if ter is None else ter, "domicile": "IE", "ucits": True,
        "wrapper": "etf", "distribution": "acc", "hedged_to": None, "duration": np.nan, "index_name": None,
        "inception_date": pd.NaT, "proxy_ticker": proxy, "proxy_currency": "USD" if proxy else None,
    }
    return pd.DataFrame([row], index=pd.Index([isin], name="isin"))


def _listing(ticker: str, isin: str) -> pd.DataFrame:
    return pd.DataFrame(
        [[ticker, isin, "XETRA", "EUR", True]], columns=["ticker", "isin", "exchange", "currency", "is_primary"]
    )


def _add(conn, ticker: str, isin: str, ter: float | None = 0.002, proxy: str | None = None) -> None:
    db.upsert_funds(conn, _fund(isin, ter, proxy))
    db.upsert_listings(conn, _listing(ticker, isin))


def _prices(conn, ticker: str, dates, start: float = 100.0, step: float = 1.0005) -> None:
    values = start * step ** np.arange(len(dates))
    db.upsert_prices(conn, pd.DataFrame({ticker: values}, index=pd.DatetimeIndex(dates)))


def _long(end: pd.Timestamp = LAST):
    return pd.bdate_range("2023-01-02", end)


def _kinds(conn) -> set[tuple[str, str]]:
    return {(i.kind, i.ticker_or_isin) for i in quality.report(conn)}


def test_clean_database_has_no_issues(conn):
    _add(conn, "AAA.DE", "IE0000000001")
    _prices(conn, "AAA.DE", _long())
    assert quality.report(conn) == []


def test_missing_ter(conn):
    _add(conn, "AAA.DE", "IE0000000001", ter=None)
    _prices(conn, "AAA.DE", _long())
    assert _kinds(conn) == {("missing_ter", "IE0000000001")}


def test_no_data_for_listing_and_for_proxy(conn):
    _add(conn, "AAA.DE", "IE0000000001", proxy="PROXY")
    _add(conn, "BBB.DE", "IE0000000002")
    _prices(conn, "BBB.DE", _long())
    assert _kinds(conn) == {("no_data", "AAA.DE"), ("no_data", "PROXY")}


def test_short_history_only_without_proxy(conn):
    dates = pd.bdate_range(LAST - pd.Timedelta(days=100), LAST)
    _add(conn, "NEW.DE", "IE0000000001")
    _add(conn, "PRX.DE", "IE0000000002", proxy="LONG")
    _add(conn, "OLD.DE", "IE0000000003")
    _prices(conn, "NEW.DE", dates)
    _prices(conn, "PRX.DE", dates)
    _prices(conn, "LONG", _long())
    _prices(conn, "OLD.DE", _long())
    assert _kinds(conn) == {("short_history", "NEW.DE")}


def test_gap_over_ten_business_days_but_not_exactly_ten(conn):
    first = list(pd.bdate_range("2023-01-02", "2023-06-30"))
    ok = first + list(pd.bdate_range("2023-07-14", LAST))  # 10 business days from Jun 30 -> Jul 14: allowed
    bad = first + list(pd.bdate_range("2023-07-24", LAST))  # 16 business days: reported
    _add(conn, "OK.DE", "IE0000000001")
    _add(conn, "BAD.DE", "IE0000000002")
    _prices(conn, "OK.DE", ok)
    _prices(conn, "BAD.DE", bad)
    issues = quality.report(conn)
    assert [(i.kind, i.ticker_or_isin) for i in issues] == [("gap", "BAD.DE")]
    assert "16 business days" in issues[0].detail


def test_stale_listing(conn):
    _add(conn, "FRESH.DE", "IE0000000001")
    _add(conn, "OLD.DE", "IE0000000002")
    _prices(conn, "FRESH.DE", _long())
    _prices(conn, "OLD.DE", _long(pd.Timestamp("2024-05-24")))  # 10 days before the newest price
    assert _kinds(conn) == {("stale", "OLD.DE")}


def test_seven_days_behind_is_not_stale(conn):
    _add(conn, "FRESH.DE", "IE0000000001")
    _add(conn, "LATE.DE", "IE0000000002")
    _prices(conn, "FRESH.DE", _long())
    _prices(conn, "LATE.DE", _long(pd.Timestamp("2024-05-27")))  # exactly 7 days behind
    assert quality.report(conn) == []


def test_extreme_move(conn):
    dates = _long()
    values = 100 * 1.0005 ** np.arange(len(dates))
    values[200:] *= 1.30  # +30% in a single day
    _add(conn, "JUMP.DE", "IE0000000001")
    db.upsert_prices(conn, pd.DataFrame({"JUMP.DE": values}, index=dates))
    issues = quality.report(conn)
    assert [(i.kind, i.ticker_or_isin) for i in issues] == [("extreme_move", "JUMP.DE")]
    assert "+30.1%" in issues[0].detail


def test_proxy_series_are_checked_for_gaps_and_moves_but_not_staleness(conn):
    _add(conn, "AAA.DE", "IE0000000001", proxy="PRX")
    _prices(conn, "AAA.DE", _long())
    _prices(conn, "PRX", _long(pd.Timestamp("2023-06-30")))  # ends early: a proxy is allowed to be old
    assert quality.report(conn) == []


def test_issues_are_sorted_by_kind_then_key(conn):
    _add(conn, "ZZZ.DE", "IE0000000001", ter=None)
    _add(conn, "AAA.DE", "IE0000000002")
    kinds = [i.kind for i in quality.report(conn)]
    assert kinds == ["no_data", "no_data", "missing_ter"]
