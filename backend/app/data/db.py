"""SQLite access (Lane A): connection helpers, upserts used by ingest, and SqliteData (a DataSource)."""

from __future__ import annotations

import math
import sqlite3
from collections.abc import Iterable
from contextlib import closing
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from app.engine.types import FUND_COLUMNS, LISTING_COLUMNS

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
_CHUNK = 500  # SQLite host-parameter limit is 999 on old builds
_FUND_STRING_COLUMNS = [
    "name", "issuer", "asset_class", "sub_class", "region", "sector", "domicile", "wrapper",
    "distribution", "hedged_to", "index_name", "proxy_ticker", "proxy_currency",
]


def connect(path: Path | str) -> sqlite3.Connection:
    """Open (creating file and parent folders if needed) a SQLite database. Use ':memory:' for tests."""
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """Create all tables from schema.sql (idempotent)."""
    conn.executescript(SCHEMA_PATH.read_text())
    conn.commit()


# ---------------------------------------------------------------- value conversion


def _py(v):
    """pandas/numpy scalar -> plain Python value SQLite accepts (NaN/NaT/NA -> None, dates -> ISO text)."""
    if v is None or v is pd.NA or v is pd.NaT:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if isinstance(v, date):  # pd.Timestamp is a datetime is a date
        return v.strftime("%Y-%m-%d")
    if isinstance(v, np.generic):
        return v.item()
    return v


def _iso(idx) -> list[str]:
    return [d.strftime("%Y-%m-%d") for d in pd.DatetimeIndex(idx)]


# ---------------------------------------------------------------- upserts (each commits)


def upsert_funds(conn: sqlite3.Connection, funds: pd.DataFrame) -> None:
    """funds: index isin, columns FUND_COLUMNS (the shape returned by DataSource.funds())."""
    cols = ", ".join(FUND_COLUMNS)
    marks = ", ".join("?" for _ in range(len(FUND_COLUMNS) + 1))
    updates = ", ".join(f"{c}=excluded.{c}" for c in FUND_COLUMNS)
    rows = [[isin, *(_py(row[c]) for c in FUND_COLUMNS)] for isin, row in funds.iterrows()]
    with conn:
        conn.executemany(
            f"INSERT INTO fund (isin, {cols}) VALUES ({marks}) ON CONFLICT(isin) DO UPDATE SET {updates}", rows
        )


def upsert_listings(conn: sqlite3.Connection, listings: pd.DataFrame) -> None:
    """listings: columns LISTING_COLUMNS. The fund rows must already exist (foreign key)."""
    cols = ", ".join(LISTING_COLUMNS)
    marks = ", ".join("?" for _ in LISTING_COLUMNS)
    updates = ", ".join(f"{c}=excluded.{c}" for c in LISTING_COLUMNS if c != "ticker")
    rows = [[_py(v) for v in r] for r in listings[LISTING_COLUMNS].itertuples(index=False, name=None)]
    with conn:
        conn.executemany(
            f"INSERT INTO listing ({cols}) VALUES ({marks}) ON CONFLICT(ticker) DO UPDATE SET {updates}", rows
        )


def delete_missing(conn: sqlite3.Connection, isins: Iterable[str], tickers: Iterable[str]) -> tuple[int, int]:
    """Delete listings whose ticker and funds whose isin are not in the given collections.
    Prices are kept (they may still serve as proxies). Returns (listings_deleted, funds_deleted)."""
    keep_t, keep_i = set(tickers), set(isins)
    with conn:
        old_t = [r[0] for r in conn.execute("SELECT ticker FROM listing") if r[0] not in keep_t]
        conn.executemany("DELETE FROM listing WHERE ticker = ?", [(t,) for t in old_t])
        old_i = [r[0] for r in conn.execute("SELECT isin FROM fund") if r[0] not in keep_i]
        conn.executemany("DELETE FROM fund WHERE isin = ?", [(i,) for i in old_i])
    return len(old_t), len(old_i)


def upsert_prices(conn: sqlite3.Connection, prices: pd.DataFrame) -> int:
    """prices: wide (DatetimeIndex x ticker). NaN cells are skipped. Returns rows written."""
    if prices.empty:
        return 0
    dates = _iso(prices.index)
    rows = []
    for ticker in prices.columns:
        vals = prices[ticker].to_numpy(dtype=float)
        rows.extend((ticker, d, float(v)) for d, v in zip(dates, vals) if not math.isnan(v))
    with conn:
        conn.executemany("INSERT OR REPLACE INTO price (ticker, date, adj_close) VALUES (?, ?, ?)", rows)
    return len(rows)


def rescale_prices(conn: sqlite3.Connection, ticker: str, factor: float) -> None:
    """Multiply every stored price of a ticker by factor (used when the provider restates adjusted history)."""
    with conn:
        conn.execute("UPDATE price SET adj_close = adj_close * ? WHERE ticker = ?", (factor, ticker))


def last_price_dates(conn: sqlite3.Connection) -> dict[str, str]:
    """ticker -> ISO date of its newest stored price."""
    return {t: d for t, d in conn.execute("SELECT ticker, MAX(date) FROM price GROUP BY ticker")}


def upsert_fx(conn: sqlite3.Connection, fx: pd.DataFrame) -> int:
    """fx: wide (DatetimeIndex x currency), USD per 1 unit. NaN skipped. Returns rows written."""
    if fx.empty:
        return 0
    dates = _iso(fx.index)
    rows = []
    for ccy in fx.columns:
        vals = fx[ccy].to_numpy(dtype=float)
        rows.extend((ccy, d, float(v)) for d, v in zip(dates, vals) if not math.isnan(v))
    with conn:
        conn.executemany("INSERT OR REPLACE INTO fx (currency, date, usd_rate) VALUES (?, ?, ?)", rows)
    return len(rows)


def upsert_rf(conn: sqlite3.Connection, currency: str, rf: pd.Series) -> int:
    """rf: DatetimeIndex -> annualised rate as a fraction. NaN skipped. Returns rows written."""
    rf = rf.dropna()
    rows = [(currency, d, float(v)) for d, v in zip(_iso(rf.index), rf.to_numpy(dtype=float))]
    with conn:
        conn.executemany("INSERT OR REPLACE INTO rf_rate (currency, date, annual_rate) VALUES (?, ?, ?)", rows)
    return len(rows)


def last_series_date(conn: sqlite3.Connection, table: str, currency: str) -> str | None:
    """Newest stored date in 'fx' or 'rf_rate' for a currency, or None."""
    if table not in ("fx", "rf_rate"):
        raise ValueError(f"unknown table {table!r}")
    row = conn.execute(f"SELECT MAX(date) FROM {table} WHERE currency = ?", (currency,)).fetchone()
    return row[0]


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    with conn:
        conn.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


# ---------------------------------------------------------------- DataSource


def _none_for_na(s: pd.Series) -> pd.Series:
    """object Series with None (never NaN) for missing values, independent of the pandas string dtype."""
    return pd.Series([None if pd.isna(v) else v for v in s], index=s.index, dtype=object)


class SqliteData:
    """DataSource over the SQLite file (see app.engine.types.DataSource for the exact contract).

    Opens a short-lived read-only connection per load. Frames are cached for the life of the instance
    (restart after a re-ingest). The caches are not locked: concurrent first calls may load the same frame
    twice (a benign duplicate load), they never return partial data.
    """

    def __init__(self, path: Path | str) -> None:
        self._path = Path(path)
        self._funds: pd.DataFrame | None = None
        self._listings: pd.DataFrame | None = None
        self._fx: pd.DataFrame | None = None
        self._rf: dict[str, pd.Series] = {}
        self._px: dict[str, pd.Series] = {}
        self._last_ingest: tuple[str | None] | None = None

    def _conn(self) -> closing:
        conn = sqlite3.connect(f"{self._path.resolve().as_uri()}?mode=ro", uri=True)
        return closing(conn)

    def funds(self) -> pd.DataFrame:
        if self._funds is None:
            with self._conn() as conn:
                rows = conn.execute(f"SELECT isin, {', '.join(FUND_COLUMNS)} FROM fund ORDER BY isin").fetchall()
            df = pd.DataFrame(rows, columns=["isin", *FUND_COLUMNS]).set_index("isin")
            for c in _FUND_STRING_COLUMNS:
                df[c] = _none_for_na(df[c])
            df["esg"] = df["esg"].astype(bool)
            df["ucits"] = df["ucits"].astype(bool)
            df["ter"] = pd.to_numeric(df["ter"], errors="coerce").astype(float)
            df["duration"] = pd.to_numeric(df["duration"], errors="coerce").astype(float)
            df["inception_date"] = pd.to_datetime(df["inception_date"])
            self._funds = df[FUND_COLUMNS]
        return self._funds.copy()

    def listings(self) -> pd.DataFrame:
        if self._listings is None:
            with self._conn() as conn:
                rows = conn.execute(
                    f"SELECT {', '.join(LISTING_COLUMNS)} FROM listing ORDER BY isin, ticker"
                ).fetchall()
            df = pd.DataFrame(rows, columns=LISTING_COLUMNS)
            df["is_primary"] = df["is_primary"].astype(bool)
            self._listings = df
        return self._listings.copy()

    def _load_prices(self, tickers: list[str]) -> None:
        for i in range(0, len(tickers), _CHUNK):
            chunk = tickers[i : i + _CHUNK]
            marks = ", ".join("?" for _ in chunk)
            with self._conn() as conn:
                rows = conn.execute(
                    f"SELECT ticker, date, adj_close FROM price WHERE ticker IN ({marks}) ORDER BY ticker, date",
                    chunk,
                ).fetchall()
            df = pd.DataFrame(rows, columns=["ticker", "date", "adj_close"])
            df["date"] = pd.to_datetime(df["date"])
            for t in chunk:
                g = df[df["ticker"] == t]
                self._px[t] = pd.Series(g["adj_close"].to_numpy(dtype=float), index=pd.DatetimeIndex(g["date"]))

    def prices(self, tickers: list[str]) -> pd.DataFrame:
        tickers = list(tickers)
        unique = list(dict.fromkeys(tickers))
        missing = [t for t in unique if t not in self._px]
        if missing:
            self._load_prices(missing)
        if not unique:
            return pd.DataFrame(index=pd.DatetimeIndex([]))
        frame = pd.concat({t: self._px[t] for t in unique}, axis=1, sort=True)
        return frame.reindex(columns=tickers).sort_index()

    def fx(self) -> pd.DataFrame:
        if self._fx is None:
            with self._conn() as conn:
                rows = conn.execute("SELECT currency, date, usd_rate FROM fx").fetchall()
            df = pd.DataFrame(rows, columns=["currency", "date", "usd_rate"])
            if df.empty:
                wide = pd.DataFrame(index=pd.DatetimeIndex([]))
            else:
                df["date"] = pd.to_datetime(df["date"])
                wide = df.pivot(index="date", columns="currency", values="usd_rate").sort_index()
            wide["USD"] = 1.0
            if "GBP" in wide.columns:
                wide["GBX"] = wide["GBP"] / 100  # pence sterling: derived, never downloaded
            wide.columns.name = None
            wide.index.name = None
            self._fx = wide[sorted(wide.columns)].astype(float)
        return self._fx.copy()

    def rf(self, currency: str) -> pd.Series:
        if currency not in self._rf:
            with self._conn() as conn:
                rows = conn.execute(
                    "SELECT date, annual_rate FROM rf_rate WHERE currency = ? ORDER BY date", (currency,)
                ).fetchall()
            idx = pd.DatetimeIndex(pd.to_datetime([r[0] for r in rows]))
            self._rf[currency] = pd.Series([r[1] for r in rows], index=idx, dtype=float, name=currency)
        return self._rf[currency].copy()

    def last_ingest(self) -> str | None:
        if self._last_ingest is None:
            with self._conn() as conn:
                self._last_ingest = (get_meta(conn, "last_ingest"),)
        return self._last_ingest[0]
