from app import config
from app.data import ingest

# Verified 2026-09-29 against issuer/Yahoo/justETF data (see plan Task 6). Changing an anchor means re-verifying it.
VERIFIED = {
    "EUR": {"global_equity": "IE00B6R52259",  # iShares MSCI ACWI UCITS ETF USD (Acc), IUSQ
            "global_bonds": "IE00BDBRDM35"},  # iShares Core Global Aggregate Bond UCITS ETF EUR Hedged (Acc), AGGH
    "USD": {"global_equity": "US4642882579",  # iShares MSCI ACWI ETF, ACWI
            "global_bonds": "US92206C5655"},  # Vanguard Total World Bond ETF (USD hedged), BNDW
}


def test_anchors_are_the_verified_isins():
    assert config.ANCHORS == VERIFIED


def test_anchor_isins_have_valid_check_digits():
    for anchors in config.ANCHORS.values():
        for isin in anchors.values():
            assert ingest.is_valid_isin(isin), isin
