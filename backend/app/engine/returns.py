"""Lane B. Spec §5.2."""

import pandas as pd

from app.engine.types import ReturnsResult


def convert_prices(prices: pd.DataFrame, currencies: dict[str, str], fx: pd.DataFrame, base: str) -> pd.DataFrame:
    """Daily prices (columns = tickers, local currency) -> base currency.

    price_base = price_local * usd_rate[local] / usd_rate[base]; fx is forward-filled onto the price dates.
    currencies: ticker -> currency code. Columns keep their ticker names.
    """
    rate = fx.reindex(fx.index.union(prices.index)).ffill().reindex(prices.index)
    local = rate[[currencies[t] for t in prices.columns]]
    local.columns = prices.columns
    return (prices * local).div(rate[base], axis=0)


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
    with_proxy = selection["proxy_ticker"].notna()
    currencies = {
        **dict(zip(selection["ticker"], selection["currency"])),
        **dict(zip(selection.loc[with_proxy, "proxy_ticker"], selection.loc[with_proxy, "proxy_currency"])),
    }
    local = prices.reindex(columns=list(currencies))
    level = convert_prices(local, currencies, fx, base).resample("W-FRI").last()
    ret = level.pct_change(fill_method=None)
    local_ret = local.resample("W-FRI").last().pct_change(fill_method=None)  # unconverted, for hedged proxies

    columns, proxied = {}, {}
    for isin, row in selection.iterrows():
        r = ret[row["ticker"]]
        start = level[row["ticker"]].first_valid_index()  # week of the first own price
        if pd.notna(row["proxy_ticker"]) and start is not None:
            source = local_ret if row["hedged_to"] == base else ret
            proxy = source[row["proxy_ticker"]]
            early = r.index <= start  # own return of that week needs a prior own price, so it is proxied too
            r = r.where(~early, proxy)
            span = proxy[early].dropna().index
            if len(span):
                proxied[isin] = (span[0], span[-1])
        columns[isin] = r
    returns = pd.DataFrame(columns).iloc[1:].asfreq("W-FRI")
    return ReturnsResult(returns=returns, proxied=proxied)
