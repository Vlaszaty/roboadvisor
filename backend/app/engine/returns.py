"""Lane B. Spec §5.2."""

import pandas as pd

from app.engine.types import ReturnsResult


def convert_prices(prices: pd.DataFrame, currencies: dict[str, str], fx: pd.DataFrame, base: str) -> pd.DataFrame:
    """Daily prices (columns = tickers, local currency) -> base currency.

    price_base = price_local * usd_rate[local] / usd_rate[base]; fx is forward-filled onto the price dates.
    currencies: ticker -> currency code. Columns keep their ticker names.
    """
    raise NotImplementedError("Lane B")


def weekly_returns(prices: pd.DataFrame, selection: pd.DataFrame, fx: pd.DataFrame, base: str) -> ReturnsResult:
    """Weekly (W-FRI, last price of week) simple returns in base currency, columns = isin.

    selection: output of universe.select (uses ticker, currency, hedged_to, proxy_ticker, proxy_currency).
    prices: daily local prices containing every selection ticker and proxy ticker.
    Before a fund's first own price, returns come from its proxy_ticker:
      - converted to base, except when the fund is hedged_to == base: then the proxy's local-currency
        returns are used unconverted (approximates a currency-hedged history).
    proxied[isin] = (first proxied week, week of the first own price), both inclusive.
    Weeks without data (and no proxy) stay NaN. The first week (no prior price) is dropped.
    """
    raise NotImplementedError("Lane B")
