import numpy as np
import pandas as pd
import pytest
from sklearn.covariance import ledoit_wolf

from app.engine import risk
from app.engine.errors import InsufficientHistory
from app.engine.risk import covariance

EQ = ["IE00B6R52259", "SYNEUEQ00001", "SYNEMEQ00001", "SYNJPEQ00001", "SYNHLTH00001"]


def _lw(x: pd.DataFrame) -> pd.DataFrame:
    """Independent reference: sklearn Ledoit-Wolf on the raw array, annualised x52."""
    return pd.DataFrame(52 * ledoit_wolf(x.to_numpy())[0], index=x.columns, columns=x.columns)


def test_symmetric_positive_definite_and_labelled(synthetic, weekly_eur):
    cov, dropped = covariance(weekly_eur, 5)
    kept = [c for c in weekly_eur.columns if c != "SYNYOUNG0001"]
    assert dropped == ["SYNYOUNG0001"]
    assert list(cov.index) == kept and list(cov.columns) == kept
    assert np.allclose(cov, cov.T)
    assert np.linalg.eigvalsh(cov.to_numpy()).min() > 0


def test_diagonal_is_close_to_annualised_sample_variance(weekly_eur):
    # shrinkage pulls variances toward their mean, so equality is not expected; equity funds are similar enough
    # for a 15% band.
    cov, _ = covariance(weekly_eur[EQ], 5)
    sample = 52 * weekly_eur[EQ].iloc[-260:].var()
    np.testing.assert_allclose(np.diag(cov), sample.to_numpy(), rtol=0.15)
    assert (cov.to_numpy()[~np.eye(len(EQ), dtype=bool)] > 0).all()  # equities co-move


def test_uses_pypfopt_ledoit_wolf_on_returns_with_frequency_52(monkeypatch, weekly_eur):
    calls = {}
    real = risk.CovarianceShrinkage

    class Spy(real):
        def __init__(self, prices, returns_data=False, frequency=252, **kw):
            calls.update(returns_data=returns_data, frequency=frequency)
            super().__init__(prices, returns_data=returns_data, frequency=frequency, **kw)

    monkeypatch.setattr(risk, "CovarianceShrinkage", Spy)
    cov, _ = covariance(weekly_eur[EQ], 5)
    assert calls == {"returns_data": True, "frequency": 52}
    pd.testing.assert_frame_equal(cov, _lw(weekly_eur[EQ].iloc[-260:]))


@pytest.mark.parametrize("years", [1, 3, 5])
def test_window_is_last_52_weeks_per_year(weekly_eur, years):
    cov, dropped = covariance(weekly_eur[EQ], years)
    assert dropped == []
    pd.testing.assert_frame_equal(cov, _lw(weekly_eur[EQ].iloc[-52 * years :]))


def test_end_bounds_the_window_and_later_rows_are_never_read(weekly_eur):
    end = pd.Timestamp("2020-12-31")
    clean, dropped = covariance(weekly_eur, 5, end=end)
    assert dropped == ["SYNYOUNG0001"]  # no data at all before 2023
    truncated, _ = covariance(weekly_eur.loc[:end], 5)
    pd.testing.assert_frame_equal(clean, truncated)

    corrupted = weekly_eur.copy()
    after = corrupted.index > end
    corrupted.loc[after] = np.random.default_rng(1).normal(0, 5, size=(after.sum(), corrupted.shape[1]))
    garbage, dropped_garbage = covariance(corrupted, 5, end=end)
    pd.testing.assert_frame_equal(clean, garbage)
    assert dropped_garbage == dropped

    expected = _lw(weekly_eur.loc[:end].iloc[-260:].drop(columns="SYNYOUNG0001"))
    pd.testing.assert_frame_equal(clean, expected)


def test_min_coverage_drops_young_fund_in_five_year_window(weekly_eur):
    # SYNYOUNG0001 has ~133 valid weeks of 260 (51% < 80%)
    cov, dropped = covariance(weekly_eur, 5)
    assert dropped == ["SYNYOUNG0001"] and "SYNYOUNG0001" not in cov.columns
    # in a 2-year window it has full coverage and is kept
    cov2, dropped2 = covariance(weekly_eur, 2)
    assert dropped2 == [] and "SYNYOUNG0001" in cov2.columns


def test_partial_coverage_is_kept_and_nan_rows_are_dropped(weekly_eur):
    w = weekly_eur[EQ[:3]].copy()
    w.iloc[-260:-230, 1] = np.nan  # 30 NaN weeks -> 88.5% coverage, above the 80% bar
    cov, dropped = covariance(w, 5)
    assert dropped == []
    pd.testing.assert_frame_equal(cov, _lw(w.iloc[-260:].dropna()))


def test_nothing_usable_raises_no_data(weekly_eur):
    empty = pd.DataFrame(np.nan, index=weekly_eur.index[:300], columns=["A", "B"])
    with pytest.raises(InsufficientHistory):
        covariance(empty, 5)
