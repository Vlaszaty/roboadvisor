import math

import numpy as np
import pandas as pd
import pytest

from app.engine import metrics as m

# Cumulative value 1.1, 0.55, 0.66, 0.726; peak 1.1 -> drawdowns 0, -0.5, -0.4, -0.34 (never recovers)
HAND = pd.Series([0.1, -0.5, 0.2, 0.1], index=pd.date_range("2020-01-03", periods=4, freq="W-FRI"))


def test_drawdown_series_hand_example():
    dd = m.drawdown_series(HAND)
    assert dd.index.equals(HAND.index)
    assert dd.tolist() == pytest.approx([0.0, -0.5, -0.4, -0.34])


def test_max_drawdown_hand_example():
    assert m.max_drawdown(HAND) == pytest.approx(-0.5)


def test_max_drawdown_counts_start_value_as_peak():
    # value 0.9 then 0.81: drawdown measured from the starting value 1.0
    assert m.max_drawdown(pd.Series([-0.1, -0.1])) == pytest.approx(-0.19)


def test_max_drawdown_is_zero_for_rising_series():
    assert m.max_drawdown(pd.Series([0.01, 0.02, 0.0, 0.03])) == 0.0


def test_max_drawdown_duration_unrecovered():
    assert m.max_drawdown_duration(HAND) == 3  # weeks 2, 3, 4 below the 1.1 peak, never recovered


def test_max_drawdown_duration_recovered_episode():
    # values 0.9, 1.08, 1.026, 0.9747, 1.07217, 1.2866: below-peak runs of 1 and 3 weeks
    r = pd.Series([-0.1, 0.2, -0.05, -0.05, 0.1, 0.2])
    assert m.max_drawdown_duration(r) == 3


def test_max_drawdown_duration_unrecovered_tail_is_longest():
    r = pd.Series([-0.1, 0.2, -0.01, -0.01, -0.01, -0.01])
    assert m.max_drawdown_duration(r) == 4


def test_max_drawdown_duration_zero_for_rising_series():
    assert m.max_drawdown_duration(pd.Series([0.01, 0.02, 0.03])) == 0


def test_cagr_constant_weekly_return():
    r = pd.Series([0.001] * 104)
    assert m.cagr(r) == pytest.approx(1.001**52 - 1)


def test_cagr_hand_example():
    assert m.cagr(HAND) == pytest.approx(0.726 ** (52 / 4) - 1)


def test_cagr_ignores_nan():
    assert m.cagr(pd.Series([0.001, np.nan, 0.001])) == pytest.approx(1.001**52 - 1)


def test_volatility_of_constant_series_is_zero():
    assert m.volatility(pd.Series([0.01] * 20)) == pytest.approx(0.0, abs=1e-12)


def test_volatility_is_annualised_sample_std():
    r = pd.Series([0.02, 0.0] * 26)
    assert m.volatility(r) == pytest.approx(0.01 * math.sqrt(52 / 51) * math.sqrt(52))


def test_sharpe_with_constant_rf():
    # mean 0.01, sample std 0.01*sqrt(52/51); excess mean 0.009 -> 0.009*52 / (0.01*sqrt(52/51)*sqrt(52)) = 0.9*sqrt(51)
    r = pd.Series([0.02, 0.0] * 26, index=pd.date_range("2020-01-03", periods=52, freq="W-FRI"))
    assert m.sharpe(r, 0.001) == pytest.approx(0.9 * math.sqrt(51))
    rf = pd.Series(0.001, index=r.index)
    assert m.sharpe(r, rf) == pytest.approx(0.9 * math.sqrt(51))


def test_sharpe_is_nan_for_zero_volatility():
    assert math.isnan(m.sharpe(pd.Series([0.01] * 10)))


def test_sortino_hand_example():
    # mean 0.01; downside deviation sqrt((0.02^2 + 0.02^2) / 4) = sqrt(0.0002)
    # sortino = 0.01*52 / (sqrt(0.0002)*sqrt(52)) = sqrt(26)
    r = pd.Series([0.04, -0.02, 0.04, -0.02])
    assert m.sortino(r) == pytest.approx(math.sqrt(26))


def test_sortino_only_penalises_downside():
    # same mean (0.01) and same losing weeks; b has much more upside dispersion
    a = pd.Series([0.04, -0.02, 0.04, -0.02])
    b = pd.Series([0.08, -0.02, 0.00, -0.02])
    assert m.sortino(a) == pytest.approx(m.sortino(b))
    assert m.sharpe(b) < m.sharpe(a)


def test_sortino_nan_without_downside():
    assert math.isnan(m.sortino(pd.Series([0.01, 0.02, 0.03])))


def test_cvar_on_known_values():
    values = np.arange(-50, 50) / 100  # -0.50 .. 0.49, 100 values
    r = pd.Series(np.random.default_rng(0).permutation(values))
    # worst 5% = -0.50, -0.49, -0.48, -0.47, -0.46
    assert m.cvar(r, 0.95) == pytest.approx(-0.48)
    # worst 10% = -0.50 .. -0.41
    assert m.cvar(r, 0.90) == pytest.approx(-0.455)


def test_cvar_uses_at_least_one_observation():
    assert m.cvar(pd.Series([0.01, -0.03, 0.02]), 0.95) == pytest.approx(-0.03)


def test_calmar_is_cagr_over_abs_max_drawdown():
    assert m.calmar(HAND) == pytest.approx(m.cagr(HAND) / 0.5)


def test_calmar_nan_without_drawdown():
    assert math.isnan(m.calmar(pd.Series([0.01, 0.02])))


def test_beta_of_double_series_is_two():
    x = pd.Series(np.random.default_rng(1).normal(0, 0.02, 200))
    assert m.beta(2 * x, x) == pytest.approx(2.0)


def test_beta_aligns_and_drops_nan():
    x = pd.Series(np.random.default_rng(2).normal(0, 0.02, 200))
    y = 2 * x
    y.iloc[:10] = np.nan
    assert m.beta(y, x) == pytest.approx(2.0)


def test_drawdown_series_keeps_input_index_with_nan():
    # Lane E needs the same index as the input; a missing week carries the previous drawdown
    r = pd.Series([np.nan, 0.1, np.nan, -0.5, 0.2], index=pd.date_range("2020-01-03", periods=5, freq="W-FRI"))
    dd = m.drawdown_series(r)
    assert dd.index.equals(r.index)
    assert dd.tolist() == pytest.approx([0.0, 0.0, 0.0, -0.5, -0.4])


def test_cagr_total_loss_is_minus_one():
    assert m.cagr(pd.Series([0.1, -1.0, 0.05])) == -1.0
