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
