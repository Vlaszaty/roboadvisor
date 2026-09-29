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
