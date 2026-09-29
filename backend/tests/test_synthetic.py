import numpy as np
import pandas as pd

from app.engine.types import FUND_COLUMNS, LISTING_COLUMNS
from tests.fixtures.synthetic import ANCHOR_ISINS


def test_shapes(synthetic):
    funds, listings = synthetic.funds(), synthetic.listings()
    assert list(funds.columns) == FUND_COLUMNS and funds.index.is_unique
    assert list(listings.columns) == LISTING_COLUMNS
    assert set(listings["isin"]) <= set(funds.index)
    assert set(ANCHOR_ISINS) <= set(funds.index)


def test_prices_and_fx(synthetic):
    px = synthetic.prices(["IUSQ.DE", "NOPE", "SYN-EQ"])
    assert list(px.columns) == ["IUSQ.DE", "NOPE", "SYN-EQ"]
    assert px["NOPE"].isna().all()
    assert px["IUSQ.DE"].first_valid_index() == pd.Timestamp("2011-10-21")
    assert px["SYN-EQ"].first_valid_index() == pd.Timestamp("2005-01-03")
    assert (synthetic.fx()["USD"] == 1.0).all()
    assert synthetic.rf("EUR").index.equals(synthetic.fx().index)


def test_gfc_crash_is_visible(synthetic):
    eq = synthetic.prices(["SYN-EQ"])["SYN-EQ"]
    assert eq["2009-03-09"] / eq["2008-09-12"] - 1 < -0.2


def test_weekly_reference(weekly_eur):
    assert weekly_eur.index.freqstr == "W-FRI"
    assert weekly_eur["SYNBTC000001"][:"2014-09-01"].isna().all()
    assert weekly_eur["SYNYOUNG0001"][:"2023-05-01"].isna().all()
    assert np.isfinite(weekly_eur["IE00B6R52259"]).all()


def test_deterministic():
    from tests.fixtures.synthetic import SyntheticData

    a, b = SyntheticData(), SyntheticData()
    pd.testing.assert_frame_equal(a.prices(["SUSE"]), b.prices(["SUSE"]))
