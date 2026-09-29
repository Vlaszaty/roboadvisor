from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from app.data import db, ingest, sources
from tests.data.test_ingest_csv import ACWI_UCITS, SPY, frame

EUNL = dict(
    ACWI_UCITS, ticker="NODATA.DE", isin="IE00B4L5Y983", name="iShares Core MSCI World", proxy_ticker="PROXYONLY",
    index_name="MSCI World",
)
SSAC = dict(ACWI_UCITS, ticker="SSAC.L", exchange="LSE", currency="GBP", is_primary="0")
ROWS = [SPY, ACWI_UCITS, SSAC, EUNL]


class FakeSources:
    """Replaces the network functions of app.data.sources. Prices are 100 + day index, times `scale`."""

    def __init__(self):
        self.end = pd.Timestamp("2024-03-01")
        self.scale = 1.0
        self.price_calls: list[tuple[list[str], date | None]] = []
        self.fx_calls: list[tuple[list[str], date | None]] = []
        self.rf_calls: list[tuple[str, date | None]] = []

    def fetch_prices(self, tickers, start):
        self.price_calls.append((list(tickers), start))
        days = pd.bdate_range("2024-01-02", self.end)
        if start is not None:
            days = days[days >= pd.Timestamp(start)]
        full = pd.bdate_range("2024-01-02", self.end)
        out = {}
        for t in tickers:
            if t == "NODATA.DE":
                continue
            out[t] = [(100.0 + full.get_loc(d)) * self.scale for d in days]
        return pd.DataFrame(out, index=days)

    def fetch_fx(self, currencies, start):
        self.fx_calls.append((list(currencies), start))
        days = pd.bdate_range("2024-01-02", self.end)
        if start is not None:
            days = days[days >= pd.Timestamp(start)]
        return pd.DataFrame({c: 1.1 for c in currencies}, index=days)

    def fetch_rf(self, currency, start):
        self.rf_calls.append((currency, start))
        days = pd.bdate_range("2024-01-02", self.end)
        if start is not None:
            days = days[days >= pd.Timestamp(start)]
        return pd.Series(0.03, index=days, name=currency)


@pytest.fixture()
def fake(monkeypatch):
    f = FakeSources()
    monkeypatch.setattr(sources, "fetch_prices", f.fetch_prices)
    monkeypatch.setattr(sources, "fetch_fx", f.fetch_fx)
    monkeypatch.setattr(sources, "fetch_rf", f.fetch_rf)
    return f


def _csv(tmp_path, rows=ROWS, name="etfs.csv"):
    path = tmp_path / name
    frame(*rows).to_csv(path, index=False)
    return str(path)


def _run(tmp_path, *extra, rows=ROWS):
    return ingest.main(["--csv", _csv(tmp_path, rows), "--db", str(tmp_path / "t.db"), *extra])


def _stored(tmp_path, ticker):
    conn = db.connect(tmp_path / "t.db")
    rows = conn.execute("SELECT date, adj_close FROM price WHERE ticker=? ORDER BY date", (ticker,)).fetchall()
    conn.close()
    return pd.Series([r[1] for r in rows], index=pd.to_datetime([r[0] for r in rows]))


def test_first_run_stores_everything_and_reports(tmp_path, fake, capsys):
    assert _run(tmp_path) == 0
    out = capsys.readouterr().out
    src = db.SqliteData(tmp_path / "t.db")
    assert len(src.funds()) == 3 and len(src.listings()) == 4
    assert src.last_ingest() == date.today().isoformat()
    px = src.prices(["SPY", "IUSQ.DE", "SSAC.L", "PROXYONLY", "NODATA.DE"])
    assert px[["SPY", "IUSQ.DE", "SSAC.L", "PROXYONLY"]].notna().all().all()  # proxy tickers are fetched too
    assert px["NODATA.DE"].isna().all()
    assert set(src.fx().columns) == {"EUR", "GBP", "USD"}
    assert len(src.rf("EUR")) > 0 and len(src.rf("USD")) > 0
    # first run: one full-history call, currencies exclude USD, rf for both
    assert fake.price_calls == [(["SPY", "IUSQ.DE", "SSAC.L", "NODATA.DE", "PROXYONLY"], None)]
    assert fake.fx_calls == [(["EUR", "GBP"], None)]
    assert fake.rf_calls == [("EUR", None), ("USD", None)]
    assert "Data quality report" in out and "no_data" in out and "NODATA.DE" in out


def test_second_run_is_incremental_with_overlap(tmp_path, fake):
    _run(tmp_path)
    fake.price_calls.clear(), fake.fx_calls.clear(), fake.rf_calls.clear()
    fake.end = pd.Timestamp("2024-03-15")
    assert _run(tmp_path) == 0
    incremental = [c for c in fake.price_calls if c[1] is not None]
    assert incremental == [(["SPY", "IUSQ.DE", "SSAC.L", "PROXYONLY"], date(2024, 3, 1) - timedelta(days=7))]
    assert [c for c in fake.price_calls if c[1] is None] == [(["NODATA.DE"], None)]  # still has no stored data
    assert fake.fx_calls == [(["EUR", "GBP"], date(2024, 3, 1))]
    assert fake.rf_calls == [("EUR", date(2024, 3, 1)), ("USD", date(2024, 3, 1))]
    assert _stored(tmp_path, "SPY").index.max() == pd.Timestamp("2024-03-15")


def test_restated_history_is_rescaled_to_one_basis(tmp_path, fake, capsys):
    _run(tmp_path)
    before = _stored(tmp_path, "SPY")
    fake.end, fake.scale = pd.Timestamp("2024-03-15"), 0.98  # a dividend: Yahoo restates everything by -2%
    _run(tmp_path)
    after = _stored(tmp_path, "SPY")
    days = pd.bdate_range("2024-01-02", "2024-03-15")
    expected = pd.Series([(100.0 + i) * 0.98 for i in range(len(days))], index=days)
    pd.testing.assert_series_equal(after, expected, check_freq=False, check_names=False, rtol=1e-12)
    assert (after[before.index] / before).round(12).eq(0.98).all()
    assert "rescaled: " in capsys.readouterr().out


def test_unchanged_history_is_not_rescaled(tmp_path, fake, capsys):
    _run(tmp_path)
    before = _stored(tmp_path, "SPY")
    fake.end = pd.Timestamp("2024-03-15")
    _run(tmp_path)
    assert (_stored(tmp_path, "SPY")[before.index] == before).all()
    assert "0 tickers rescaled" in capsys.readouterr().out


def test_full_flag_refetches_everything_from_the_start(tmp_path, fake):
    _run(tmp_path)
    fake.price_calls.clear(), fake.fx_calls.clear(), fake.rf_calls.clear()
    assert _run(tmp_path, "--full") == 0
    assert all(start is None for _, start in fake.price_calls)
    assert fake.fx_calls[0][1] is None and all(s is None for _, s in fake.rf_calls)


def test_removed_csv_rows_disappear_from_the_catalogue(tmp_path, fake):
    _run(tmp_path)
    _run(tmp_path, rows=[SPY, ACWI_UCITS])
    src = db.SqliteData(tmp_path / "t.db")
    assert sorted(src.listings()["ticker"]) == ["IUSQ.DE", "SPY"]
    assert list(src.funds().index) == ["IE00B6R52259", "US78462F1030"]


def test_invalid_csv_exits_2_and_creates_no_database(tmp_path, fake, capsys):
    bad = dict(SPY, isin="US78462F1031")
    assert _run(tmp_path, rows=[bad]) == 2
    assert "not a valid ISIN" in capsys.readouterr().err
    assert not (tmp_path / "t.db").exists() and fake.price_calls == []


def test_no_prices_at_all_exits_3_without_marking_the_ingest(tmp_path, fake, monkeypatch, capsys):
    monkeypatch.setattr(sources, "fetch_prices", lambda tickers, start: pd.DataFrame())
    assert _run(tmp_path) == 3
    assert "no price data was obtained" in capsys.readouterr().err
    assert db.SqliteData(tmp_path / "t.db").last_ingest() is None


def test_check_currencies_flags_mismatch_and_unknown(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(sources, "fetch_currencies", lambda tickers: {"SPY": "USD", "IUSQ.DE": "EUR", "SSAC.L": "USD"})
    code = ingest.main(["--csv", _csv(tmp_path), "--db", str(tmp_path / "t.db"), "--check-currencies"])
    out = capsys.readouterr().out
    assert code == 1
    assert "mismatch  SSAC.L: csv says GBP, Yahoo quotes USD" in out
    assert "unknown   NODATA.DE" in out
    assert not (tmp_path / "t.db").exists()  # the check never writes


def test_merge_prices_ignores_rounding_noise():
    conn = db.connect(":memory:")
    db.init_db(conn)
    idx = pd.to_datetime(["2024-01-02", "2024-01-03"])
    db.upsert_prices(conn, pd.DataFrame({"A": [100.0, 101.0]}, index=idx))
    fresh = pd.DataFrame({"A": [101.0 * (1 + 1e-7), 102.0]}, index=pd.to_datetime(["2024-01-03", "2024-01-04"]))
    written, rescaled = ingest.merge_prices(conn, fresh, {"A": "2024-01-03"})
    assert written == 2 and rescaled == []
    assert conn.execute("SELECT adj_close FROM price WHERE ticker='A' AND date='2024-01-02'").fetchone()[0] == 100.0


def test_merge_prices_ignores_a_forming_bar_for_today():
    """Plan deviation: an intraday bar stored for today must not be mistaken for a dividend restatement."""
    conn = db.connect(":memory:")
    db.init_db(conn)
    today = pd.Timestamp(date.today())
    idx = pd.DatetimeIndex([today - pd.Timedelta(days=2), today - pd.Timedelta(days=1), today])
    db.upsert_prices(conn, pd.DataFrame({"A": [100.0, 101.0, 102.0]}, index=idx))
    fresh = pd.DataFrame({"A": [101.0, 101.5]}, index=idx[1:])  # same closed bar, today's bar moved intraday
    written, rescaled = ingest.merge_prices(conn, fresh, {"A": today.strftime("%Y-%m-%d")})
    assert rescaled == [] and written == 2
    assert conn.execute("SELECT adj_close FROM price WHERE ticker='A' ORDER BY date LIMIT 1").fetchone()[0] == 100.0
