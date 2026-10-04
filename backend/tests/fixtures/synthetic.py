"""Deterministic synthetic market for tests. No network; identical output for a given seed.

Business days 2005-01-03..2025-12-31. Each fund's daily return, in its economic currency, is
alpha + b_eq*EQ + b_bd*BD + b_x*X + idio. EUR-native and EUR-hedged funds have economic currency EUR
(no FX effect for EUR investors); all others USD. Listing prices = economic value converted to the
listing currency. Prices before inception are NaN; proxy series (SYN-*) cover the full history.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.config import ANCHORS
from app.engine.types import FUND_COLUMNS, LISTING_COLUMNS

DATES = pd.bdate_range("2005-01-03", "2025-12-31")
BTC_START = pd.Timestamp("2014-09-17")
ANCHOR_ISINS = sorted({isin for a in ANCHORS.values() for isin in a.values()})

# Stand-in for config.TEXTBOOK_FUNDS (the real ISINs are not in the synthetic market). EUR only.
SYN_TEXTBOOK_FUNDS = {
    "EUR": {
        "risky": {
            "US equities": "SYNUSEQ00001",
            "European equities": "SYNEUEQ00001",
            "Emerging market equities": "SYNEMEQ00001",
            "Government bonds": "SYNGOVL00001",
            "Corporate bonds": "SYNCORP00001",
            "Gold": "SYNGOLD00001",
            "Real estate": "SYNREIT00001",
        },
        "risk_free": "SYNCASH00001",
    },
}

# isin, name, issuer, asset_class, sub_class, region, sector, esg, ter, domicile, ucits, wrapper, distribution,
# hedged_to, duration, index_name, inception_date, proxy_ticker, proxy_currency
_FUNDS = [
    ("US4642882579", "Syn ACWI (US)", "Syn Issuer", "equity", "broad", "global", None, False, 0.0032, "US", False, "etf", "dist", None, None, "MSCI ACWI", "2008-03-26", "SYN-EQ", "USD"),
    ("US92206C5655", "Syn Total World Bond (US)", "Syn Issuer", "bond", "broad", "global", None, False, 0.0005, "US", False, "etf", "dist", "USD", 6.5, "Global Aggregate USD Hedged", "2018-09-04", "SYN-BD", "USD"),
    ("IE00B6R52259", "Syn ACWI UCITS", "Syn Issuer", "equity", "broad", "global", None, False, 0.0020, "IE", True, "etf", "acc", None, None, "MSCI ACWI", "2011-10-21", "SYN-EQ", "USD"),
    ("IE00BDBRDM35", "Syn Global Agg EUR Hedged", "Syn Issuer", "bond", "broad", "global", None, False, 0.0010, "IE", True, "etf", "acc", "EUR", 6.5, "Global Aggregate EUR Hedged", "2017-11-21", "SYN-BD", "USD"),
    ("SYNUSEQ00001", "Syn US Large Cap", "Syn Issuer", "equity", "large_cap", "us", None, False, 0.0003, "US", False, "etf", "dist", None, None, "S&P 500", "2005-01-03", None, None),
    ("SYNEUEQ00001", "Syn Europe Equity", "Syn Issuer", "equity", "large_cap", "europe", None, False, 0.0012, "IE", True, "etf", "dist", None, None, "MSCI Europe", "2005-01-03", None, None),
    ("SYNEMEQ00001", "Syn EM Equity", "Syn Issuer", "equity", "broad", "em", None, False, 0.0018, "IE", True, "etf", "acc", None, None, "MSCI EM", "2006-01-02", None, None),
    ("SYNJPEQ00001", "Syn Japan Equity", "Syn Issuer", "equity", "large_cap", "japan", None, False, 0.0015, "IE", True, "etf", "acc", None, None, "MSCI Japan", "2005-01-03", None, None),
    ("SYNESGEQ0001", "Syn World ESG", "Syn Issuer", "equity", "broad", "global", None, True, 0.0020, "IE", True, "etf", "acc", None, None, "MSCI World ESG Leaders", "2015-06-01", "SYN-EQ", "USD"),
    ("SYNHLTH00001", "Syn World Healthcare", "Syn Issuer", "equity", "sector", "global", "healthcare", False, 0.0025, "IE", True, "etf", "acc", None, None, "MSCI World Health Care", "2005-01-03", None, None),
    ("SYNTECH00001", "Syn US Technology", "Syn Issuer", "equity", "sector", "us", "technology", False, 0.0010, "US", False, "etf", "dist", None, None, "S&P Technology", "2005-01-03", None, None),
    ("SYNGOVS00001", "Syn EUR Gov 1-3y", "Syn Issuer", "bond", "gov_short", "europe", None, False, 0.0015, "IE", True, "etf", "acc", None, 2.0, "EUR Gov 1-3", "2005-01-03", None, None),
    ("SYNGOVL00001", "Syn EUR Gov 15+y", "Syn Issuer", "bond", "gov_long", "europe", None, False, 0.0015, "IE", True, "etf", "acc", None, 16.0, "EUR Gov 15+", "2005-01-03", None, None),
    ("SYNUSTL00001", "Syn US Treasury 20+y (US)", "Syn Issuer", "bond", "gov_long", "us", None, False, 0.0015, "US", False, "etf", "dist", None, 17.0, "US Treasury 20+", "2005-01-03", None, None),
    ("SYNUSTLEH001", "Syn US Treasury 20+y EUR Hedged", "Syn Issuer", "bond", "gov_long", "us", None, False, 0.0010, "IE", True, "etf", "acc", "EUR", 17.0, "US Treasury 20+ UCITS", "2016-03-01", "SYN-UST", "USD"),
    ("SYNUSTLUH001", "Syn US Treasury 20+y UCITS", "Syn Issuer", "bond", "gov_long", "us", None, False, 0.0007, "IE", True, "etf", "acc", None, 17.0, "US Treasury 20+ UCITS", "2009-06-01", "SYN-UST", "USD"),
    ("SYNCORP00001", "Syn EUR Corporate IG", "Syn Issuer", "bond", "corp_ig", "europe", None, False, 0.0020, "IE", True, "etf", "acc", None, 4.5, "EUR Corporate", "2005-01-03", None, None),
    ("SYNHY0000001", "Syn US High Yield", "Syn Issuer", "bond", "high_yield", "us", None, False, 0.0040, "US", False, "etf", "dist", None, 3.5, "US High Yield", "2007-04-04", None, None),
    ("SYNGOLD00001", "Syn Physical Gold", "Syn Issuer", "commodity", "gold", "global", None, False, 0.0012, "IE", False, "etc", "acc", None, None, "Gold", "2005-01-03", None, None),
    ("SYNCASH00001", "Syn EUR Money Market", "Syn Issuer", "cash", "money_market", "europe", None, False, 0.0010, "LU", True, "etf", "acc", None, 0.1, "EUR Overnight", "2005-01-03", None, None),
    ("SYNREIT00001", "Syn US REIT", "Syn Issuer", "real_estate", "reit", "us", None, False, 0.0012, "US", False, "etf", "dist", None, None, "US REIT", "2005-01-03", None, None),
    ("SYNBTC000001", "Syn Bitcoin ETP", "Syn Issuer", "crypto", "bitcoin", "global", None, False, 0.0095, "CH", False, "etp", "acc", None, None, "Bitcoin", "2020-01-02", "SYN-BTC", "USD"),
    ("SYNIBIT00001", "Syn Bitcoin ETF (US)", "Syn Issuer", "crypto", "bitcoin", "global", None, False, 0.0025, "US", False, "etf", "acc", None, None, "Bitcoin", "2024-01-11", "SYN-BTC", "USD"),
    ("SYNYOUNG0001", "Syn Global Small Cap", "Syn Issuer", "equity", "small_cap", "global", None, False, 0.0035, "IE", True, "etf", "acc", None, None, "MSCI World Small Cap", "2023-06-01", None, None),
]

# isin -> (alpha, b_eq, b_bd, extra_factor, b_extra, idio_sigma, economic_currency)
_ECON = {
    "US4642882579": (0.0, 1.0, 0.0, None, 0.0, 0.001, "USD"),
    "US92206C5655": (0.0, 0.0, 1.0, None, 0.0, 0.0005, "USD"),
    "IE00B6R52259": (0.0, 1.0, 0.0, None, 0.0, 0.001, "USD"),
    "IE00BDBRDM35": (0.0, 0.0, 1.0, None, 0.0, 0.0005, "EUR"),
    "SYNUSEQ00001": (0.00005, 1.05, 0.0, None, 0.0, 0.003, "USD"),
    "SYNEUEQ00001": (-0.00005, 0.95, 0.0, None, 0.0, 0.004, "EUR"),
    "SYNEMEQ00001": (0.0, 1.2, 0.0, None, 0.0, 0.007, "USD"),
    "SYNJPEQ00001": (-0.00005, 0.8, 0.0, None, 0.0, 0.006, "USD"),
    "SYNESGEQ0001": (0.0, 1.0, 0.0, None, 0.0, 0.002, "USD"),
    "SYNHLTH00001": (0.00005, 0.75, 0.0, None, 0.0, 0.006, "USD"),
    "SYNTECH00001": (0.0002, 1.3, 0.0, None, 0.0, 0.008, "USD"),
    "SYNGOVS00001": (0.0, 0.0, 0.3, None, 0.0, 0.0005, "EUR"),
    "SYNGOVL00001": (0.0, -0.05, 2.2, None, 0.0, 0.002, "EUR"),
    "SYNUSTL00001": (0.0, -0.1, 2.5, None, 0.0, 0.002, "USD"),
    "SYNUSTLEH001": (0.0, -0.1, 2.5, None, 0.0, 0.002, "EUR"),
    "SYNUSTLUH001": (0.0, -0.1, 2.5, None, 0.0, 0.002, "USD"),
    "SYNCORP00001": (0.00002, 0.1, 1.2, None, 0.0, 0.001, "EUR"),
    "SYNHY0000001": (0.00005, 0.35, 0.5, None, 0.0, 0.002, "USD"),
    "SYNGOLD00001": (0.0, 0.05, 0.0, "GOLD", 1.0, 0.001, "USD"),
    "SYNCASH00001": (0.0, 0.0, 0.0, "CASH_EUR", 1.0, 0.0, "EUR"),
    "SYNREIT00001": (0.0, 1.1, 0.3, None, 0.0, 0.006, "USD"),
    "SYNBTC000001": (0.0, 0.2, 0.0, "BTC", 1.0, 0.002, "USD"),
    "SYNIBIT00001": (0.0, 0.2, 0.0, "BTC", 1.0, 0.002, "USD"),
    "SYNYOUNG0001": (0.0, 1.1, 0.0, None, 0.0, 0.004, "USD"),
}

# ticker, isin, exchange, currency, is_primary
_LISTINGS = [
    ("ACWI", "US4642882579", "NASDAQ", "USD", True),
    ("BNDW", "US92206C5655", "NASDAQ", "USD", True),
    ("IUSQ.DE", "IE00B6R52259", "XETRA", "EUR", True),
    ("SSAC.L", "IE00B6R52259", "LSE", "USD", False),
    ("EUNA.DE", "IE00BDBRDM35", "XETRA", "EUR", True),
    ("SUSE", "SYNUSEQ00001", "NYSE", "USD", True),
    ("SEUE.DE", "SYNEUEQ00001", "XETRA", "EUR", True),
    ("SEME.DE", "SYNEMEQ00001", "XETRA", "EUR", True),
    ("SEME.L", "SYNEMEQ00001", "LSE", "USD", False),
    ("SJPE.DE", "SYNJPEQ00001", "XETRA", "EUR", True),
    ("SESG.AS", "SYNESGEQ0001", "EURONEXT", "EUR", True),
    ("SHLT.DE", "SYNHLTH00001", "XETRA", "EUR", True),
    ("STEC", "SYNTECH00001", "NYSE", "USD", True),
    ("SGVS.DE", "SYNGOVS00001", "XETRA", "EUR", True),
    ("SGVL.DE", "SYNGOVL00001", "XETRA", "EUR", True),
    ("SUST", "SYNUSTL00001", "NASDAQ", "USD", True),
    ("SUSH.DE", "SYNUSTLEH001", "XETRA", "EUR", True),
    ("SUSU.L", "SYNUSTLUH001", "LSE", "USD", True),
    ("SUSU.DE", "SYNUSTLUH001", "XETRA", "EUR", False),
    ("SCRP.DE", "SYNCORP00001", "XETRA", "EUR", True),
    ("SHYG", "SYNHY0000001", "NYSE", "USD", True),
    ("SGLD.DE", "SYNGOLD00001", "XETRA", "EUR", True),
    ("SCSH.DE", "SYNCASH00001", "XETRA", "EUR", True),
    ("SRET", "SYNREIT00001", "NYSE", "USD", True),
    ("SBTC.SW", "SYNBTC000001", "SIX", "EUR", True),
    ("SBIT", "SYNIBIT00001", "NASDAQ", "USD", True),
    ("SYNG.DE", "SYNYOUNG0001", "XETRA", "EUR", True),
]

# factor, start, end, extra daily return
_SHOCKS = [
    ("EQ", "2008-09-15", "2009-03-09", -0.003),
    ("EQ", "2020-02-20", "2020-03-23", -0.012),
    ("EQ", "2022-01-03", "2022-10-14", -0.0008),
    ("BD", "2022-01-03", "2022-10-14", -0.0008),
]


def _rf_annual(currency: str) -> pd.Series:
    d = DATES
    if currency == "USD":
        v = np.select([d < "2008-12-16", d < "2016-12-15", d < "2020-03-16", d < "2022-03-17"], [0.03, 0.002, 0.015, 0.001], 0.045)
    else:
        v = np.select([d < "2008-12-10", d < "2015-03-09", d < "2022-07-27"], [0.03, 0.005, -0.004], 0.03)
    return pd.Series(v, index=d, name=currency, dtype=float)


class SyntheticData:
    def __init__(self, seed: int = 0) -> None:
        rng = np.random.default_rng(seed)
        n = len(DATES)
        f = pd.DataFrame(
            {
                "EQ": rng.normal(0.0003, 0.011, n),
                "BD": rng.normal(0.00012, 0.003, n),
                "GOLD": rng.normal(0.00025, 0.010, n),
                "BTC": rng.normal(0.0015, 0.04, n),
            },
            index=DATES,
        )
        for col, start, end, add in _SHOCKS:
            f.loc[start:end, col] += add
        f.loc[f.index < BTC_START, "BTC"] = np.nan
        self._rf = {c: _rf_annual(c) for c in ("USD", "EUR")}
        f["CASH_EUR"] = self._rf["EUR"] / 252
        self._fx = pd.DataFrame({"USD": 1.0, "EUR": 1.25 * np.exp(np.cumsum(rng.normal(0, 0.004, n)))}, index=DATES)

        self._econ: dict[str, tuple[pd.Series, str]] = {}
        for isin, (alpha, b_eq, b_bd, x, b_x, idio, ccy) in _ECON.items():
            r = alpha + b_eq * f["EQ"] + b_bd * f["BD"] + rng.normal(0, idio, n)
            if x:
                r = r + b_x * f[x]
            self._econ[isin] = (r, ccy)

        self._funds = pd.DataFrame(_FUNDS, columns=["isin", *FUND_COLUMNS]).set_index("isin")
        self._funds["inception_date"] = pd.to_datetime(self._funds["inception_date"])
        self._funds["duration"] = self._funds["duration"].astype(float)
        self._listings = pd.DataFrame(_LISTINGS, columns=LISTING_COLUMNS)

        prices: dict[str, pd.Series] = {}
        for ticker, isin, _, ccy, _ in _LISTINGS:
            r, eccy = self._econ[isin]
            px = 100 * (1 + r.fillna(0)).cumprod() * self._conv(eccy, ccy)
            px[px.index < self._funds.at[isin, "inception_date"]] = np.nan
            prices[ticker] = px
        proxies = {"SYN-EQ": f["EQ"], "SYN-BD": f["BD"], "SYN-UST": -0.1 * f["EQ"] + 2.5 * f["BD"], "SYN-BTC": f["BTC"]}
        for ticker, r in proxies.items():
            px = 100 * (1 + r.fillna(0)).cumprod()
            px[r.isna()] = np.nan
            prices[ticker] = px
        self._prices = pd.DataFrame(prices)

    def _conv(self, from_ccy: str, to_ccy: str) -> pd.Series:
        return self._fx[from_ccy] / self._fx[to_ccy]

    # ---- DataSource ----
    def funds(self) -> pd.DataFrame:
        return self._funds.copy()

    def listings(self) -> pd.DataFrame:
        return self._listings.copy()

    def prices(self, tickers: list[str]) -> pd.DataFrame:
        return self._prices.reindex(columns=list(tickers))

    def fx(self) -> pd.DataFrame:
        return self._fx.copy()

    def rf(self, currency: str) -> pd.Series:
        return self._rf[currency].copy()

    def last_ingest(self) -> str | None:
        return "2025-12-31"

    # ---- reference helpers for tests (independent of the engine) ----
    def weekly_returns(self, base: str) -> pd.DataFrame:
        """Weekly base-currency returns per isin from the economic series over the full history, as if every
        fund had a perfect proxy. Exceptions: BTC funds start 2014-09, SYNYOUNG0001 starts at inception."""
        cols = {}
        for isin, (r, eccy) in self._econ.items():
            value = (1 + r).cumprod(skipna=True) * self._conv(eccy, base)
            value[r.isna()] = np.nan
            if isin == "SYNYOUNG0001":
                value[value.index < self._funds.at[isin, "inception_date"]] = np.nan
            cols[isin] = value
        return pd.DataFrame(cols).resample("W-FRI").last().pct_change(fill_method=None).iloc[1:]

    def weekly_rf(self, base: str) -> pd.Series:
        """Annualised risk-free rate sampled W-FRI (last)."""
        return self._rf[base].resample("W-FRI").last()
