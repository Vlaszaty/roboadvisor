import numpy as np
import pandas as pd
import pytest
from scipy.stats import norm

from app.engine.downside import normal_comparison, simulate
from app.engine.errors import InvalidSettings

MU, SIGMA, H = 0.06, 0.15, 10
THRESHOLDS = [0.1, 0.2, 0.3]


def test_annual_loss_matches_scipy_formula():
    res = normal_comparison(MU, SIGMA, H, THRESHOLDS, n_paths=500, seed=0)
    for point, t in zip(res.annual_loss_probs, THRESHOLDS):
        p_year = norm.cdf(np.log(1 - t), loc=np.log(1 + MU) - SIGMA**2 / 2, scale=SIGMA)
        assert point.threshold == t
        assert point.probability == pytest.approx(1 - (1 - p_year) ** H, rel=1e-12)


def test_annual_loss_known_values():
    # z = (ln(0.9) - (ln(1.06) - 0.01125)) / 0.15 ≈ -1.016 -> p ≈ 0.155 -> any of 10 years ≈ 0.81
    res = normal_comparison(MU, SIGMA, H, [0.1], n_paths=500, seed=0)
    assert res.annual_loss_probs[0].probability == pytest.approx(0.81, abs=0.01)


def test_normal_drawdown_probs_valid_and_decreasing():
    res = normal_comparison(MU, SIGMA, H, THRESHOLDS, n_paths=2000, seed=1)
    values = [p.probability for p in res.drawdown_probs]
    assert [p.threshold for p in res.drawdown_probs] == THRESHOLDS
    assert all(0.0 <= v <= 1.0 for v in values)
    assert values == sorted(values, reverse=True)


def test_normal_comparison_is_deterministic():
    a = normal_comparison(MU, SIGMA, H, THRESHOLDS, n_paths=1000, seed=9)
    b = normal_comparison(MU, SIGMA, H, THRESHOLDS, n_paths=1000, seed=9)
    assert a == b


def test_normal_comparison_rejects_zero_sigma():
    with pytest.raises(InvalidSettings):
        normal_comparison(MU, 0.0, H, THRESHOLDS, n_paths=100)


def test_monte_carlo_matches_analytic_on_normal_data():
    # i.i.d. normal weekly returns whose arithmetic mean compounds to 6%/year and whose volatility is 15%/year.
    # Bootstrapping i.i.d. data keeps it i.i.d., so the bootstrap must reproduce the normal model.
    # Why the margin is thin (annual loss at t=0.2: MC 0.277 vs analytic 0.306): this seeded sample has slightly
    # negative autocorrelation (lag-1..3 ≈ -0.009, -0.005, -0.003), which the 4-13 week blocks preserve. The
    # bootstrap's 52-week variance is about 0.96-0.97 of 52 x weekly variance (measured 0.962 ± 0.002), so
    # annual losses are a little thinner-tailed and MC sits systematically slightly BELOW the analytic value.
    # That is sampling noise in the history, not a bug; the tolerances cover it.
    n = 52 * 200
    weekly_mean = 1.06 ** (1 / 52) - 1
    hist = pd.Series(
        np.random.default_rng(1).normal(weekly_mean, SIGMA / np.sqrt(52), n),
        index=pd.date_range("1900-01-05", periods=n, freq="W-FRI"),
    )
    mc = simulate(hist, MU, H, THRESHOLDS, n_paths=4000, seed=7)
    normal = normal_comparison(MU, SIGMA, H, THRESHOLDS, n_paths=4000, seed=7)
    for sim, ana in zip(mc.annual_loss_probs, normal.annual_loss_probs):
        assert sim.probability == pytest.approx(ana.probability, abs=0.04), sim.threshold
    for sim, gbm in zip(mc.drawdown_probs, normal.drawdown_probs):
        assert sim.probability == pytest.approx(gbm.probability, abs=0.05), sim.threshold
