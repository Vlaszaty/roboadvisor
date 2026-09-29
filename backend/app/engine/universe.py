"""Lane B. Spec §5.1."""

import pandas as pd

from app import config
from app.engine.errors import NoEligibleFunds
from app.engine.types import InvestorProfile


def _choose_listing(listings: pd.DataFrame, isins: pd.Index, base: str) -> pd.DataFrame:
    """One listing per isin: base currency first, then is_primary, then ticker alphabetical."""
    lst = listings[listings["isin"].isin(isins)].copy()
    lst["_other_ccy"] = lst["currency"] != base
    lst["_not_primary"] = ~lst["is_primary"].astype(bool)
    best = lst.sort_values(["_other_ccy", "_not_primary", "ticker"]).drop_duplicates("isin")
    return best.set_index("isin")[["ticker", "exchange", "currency"]]


def select(funds: pd.DataFrame, listings: pd.DataFrame, profile: InvestorProfile) -> pd.DataFrame:
    """Eligible funds for this profile, one chosen listing each.

    funds / listings: as returned by DataSource.funds() / .listings().
    Returns: funds' columns (index isin) plus 'ticker', 'exchange' and 'currency' of the chosen listing.

    Filters (in this order). The result carries result.attrs["removed"] = {key: number of funds removed} with keys
    esg, regions_include, regions_exclude, sectors_exclude, max_ter, distribution, crypto, non_ucits,
    hedged_duplicates_and_unlisted (every key present, 0 when the filter did nothing), for the trace:
    - esg_only -> keep esg == True.
    - regions_include (non-empty) -> keep region in list or region == 'global'. regions_exclude -> drop region in list.
    - sectors_exclude -> drop sector in list.
    - max_ter -> drop ter > max_ter (unknown TER is kept).
    - distribution 'acc'/'dist' -> keep matching.
    - crypto: drop asset_class == 'crypto' if preferences.crypto_max == 0 or risk_level < config.CRYPTO_MIN_RISK_LEVEL.
    - ucits_only (None -> config.UCITS_DEFAULT[base]) -> drop wrapper == 'etf' funds with ucits False
      (ETPs/ETCs are not UCITS by law but are sold to EU retail, so they pass).
    - hedge_bonds -> among bond funds sharing index_name, if any is hedged_to == base, drop the others.
    - drop funds without any listing.
    Listing choice: currency == base first, then is_primary, then ticker alphabetical.
    Raises NoEligibleFunds if nothing remains.
    """
    p, base = profile.preferences, profile.base_currency
    f = funds
    removed: dict[str, int] = {}

    def keep(key: str, mask: pd.Series) -> None:
        nonlocal f
        removed[key] = int((~mask).sum())
        f = f[mask]

    everything = pd.Series(True, index=f.index)
    keep("esg", f["esg"].astype(bool) if p.esg_only else everything)
    keep("regions_include", f["region"].isin([*p.regions_include, "global"]) if p.regions_include else everything.loc[f.index])
    keep("regions_exclude", ~f["region"].isin(p.regions_exclude))
    keep("sectors_exclude", ~f["sector"].isin(p.sectors_exclude))
    keep("max_ter", ~(f["ter"] > p.max_ter) if p.max_ter is not None else everything.loc[f.index])  # unknown TER stays
    keep("distribution", f["distribution"] == p.distribution if p.distribution != "any" else everything.loc[f.index])
    crypto_off = p.crypto_max == 0 or profile.risk_level < config.CRYPTO_MIN_RISK_LEVEL
    keep("crypto", f["asset_class"] != "crypto" if crypto_off else everything.loc[f.index])
    ucits_only = config.UCITS_DEFAULT[base] if p.ucits_only is None else p.ucits_only
    keep("non_ucits", ~((f["wrapper"] == "etf") & ~f["ucits"].astype(bool)) if ucits_only else everything.loc[f.index])

    before = len(f)
    if p.hedge_bonds:
        bonds = f[f["asset_class"] == "bond"]
        hedged_indices = bonds.loc[bonds["hedged_to"] == base, "index_name"].dropna()
        unhedged_siblings = bonds[bonds["index_name"].isin(hedged_indices) & (bonds["hedged_to"] != base)]
        f = f.drop(index=unhedged_siblings.index)
    f = f.join(_choose_listing(listings, f.index, base), how="inner")
    removed["hedged_duplicates_and_unlisted"] = before - len(f)

    if f.empty:
        raise NoEligibleFunds("no fund matches the investor's preferences")
    f.attrs["removed"] = removed
    return f
