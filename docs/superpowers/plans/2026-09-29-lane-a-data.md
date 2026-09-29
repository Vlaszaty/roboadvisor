# Lane A — Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the Lane A bodies (`db.py`, `sources.py`, `quality.py`, `ingest.py`), draft and validate the curated ETF catalogue `backend/data/etfs.csv` (300+ listings), verify the four `config.ANCHORS` ISINs, and prove with one real ingest that yfinance recognises the tickers.

**Architecture:** `sources.py` is the only module that touches the network (yfinance, ECB Data Portal over httpx); every call goes through a tiny private wrapper (`_download`, `_http_get`, `_yahoo_currency`) so tests substitute fakes. `ingest.py` validates `etfs.csv`, upserts funds/listings, fetches prices incrementally (with a restatement fix for Yahoo's retroactive dividend adjustment), then fx and risk-free rates, then prints `quality.report`. `db.SqliteData` implements the `DataSource` protocol over the SQLite file, with per-instance caches.

**Tech Stack:** Python 3.12, uv, sqlite3, pandas, numpy, yfinance, httpx, pytest (all already installed by Phase 0; **no new dependencies**).

**Spec:** `docs/superpowers/specs/2026-09-29-roboadvisor-design.md` (sections 4.1, 4.2, 4.3, 10). Contracts: `docs/superpowers/plans/2026-09-29-phase0-contracts.md` (this plan assumes it is merged and tagged `phase0-contracts`).

## Global Constraints

Copied from the Phase 0 plan:

- Python tooling is **uv** only: `uv sync`, `uv add`, `uv run pytest`, `uv run python -m ...`. Python pinned to **3.12**. Never use pip or a hand-made venv.
- Backend port **8740**, frontend port **5740** with Vite `strictPort: true`; Vite proxies `/api` → `http://localhost:8740`.
- All API routes live under `/api`. The API is stateless.
- Engine modules (`app/engine/*`) never import FastAPI, sqlite3 or `app.data`.
- All engine return series are **weekly (W-FRI)**, simple returns, base currency, columns = ISIN. Annualisation factor 52.
- Base currencies: `EUR`, `USD`.
- Drawdowns and losses are **negative numbers** (−0.35 = −35%). Thresholds are positive (0.3 means "−30% or worse").
- No network access in tests.
- Only Phase 0 adds Python/npm dependencies. Lanes that need one must escalate.
- Contract files created in Phase 0 (`config.py` structure, `engine/types.py`, `engine/errors.py`, `api/schemas.py`, `data/schema.sql`, route signatures, stub signatures) are frozen after Phase 0; changes go through the integrator.

Lane A specifics:

- Lane A touches only: `backend/app/data/{db,ingest,sources,quality}.py`, `backend/data/etfs.csv`, the **values** (not keys) of `config.ANCHORS`, and new files under `backend/tests/data/`. Nothing else, not even to "fix" a Phase 0 file: escalate in the hand-back note instead.
- Tests never use the network. The only network steps in this plan are the manual verification steps in Tasks 3, 6, 7, 8 and 9, which are labelled **(network)** or say so, and are never part of `pytest`.
- Problems in the data are reported by `quality.report`, never silently fixed by code.
- Prices are stored exactly as delivered (`auto_adjust=True`, local currency, total return); the only transformation ingest may apply is the restatement rescale in Task 5.

## Findings that shaped this plan (verified 2026-09-29, live)

1. **Anchor ISIN bug in Phase 0.** `US92203J4076` is **BNDX** (Vanguard Total International Bond ETF, ex-US), not BNDW. Vanguard Total World Bond ETF **BNDW** is `US92206C5655` (Yahoo `Ticker("BNDW").isin` and ISIN search agree). The other three anchors are correct: `IE00B6R52259` = iShares MSCI ACWI UCITS ETF USD (Acc) (IUSQ/ISAC), `IE00BDBRDM35` = iShares Core Global Aggregate Bond UCITS ETF EUR Hedged (Acc) (AGGH), `US4642882579` = iShares MSCI ACWI ETF (ACWI). Task 6 applies the correction.
2. **ECB series keys** (both return HTTP 200 CSV with `TIME_PERIOD`, `OBS_VALUE` in **percent**):
   - EONIA: `https://data-api.ecb.europa.eu/service/data/EON/D.EONIA_TO.RATE?format=csvdata&startPeriod=YYYY-MM-DD` (1999-01-04 onwards, e.g. 2019-09-25 = -0.455).
   - Euro short-term rate (EUR STR): `https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?format=csvdata&startPeriod=YYYY-MM-DD` (2019-10-01 onwards, e.g. 2024-01-02 = 3.906).
   - `FM/D.U2.EUR.4F.KR.DFR.LEV` (deposit facility rate) also works but is not used.
   - An empty date range answers HTTP 404: treated as "no rows".
3. **Yahoo quotes London lines in pence** (`SSAC.L` price 9330 with currency `GBp`; `SEGA.L`, a EUR-denominated fund, also reports `GBp`). The `currency` column in `etfs.csv` must equal **the currency Yahoo quotes**, with pence counted as `GBP`, and some lines are surprising (`SUSW.L` is quoted in EUR). `ingest --check-currencies` (Task 5) compares all listings against Yahoo. Levels of pence-quoted series are 100x too large in GBP terms; returns are unaffected (see integrator note 3).
4. **Real data glitches exist** in Yahoo history, found while drafting the seed catalogue: `1306.T` (TOPIX ETF) shows a +948% day on 2026-04-01 (unadjusted 10:1 split); `IJPA.L`, `IS3Q.DE`, `IS3S.DE`, `SSAC.L`, `ABTC.SW`, `AETH.SW` show +30% to +1200% "moves" in their first weeks or gaps of 50 business days. The seed catalogue uses cleaner listings of the same funds. Task 9 defines the review rules for such issues.
5. **`auto_adjust=True` restates the past.** Every dividend or split rescales all earlier adjusted closes. Appending only new days to stored history would leave a seam whose return is biased by the dividends paid since the last run. Task 5 fetches with a 7-day overlap and rescales stored history when the overlap price changed.

## File structure

| File | Responsibility |
|---|---|
| `backend/app/data/db.py` | connect/init, upsert helpers used by ingest, `SqliteData` (DataSource) |
| `backend/app/data/quality.py` | `Issue`, `report(conn)` |
| `backend/app/data/sources.py` | all network access: prices, fx, rf, quote currencies |
| `backend/app/data/ingest.py` | `etfs.csv` schema + validation, incremental price merge, CLI `main` |
| `backend/data/etfs.csv` | the curated catalogue, one row per listing |
| `backend/config.ANCHORS` values | verified anchor ISINs |
| `backend/tests/data/__init__.py`, `conftest.py` | package marker; `synthetic_db_path` fixture (SyntheticData written into a temp SQLite file) |
| `backend/tests/data/test_{db,quality,sources,ingest_csv,ingest_run,anchors,etfs_csv}.py` | tests |

---

### Task 1: SQLite layer (`db.py`)

**Files:**
- Modify: `backend/app/data/db.py` (replace the stub completely)
- Create: `backend/tests/data/__init__.py` (empty), `backend/tests/data/conftest.py`
- Test: `backend/tests/data/test_db.py`

**Interfaces:**
- Consumes: `app.engine.types.FUND_COLUMNS`, `LISTING_COLUMNS`; `data/schema.sql`; test fixture `synthetic` (`tests/conftest.py`, Phase 0).
- Produces (all in `app.data.db`):
  - `connect(path) -> sqlite3.Connection` (creates parent folders; `':memory:'` allowed; foreign keys on), `init_db(conn) -> None`
  - `upsert_funds(conn, funds: DataFrame) -> None` (index isin, columns `FUND_COLUMNS`), `upsert_listings(conn, listings) -> None`, `delete_missing(conn, isins, tickers) -> (listings_deleted, funds_deleted)`
  - `upsert_prices(conn, wide) -> int`, `rescale_prices(conn, ticker, factor) -> None`, `last_price_dates(conn) -> dict[ticker, 'YYYY-MM-DD']`
  - `upsert_fx(conn, wide) -> int`, `upsert_rf(conn, currency, series) -> int`, `last_series_date(conn, table: 'fx'|'rf_rate', currency) -> str | None`
  - `set_meta(conn, key, value)`, `get_meta(conn, key) -> str | None`
  - `SqliteData(path)`: `funds() prices(tickers) listings() fx() rf(currency) last_ingest()` exactly as documented on `DataSource`. Read-only connection per load, every frame cached per instance, callers get copies.

- [ ] **Step 1: Check the Phase 0 precondition**

Run: `(cd backend && uv run python -c "from tests.fixtures.synthetic import SyntheticData; print(SyntheticData().funds().shape)")`
Expected: `(24, 18)`.
If it raises `ValueError: 19 columns passed, passed data had 18 columns`, the integrator has not yet applied the Phase 0 fixture fix (see "Notes for the integrator", item 1). STOP and escalate; do not edit the fixture.

- [ ] **Step 2: Create the test package and fixture**

`backend/tests/data/__init__.py`: empty file.

`backend/tests/data/conftest.py`:

```python
import pytest

from app.data import db


def load_synthetic(conn, synthetic) -> None:
    """Write a SyntheticData market into an initialised DB using the Lane A upsert helpers."""
    funds, listings = synthetic.funds(), synthetic.listings()
    db.upsert_funds(conn, funds)
    db.upsert_listings(conn, listings)
    tickers = list(listings["ticker"]) + ["SYN-EQ", "SYN-BD", "SYN-UST", "SYN-BTC"]
    db.upsert_prices(conn, synthetic.prices(tickers))
    fx = synthetic.fx()
    db.upsert_fx(conn, fx[["EUR"]])
    for ccy in ("USD", "EUR"):
        db.upsert_rf(conn, ccy, synthetic.rf(ccy))
    db.set_meta(conn, "last_ingest", "2025-12-31")


@pytest.fixture(scope="session")
def synthetic_db_path(synthetic, tmp_path_factory):
    path = tmp_path_factory.mktemp("db") / "synthetic.db"
    conn = db.connect(path)
    db.init_db(conn)
    load_synthetic(conn, synthetic)
    conn.close()
    return path
```

- [ ] **Step 3: Write the failing tests**

`backend/tests/data/test_db.py`:

```python
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
```

- [ ] **Step 4: Run to verify it fails**

Run: `(cd backend && uv run pytest tests/data/test_db.py -q)`
Expected: FAIL/ERROR, `NotImplementedError: Lane A` (the stubs) on every test.

- [ ] **Step 5: Write `backend/app/data/db.py`**

```python
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

    Opens a short-lived read-only connection per load, so instances are thread-safe. Every frame is
    loaded once and cached for the life of the instance: restart after a re-ingest.
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
```

- [ ] **Step 6: Run the tests**

Run: `(cd backend && uv run pytest tests/data/test_db.py -q)`
Expected: `16 passed`

- [ ] **Step 7: Commit**

```bash
git add backend/app/data/db.py backend/tests/data
git commit -m "feat(data): sqlite layer, upserts and SqliteData DataSource"
```

---

### Task 2: Quality report (`quality.py`)

**Files:**
- Modify: `backend/app/data/quality.py` (replace the stub completely)
- Test: `backend/tests/data/test_quality.py`

**Interfaces:**
- Consumes: `app.data.db.{connect, init_db, upsert_funds, upsert_listings, upsert_prices}` (Task 1, used by the tests).
- Produces: `Issue(kind, ticker_or_isin, detail)` (frozen contract), `report(conn) -> list[Issue]` sorted by kind (order in `KIND_ORDER`) then key; constants `KIND_ORDER`, `MIN_HISTORY_DAYS=365`, `MAX_GAP_BUSINESS_DAYS=10`, `STALE_DAYS=7`, `EXTREME_MOVE=0.25`. Kinds: `no_data` (listing, or a fund's proxy ticker, with zero prices), `missing_ter`, `short_history` (<1 year span and fund has no proxy), `gap` (>10 business days between consecutive prices), `stale` (listing's last price more than 7 days older than the newest price in the DB), `extreme_move` (|daily return| > 25%). Gaps and extreme moves are checked on every price series including proxies; staleness and short history only on listings.

- [ ] **Step 1: Write the failing tests**

`backend/tests/data/test_quality.py`:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `(cd backend && uv run pytest tests/data/test_quality.py -q)`
Expected: FAIL, `NotImplementedError: Lane A` (from `report`) or `AttributeError` for `quality.KIND_ORDER`.

- [ ] **Step 3: Write `backend/app/data/quality.py`**

```python
"""Data quality report printed after ingestion (Lane A). Problems are reported, never fixed."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

import numpy as np
import pandas as pd

MIN_HISTORY_DAYS = 365
MAX_GAP_BUSINESS_DAYS = 10
STALE_DAYS = 7
EXTREME_MOVE = 0.25
KIND_ORDER = ["no_data", "missing_ter", "short_history", "gap", "stale", "extreme_move"]


@dataclass
class Issue:
    kind: str  # missing_ter | short_history | gap | stale | extreme_move | no_data
    ticker_or_isin: str
    detail: str


def _series(conn: sqlite3.Connection, ticker: str) -> pd.Series:
    rows = conn.execute("SELECT date, adj_close FROM price WHERE ticker = ? ORDER BY date", (ticker,)).fetchall()
    return pd.Series(
        [r[1] for r in rows], index=pd.DatetimeIndex(pd.to_datetime([r[0] for r in rows])), dtype=float
    )


def report(conn: sqlite3.Connection) -> list[Issue]:
    """Run every check over the whole database.

    - no_data: a listing (or a fund's proxy ticker) with zero stored prices.
    - missing_ter: fund.ter is NULL.
    - short_history: a listing whose first-to-last price span is < 1 year and whose fund has no proxy_ticker.
    - gap: a ticker with more than 10 business days between two consecutive prices.
    - stale: a listing whose last price is more than 7 days before the newest price date in the database.
    - extreme_move: a ticker with a daily return beyond +/-25%.
    """
    issues: list[Issue] = []
    listings = conn.execute("SELECT l.ticker, l.isin, f.proxy_ticker FROM listing l JOIN fund f USING (isin)").fetchall()
    listing_tickers = {t for t, _, _ in listings}
    has_proxy = {t: p is not None for t, _, p in listings}

    for isin, name in conn.execute("SELECT isin, name FROM fund WHERE ter IS NULL ORDER BY isin"):
        issues.append(Issue("missing_ter", isin, f"{name}: TER is not set"))

    priced = {t for (t,) in conn.execute("SELECT DISTINCT ticker FROM price")}
    for t in sorted(listing_tickers - priced):
        issues.append(Issue("no_data", t, "listing has no prices"))
    issues.extend(_missing_proxies(listings, priced))

    latest = conn.execute("SELECT MAX(date) FROM price").fetchone()[0]
    latest_ts = pd.Timestamp(latest) if latest else None

    for ticker in sorted(priced):
        s = _series(conn, ticker)
        if ticker in listing_tickers:
            span = (s.index[-1] - s.index[0]).days
            if span < MIN_HISTORY_DAYS and not has_proxy[ticker]:
                issues.append(Issue("short_history", ticker, f"only {span} days of history and no proxy"))
            if latest_ts is not None and (latest_ts - s.index[-1]).days > STALE_DAYS:
                issues.append(Issue("stale", ticker, f"last price {s.index[-1].date()}, database is at {latest_ts.date()}"))
        if len(s) > 1:
            d = s.index.values.astype("datetime64[D]")
            gaps = np.busday_count(d[:-1], d[1:])
            worst = int(gaps.max())
            if worst > MAX_GAP_BUSINESS_DAYS:
                i = int(gaps.argmax())
                issues.append(
                    Issue("gap", ticker, f"{worst} business days without a price between {d[i]} and {d[i + 1]}")
                )
            rets = s.pct_change().dropna()
            big = rets[rets.abs() > EXTREME_MOVE]
            if len(big):
                w = big.abs().idxmax()
                issues.append(
                    Issue("extreme_move", ticker, f"{len(big)} daily move(s) beyond 25%, worst {big[w]:+.1%} on {w.date()}")
                )

    issues.sort(key=lambda i: (KIND_ORDER.index(i.kind), i.ticker_or_isin))
    return issues


def _missing_proxies(listings: list[tuple], priced: set[str]) -> list[Issue]:
    out: list[Issue] = []
    seen: set[str] = set()
    for ticker, _, proxy in listings:
        if proxy and proxy not in priced and proxy not in seen:
            seen.add(proxy)
            out.append(Issue("no_data", proxy, f"proxy ticker (used by {ticker}) has no prices"))
    return out
```

- [ ] **Step 4: Run the tests**

Run: `(cd backend && uv run pytest tests/data/test_quality.py -q)`
Expected: `10 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/data/quality.py backend/tests/data/test_quality.py
git commit -m "feat(data): data quality report"
```

---

### Task 3: Network sources (`sources.py`)

**Files:**
- Modify: `backend/app/data/sources.py` (replace the stub completely)
- Test: `backend/tests/data/test_sources.py`

**Interfaces:**
- Consumes: nothing from other tasks. (yfinance, httpx, pandas are Phase 0 dependencies.)
- Produces (`app.data.sources`):
  - `fetch_prices(tickers: list[str], start: date | None) -> DataFrame` (batches of 50, columns = tickers that returned data, `start=None` = `period="max"`)
  - `fetch_fx(currencies: list[str], start: date | None) -> DataFrame` (USD per unit, `f"{ccy}USD=X"`, USD skipped)
  - `fetch_rf(currency: str, start: date | None) -> Series` (`"USD"`: `^IRX`/100; `"EUR"`: ECB EONIA until 2019-09-30 then EUR STR from 2019-10-01, percent/100; other currencies raise `ValueError`)
  - `fetch_currencies(tickers: list[str]) -> dict[str, str]` (Yahoo quote currency, `GBp`/`GBX` normalised to `GBP`; unknown tickers absent). This is an additive helper used by `ingest --check-currencies`.
  - Private network wrappers replaced by tests: `_download(batch, start)`, `_http_get(url, params)`, `_yahoo_currency(ticker)`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/data/test_sources.py`:

```python
from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.data import sources

DAYS = pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04"])


def _multi(data: dict[str, list[float]], index=DAYS) -> pd.DataFrame:
    """Shape of yf.download(list, group_by='column'): MultiIndex (field, ticker)."""
    cols, arrays = [], []
    for field in ("Close", "Volume"):
        for t, v in data.items():
            cols.append((field, t))
            arrays.append(np.array(v) if field == "Close" else np.ones(len(v)))
    return pd.DataFrame(dict(zip(cols, arrays)), index=index)


def test_fetch_prices_batches_and_drops_empty_columns(monkeypatch):
    calls = []

    def fake(batch, start):
        calls.append((list(batch), start))
        data = {t: [1.0, 2.0, 3.0] for t in batch}
        if "DEAD" in batch:
            data["DEAD"] = [np.nan] * 3  # yfinance keeps failed tickers as all-NaN columns
        return _multi(data)

    monkeypatch.setattr(sources, "_download", fake)
    monkeypatch.setattr(sources, "BATCH_SIZE", 2)
    out = sources.fetch_prices(["A", "B", "DEAD", "A", "C"], date(2020, 1, 1))
    assert calls == [(["A", "B"], date(2020, 1, 1)), (["DEAD", "C"], date(2020, 1, 1))]
    assert list(out.columns) == ["A", "B", "C"]
    assert isinstance(out.index, pd.DatetimeIndex) and len(out) == 3


def test_fetch_prices_normalises_timezone_and_time_of_day(monkeypatch):
    idx = pd.DatetimeIndex(["2024-01-02 09:00", "2024-01-03 09:00"], tz="Europe/Berlin")
    monkeypatch.setattr(sources, "_download", lambda b, s: _multi({"A": [1.0, 2.0]}, idx))
    out = sources.fetch_prices(["A"], None)
    assert out.index.tz is None
    assert list(out.index) == [pd.Timestamp("2024-01-02"), pd.Timestamp("2024-01-03")]


def test_fetch_prices_accepts_flat_columns_for_single_ticker(monkeypatch):
    flat = pd.DataFrame({"Close": [1.0, 2.0, 3.0], "Volume": [1, 1, 1]}, index=DAYS)
    monkeypatch.setattr(sources, "_download", lambda b, s: flat)
    assert list(sources.fetch_prices(["A"], None).columns) == ["A"]


def test_fetch_prices_survives_a_failed_batch(monkeypatch, capsys):
    def fake(batch, start):
        if "BAD" in batch:
            raise RuntimeError("boom")
        return _multi({t: [1.0, 2.0, 3.0] for t in batch})

    monkeypatch.setattr(sources, "_download", fake)
    monkeypatch.setattr(sources, "BATCH_SIZE", 1)
    out = sources.fetch_prices(["A", "BAD", "C"], None)
    assert list(out.columns) == ["A", "C"]
    assert "price download failed" in capsys.readouterr().err


def test_fetch_prices_returns_empty_frame_when_nothing_comes_back(monkeypatch):
    monkeypatch.setattr(sources, "_download", lambda b, s: pd.DataFrame())
    assert sources.fetch_prices(["A"], None).empty
    assert sources.fetch_prices([], None).empty


def test_fetch_fx_uses_usd_quoted_tickers_and_skips_usd(monkeypatch):
    seen = []

    def fake(tickers, start):
        seen.append(list(tickers))
        return pd.DataFrame({t: [1.1, 1.2, 1.3] for t in tickers}, index=DAYS)

    monkeypatch.setattr(sources, "fetch_prices", fake)
    out = sources.fetch_fx(["EUR", "USD", "GBP", "EUR"], None)
    assert seen == [["EURUSD=X", "GBPUSD=X"]]
    assert list(out.columns) == ["EUR", "GBP"]
    assert sources.fetch_fx(["USD"], None).empty


def test_fetch_rf_usd_divides_irx_by_100(monkeypatch):
    monkeypatch.setattr(
        sources, "fetch_prices", lambda t, s: pd.DataFrame({"^IRX": [5.25, np.nan, 5.0]}, index=DAYS)
    )
    rf = sources.fetch_rf("USD", None)
    assert rf.name == "USD"
    assert rf.tolist() == pytest.approx([0.0525, 0.05])


ECB_CSV_EONIA = "KEY,FREQ,TIME_PERIOD,OBS_VALUE,OBS_STATUS\nEON.D.EONIA_TO.RATE,D,2019-09-27,-0.452,A\nEON.D.EONIA_TO.RATE,D,2019-09-30,-0.460,A\n"
ECB_CSV_ESTR = "KEY,FREQ,TIME_PERIOD,OBS_VALUE,OBS_STATUS\nEST.B.EU000A2X2A25.WT,B,2019-10-01,-0.549,A\nEST.B.EU000A2X2A25.WT,B,2019-10-02,-0.550,A\n"


def _fake_ecb(calls):
    def fake(url, params):
        calls.append((url, dict(params)))
        if "/EON/" in url:
            return ECB_CSV_EONIA
        return ECB_CSV_ESTR

    return fake


def test_fetch_rf_eur_splices_eonia_and_estr(monkeypatch):
    calls = []
    monkeypatch.setattr(sources, "_http_get", _fake_ecb(calls))
    rf = sources.fetch_rf("EUR", None)
    assert calls == [
        ("https://data-api.ecb.europa.eu/service/data/EON/D.EONIA_TO.RATE",
         {"format": "csvdata", "endPeriod": "2019-09-30"}),
        ("https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT",
         {"format": "csvdata", "startPeriod": "2019-10-01"}),
    ]
    assert rf.name == "EUR"
    assert [d.strftime("%Y-%m-%d") for d in rf.index] == ["2019-09-27", "2019-09-30", "2019-10-01", "2019-10-02"]
    assert rf.tolist() == pytest.approx([-0.00452, -0.0046, -0.00549, -0.0055])  # percent -> fraction


def test_fetch_rf_eur_incremental_skips_eonia(monkeypatch):
    calls = []
    monkeypatch.setattr(sources, "_http_get", _fake_ecb(calls))
    sources.fetch_rf("EUR", date(2024, 1, 2))
    assert len(calls) == 1
    assert calls[0][0].endswith("/EST/B.EU000A2X2A25.WT") and calls[0][1]["startPeriod"] == "2024-01-02"


def test_fetch_rf_eur_with_empty_ecb_answer(monkeypatch):
    monkeypatch.setattr(sources, "_http_get", lambda url, params: "")
    rf = sources.fetch_rf("EUR", date(2030, 1, 1))
    assert rf.empty and rf.name == "EUR"


def test_fetch_rf_rejects_other_currencies():
    with pytest.raises(ValueError):
        sources.fetch_rf("CHF", None)


def test_fetch_currencies_normalises_pence(monkeypatch):
    table = {"A.L": "GBp", "B.DE": "EUR", "C": "USD"}
    monkeypatch.setattr(sources, "_yahoo_currency", lambda t: table.get(t))
    assert sources.fetch_currencies(["A.L", "B.DE", "C", "UNKNOWN"]) == {"A.L": "GBP", "B.DE": "EUR", "C": "USD"}
```

- [ ] **Step 2: Run to verify it fails**

Run: `(cd backend && uv run pytest tests/data/test_sources.py -q)`
Expected: FAIL, `NotImplementedError: Lane A` / `AttributeError: module 'app.data.sources' has no attribute '_download'`.

- [ ] **Step 3: Write `backend/app/data/sources.py`**

```python
"""All network access for ingestion (Lane A). Swappable for a paid provider later.

Three fetchers (prices, fx, rf) plus one helper (quote currencies). Every function that touches the network
is a thin private wrapper (`_download`, `_http_get`, `_yahoo_currency`) that tests replace with fakes.

Verified 2026-09-29 (curl against the live ECB Data Portal):
  * EONIA  https://data-api.ecb.europa.eu/service/data/EON/D.EONIA_TO.RATE   (daily, percent, 1999-01-04 ..)
  * euro short-term rate (EUR STR)  .../service/data/EST/B.EU000A2X2A25.WT   (daily, percent, 2019-10-01 ..)
  query string: ?format=csvdata&startPeriod=YYYY-MM-DD[&endPeriod=YYYY-MM-DD]; columns used: TIME_PERIOD, OBS_VALUE.
  An empty date range returns HTTP 404, which we treat as "no rows".
  (Also verified but not used: ECB deposit facility rate FM/D.U2.EUR.4F.KR.DFR.LEV.)
EONIA stopped being the policy benchmark on 2019-10-01; we splice EONIA up to 2019-09-30 and EUR STR from
2019-10-01 without adjustment (EONIA was defined as EUR STR + 8.5bp after that date, so the splice
is a step of about -8.5bp in a ~0% rate: negligible for this application).
"""

from __future__ import annotations

import io
import sys
from datetime import date, timedelta

import httpx
import pandas as pd

BATCH_SIZE = 50
ECB_BASE = "https://data-api.ecb.europa.eu/service/data"
EONIA = ("EON", "D.EONIA_TO.RATE")
ESTR = ("EST", "B.EU000A2X2A25.WT")
EONIA_LAST_DAY = date(2019, 9, 30)
ESTR_FIRST_DAY = date(2019, 10, 1)
PENCE = {"GBp": "GBP", "GBX": "GBP"}  # Yahoo quotes many London lines in pence; the currency is still GBP


# ---------------------------------------------------------------- network wrappers (patched in tests)


def _download(batch: list[str], start: date | None) -> pd.DataFrame:
    """Raw yfinance download for one batch. start=None -> maximum history."""
    import yfinance as yf

    kwargs = {"period": "max"} if start is None else {"start": start.isoformat()}
    return yf.download(batch, auto_adjust=True, progress=False, threads=True, group_by="column", **kwargs)


def _http_get(url: str, params: dict[str, str]) -> str:
    """GET text; an HTTP 404 (ECB: no observations in range) returns ''."""
    r = httpx.get(url, params=params, timeout=30, follow_redirects=True)
    if r.status_code == 404:
        return ""
    r.raise_for_status()
    return r.text


def _yahoo_currency(ticker: str) -> str | None:
    import yfinance as yf

    try:
        return yf.Ticker(ticker).fast_info.get("currency")
    except Exception:
        return None


# ---------------------------------------------------------------- helpers


def _naive_days(idx: pd.Index) -> pd.DatetimeIndex:
    idx = pd.DatetimeIndex(idx)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    return idx.normalize()


def _close_frame(raw: pd.DataFrame, batch: list[str]) -> pd.DataFrame:
    """Close prices (auto-adjusted) as DatetimeIndex x ticker, without empty columns."""
    if raw is None or raw.empty:
        return pd.DataFrame()
    if isinstance(raw.columns, pd.MultiIndex):
        close = raw["Close"]
    else:  # older yfinance / single ticker: flat columns
        close = raw[["Close"]].rename(columns={"Close": batch[0]})
    close = close.copy()
    close.index = _naive_days(close.index)
    close = close[~close.index.duplicated(keep="last")].sort_index()
    return close.dropna(axis=1, how="all").astype(float)


# ---------------------------------------------------------------- public API


def fetch_prices(tickers: list[str], start: date | None) -> pd.DataFrame:
    """Daily adjusted close per ticker (yfinance, auto_adjust=True). DatetimeIndex, columns = tickers
    that returned data (others are absent). start=None -> maximum history. Batches of 50 tickers; a failed
    batch is reported on stderr and skipped, so its tickers show up as no_data in the quality report."""
    unique = list(dict.fromkeys(tickers))
    frames = []
    for i in range(0, len(unique), BATCH_SIZE):
        batch = unique[i : i + BATCH_SIZE]
        try:
            frames.append(_close_frame(_download(batch, start), batch))
        except Exception as exc:  # network / provider failure: keep going with the other batches
            print(f"warning: price download failed for {len(batch)} tickers ({batch[0]}, ...): {exc}", file=sys.stderr)
    frames = [f for f in frames if not f.empty]
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, axis=1, sort=True)


def fetch_fx(currencies: list[str], start: date | None) -> pd.DataFrame:
    """Daily USD per 1 unit for each non-USD currency ('EURUSD=X' style tickers). Columns = currencies
    that returned data."""
    wanted = [c for c in dict.fromkeys(currencies) if c != "USD"]
    if not wanted:
        return pd.DataFrame()
    prices = fetch_prices([f"{c}USD=X" for c in wanted], start)
    return prices.rename(columns={f"{c}USD=X": c for c in wanted})


def _ecb_series(flow_key: tuple[str, str], start: date | None, end: date | None) -> pd.Series:
    flow, key = flow_key
    params = {"format": "csvdata"}
    if start is not None:
        params["startPeriod"] = start.isoformat()
    if end is not None:
        params["endPeriod"] = end.isoformat()
    text = _http_get(f"{ECB_BASE}/{flow}/{key}", params)
    if not text.strip():
        return pd.Series(dtype=float)
    df = pd.read_csv(io.StringIO(text), usecols=["TIME_PERIOD", "OBS_VALUE"])
    s = pd.Series(df["OBS_VALUE"].to_numpy(dtype=float), index=pd.DatetimeIndex(pd.to_datetime(df["TIME_PERIOD"])))
    return s.sort_index() / 100.0  # the ECB publishes percent


def fetch_rf(currency: str, start: date | None) -> pd.Series:
    """Daily annualised risk-free rate as a fraction (0.035 = 3.5%), name = currency.

    USD: ^IRX (13-week T-bill, quoted in percent) / 100.
    EUR: ECB EONIA up to 2019-09-30, then EUR STR (see module docstring for series keys)."""
    if currency == "USD":
        raw = fetch_prices(["^IRX"], start)
        s = raw["^IRX"].dropna() / 100.0 if "^IRX" in raw else pd.Series(dtype=float)
    elif currency == "EUR":
        parts = []
        if start is None or start <= EONIA_LAST_DAY:
            parts.append(_ecb_series(EONIA, start, EONIA_LAST_DAY))
        parts.append(_ecb_series(ESTR, ESTR_FIRST_DAY if start is None else max(start, ESTR_FIRST_DAY), None))
        s = pd.concat(parts)
        s = s[~s.index.duplicated(keep="last")].sort_index()
    else:
        raise ValueError(f"no risk-free source for currency {currency!r} (supported: EUR, USD)")
    s.name = currency
    return s


def fetch_currencies(tickers: list[str]) -> dict[str, str]:
    """Quote currency Yahoo reports per ticker (pence normalised to GBP). Tickers Yahoo cannot resolve are absent."""
    out = {}
    for t in tickers:
        c = _yahoo_currency(t)
        if c:
            out[t] = PENCE.get(c, c)
    return out
```

- [ ] **Step 4: Run the tests**

Run: `(cd backend && uv run pytest tests/data/test_sources.py -q)`
Expected: `12 passed`

- [ ] **Step 5: Live smoke test (network)**

Run:

```bash
(cd backend && uv run python - <<'EOF'
from datetime import date, timedelta
from app.data import sources
start = date.today() - timedelta(days=12)
print(sources.fetch_prices(["SPY", "IUSQ.DE"], start).tail(2))
print(sources.fetch_fx(["EUR", "GBP", "USD"], start).tail(2))
print(sources.fetch_rf("USD", start).tail(2))
e = sources.fetch_rf("EUR", None)
print(e.index.min().date(), len(e)); print(e["2019-09-30":"2019-10-01"])
print(sources.fetch_currencies(["SSAC.L", "IUSQ.DE", "SPY"]))
EOF
)
```

Expected: two price rows with columns `IUSQ.DE`, `SPY`; fx columns `EUR`, `GBP` around 1.1 and 1.3; USD rf around 0.04; EUR rf starts `1999-01-04` with about 7100 rows, and `2019-09-30` about `-0.0045`, `2019-10-01` about `-0.0055` (the EONIA to EUR STR splice); currencies `{'SSAC.L': 'GBP', 'IUSQ.DE': 'EUR', 'SPY': 'USD'}`. yfinance may print harmless warnings. If the ECB calls fail, run `curl -s "https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?format=csvdata&startPeriod=2024-01-02&endPeriod=2024-01-03"`: the second line should contain `2024-01-02,3.906`; if the series key has changed, escalate.

- [ ] **Step 6: Commit**

```bash
git add backend/app/data/sources.py backend/tests/data/test_sources.py
git commit -m "feat(data): yfinance and ECB sources behind fakeable wrappers"
```

---

### Task 4: Catalogue schema and validation (`ingest.py`, part 1)

**Files:**
- Modify: `backend/app/data/ingest.py` (replace the stub; this task writes the first half, Task 5 appends the second half)
- Test: `backend/tests/data/test_ingest_csv.py`

**Interfaces:**
- Consumes: `app.engine.types.{FUND_COLUMNS, LISTING_COLUMNS}`, `app.config`; imports `app.data.{db, quality, sources}` (used from Task 5 on).
- Produces (`app.data.ingest`):
  - Constants `CSV_COLUMNS` (= `LISTING_COLUMNS + FUND_COLUMNS`, the exact column order of `etfs.csv`), `REQUIRED`, `ASSET_CLASSES`, `SUB_CLASSES` (dict per asset class), `REGIONS`, `SECTORS`, `EXCHANGES`, `WRAPPERS`, `DISTRIBUTIONS`, `HEDGE_CURRENCIES`
  - `CsvError(ValueError)`, `is_valid_isin(isin) -> bool` (format + ISO 6166 check digit), `read_csv(path) -> DataFrame` (all strings, blanks `''`), `validate(df) -> list[str]` (one readable line per problem; `[]` = valid), `split_catalogue(df) -> (funds, listings)` (typed like `DataSource.funds()`/`.listings()`), `load_catalogue(path) -> (funds, listings)` (raises `CsvError` with all problems)
  - These vocabularies are the ones the engine lanes and the frontend filters can rely on (`region`, `sector`, `sub_class` values), and `index_name` for bonds must be identical between hedged and unhedged share classes (Task 7 explains why).

- [ ] **Step 1: Write the failing tests**

`backend/tests/data/test_ingest_csv.py`:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `(cd backend && uv run pytest tests/data/test_ingest_csv.py -q)`
Expected: FAIL at collection or call with `AttributeError: module 'app.data.ingest' has no attribute 'CSV_COLUMNS'`.

- [ ] **Step 3: Write the first half of `backend/app/data/ingest.py`**

Replace the whole file with:

```python
"""`uv run python -m app.data.ingest [--full]` (Lane A). Run from backend/.

    --full              re-download the maximum history for every ticker (default: incremental)
    --csv PATH          catalogue file (default: backend/data/etfs.csv)
    --db PATH           database file (default: config.DB_PATH)
    --check-currencies  only compare each listing's currency in the CSV with the currency Yahoo quotes it in

Exit code: 0 after a successful run (data problems are printed in the quality report, never fatal),
1 if --check-currencies finds a mismatch, 2 if etfs.csv is invalid, 3 if no price data exists at all
(for example when offline), in which case last_ingest is not updated.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from app import config
from app.data import db, quality, sources
from app.engine.types import FUND_COLUMNS, LISTING_COLUMNS

OVERLAP_DAYS = 7  # incremental price fetches start this many days before the last stored date
RESTATE_TOL = 1e-5  # relative change of the overlap price that counts as a restated adjustment

CSV_COLUMNS = [*LISTING_COLUMNS, *FUND_COLUMNS]
REQUIRED = [
    "ticker", "isin", "exchange", "currency", "is_primary", "name", "issuer", "asset_class", "sub_class",
    "region", "esg", "domicile", "ucits", "wrapper", "distribution",
]
ASSET_CLASSES = ["equity", "bond", "commodity", "real_estate", "cash", "crypto"]
SUB_CLASSES = {
    "equity": ["broad", "large_cap", "mid_cap", "small_cap", "sector", "value", "growth", "momentum", "quality",
               "min_vol", "dividend", "multi_factor"],
    "bond": ["broad", "gov_short", "gov_intermediate", "gov_long", "gov_all", "corp_ig", "corp_short", "high_yield",
             "inflation_linked", "em_debt", "covered"],
    "commodity": ["gold", "silver", "precious_metals", "broad_commodities", "energy", "agriculture"],
    "real_estate": ["reit"],
    "cash": ["money_market"],
    "crypto": ["bitcoin", "ethereum", "basket"],
}
REGIONS = ["global", "us", "europe", "eurozone", "uk", "germany", "switzerland", "japan", "pacific_ex_japan",
           "world_ex_us", "em", "china", "india", "canada", "australia"]
SECTORS = ["technology", "healthcare", "financials", "energy", "consumer_discretionary", "consumer_staples",
           "industrials", "materials", "utilities", "communication_services"]
EXCHANGES = ["NYSE", "NASDAQ", "XETRA", "LSE", "EURONEXT", "SIX", "TSX", "ASX", "TSE"]
WRAPPERS = ["etf", "etp", "etc"]
DISTRIBUTIONS = ["acc", "dist"]
HEDGE_CURRENCIES = ["EUR", "USD", "GBP", "CHF"]


class CsvError(ValueError):
    """etfs.csv failed validation; the message lists every problem."""


# ---------------------------------------------------------------- catalogue (etfs.csv)


def is_valid_isin(isin: str) -> bool:
    """12 characters, country prefix, and a correct ISO 6166 (Luhn) check digit."""
    if not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", isin):
        return False
    digits = "".join(str(int(ch, 36)) for ch in isin)
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d = d * 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def read_csv(path: Path | str) -> pd.DataFrame:
    """Raw catalogue: every cell a stripped string, blanks are ''."""
    df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8")
    return df.apply(lambda col: col.str.strip())


def _number(text: str, lo: float, hi: float, what: str) -> str | None:
    try:
        v = float(text)
    except ValueError:
        return f"{what} {text!r} is not a number"
    if not lo <= v <= hi:
        return f"{what} {v} outside [{lo}, {hi}]"
    return None


def _row_errors(r: dict[str, str]) -> list[str]:
    e: list[str] = []
    for c in REQUIRED:
        if r[c] == "":
            e.append(f"{c} is required")
    if r["isin"] and not is_valid_isin(r["isin"]):
        e.append(f"isin {r['isin']!r} is not a valid ISIN (12 chars, valid check digit)")
    if r["currency"] and not re.fullmatch(r"[A-Z]{3}", r["currency"]):
        e.append(f"currency {r['currency']!r} is not a 3-letter code")
    if r["domicile"] and not re.fullmatch(r"[A-Z]{2}", r["domicile"]):
        e.append(f"domicile {r['domicile']!r} is not a 2-letter country code")
    for c in ("is_primary", "esg", "ucits"):
        if r[c] not in ("", "0", "1"):
            e.append(f"{c} must be 0 or 1, got {r[c]!r}")
    for col, allowed in (("exchange", EXCHANGES), ("asset_class", ASSET_CLASSES), ("region", REGIONS),
                         ("wrapper", WRAPPERS), ("distribution", DISTRIBUTIONS)):
        if r[col] and r[col] not in allowed:
            e.append(f"{col} {r[col]!r} not in {allowed}")
    ac = r["asset_class"]
    if ac in SUB_CLASSES and r["sub_class"] and r["sub_class"] not in SUB_CLASSES[ac]:
        e.append(f"sub_class {r['sub_class']!r} not allowed for {ac}: {SUB_CLASSES[ac]}")
    is_sector = ac == "equity" and r["sub_class"] == "sector"
    if is_sector and r["sector"] not in SECTORS:
        e.append(f"sector funds need sector in {SECTORS}, got {r['sector']!r}")
    if not is_sector and r["sector"]:
        e.append("sector must be blank unless sub_class is 'sector'")
    if r["ter"]:
        msg = _number(r["ter"], 0.0, 0.05, "ter (fraction, 0.002 = 0.20%)")
        if msg:
            e.append(msg)
    if r["duration"]:
        msg = _number(r["duration"], 0.0, 40.0, "duration")
        if msg:
            e.append(msg)
        if ac not in ("bond", "cash"):
            e.append("duration is only for bond/cash funds")
    if r["hedged_to"]:
        if ac != "bond":
            e.append("hedged_to is only allowed for bond funds")
        if r["hedged_to"] not in HEDGE_CURRENCIES:
            e.append(f"hedged_to {r['hedged_to']!r} not in {HEDGE_CURRENCIES}")
    if ac == "bond" and not r["index_name"]:
        e.append("bond funds need index_name (hedged and unhedged share classes must share it exactly)")
    if r["inception_date"]:
        try:
            date.fromisoformat(r["inception_date"])
        except ValueError:
            e.append(f"inception_date {r['inception_date']!r} is not YYYY-MM-DD")
    if bool(r["proxy_ticker"]) != bool(r["proxy_currency"]):
        e.append("proxy_ticker and proxy_currency must be set together")
    if r["proxy_currency"] and not re.fullmatch(r"[A-Z]{3}", r["proxy_currency"]):
        e.append(f"proxy_currency {r['proxy_currency']!r} is not a 3-letter code")
    return e


def validate(df: pd.DataFrame) -> list[str]:
    """Every problem in a raw catalogue (see read_csv), one readable line each; [] means valid."""
    missing = [c for c in CSV_COLUMNS if c not in df.columns]
    extra = [c for c in df.columns if c not in CSV_COLUMNS]
    if missing or extra:
        return [f"columns must be exactly {CSV_COLUMNS}; missing {missing}, unexpected {extra}"]
    errors: list[str] = []
    records = df.to_dict("records")
    for n, r in enumerate(records, start=2):  # line 1 is the header
        errors += [f"line {n} ({r['ticker'] or '?'}): {m}" for m in _row_errors(r)]
    for ticker, count in df["ticker"][df["ticker"] != ""].value_counts().items():
        if count > 1:
            errors.append(f"ticker {ticker!r} appears {count} times (one row per listing)")
    for isin, g in df[df["isin"] != ""].groupby("isin", sort=True):
        for c in FUND_COLUMNS:
            if g[c].nunique() > 1:
                errors.append(f"isin {isin}: column {c} differs between its listings: {sorted(g[c].unique())}")
        primaries = int((g["is_primary"] == "1").sum())
        if primaries != 1:
            errors.append(f"isin {isin}: exactly one listing must have is_primary=1, found {primaries}")
    return errors


def _typed(column: str, text: str):
    if column in ("esg", "ucits"):
        return text == "1"
    if column in ("ter", "duration"):
        return float(text) if text else np.nan
    if column == "inception_date":
        return pd.Timestamp(text) if text else pd.NaT
    return text if text else None


def split_catalogue(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Validated raw catalogue -> (funds indexed by isin with FUND_COLUMNS, listings with LISTING_COLUMNS),
    typed exactly like DataSource.funds() / .listings()."""
    first: dict[str, dict[str, str]] = {}
    for r in df.to_dict("records"):
        first.setdefault(r["isin"], r)
    funds = pd.DataFrame(
        [{c: _typed(c, r[c]) for c in FUND_COLUMNS} for r in first.values()],
        index=pd.Index(list(first), name="isin"),
        columns=FUND_COLUMNS,
    )
    listings = df[LISTING_COLUMNS].copy().reset_index(drop=True)
    listings["is_primary"] = listings["is_primary"] == "1"
    return funds, listings


def load_catalogue(path: Path | str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """read_csv + validate + split. Raises CsvError listing all problems."""
    raw = read_csv(path)
    errors = validate(raw)
    if errors:
        raise CsvError("\n".join(errors))
    return split_catalogue(raw)
```

- [ ] **Step 4: Run the tests**

Run: `(cd backend && uv run pytest tests/data/test_ingest_csv.py -q)`
Expected: `30 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/data/ingest.py backend/tests/data/test_ingest_csv.py
git commit -m "feat(data): etfs.csv schema, validation and typed loading"
```

---

### Task 5: Ingest orchestration (`ingest.py`, part 2)

**Files:**
- Modify: `backend/app/data/ingest.py` (append; do not touch part 1)
- Test: `backend/tests/data/test_ingest_run.py`

**Interfaces:**
- Consumes: Task 1 (`db.*`), Task 2 (`quality.report`, `quality.KIND_ORDER`), Task 3 (`sources.fetch_prices/fetch_fx/fetch_rf/fetch_currencies`, called as `sources.<name>(...)` so tests can monkeypatch the module attributes), Task 4 (`load_catalogue`, `CsvError`).
- Produces: `main(argv: list[str] | None = None) -> int` (Phase 0 signature). Flags: `--full`, `--csv PATH` (default `config.ETFS_CSV`), `--db PATH` (default `config.DB_PATH`), `--check-currencies`. Exit codes: 0 success (data problems are only printed), 1 currency check found a problem, 2 invalid `etfs.csv`, 3 no price data at all. Also public helpers `merge_prices(conn, fresh, last) -> (rows_written, rescaled_tickers)`, `update_prices`, `update_fx`, `update_rf`, `print_report`, `check_currencies(listings) -> int`, constants `OVERLAP_DAYS = 7`, `RESTATE_TOL = 1e-5`.
- Behaviour: new tickers (no stored price) or `--full` get maximum history; the others are fetched from `last stored date - 7 days`, grouped by start date. Before storing, if the overlap price differs from the stored price by more than 1e-5 relative, all older stored prices of that ticker are multiplied by the ratio (Yahoo restated its adjustment). Proxy tickers from `fund.proxy_ticker` are fetched like listings. FX currencies = every listing currency and proxy currency plus EUR, minus USD. Risk-free for EUR and USD. `meta.last_ingest` = today, written after the price step succeeded. Funds and listings missing from the CSV are deleted from the DB (prices are kept).

- [ ] **Step 1: Write the failing tests**

`backend/tests/data/test_ingest_run.py`:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `(cd backend && uv run pytest tests/data/test_ingest_run.py -q)`
Expected: FAIL: `AttributeError: module 'app.data.ingest' has no attribute 'main'` (part 1 has no `main` yet) or `merge_prices`.

- [ ] **Step 3: Append the second half to `backend/app/data/ingest.py`**

Append (after two blank lines, at the end of the file written in Task 4):

```python
# ---------------------------------------------------------------- prices (incremental with restatement fix)


def merge_prices(conn, fresh: pd.DataFrame, last: dict[str, str]) -> tuple[int, list[str]]:
    """Store freshly fetched prices on top of stored history.

    auto_adjust=True makes Yahoo restate the whole past series whenever a dividend or split happens. If the
    price on a ticker's last stored date differs from the stored value by more than RESTATE_TOL, all older
    stored prices of that ticker are multiplied by the ratio first, so the stored series stays on one basis.
    Returns (rows written, tickers rescaled)."""
    rescaled: list[str] = []
    for ticker in fresh.columns:
        anchor = last.get(ticker)
        col = fresh[ticker].dropna()
        if anchor is None or pd.Timestamp(anchor) not in col.index:
            continue
        row = conn.execute("SELECT adj_close FROM price WHERE ticker = ? AND date = ?", (ticker, anchor)).fetchone()
        if not row or not row[0]:
            continue
        factor = float(col[pd.Timestamp(anchor)]) / row[0]
        if abs(factor - 1.0) > RESTATE_TOL:
            db.rescale_prices(conn, ticker, factor)
            rescaled.append(ticker)
    return db.upsert_prices(conn, fresh), rescaled


def update_prices(conn, tickers: list[str], full: bool) -> tuple[int, list[str]]:
    """Fetch and store prices. New tickers (or everything with full=True) get maximum history; the rest are
    fetched from OVERLAP_DAYS before their last stored date, grouped by that start date."""
    last = db.last_price_dates(conn)
    written, rescaled = 0, []
    fresh_tickers = [t for t in tickers if full or t not in last]
    if fresh_tickers:
        print(f"prices: {len(fresh_tickers)} tickers, full history")
        written += db.upsert_prices(conn, sources.fetch_prices(fresh_tickers, None))
    groups: dict[date, list[str]] = defaultdict(list)
    for t in tickers:
        if not full and t in last:
            groups[date.fromisoformat(last[t]) - timedelta(days=OVERLAP_DAYS)].append(t)
    if groups:
        print(f"prices: {sum(map(len, groups.values()))} tickers, incremental ({len(groups)} start dates)")
    for start, group in sorted(groups.items()):
        w, r = merge_prices(conn, sources.fetch_prices(group, start), last)
        written += w
        rescaled += r
    return written, rescaled


def update_fx(conn, currencies: list[str], full: bool) -> int:
    last = [db.last_series_date(conn, "fx", c) for c in currencies]
    start = None if full or not currencies or any(x is None for x in last) else date.fromisoformat(min(last))
    return db.upsert_fx(conn, sources.fetch_fx(currencies, start))


def update_rf(conn, currency: str, full: bool) -> int:
    last = db.last_series_date(conn, "rf_rate", currency)
    start = None if full or last is None else date.fromisoformat(last)
    return db.upsert_rf(conn, currency, sources.fetch_rf(currency, start))


# ---------------------------------------------------------------- reporting and commands


def print_report(issues: list[quality.Issue]) -> None:
    if not issues:
        print("Data quality report: no issues")
        return
    print(f"Data quality report: {len(issues)} issue(s)")
    by_kind: dict[str, list[quality.Issue]] = defaultdict(list)
    for i in issues:
        by_kind[i.kind].append(i)
    for kind in quality.KIND_ORDER:
        for i in by_kind.get(kind, []):
            print(f"  {kind:<14} {i.ticker_or_isin:<14} {i.detail}")


def check_currencies(listings: pd.DataFrame) -> int:
    """Compare the CSV currency of each listing with Yahoo's quote currency. Returns 1 on any mismatch."""
    quoted = sources.fetch_currencies(list(listings["ticker"]))
    bad = 0
    for row in listings.itertuples():
        yahoo = quoted.get(row.ticker)
        if yahoo is None:
            print(f"  unknown   {row.ticker}: Yahoo does not know this ticker")
            bad += 1
        elif yahoo != row.currency:
            print(f"  mismatch  {row.ticker}: csv says {row.currency}, Yahoo quotes {yahoo}")
            bad += 1
    print(f"currency check: {bad} problem(s) in {len(listings)} listings")
    return 1 if bad else 0


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m app.data.ingest", description=__doc__.split("\n")[0])
    p.add_argument("--full", action="store_true", help="re-download maximum history for every ticker")
    p.add_argument("--csv", default=str(config.ETFS_CSV))
    p.add_argument("--db", default=str(config.DB_PATH))
    p.add_argument("--check-currencies", action="store_true")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        funds, listings = load_catalogue(args.csv)
    except CsvError as exc:
        print(f"error: {args.csv} is invalid:\n{exc}", file=sys.stderr)
        return 2
    if args.check_currencies:
        return check_currencies(listings)

    conn = db.connect(args.db)
    db.init_db(conn)
    db.upsert_funds(conn, funds)
    db.upsert_listings(conn, listings)
    gone_l, gone_f = db.delete_missing(conn, funds.index, listings["ticker"])
    print(f"catalogue: {len(funds)} funds, {len(listings)} listings ({gone_f} funds, {gone_l} listings removed)")

    proxies = [p for p in funds["proxy_ticker"].dropna().unique() if p]
    tickers = list(dict.fromkeys([*listings["ticker"], *proxies]))
    written, rescaled = update_prices(conn, tickers, args.full)
    print(f"prices: {written} rows written, {len(rescaled)} tickers rescaled after provider restatement")
    if rescaled:
        print("  rescaled: " + ", ".join(rescaled))
    if not db.last_price_dates(conn):
        print("error: no price data was obtained (offline, or Yahoo blocked the request?)", file=sys.stderr)
        conn.close()
        return 3

    currencies = sorted(
        ({*listings["currency"], *funds["proxy_currency"].dropna(), "EUR"} - {"USD"}),
    )
    print(f"fx: {update_fx(conn, currencies, args.full)} rows for {currencies}")
    for ccy in ("EUR", "USD"):
        print(f"rf {ccy}: {update_rf(conn, ccy, args.full)} rows")

    db.set_meta(conn, "last_ingest", date.today().isoformat())
    print_report(quality.report(conn))
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the data tests**

Run: `(cd backend && uv run pytest tests/data -q)`
Expected: all pass (`16 + 10 + 12 + 30 + 10 = 78 passed`).

- [ ] **Step 5: Commit**

```bash
git add backend/app/data/ingest.py backend/tests/data/test_ingest_run.py
git commit -m "feat(data): ingest CLI with incremental prices, restatement fix, fx, rf and quality report"
```

---

### Task 6: Verify and correct the anchor ISINs

**Files:**
- Modify: `backend/app/config.py` (**only the value** of `ANCHORS["USD"]["global_bonds"]`; keys and structure are frozen)
- Test: `backend/tests/data/test_anchors.py`

**Interfaces:**
- Consumes: `app.config.ANCHORS`, `app.data.ingest.is_valid_isin` (Task 4).
- Produces: `config.ANCHORS` with four verified ISINs (EUR equity `IE00B6R52259`, EUR bonds `IE00BDBRDM35`, USD equity `US4642882579`, USD bonds `US92206C5655`). Every later task and lane B/C/E rely on these being real funds that exist in `etfs.csv`.

- [ ] **Step 1: Write the failing test**

`backend/tests/data/test_anchors.py`:

```python
from app import config
from app.data import ingest

# Verified 2026-09-29 against issuer/Yahoo/justETF data (see plan Task 6). Changing an anchor means re-verifying it.
VERIFIED = {
    "EUR": {"global_equity": "IE00B6R52259",  # iShares MSCI ACWI UCITS ETF USD (Acc), IUSQ
            "global_bonds": "IE00BDBRDM35"},  # iShares Core Global Aggregate Bond UCITS ETF EUR Hedged (Acc), AGGH
    "USD": {"global_equity": "US4642882579",  # iShares MSCI ACWI ETF, ACWI
            "global_bonds": "US92206C5655"},  # Vanguard Total World Bond ETF (USD hedged), BNDW
}


def test_anchors_are_the_verified_isins():
    assert config.ANCHORS == VERIFIED


def test_anchor_isins_have_valid_check_digits():
    for anchors in config.ANCHORS.values():
        for isin in anchors.values():
            assert ingest.is_valid_isin(isin), isin
```

- [ ] **Step 2: Run to verify it fails**

Run: `(cd backend && uv run pytest tests/data/test_anchors.py -q)`
Expected: FAIL in `test_anchors_are_the_verified_isins` (`US92203J4076` != `US92206C5655`) if Phase 0 still has the wrong value; if Phase 0 already shipped the correct value, both tests pass and the correction step below is a no-op.

- [ ] **Step 3: Re-verify the four ISINs yourself (network)**

Run:

```bash
(cd backend && uv run python - <<'EOF'
import yfinance as yf
for q in ["IE00B6R52259", "IE00BDBRDM35", "US4642882579", "US92206C5655", "US92203J4076"]:
    print(q, [(x["symbol"], x.get("shortname")) for x in yf.Search(q, max_results=5).quotes])
for t in ["ACWI", "BNDW", "BNDX"]:
    print(t, yf.Ticker(t).isin)
EOF
)
```

Expected (2026-09-29):

```
IE00B6R52259 [('ISAC.L', 'ISHARES V PUBLIC LIMITED COMPAN')]
IE00BDBRDM35 [('0GGH.L', 'ISHARES III PLC ISH GLOBAL AGG ')]
US4642882579 [('ACWI', 'iShares MSCI ACWI ETF')]
US92206C5655 [('BNDW', 'Vanguard Total World Bond ETF')]
US92203J4076 [('BNDX', 'Vanguard Total International Bo')]
ACWI US4642882579
BNDW US92206C5655
BNDX US92203J4076
```

Then confirm the two UCITS anchors on justETF with WebFetch: `https://www.justetf.com/en/etf-profile.html?isin=IE00B6R52259` must say iShares MSCI ACWI UCITS ETF (Acc), and `https://www.justetf.com/en/etf-profile.html?isin=IE00BDBRDM35` must say iShares Core Global Aggregate Bond UCITS ETF EUR Hedged (Acc), TER 0.10%, launched 21 Nov 2017. If any of the four differs from `VERIFIED` in the test, stop and escalate (anchors are contract values).

- [ ] **Step 4: Correct the value in `config.py` if wrong**

In `backend/app/config.py`, change only:

```python
    "USD": {"global_equity": "US4642882579", "global_bonds": "US92206C5655"},
```

(the old value was `"US92203J4076"`, BNDX). Then list every other place that still uses the old ISIN so the integrator can fix it, and do not edit those files:

Run: `git grep -n "US92203J4076" -- backend docs`
Expected: hits only in Phase 0 files outside Lane A (`backend/tests/fixtures/synthetic.py`, and mentions in the Phase 0 plan). Put them in your hand-back note (integrator note 2).

- [ ] **Step 5: Run the test**

Run: `(cd backend && uv run pytest tests/data/test_anchors.py -q)`
Expected: `2 passed`. (`tests/test_synthetic.py::test_shapes` from Phase 0 now fails until the integrator replaces the ISIN in the fixture. That is expected and is not Lane A's to fix; run only `tests/data` in this lane.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/config.py backend/tests/data/test_anchors.py
git commit -m "fix(config): USD global bond anchor is BNDW US92206C5655 (old value was BNDX)"
```

---

### Task 7: Catalogue column spec, conventions and the seed `etfs.csv`

**Files:**
- Create: `backend/data/etfs.csv` (60 listings, 56 funds)
- Test: `backend/tests/data/test_etfs_csv.py`

**Interfaces:**
- Consumes: `ingest.read_csv`, `ingest.validate`, `ingest.ASSET_CLASSES` (Task 4), `config.ANCHORS` and `config.ETFS_CSV`, corrected anchors (Task 6).
- Produces: `backend/data/etfs.csv` in the exact column order below, which `ingest.main` loads; a structural test that Task 8 extends.

**Column spec** (one row per listing, fund columns repeated and identical on every row of the same ISIN; blank = unknown/not applicable; column order is exactly this, and is `ingest.CSV_COLUMNS`):

| Column | Rule |
|---|---|
| `ticker` | Yahoo Finance symbol, unique in the file (`SPY`, `IUSQ.DE`, `AGGH.AS`, `VFV.TO`, `VAS.AX`) |
| `isin` | 12 characters, valid check digit (validated) |
| `exchange` | `NYSE NASDAQ XETRA LSE EURONEXT SIX TSX ASX TSE` (suffix `.DE`=XETRA, `.L`=LSE, `.AS` `.PA`=EURONEXT, `.SW`=SIX, `.TO`=TSX, `.AX`=ASX, `.T`=TSE; US NYSE Arca counts as NYSE) |
| `currency` | 3-letter code **as quoted by Yahoo** (pence = `GBP`); verify with `--check-currencies` |
| `is_primary` | `1` for exactly one listing per ISIN: US funds the US line; UCITS the Xetra line if any, else Euronext, else LSE, else SIX |
| `name` `issuer` | free text without commas (or quote the field) |
| `asset_class` | `equity bond commodity real_estate cash crypto` |
| `sub_class` | equity: `broad large_cap mid_cap small_cap sector value growth momentum quality min_vol dividend multi_factor`; bond: `broad gov_short gov_intermediate gov_long gov_all corp_ig corp_short high_yield inflation_linked em_debt covered`; commodity: `gold silver precious_metals broad_commodities energy agriculture`; real_estate: `reit`; cash: `money_market`; crypto: `bitcoin ethereum basket` |
| `region` | `global us europe eurozone uk germany switzerland japan pacific_ex_japan world_ex_us em china india canada australia` |
| `sector` | only when `sub_class=sector`: `technology healthcare financials energy consumer_discretionary consumer_staples industrials materials utilities communication_services` |
| `esg` | `1` for ESG/SRI/Paris-aligned/screened funds, else `0` |
| `ter` | annual fraction, `0.0020` = 0.20% (0 to 0.05); blank only if truly unknown (reported as `missing_ter`) |
| `domicile` | 2-letter country of the fund (`IE LU US DE CH CA AU JP FR GB`) |
| `ucits` | `1`/`0`; ETPs/ETCs are `0` |
| `wrapper` | `etf` `etp` `etc` (crypto ETNs/ETPs `etp`, physical gold ETCs `etc`) |
| `distribution` | `acc` or `dist` |
| `hedged_to` | bond funds only: `EUR USD GBP CHF` when the share class hedges to it, else blank |
| `duration` | years, bond and cash funds only |
| `index_name` | required for bonds, otherwise recommended. **Convention: hedged and unhedged share classes of the same index carry the identical string** (`Bloomberg Global Aggregate`, without any "EUR Hedged" suffix). `universe.select` drops unhedged bond siblings by matching this string when a share class hedged to the base currency exists |
| `inception_date` | `YYYY-MM-DD` or blank |
| `proxy_ticker` `proxy_currency` | set together or both blank. Older series used before the fund's own first price. The proxy must be a `ticker` in the file or an external price series (`BTC-USD`, `ETH-USD`). `proxy_currency` is the currency of that series |

**Proxy rules** (set a proxy when the fund's own history starts after 2005 and a row matches; otherwise blank):

| Exposure | proxy_ticker (USD) |
|---|---|
| global equity (ACWI, World, All-World, ESG variants) and US equity | `SPY` (ACWI itself only starts 2008-03 and would leave the 2007-08 GFC uncovered; the US market is the best long series, and `proxied` masks are shown to the user) |
| developed ex-US, Europe, Japan | `EFA` |
| emerging markets | `EEM` |
| US small cap | `IWM` |
| US Treasuries long / intermediate / short | `TLT` / `IEF` / `SHY` |
| US aggregate and global aggregate bonds, hedged or not (a hedged fund's proxy return is used unconverted by `returns.weekly_returns`) | `AGG` |
| USD investment grade / high yield / TIPS | `LQD` / `HYG` / `TIP` |
| gold | `GLD` |
| REITs (US and global) | `VNQ` |
| bitcoin / ethereum | `BTC-USD` / `ETH-USD` |
| EUR government, EUR corporate, EUR money market | none (blank) |

- [ ] **Step 1: Write the failing test**

`backend/tests/data/test_etfs_csv.py`:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `(cd backend && uv run pytest tests/data/test_etfs_csv.py -q)`
Expected: FAIL/ERROR: `FileNotFoundError: ... backend/data/etfs.csv`.

- [ ] **Step 3: Write `backend/data/etfs.csv`**

Create the file with exactly this content (header plus 60 rows: US ETFs incl. all long-history anchors, the four config anchors, UCITS on Xetra/LSE/Euronext/SIX, hedged and unhedged global aggregate share classes with the same `index_name`, factor, sector, ESG, bond range, gold, money market, REIT, crypto ETPs, Canada and Australia). TER and inception values are drafts from issuer data and are re-verified in Task 8.

```csv
ticker,isin,exchange,currency,is_primary,name,issuer,asset_class,sub_class,region,sector,esg,ter,domicile,ucits,wrapper,distribution,hedged_to,duration,index_name,inception_date,proxy_ticker,proxy_currency
SPY,US78462F1030,NYSE,USD,1,SPDR S&P 500 ETF Trust,State Street,equity,large_cap,us,,0,0.000945,US,0,etf,dist,,,S&P 500,1993-01-22,,
IVV,US4642872000,NYSE,USD,1,iShares Core S&P 500 ETF,iShares,equity,large_cap,us,,0,0.0003,US,0,etf,dist,,,S&P 500,2000-05-15,,
VTI,US9229087690,NYSE,USD,1,Vanguard Total Stock Market ETF,Vanguard,equity,broad,us,,0,0.0003,US,0,etf,dist,,,CRSP US Total Market,2001-05-24,,
QQQ,US46090E1038,NASDAQ,USD,1,Invesco QQQ Trust,Invesco,equity,growth,us,,0,0.002,US,0,etf,dist,,,Nasdaq-100,1999-03-10,,
IWM,US4642876555,NYSE,USD,1,iShares Russell 2000 ETF,iShares,equity,small_cap,us,,0,0.0019,US,0,etf,dist,,,Russell 2000,2000-05-22,,
EFA,US4642874659,NYSE,USD,1,iShares MSCI EAFE ETF,iShares,equity,broad,world_ex_us,,0,0.0035,US,0,etf,dist,,,MSCI EAFE,2001-08-14,,
EWJ,US4642868487,NYSE,USD,1,iShares MSCI Japan ETF,iShares,equity,broad,japan,,0,0.005,US,0,etf,dist,,,MSCI Japan,1996-03-12,,
EEM,US4642872349,NYSE,USD,1,iShares MSCI Emerging Markets ETF,iShares,equity,broad,em,,0,0.007,US,0,etf,dist,,,MSCI Emerging Markets,2003-04-07,,
IEMG,US46434G1031,NYSE,USD,1,iShares Core MSCI Emerging Markets ETF,iShares,equity,broad,em,,0,0.0009,US,0,etf,dist,,,MSCI Emerging Markets IMI,2012-10-18,EEM,USD
ACWI,US4642882579,NASDAQ,USD,1,iShares MSCI ACWI ETF,iShares,equity,broad,global,,0,0.0032,US,0,etf,dist,,,MSCI ACWI,2008-03-26,SPY,USD
XLK,US81369Y8030,NYSE,USD,1,Technology Select Sector SPDR Fund,State Street,equity,sector,us,technology,0,0.0008,US,0,etf,dist,,,Technology Select Sector,1998-12-16,,
XLV,US81369Y2090,NYSE,USD,1,Health Care Select Sector SPDR Fund,State Street,equity,sector,us,healthcare,0,0.0008,US,0,etf,dist,,,Health Care Select Sector,1998-12-16,,
ESGU,US46435G4257,NASDAQ,USD,1,iShares ESG Aware MSCI USA ETF,iShares,equity,broad,us,,1,0.0015,US,0,etf,dist,,,MSCI USA Extended ESG Focus,2016-12-01,SPY,USD
AGG,US4642872265,NYSE,USD,1,iShares Core US Aggregate Bond ETF,iShares,bond,broad,us,,0,0.0003,US,0,etf,dist,,6.0,Bloomberg US Aggregate,2003-09-22,,
BND,US9219378356,NASDAQ,USD,1,Vanguard Total Bond Market ETF,Vanguard,bond,broad,us,,0,0.0003,US,0,etf,dist,,6.0,Bloomberg US Aggregate Float Adjusted,2007-04-03,,
TLT,US4642874329,NASDAQ,USD,1,iShares 20+ Year Treasury Bond ETF,iShares,bond,gov_long,us,,0,0.0015,US,0,etf,dist,,17.0,ICE US Treasury 20+ Year,2002-07-22,,
IEF,US4642874402,NASDAQ,USD,1,iShares 7-10 Year Treasury Bond ETF,iShares,bond,gov_intermediate,us,,0,0.0015,US,0,etf,dist,,7.5,ICE US Treasury 7-10 Year,2002-07-22,,
SHY,US4642874576,NASDAQ,USD,1,iShares 1-3 Year Treasury Bond ETF,iShares,bond,gov_short,us,,0,0.0015,US,0,etf,dist,,1.9,ICE US Treasury 1-3 Year,2002-07-22,,
LQD,US4642872422,NYSE,USD,1,iShares iBoxx $ Investment Grade Corporate Bond ETF,iShares,bond,corp_ig,us,,0,0.0014,US,0,etf,dist,,8.5,Markit iBoxx USD Liquid Investment Grade,2002-07-22,,
HYG,US4642885135,NYSE,USD,1,iShares iBoxx $ High Yield Corporate Bond ETF,iShares,bond,high_yield,us,,0,0.0049,US,0,etf,dist,,3.2,Markit iBoxx USD Liquid High Yield,2007-04-04,,
TIP,US4642871762,NYSE,USD,1,iShares TIPS Bond ETF,iShares,bond,inflation_linked,us,,0,0.0018,US,0,etf,dist,,6.5,ICE US Treasury Inflation Linked Bond,2003-12-04,,
BNDW,US92206C5655,NASDAQ,USD,1,Vanguard Total World Bond ETF,Vanguard,bond,broad,global,,0,0.0005,US,0,etf,dist,USD,6.9,Bloomberg Global Aggregate,2018-09-04,AGG,USD
BNDX,US92203J4076,NASDAQ,USD,1,Vanguard Total International Bond ETF,Vanguard,bond,broad,world_ex_us,,0,0.0007,US,0,etf,dist,USD,7.0,Bloomberg Global Aggregate ex-USD,2013-05-31,,
BIL,US78468R6633,NYSE,USD,1,SPDR Bloomberg 1-3 Month T-Bill ETF,State Street,cash,money_market,us,,0,0.0014,US,0,etf,dist,,0.1,Bloomberg 1-3 Month US Treasury Bill,2007-05-25,,
GLD,US78463V1070,NYSE,USD,1,SPDR Gold Shares,State Street,commodity,gold,global,,0,0.004,US,0,etf,acc,,,LBMA Gold Price PM,2004-11-18,,
VNQ,US9229085538,NYSE,USD,1,Vanguard Real Estate ETF,Vanguard,real_estate,reit,us,,0,0.0013,US,0,etf,dist,,,MSCI US IMI Real Estate 25/50,2004-09-23,,
IBIT,US46438F1012,NASDAQ,USD,1,iShares Bitcoin Trust ETF,iShares,crypto,bitcoin,global,,0,0.0025,US,0,etf,acc,,,CF Benchmarks Bitcoin Reference Rate,2024-01-11,BTC-USD,USD
IUSQ.DE,IE00B6R52259,XETRA,EUR,1,iShares MSCI ACWI UCITS ETF USD (Acc),iShares,equity,broad,global,,0,0.002,IE,1,etf,acc,,,MSCI ACWI,2011-10-21,SPY,USD
ISAC.L,IE00B6R52259,LSE,USD,0,iShares MSCI ACWI UCITS ETF USD (Acc),iShares,equity,broad,global,,0,0.002,IE,1,etf,acc,,,MSCI ACWI,2011-10-21,SPY,USD
EUNL.DE,IE00B4L5Y983,XETRA,EUR,1,iShares Core MSCI World UCITS ETF USD (Acc),iShares,equity,broad,global,,0,0.002,IE,1,etf,acc,,,MSCI World,2009-09-25,SPY,USD
IWDA.AS,IE00B4L5Y983,EURONEXT,EUR,0,iShares Core MSCI World UCITS ETF USD (Acc),iShares,equity,broad,global,,0,0.002,IE,1,etf,acc,,,MSCI World,2009-09-25,SPY,USD
SXR8.DE,IE00B5BMR087,XETRA,EUR,1,iShares Core S&P 500 UCITS ETF USD (Acc),iShares,equity,large_cap,us,,0,0.0007,IE,1,etf,acc,,,S&P 500,2010-05-19,SPY,USD
CSSPX.SW,IE00B5BMR087,SIX,USD,0,iShares Core S&P 500 UCITS ETF USD (Acc),iShares,equity,large_cap,us,,0,0.0007,IE,1,etf,acc,,,S&P 500,2010-05-19,SPY,USD
VWCE.DE,IE00BK5BQT80,XETRA,EUR,1,Vanguard FTSE All-World UCITS ETF USD Acc,Vanguard,equity,broad,global,,0,0.0019,IE,1,etf,acc,,,FTSE All-World,2019-07-23,SPY,USD
IS3N.DE,IE00BKM4GZ66,XETRA,EUR,1,iShares Core MSCI EM IMI UCITS ETF USD (Acc),iShares,equity,broad,em,,0,0.0018,IE,1,etf,acc,,,MSCI Emerging Markets IMI,2014-05-30,EEM,USD
EIMI.L,IE00BKM4GZ66,LSE,USD,0,iShares Core MSCI EM IMI UCITS ETF USD (Acc),iShares,equity,broad,em,,0,0.0018,IE,1,etf,acc,,,MSCI Emerging Markets IMI,2014-05-30,EEM,USD
IMAE.AS,IE00B4K48X80,EURONEXT,EUR,1,iShares Core MSCI Europe UCITS ETF EUR (Acc),iShares,equity,broad,europe,,0,0.0012,IE,1,etf,acc,,,MSCI Europe,,,
IWQU.L,IE00BP3QZ601,LSE,USD,1,iShares Edge MSCI World Quality Factor UCITS ETF USD (Acc),iShares,equity,quality,global,,0,0.003,IE,1,etf,acc,,,MSCI World Sector Neutral Quality,2014-10-06,,
MVOL.L,IE00B8FHGS14,LSE,USD,1,iShares Edge MSCI World Minimum Volatility UCITS ETF USD (Acc),iShares,equity,min_vol,global,,0,0.003,IE,1,etf,acc,,,MSCI World Minimum Volatility,2012-11-30,,
IUSN.DE,IE00BF4RFH31,XETRA,EUR,1,iShares MSCI World Small Cap UCITS ETF USD (Acc),iShares,equity,small_cap,global,,0,0.0035,IE,1,etf,acc,,,MSCI World Small Cap,,,
SUSW.L,IE00BYX2JD69,LSE,EUR,1,iShares MSCI World SRI UCITS ETF USD (Acc),iShares,equity,broad,global,,1,0.002,IE,1,etf,acc,,,MSCI World SRI,,,
QDVE.DE,IE00B3WJKG14,XETRA,EUR,1,iShares S&P 500 Information Technology Sector UCITS ETF USD (Acc),iShares,equity,sector,us,technology,0,0.0015,IE,1,etf,acc,,,S&P 500 Information Technology,,,
QDVG.DE,IE00B43HR379,XETRA,EUR,1,iShares S&P 500 Health Care Sector UCITS ETF USD (Acc),iShares,equity,sector,us,healthcare,0,0.0015,IE,1,etf,acc,,,S&P 500 Health Care,,,
AGGH.AS,IE00BDBRDM35,EURONEXT,EUR,1,iShares Core Global Aggregate Bond UCITS ETF EUR Hedged (Acc),iShares,bond,broad,global,,0,0.001,IE,1,etf,acc,EUR,7.0,Bloomberg Global Aggregate,2017-11-21,AGG,USD
AGGG.L,IE00B3F81409,LSE,USD,1,iShares Core Global Aggregate Bond UCITS ETF USD (Dist),iShares,bond,broad,global,,0,0.001,IE,1,etf,dist,,7.0,Bloomberg Global Aggregate,,AGG,USD
IBGS.AS,IE00B14X4Q57,EURONEXT,EUR,1,iShares Euro Government Bond 1-3yr UCITS ETF (Dist),iShares,bond,gov_short,eurozone,,0,0.0020,IE,1,etf,dist,,1.9,Bloomberg Euro Treasury 1-3 Year,,,
SEGA.L,IE00B4WXJJ64,LSE,GBP,1,iShares Core Euro Government Bond UCITS ETF (Dist),iShares,bond,gov_all,eurozone,,0,0.0009,IE,1,etf,dist,,8.0,Bloomberg Euro Treasury Bond,,,
IEAC.L,IE00B3F81R35,LSE,EUR,1,iShares Core Euro Corporate Bond UCITS ETF (Dist),iShares,bond,corp_ig,eurozone,,0,0.002,IE,1,etf,dist,,4.5,Bloomberg Euro Corporate Bond,,,
IDTL.L,IE00BSKRJZ44,LSE,USD,1,iShares $ Treasury Bond 20+yr UCITS ETF USD (Dist),iShares,bond,gov_long,us,,0,0.0007,IE,1,etf,dist,,17.0,ICE US Treasury 20+ Year,,TLT,USD
IBCI.AS,IE00B0M62X26,EURONEXT,EUR,1,iShares Euro Inflation Linked Government Bond UCITS ETF (Dist),iShares,bond,inflation_linked,eurozone,,0,0.0025,IE,1,etf,dist,,8.0,Bloomberg Euro Government Inflation-Linked Bond,,,
ITPS.SW,IE00B1FZSC47,SIX,USD,1,iShares $ TIPS UCITS ETF USD (Dist),iShares,bond,inflation_linked,us,,0,0.0025,IE,1,etf,dist,,7.0,Bloomberg US Treasury Inflation-Linked Bond,,TIP,USD
IEMB.L,IE00B2NPKV68,LSE,USD,1,iShares J.P. Morgan $ EM Bond UCITS ETF USD (Dist),iShares,bond,em_debt,em,,0,0.0045,IE,1,etf,dist,,7.0,JPMorgan EMBI Global Core,,,
IGLN.L,IE00B4ND3602,LSE,USD,1,iShares Physical Gold ETC,iShares,commodity,gold,global,,0,0.0012,IE,0,etc,acc,,,LBMA Gold Price PM,,GLD,USD
XEON.DE,LU0290358497,XETRA,EUR,1,Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C,Xtrackers,cash,money_market,eurozone,,0,0.001,LU,1,etf,acc,,0.1,EUR Overnight Rate Swap,,,
IWDP.SW,IE00B1FZS350,SIX,USD,1,iShares Developed Markets Property Yield UCITS ETF USD (Dist),iShares,real_estate,reit,global,,0,0.0059,IE,1,etf,dist,,,FTSE EPRA Nareit Developed Dividend+,,VNQ,USD
BTCE.DE,DE000A27Z304,XETRA,EUR,1,Bitwise Physical Bitcoin ETP,Bitwise,crypto,bitcoin,global,,0,0.02,DE,0,etp,acc,,,Bitcoin,2020-06-04,BTC-USD,USD
ZETH.DE,DE000A3GMKD7,XETRA,EUR,1,Bitwise Physical Ethereum ETP,Bitwise,crypto,ethereum,global,,0,0.0149,DE,0,etp,acc,,,Ethereum,2021-02-04,ETH-USD,USD
XIC.TO,CA46430J1012,TSX,CAD,1,iShares Core S&P/TSX Capped Composite Index ETF,iShares,equity,broad,canada,,0,0.0006,CA,0,etf,dist,,,S&P/TSX Capped Composite,2001-02-16,,
VFV.TO,CA92205Y1051,TSX,CAD,1,Vanguard S&P 500 Index ETF,Vanguard,equity,large_cap,us,,0,0.0009,CA,0,etf,dist,,,S&P 500,2012-11-02,,
VAS.AX,AU000000VAS1,ASX,AUD,1,Vanguard Australian Shares Index ETF,Vanguard,equity,broad,australia,,0,0.0007,AU,0,etf,dist,,,S&P/ASX 300,,,
```

- [ ] **Step 4: Run the tests**

Run: `(cd backend && uv run pytest tests/data/test_etfs_csv.py -q)`
Expected: `8 passed`

- [ ] **Step 5: Check currencies and tickers against Yahoo (network)**

Run: `(cd backend && uv run python -m app.data.ingest --check-currencies)`
Expected last line: `currency check: 0 problem(s) in 60 listings` (exit code 0). Any `mismatch` line means the CSV `currency` differs from Yahoo's quote currency: edit the CSV to Yahoo's value. Any `unknown` line means Yahoo does not know the ticker: fix the suffix or remove the row.

- [ ] **Step 6: Real ingest of the seed into a scratch database (network)**

Run: `(cd backend && uv run python -m app.data.ingest --db /tmp/roboadvisor-seed.db)`
Expected (about 5 seconds):

```
catalogue: 56 funds, 60 listings (0 funds, 0 listings removed)
prices: 62 tickers, full history
prices: ~270000 rows written, 0 tickers rescaled after provider restatement
fx: ~23000 rows for ['AUD', 'CAD', 'EUR', 'GBP']
rf EUR: ~7100 rows
rf USD: ~16700 rows
Data quality report: 4 issue(s)
  extreme_move   BTC-USD        2 daily move(s) beyond 25%, worst -37.2% on 2020-03-12
  extreme_move   BTCE.DE        1 daily move(s) beyond 25%, worst -25.3% on 2021-01-11
  extreme_move   ETH-USD        5 daily move(s) beyond 25%, worst -42.3% on 2020-03-12
  extreme_move   ZETH.DE        2 daily move(s) beyond 25%, worst -28.4% on 2022-06-13
```

Those four are real crypto crashes and are accepted. Anything else (`no_data`, `stale`, `gap`, `short_history`) on a seed row means that row's ticker is bad on Yahoo today: replace it with another listing of the same fund or delete the row, rerun until only these four remain. Delete `/tmp/roboadvisor-seed.db` afterwards.

- [ ] **Step 7: Commit**

```bash
git add backend/data/etfs.csv backend/tests/data/test_etfs_csv.py
git commit -m "feat(data): seed etfs.csv (60 listings) with validation test"
```

---

### Task 8: Extend `etfs.csv` to 300+ listings

**Files:**
- Modify: `backend/data/etfs.csv` (append rows), `backend/tests/data/test_etfs_csv.py` (append one test)

**Interfaces:**
- Consumes: the column spec, vocabularies and proxy rules of Task 7; `ingest.validate`.
- Produces: `etfs.csv` with at least 300 listings and 250 funds meeting the coverage numbers below; `test_final_coverage_targets` guards them.

This task is research work; the numbers are minimums, not targets to hit exactly. Work in batches of about 30 rows, one category group at a time, running the test after each batch.

**Coverage checklist (spec section 4.2)** with candidate funds to look up (names only: find the ISIN, tickers, TER and metadata yourself, never guess an ISIN):

| Group | Minimum | Candidates (by name) |
|---|---|---|
| Global / world equity, acc and dist, ESG variants | 12 global funds | iShares Core MSCI World (EUNL, IWDA), iShares MSCI World (dist), Vanguard FTSE All-World acc and dist (VWCE, VWRL), SPDR MSCI ACWI (SPYY), Xtrackers MSCI World (XDWD), Amundi MSCI World, Invesco FTSE All-World, iShares MSCI World SRI, Xtrackers MSCI World ESG, Amundi MSCI World SRI |
| US equity (UCITS and US-listed) | 15 US funds | S&P 500 UCITS (Vanguard VUSA/VUAA, Xtrackers, Amundi, SPDR SPY5, Invesco), Nasdaq-100 UCITS (CNDX, EQQQ), Russell 2000 UCITS, Vanguard Total Stock Market, iShares Core S&P 500, Schwab US Large Cap, Vanguard Growth, Vanguard Value, Vanguard Dividend Appreciation |
| Europe, Eurozone, UK, Switzerland, Germany | Europe 8, UK 2 | iShares Core MSCI Europe, STOXX Europe 600 UCITS (Xtrackers, iShares, Amundi), EURO STOXX 50, iShares Core FTSE 100, iShares Core DAX, iShares MSCI Switzerland |
| Japan, Pacific ex Japan | Japan 4, Pacific ex Japan 2 | iShares Core MSCI Japan IMI, Xtrackers MSCI Japan, Amundi MSCI Japan, iShares MSCI Pacific ex-Japan, EWJ, Tokyo listings (`1306.T`: check for splits first, see Task 9) |
| Emerging markets, China, India | EM 8, China 2, India 1 | iShares Core MSCI EM IMI, Vanguard FTSE Emerging Markets, Xtrackers MSCI EM, iShares MSCI China, iShares MSCI India, EEM, VWO, IEMG |
| World ex-US | 3 | Vanguard FTSE Developed World ex-US, iShares MSCI EAFE, Vanguard Total International Stock (VXUS) |
| Canada, Australia | 3 each | XIC, VCN, ZSP, VFV, XEQT, VAS, IOZ, STW, VGS (Vanguard MSCI Index International Shares), A200 |
| Factors | 8 funds across value, growth, momentum, quality, min_vol, dividend, multi_factor | iShares Edge MSCI World Value / Momentum / Quality / Min Vol, Xtrackers MSCI World Value / Momentum, Vanguard Value, SPDR S&P US Dividend Aristocrats, iShares MSCI USA Quality Dividend |
| Sectors | 2 per sector, all 10 sectors | iShares S&P 500 sector UCITS (IUIT/QDVE, IUHC/QDVG, IUFS, IUES, IUCD, IUCS, IUIS, IUMS, IUUS, IUCM), SPDR Select Sector funds XLK XLV XLF XLE XLY XLP XLI XLB XLU XLC |
| ESG variants | 15 funds with `esg=1` | iShares MSCI USA SRI, MSCI Europe SRI, MSCI EM SRI, MSCI World Paris-Aligned, Xtrackers ESG, Amundi Climate, Vanguard ESG Global All Cap, ESGU, SUSA, EUSRI |
| Government bonds | gov_short 3, gov_intermediate 3, gov_long 3 | iShares $ Treasury 1-3, 3-7, 7-10, 20+ UCITS, iShares Euro Government 1-3, 3-7, 7-10, 15-30, Xtrackers Eurozone Government, Vanguard USD Treasury, SHY, IEI, IEF, TLT, VGSH, VGIT, VGLT |
| Corporate IG / HY | corp_ig 3, high_yield 3 | iShares Core Euro Corporate, iShares $ Corp Bond, iShares $ High Yield Corp, iShares Euro High Yield, LQD, VCIT, HYG, JNK, USHY |
| Inflation-linked, EM debt, broad bonds | inflation_linked 3, em_debt 3, broad 5 | iShares Euro Inflation Linked, $ TIPS UCITS, TIP, VTIP, SCHP, iShares JPM $ EM Bond, EM Local Government Bond, EMB, VWOB, AGG, BND, Vanguard Global Aggregate (VGAB/VAGF), Xtrackers Global Aggregate |
| **Hedged and unhedged bond share classes** | 8 funds hedged to EUR, 3 hedged to USD, 12 hedged in total | Global aggregate EUR-hedged / USD-hedged / unhedged (iShares AGGH/AGGG, Vanguard, Xtrackers, Amundi), US Treasury 20+ EUR hedged (IDTE/DTLE), EUR Hedged HY, Vanguard USD Corporate EUR Hedged, BNDW, BNDX, IUSB. Use the same `index_name` string across the share classes of one index |
| Gold and commodities | commodity 6 (gold 3) | iShares Physical Gold ETC (IGLN/SGLN), Invesco Physical Gold (SGLD), Xetra-Gold, WisdomTree Physical Gold, GLD, IAU, iShares Physical Silver, iShares Diversified Commodity Swap (ICOM), Invesco Bloomberg Commodity (CMOP) |
| REITs | real_estate 5 | iShares Developed Markets Property Yield (IWDP), iShares European Property Yield (IPRP), VNQ, VNQI, SCHH, iShares US Property Yield |
| Money market / cash | cash 4 | Xtrackers EUR Overnight Rate Swap (XEON), Xtrackers II USD Overnight Rate Swap, Lyxor Smart Overnight Return, iShares Euro Ultrashort Bond, BIL, SGOV, SHV |
| Crypto ETFs / ETPs | crypto 6 (bitcoin 3, ethereum 2) | Bitwise Physical Bitcoin (BTCE), Bitwise Physical Ethereum (ZETH), WisdomTree Physical Bitcoin/Ethereum, VanEck Bitcoin/Ethereum ETN, 21Shares (ABTC, AETH: check for early-history glitches first), IBIT, FBTC, ETHA, FETH, Valour and CoinShares ETPs. Wrapper `etp` for European ETNs/ETPs |

**Exchange minimums for listings:** XETRA 50, LSE 40, EURONEXT 15, SIX 10, TSX 5, ASX 5, TSE 3, NYSE+NASDAQ 80. Give UCITS funds their EUR line (Xetra, Euronext) and one LSE or SIX USD/GBP line where it exists, so the universe step can choose a base-currency listing.

**Research method (network, per batch):**

1. Enumerate funds from issuer product lists and the candidates above. For each fund, fetch its justETF profile with WebFetch: `https://www.justetf.com/en/etf-profile.html?isin=<ISIN>`, prompt: "Return fund name, total expense ratio, distribution policy, domicile, launch date, index, currency hedging, and every listing with ticker, exchange and trading currency". If you only know a name, web-search it to find the ISIN first.
2. Cross-check every ticker to ISIN on Yahoo (this is the check that caught the wrong anchor and confirmed the seed):

```bash
(cd backend && uv run python - <<'EOF'
import yfinance as yf
for isin in ["IE00B4L5Y983", "IE00B3XXRP09"]:   # replace with the ISINs of the batch
    print(isin, [(x["symbol"], x.get("exchDisp")) for x in yf.Search(isin, max_results=8).quotes])
EOF
)
```

   US-listed funds also answer `yf.Ticker("SPY").isin`. Yahoo does not list every venue for an ISIN; guess the suffix (`.DE`, `.AS`, `.L`, `.SW`, `.PA`, `.MI`) and confirm the ticker has data with the currency check in Task 9.
3. Append the rows following the Task 7 column spec, proxy rules and conventions. One row per listing; repeat the fund columns exactly on every row of the same ISIN.
4. After each batch run `(cd backend && uv run pytest tests/data/test_etfs_csv.py -q)` (validation catches a mistyped ISIN through its check digit) and commit the batch.

- [ ] **Step 1: Append the final coverage test (fails until the catalogue is big enough)**

Append to `backend/tests/data/test_etfs_csv.py`:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `(cd backend && uv run pytest tests/data/test_etfs_csv.py -q)`
Expected: `1 failed, 8 passed`; the failure is `assert (60 >= 300 ...)`.

- [ ] **Step 3: Research and append rows in batches**

Follow the checklist and method above. Suggested batch order: US equity and factors, UCITS equity (world, US, Europe, EM, Japan), sectors and ESG, government bonds, corporates/HY/inflation/EM debt, hedged share classes, commodities/REIT/cash/crypto, Canada/Australia/Japan local listings. After each batch:

Run: `(cd backend && uv run pytest tests/data/test_etfs_csv.py -q)`
Expected: only `test_final_coverage_targets` fails (with a message naming the shortest category) until the last batch; then `9 passed`.

Commit each batch:

```bash
git add backend/data/etfs.csv
git commit -m "data: etfs.csv batch <category group> (<N> listings total)"
```

- [ ] **Step 4: Verify TER and hedging on a sample**

For the seed rows and at least 30 of the new rows, compare `ter`, `distribution`, `hedged_to` and `inception_date` with the justETF profile (or the issuer factsheet for US funds) and correct the CSV where they differ. The seed TERs are drafts (for example the Bitwise Physical Bitcoin ETP TER of 0.0200 must be checked).

- [ ] **Step 5: Final offline check**

Run: `(cd backend && uv run pytest tests/data -q)`
Expected: all pass (`78 + 2 + 9 = 89 passed`).

---

### Task 9: Live ingest acceptance and cleanup

**Files:**
- Modify: `backend/data/etfs.csv` (remove or replace bad rows)

**Interfaces:**
- Consumes: everything above. Uses the default `config.DB_PATH` (`backend/data/roboadvisor.db`, git-ignored).
- Produces: a catalogue in which every ticker resolves on Yahoo, and a populated `backend/data/roboadvisor.db` for the integrator's Phase 2 (the database itself is not committed).

- [ ] **Step 1: Currency and ticker check (network)**

Run: `(cd backend && uv run python -m app.data.ingest --check-currencies)`
Expected last line: `currency check: 0 problem(s) in <N> listings`. For each `mismatch` set the CSV `currency` to Yahoo's value; for each `unknown` fix the ticker suffix or delete the row. Repeat until 0 problems.

- [ ] **Step 2: First real ingest (network, a few minutes)**

Run: `(cd backend && uv run python -m app.data.ingest)`
Expected shape: `catalogue: <F> funds, <N> listings ...`, `prices: ... full history`, `fx: ... rows for ['AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY']` (depending on the listings), `rf EUR`, `rf USD`, then the quality report. Exit code 0. Yahoo may rate-limit large batches: a `warning: price download failed` on stderr means those tickers show up as `no_data`; wait a minute and rerun (the run is incremental and idempotent).

- [ ] **Step 3: Review the quality report and decide per issue**

For every line of the report, apply exactly one of these rules; never patch prices or edit the database by hand:

| Issue | Decision |
|---|---|
| `no_data` on a listing | Wrong ticker or delisted: find the right Yahoo symbol for the ISIN (`yf.Search`), else delete that listing row. If it was the fund's only listing, delete the fund; if it was `is_primary=1`, move `is_primary` to another listing of the ISIN |
| `no_data` on a proxy ticker | Fix `proxy_ticker` (or drop both proxy columns) |
| `missing_ter` | Look the TER up on justETF/issuer and fill it in |
| `short_history` | Acceptable only if the fund is genuinely young (launched under a year ago); otherwise add a proxy from the Task 7 table or delete the fund |
| `stale` | Delisted or merged fund: delete the listing |
| `gap` | Look at the dates. Exchange closure or launch quirk of a young fund: replace the listing with another line of the same fund, or delete it. Long gaps in a proxy: choose another proxy |
| `extreme_move` | Genuine market crash (crypto on 2020-03-12, similar): **accept**. First weeks after launch, unadjusted split (like `1306.T` +948% on 2026-04-01) or bad ticks: replace with a cleaner line of the same fund or delete the row. Do not accept an extreme move you cannot explain |

Rerun `(cd backend && uv run python -m app.data.ingest)` after each round of CSV edits (fast, incremental; removed rows disappear from `fund`/`listing`). Stop when the report is empty or lists only issues you can each explain as genuine. Write the accepted ones into the commit message.

- [ ] **Step 4: Prove incremental mode against live data (network)**

Run the ingest a second time: `(cd backend && uv run python -m app.data.ingest)`
Expected: `prices: <N> tickers, incremental (<k> start dates)` with small `rows written` (about one week of rows per ticker), and `0 tickers rescaled` (a nonzero number is normal right after a dividend and shows the restatement fix working; the tickers are listed).

- [ ] **Step 5: Smoke test `SqliteData` on the real database**

Run:

```bash
(cd backend && uv run python - <<'EOF'
from app import config
from app.data.db import SqliteData

d = SqliteData(config.DB_PATH)
funds, listings = d.funds(), d.listings()
print(len(funds), "funds;", len(listings), "listings; last_ingest", d.last_ingest())
print(funds.dtypes[["esg", "ucits", "ter", "inception_date"]].to_dict())
for cur, a in config.ANCHORS.items():
    for key, isin in a.items():
        t = listings[listings.isin == isin]
        px = d.prices(list(t.ticker) + [funds.at[isin, "proxy_ticker"]])
        print(cur, key, isin, dict(px.count()))
fx, rf = d.fx(), d.rf("EUR")
print(list(fx.columns), fx["USD"].eq(1.0).all(), rf.index.min().date(), len(d.rf("USD")))
assert listings.isin.isin(funds.index).all()
EOF
)
```

Expected: fund/listing counts equal the CSV's (`grep -c . backend/data/etfs.csv` is listings + 1), dtypes `bool bool float64 datetime64[...]`, each anchor line shows non-zero price counts for its own listing(s) and proxy, `fx["USD"]` all 1.0 (`True`), EUR rf starting `1999-01-04`.

- [ ] **Step 6: Confirm the database is not tracked**

Run: `git check-ignore backend/data/roboadvisor.db`
Expected: prints the path. If it prints nothing, do **not** add the file: escalate to the integrator (the Phase 0 `.gitignore` is missing `backend/data/roboadvisor.db`).

- [ ] **Step 7: Full lane test run and commit**

Run: `(cd backend && uv run pytest tests/data -q)`
Expected: all pass (`89 passed`).

```bash
git add backend/data/etfs.csv
git commit -m "data: etfs.csv cleaned after live ingest

Accepted quality issues: <list each accepted extreme_move/gap with its reason, or 'none'>"
```

---

## Notes for the integrator (contract problems found in Phase 0)

1. **Phase 0 fixture cannot be constructed.** `tests/fixtures/synthetic.py::_FUNDS` tuples have 18 fields (no `issuer`) while the DataFrame is built with `["isin", *FUND_COLUMNS]` = 19 names, so `SyntheticData()` raises `ValueError: 19 columns passed, passed data had 18 columns` and `tests/test_synthetic.py` fails as written. Fix: add an `issuer` value after `name` in every `_FUNDS` tuple (the Lane A tests were run against a fixture patched with `"Syn Issuer"`), and correct the header comment. Every lane's tests depend on this fixture.
2. **Anchor ISIN `US92203J4076` is BNDX, not BNDW.** Correct value: `US92206C5655`. Lane A changes `config.ANCHORS` (Task 6), after which `tests/test_synthetic.py::test_shapes` fails because `synthetic.py` hard-codes the old ISIN in `_FUNDS`, `_ECON` and `_LISTINGS`. Best: fix it in the Phase 0 plan before lanes start (config value, the three fixture spots, and the roster text in Task 5), so Lane A's Task 6 becomes a no-op. Better still: derive the anchor ISINs in the fixture from `config.ANCHORS`.
3. **London lines are quoted in pence.** Yahoo reports `GBp` for `.L` tickers (even for EUR- or USD-denominated funds, e.g. `SSAC.L`, `SEGA.L`), so the CSV records `GBP` and the stored levels are 100x the GBP price. Returns are unaffected, but `api/universe` `FundDetail.history` ("primary listing converted to base currency") would be off by 100 for such listings unless it is rebased (for example to 100 at the first date) or divided by 100 for GBP listings. Lane B's `convert_prices` needs no change.
4. **`index_name` is the hedge-sibling key.** `universe.select` drops unhedged bond siblings by matching `index_name`; Lane A's catalogue rules make hedged and unhedged share classes carry the identical string (`Bloomberg Global Aggregate`), enforced only as "bond funds need index_name" plus a test that at least one such pair exists. Tell Lane B the convention and that hedge groups can mix several `hedged_to` currencies (EUR, USD): with base EUR, keep only `hedged_to == EUR` when one exists.
5. **`DataSource.prices` index is not strictly business days.** The union of trading dates across tickers includes weekends when crypto (`BTC-USD`, `ETH-USD`, and funds proxied by them) is requested. Harmless for W-FRI resampling, but the docstring says business days.
6. **Missing strings are `None` only in `SqliteData`.** With pandas 3 (unpinned in Phase 0, resolved to 3.0.6 during this lane's verification) `SyntheticData` returns pandas `str` columns with `NaN` for missing values. `SqliteData` returns `object` columns with `None` as the protocol says; consider pinning `pandas<3` or relaxing the docstring, and make `universe.select` use `pd.isna`.
7. **Additive public API in Lane A files** (no signature of a frozen stub changed): `db` upsert helpers, `sources.fetch_currencies`, `ingest.main` flags `--full --csv --db --check-currencies`, and exit codes 0/1/2/3.
8. **`backend/data/roboadvisor.db` must be git-ignored** (Task 9 step 6 checks it). Phase 2 should run `uv run python -m app.data.ingest` once on the final catalogue before enabling the API against real data.
