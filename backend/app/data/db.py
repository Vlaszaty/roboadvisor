"""SQLite access (Lane A)."""

import sqlite3
from pathlib import Path

import pandas as pd

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def connect(path: Path | str) -> sqlite3.Connection:
    raise NotImplementedError("Lane A")


def init_db(conn: sqlite3.Connection) -> None:
    """Create all tables from schema.sql (idempotent)."""
    raise NotImplementedError("Lane A")


class SqliteData:
    """DataSource over the SQLite file (see app.engine.types.DataSource for the exact contract)."""

    def __init__(self, path: Path | str) -> None:
        raise NotImplementedError("Lane A")

    def funds(self) -> pd.DataFrame: ...
    def listings(self) -> pd.DataFrame: ...
    def prices(self, tickers: list[str]) -> pd.DataFrame: ...
    def fx(self) -> pd.DataFrame: ...
    def rf(self, currency: str) -> pd.Series: ...
    def last_ingest(self) -> str | None: ...
