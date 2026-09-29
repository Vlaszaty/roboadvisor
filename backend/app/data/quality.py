"""Data quality report printed after ingestion (Lane A)."""

import sqlite3
from dataclasses import dataclass


@dataclass
class Issue:
    kind: str  # missing_ter | short_history | gap | stale | extreme_move | no_data
    ticker_or_isin: str
    detail: str


def report(conn: sqlite3.Connection) -> list[Issue]:
    raise NotImplementedError("Lane A")
