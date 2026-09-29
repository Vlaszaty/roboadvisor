import sqlite3

import numpy as np
import pandas as pd
import pytest

from app.data import db
from app.engine.types import FUND_COLUMNS, LISTING_COLUMNS


@pytest.fixture()
def conn():
    c = db.connect(":memory:")
    db.init_db(c)
    yield c
    c.close()


def test_init_db_is_idempotent(conn):
    db.init_db(conn)
    names = {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
    assert {"fund", "listing", "price", "fx", "rf_rate", "meta"} <= names


def test_connect_creates_parent_folder(tmp_path):
    c = db.connect(tmp_path / "nested" / "x.db")
    c.close()
    assert (tmp_path / "nested" / "x.db").exists()


def test_funds_roundtrip_matches_synthetic(synthetic, synthetic_db_path):
    src = db.SqliteData(synthetic_db_path)
    got, want = src.funds(), synthetic.funds()
    assert list(got.columns) == FUND_COLUMNS
    assert got.index.name == "isin"
    assert set(got.index) == set(want.index)
    got = got.loc[want.index]
    assert got["esg"].dtype == bool and got["ucits"].dtype == bool
    assert got["ter"].dtype == float and got["duration"].dtype == float
    assert pd.api.types.is_datetime64_any_dtype(got["inception_date"])
    assert (got["inception_date"] == want["inception_date"]).all()
    assert (got["esg"] == want["esg"]).all() and (got["ucits"] == want["ucits"]).all()
    np.testing.assert_allclose(got["ter"], want["ter"])
    # missing strings are None, never NaN
    assert got.at["SYNUSEQ00001", "sector"] is None
    assert got.at["SYNHLTH00001", "sector"] == "healthcare"
    assert got.at["SYNUSEQ00001", "proxy_ticker"] is None
    assert got.at["IE00B6R52259", "proxy_ticker"] == "SYN-EQ"
    assert np.isnan(got.at["SYNUSEQ00001", "duration"])


def test_unknown_ter_and_inception_become_nan_and_nat(conn, tmp_path):
    funds = pd.DataFrame(
        [["X", None, "equity", "broad", "us", None, False, np.nan, "US", False, "etf", "acc", None, np.nan,
          None, pd.NaT, None, None]],
        columns=FUND_COLUMNS, index=pd.Index(["US0000000001"], name="isin"),
    )
    path = tmp_path / "t.db"
    c = db.connect(path)
    db.init_db(c)
    db.upsert_funds(c, funds)
    c.close()
    got = db.SqliteData(path).funds()
    assert np.isnan(got.at["US0000000001", "ter"])
    assert pd.isna(got.at["US0000000001", "inception_date"])
    assert got.at["US0000000001", "issuer"] is None


def test_listings_roundtrip(synthetic, synthetic_db_path):
    got = db.SqliteData(synthetic_db_path).listings()
    want = synthetic.listings()
    assert list(got.columns) == LISTING_COLUMNS
    assert got["is_primary"].dtype == bool
    assert isinstance(got.index, pd.RangeIndex)
    key = ["ticker"]
    pd.testing.assert_frame_equal(
        got.sort_values(key).reset_index(drop=True),
        want.sort_values(key).reset_index(drop=True),
        check_dtype=False,
    )


def test_prices_order_unknown_and_values(synthetic, synthetic_db_path):
    src = db.SqliteData(synthetic_db_path)
    tickers = ["IUSQ.DE", "NOPE", "SYN-EQ", "ACWI"]
    got = src.prices(tickers)
    want = synthetic.prices(tickers)
    assert list(got.columns) == tickers
    assert got["NOPE"].isna().all()
    assert isinstance(got.index, pd.DatetimeIndex) and got.index.is_monotonic_increasing
    assert got["IUSQ.DE"].first_valid_index() == pd.Timestamp("2011-10-21")
    pd.testing.assert_frame_equal(got.reindex(want.index), want, check_freq=False, check_dtype=False)


def test_prices_of_only_unknown_tickers(synthetic_db_path):
    got = db.SqliteData(synthetic_db_path).prices(["NOPE", "NADA"])
    assert list(got.columns) == ["NOPE", "NADA"] and got.isna().all().all()
    assert list(db.SqliteData(synthetic_db_path).prices([]).columns) == []


def test_fx_has_usd_column(synthetic, synthetic_db_path):
    fx = db.SqliteData(synthetic_db_path).fx()
    assert set(fx.columns) == {"EUR", "USD"}
    assert (fx["USD"] == 1.0).all()
    np.testing.assert_allclose(fx["EUR"], synthetic.fx()["EUR"].reindex(fx.index))


def test_fx_on_empty_db_still_has_usd(tmp_path):
    path = tmp_path / "e.db"
    c = db.connect(path)
    db.init_db(c)
    c.close()
    fx = db.SqliteData(path).fx()
    assert list(fx.columns) == ["USD"] and len(fx) == 0


def test_rf_and_last_ingest(synthetic, synthetic_db_path, tmp_path):
    src = db.SqliteData(synthetic_db_path)
    rf = src.rf("EUR")
    assert isinstance(rf.index, pd.DatetimeIndex)
    np.testing.assert_allclose(rf.to_numpy(), synthetic.rf("EUR").to_numpy())
    assert src.rf("CHF").empty
    assert src.last_ingest() == "2025-12-31"
    path = tmp_path / "e.db"
    c = db.connect(path)
    db.init_db(c)
    c.close()
    assert db.SqliteData(path).last_ingest() is None


def test_frames_are_cached_per_instance(synthetic_db_path, tmp_path):
    import shutil

    path = tmp_path / "copy.db"
    shutil.copy(synthetic_db_path, path)
    src = db.SqliteData(path)
    first = src.funds()
    c = sqlite3.connect(path)
    c.execute("PRAGMA foreign_keys = OFF")
    c.execute("DELETE FROM listing")
    c.execute("DELETE FROM fund")
    c.commit()
    c.close()
    assert len(src.funds()) == len(first) > 0
    src.funds().drop(src.funds().index, inplace=True)  # mutating a returned copy must not poison the cache
    assert len(src.funds()) == len(first)
    assert len(db.SqliteData(path).funds()) == 0


def test_upsert_funds_updates_existing_row(conn, synthetic):
    funds = synthetic.funds().iloc[:2].copy()
    db.upsert_funds(conn, funds)
    funds.iloc[0, funds.columns.get_loc("ter")] = 0.0099
    db.upsert_funds(conn, funds)
    n, ter = conn.execute("select count(*), max(ter) from fund").fetchone()
    assert n == 2 and ter == pytest.approx(0.0099)


def test_upsert_prices_skips_nan_and_overwrites(conn):
    idx = pd.to_datetime(["2024-01-02", "2024-01-03"])
    assert db.upsert_prices(conn, pd.DataFrame({"A": [1.0, np.nan]}, index=idx)) == 1
    db.upsert_prices(conn, pd.DataFrame({"A": [2.0]}, index=idx[:1]))
    assert conn.execute("select adj_close from price where ticker='A' and date='2024-01-02'").fetchone()[0] == 2.0
    assert db.last_price_dates(conn) == {"A": "2024-01-02"}


def test_rescale_prices_only_touches_one_ticker(conn):
    idx = pd.to_datetime(["2024-01-02", "2024-01-03"])
    db.upsert_prices(conn, pd.DataFrame({"A": [10.0, 11.0], "B": [5.0, 5.0]}, index=idx))
    db.rescale_prices(conn, "A", 0.5)
    assert [r[0] for r in conn.execute("select adj_close from price where ticker='A' order by date")] == [5.0, 5.5]
    assert [r[0] for r in conn.execute("select adj_close from price where ticker='B' order by date")] == [5.0, 5.0]


def test_series_dates_and_meta(conn):
    idx = pd.to_datetime(["2024-01-02", "2024-01-05"])
    db.upsert_fx(conn, pd.DataFrame({"EUR": [1.1, 1.2]}, index=idx))
    db.upsert_rf(conn, "USD", pd.Series([0.05, np.nan], index=idx))
    assert db.last_series_date(conn, "fx", "EUR") == "2024-01-05"
    assert db.last_series_date(conn, "rf_rate", "USD") == "2024-01-02"
    assert db.last_series_date(conn, "fx", "GBP") is None
    with pytest.raises(ValueError):
        db.last_series_date(conn, "price", "EUR")
    assert db.get_meta(conn, "k") is None
    db.set_meta(conn, "k", "v1")
    db.set_meta(conn, "k", "v2")
    assert db.get_meta(conn, "k") == "v2"


def test_delete_missing_removes_stale_catalogue_rows(conn, synthetic):
    funds, listings = synthetic.funds(), synthetic.listings()
    db.upsert_funds(conn, funds)
    db.upsert_listings(conn, listings)
    keep_isins = list(funds.index[:5])
    keep_tickers = list(listings[listings["isin"].isin(keep_isins)]["ticker"])
    n_l, n_f = db.delete_missing(conn, keep_isins, keep_tickers)
    assert n_f == len(funds) - 5 and n_l == len(listings) - len(keep_tickers)
    assert conn.execute("select count(*) from fund").fetchone()[0] == 5
