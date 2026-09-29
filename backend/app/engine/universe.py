"""Lane B. Spec §5.1."""

import pandas as pd

from app.engine.types import InvestorProfile


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
    raise NotImplementedError("Lane B")
