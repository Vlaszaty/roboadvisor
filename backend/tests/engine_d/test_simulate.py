import numpy as np
import pandas as pd
import pytest

from app.engine.downside import _block_indices, simulate
from app.engine.errors import InvalidSettings, InsufficientHistory


def _history(n: int, mean: float = 0.001, sd: float = 0.02, seed: int = 0) -> pd.Series:
    idx = pd.date_range("1990-01-05", periods=n, freq="W-FRI")
    return pd.Series(np.random.default_rng(seed).normal(mean, sd, n), index=idx)


def _runs(row_continues: np.ndarray, n_weeks: int) -> np.ndarray:
    breaks = np.flatnonzero(~row_continues) + 1  # positions where a new block starts
    return np.diff(np.concatenate([[0], breaks, [n_weeks]]))


def test_block_indices_fixed_length_blocks_wrap_around():
    idx = _block_indices(n_hist=50, n_paths=40, n_weeks=200, block_weeks=(5, 5), rng=np.random.default_rng(0))
    assert idx.shape == (40, 200)
    assert idx.min() >= 0 and idx.max() < 50
    step = np.diff(idx, axis=1)
    continues = (step == 1) | (step == -49)  # -49 = wrap from position 49 back to 0
    assert (step == -49).any()
    for row in continues:
        runs = _runs(row, 200)
        # every completed run is a whole number of 5-week blocks (two blocks can join by chance)
        assert (runs[:-1] % 5 == 0).all()


def test_block_indices_variable_lengths_at_least_minimum():
    idx = _block_indices(n_hist=1000, n_paths=30, n_weeks=520, block_weeks=(4, 13), rng=np.random.default_rng(1))
    step = np.diff(idx, axis=1)
    continues = (step == 1) | (step == -999)
    n_breaks = 0
    for row in continues:
        runs = _runs(row, 520)
        assert (runs[:-1] >= 4).all()
        n_breaks += len(runs) - 1
    # mean block length 8.5 -> about 60 blocks per path; far more than 1
    assert n_breaks > 30 * 20


def test_constant_history_gives_exact_expected_growth():
    # a constant history demeans to 0, then every week earns exactly (1.05)^(1/52) - 1
    hist = pd.Series(0.002, index=pd.date_range("2000-01-07", periods=300, freq="W-FRI"))
    res = simulate(hist, 0.05, 3, [0.1, 0.2], n_paths=200, seed=1)
    assert [p.year for p in res.fan] == [0, 1, 2, 3]
    for p in res.fan:
        for v in (p.p5, p.p25, p.p50, p.p75, p.p95):
            assert v == pytest.approx(1.05**p.year, rel=1e-9)
    assert res.p_below_invested == 0.0
    assert all(p.probability == 0.0 for p in res.drawdown_probs + res.annual_loss_probs)


def test_simulate_is_deterministic_for_a_seed():
    hist = _history(520)
    a = simulate(hist, 0.05, 5, [0.1, 0.2, 0.3], n_paths=1000, seed=3)
    b = simulate(hist, 0.05, 5, [0.1, 0.2, 0.3], n_paths=1000, seed=3)
    c = simulate(hist, 0.05, 5, [0.1, 0.2, 0.3], n_paths=1000, seed=4)
    assert a == b
    assert a != c


def test_simulate_output_shape_and_ordering():
    hist = _history(780, sd=0.025)
    thresholds = [0.1, 0.2, 0.3, 0.4]
    res = simulate(hist, 0.06, 10, thresholds, n_paths=2000, seed=5)
    assert len(res.fan) == 11
    assert res.fan[0].model_dump() == {"year": 0, "p5": 1.0, "p25": 1.0, "p50": 1.0, "p75": 1.0, "p95": 1.0}
    for p in res.fan:
        assert p.p5 <= p.p25 <= p.p50 <= p.p75 <= p.p95
    for probs in (res.drawdown_probs, res.annual_loss_probs):
        assert [p.threshold for p in probs] == thresholds
        values = [p.probability for p in probs]
        assert all(0.0 <= v <= 1.0 for v in values)
        assert values == sorted(values, reverse=True)  # decreasing in threshold
    assert 0.0 <= res.p_below_invested <= 1.0
    # any 10-year path with a -10% calendar-year loss also has a drawdown of at least 10%
    assert res.drawdown_probs[0].probability >= res.annual_loss_probs[0].probability


def test_simulate_median_log_growth_matches_expected_return():
    # history mean (0.3%/week) is replaced by the CAPM expectation (6%/year): median growth
    # ≈ exp(H * (ln(1.06) - sigma^2 / 2)) with sigma = annualised history volatility (15%)
    sigma = 0.15
    hist = _history(52 * 200, mean=0.003, sd=sigma / np.sqrt(52), seed=11)
    res = simulate(hist, 0.06, 10, [0.3], n_paths=4000, seed=2)
    expected_median = np.exp(10 * (np.log(1.06) - sigma**2 / 2))
    assert res.fan[-1].p50 == pytest.approx(expected_median, rel=0.05)


def test_simulate_large_run_is_feasible():
    res = simulate(_history(52 * 20), 0.05, 40, [0.3, 0.4, 0.5], n_paths=10_000, seed=1)
    assert len(res.fan) == 41


def test_simulate_rejects_bad_inputs():
    hist = _history(100)
    with pytest.raises(InvalidSettings):
        simulate(hist, 0.05, 5, [0.3], n_paths=100, block_weeks=(10, 4))
    with pytest.raises(InvalidSettings):
        simulate(hist, 0.05, 0, [0.3], n_paths=100)
    with pytest.raises(InsufficientHistory):
        simulate(pd.Series([np.nan, np.nan]), 0.05, 5, [0.3], n_paths=100)


def test_simulate_needs_52_weeks_of_history():
    with pytest.raises(InsufficientHistory):
        simulate(_history(51), 0.05, 5, [0.3], n_paths=100)
    hist = _history(60)
    hist.iloc[:9] = np.nan  # 51 non-NaN weeks
    with pytest.raises(InsufficientHistory):
        simulate(hist, 0.05, 5, [0.3], n_paths=100)
    assert len(simulate(_history(52), 0.05, 5, [0.3], n_paths=100).fan) == 6


def test_simulate_rejects_zero_paths():
    with pytest.raises(InvalidSettings):
        simulate(_history(100), 0.05, 5, [0.3], n_paths=0)
