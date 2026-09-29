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
PENCE = {"GBp": "GBX", "GBX": "GBX"}  # Yahoo quotes many London lines in pence: currency code GBX (fx derived, see db)


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
    """Quote currency Yahoo reports per ticker (pence lines are reported as GBX). Tickers Yahoo cannot resolve are absent."""
    out = {}
    for t in tickers:
        c = _yahoo_currency(t)
        if c:
            out[t] = PENCE.get(c, c)
    return out
