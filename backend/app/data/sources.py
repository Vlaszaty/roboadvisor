"""All network access for ingestion (Lane A). Swappable for a paid provider later."""

from datetime import date

import pandas as pd


def fetch_prices(tickers: list[str], start: date | None) -> pd.DataFrame:
    """Daily adjusted close per ticker (yfinance, auto_adjust=True). DatetimeIndex, columns = tickers
    that returned data. start=None -> maximum history."""
    raise NotImplementedError("Lane A")


def fetch_fx(currencies: list[str], start: date | None) -> pd.DataFrame:
    """Daily USD per 1 unit for each non-USD currency (e.g. from 'EURUSD=X'). Columns = currencies."""
    raise NotImplementedError("Lane A")


def fetch_rf(currency: str, start: date | None) -> pd.Series:
    """Daily annualised risk-free rate as a fraction. USD: ^IRX / 100. EUR: ECB EONIA until 2019-09-30,
    then €STR (EONIA = €STR + 0.00085 for the overlap convention)."""
    raise NotImplementedError("Lane A")
