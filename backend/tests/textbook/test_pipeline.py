import json
import math
import time

import pytest

from app import config
from app.engine import pipeline
from app.engine.errors import InsufficientHistory
from app.engine.textbook import textbook
from tests.fixtures.synthetic import SYN_TEXTBOOK_FUNDS

RISKY = list(SYN_TEXTBOOK_FUNDS["EUR"]["risky"].values())
RF_FUND = SYN_TEXTBOOK_FUNDS["EUR"]["risk_free"]


@pytest.fixture
def tb_funds(monkeypatch):
    monkeypatch.setattr(config, "TEXTBOOK_FUNDS", SYN_TEXTBOOK_FUNDS)


def _tb(data, risk=50.0, model="capm", premium=None):
    return textbook("EUR", risk, model, premium, data)


def test_funds_come_back_in_config_order_with_their_block(synthetic, tb_funds):
    res = _tb(synthetic)
    assert [f.isin for f in res.funds] == RISKY
    assert [f.block for f in res.funds] == list(SYN_TEXTBOOK_FUNDS["EUR"]["risky"])
    assert res.risk_free_fund.isin == RF_FUND
    assert res.inputs.frequency == "weekly" and res.inputs.weeks == 260
    assert res.inputs.market["isin"] == config.ANCHORS["EUR"]["global_equity"]


def test_stats_and_correlation_match_a_hand_computation(synthetic, tb_funds):
    res = _tb(synthetic)
    market = config.ANCHORS["EUR"]["global_equity"]
    rows = pipeline._listing_rows(synthetic.funds(), synthetic.listings(), "EUR", [*RISKY, market],
                                  error=InsufficientHistory, what="test")
    r = pipeline._weekly(rows, "EUR", synthetic).returns.iloc[-260:].dropna()
    first = res.funds[0]
    assert first.mean_return == pytest.approx(r[first.isin].mean() * 52, abs=1e-5)
    assert first.volatility == pytest.approx(r[first.isin].std() * math.sqrt(52), abs=1e-5)
    assert res.correlation.isins == RISKY
    assert res.correlation.matrix[0][1] == pytest.approx(r[RISKY[0]].corr(r[RISKY[1]]), abs=1e-5)
    assert all(res.correlation.matrix[k][k] == pytest.approx(1.0) for k in range(7))
    assert str(res.inputs.window["end"]) == str(r.index[-1].date())


def test_capm_return_is_rf_plus_beta_times_premium(synthetic, tb_funds):
    res = _tb(synthetic, premium=0.04)
    assert res.inputs.premium == 0.04
    for f in res.funds:
        assert f.capm_return == pytest.approx(res.inputs.rf + f.beta * 0.04, abs=1e-5)
        assert f.expected_return == f.capm_return


def test_default_premium_comes_from_config(synthetic, tb_funds):
    assert _tb(synthetic).inputs.premium == config.TEXTBOOK_PREMIUM


def test_historical_model_uses_the_average_return(synthetic, tb_funds):
    res = _tb(synthetic, model="historical")
    assert res.inputs.return_model == "historical"
    assert all(f.expected_return == f.mean_return for f in res.funds)
    json.dumps(res.model_dump(mode="json"), allow_nan=False)  # finite even when one fund dominates
    assert res.frontier and abs(sum(res.portfolio.weights.values()) - 1) < 1e-4


def test_tangent_has_the_best_sharpe_ratio(synthetic, tb_funds):
    res = _tb(synthetic)
    assert res.tangent is not None
    assert sum(res.tangent.weights.values()) == pytest.approx(1.0, abs=1e-4)
    assert all(w > 0 for w in res.tangent.weights.values())
    assert len(res.frontier) >= 5
    vols = [p.volatility for p in res.frontier]
    assert vols == sorted(vols)
    best_on_curve = max(p.sharpe for p in res.frontier if p.sharpe is not None)
    assert res.tangent.sharpe >= best_on_curve - 1e-3
    assert [p.volatility for p in res.capital_market_line] == [0.0, res.tangent.volatility]


def test_split_and_final_portfolio(synthetic, tb_funds):
    res = _tb(synthetic, risk=0)  # A = 10: the cautious end, share well below 100%
    t, s, p = res.tangent, res.split, res.portfolio
    assert s.risk_aversion == 10.0 == res.inputs.risk_aversion
    expected_share = (t.expected_return - res.inputs.rf) / (10.0 * t.volatility**2)
    assert s.risky_share_uncapped == pytest.approx(expected_share, abs=1e-4)
    assert 0 < s.risky_share < 1 and s.risky_share == pytest.approx(min(expected_share, 1.0), abs=1e-4)
    assert sum(p.weights.values()) == pytest.approx(1.0, abs=1e-4)
    assert p.weights[RF_FUND] == pytest.approx(1 - s.risky_share, abs=1e-4)
    assert p.volatility == pytest.approx(s.risky_share * t.volatility, abs=1e-5)
    assert p.expected_return == pytest.approx(res.inputs.rf + s.risky_share * (t.expected_return - res.inputs.rf), abs=1e-5)
    assert p.sharpe == t.sharpe


def test_adventurous_investor_is_capped_at_the_tangent_portfolio(synthetic, tb_funds):
    res = _tb(synthetic, risk=100, premium=0.15)  # A = 2 and a high premium: the formula asks for more than 100%
    assert res.split.risky_share_uncapped > 1 and res.split.risky_share == 1.0
    assert RF_FUND not in res.portfolio.weights
    assert res.portfolio.volatility == pytest.approx(res.tangent.volatility, abs=1e-5)


def test_no_fund_above_the_risk_free_rate_means_all_in_the_risk_free_fund(synthetic, tb_funds):
    res = _tb(synthetic, premium=0.0)  # CAPM with a zero premium: every fund is expected to earn rf
    assert res.tangent is None and res.capital_market_line == []
    assert len(res.frontier) == 1
    assert res.split.risky_share == 0.0
    assert res.portfolio.weights == {RF_FUND: 1.0}
    assert res.portfolio.volatility == 0.0 and res.portfolio.sharpe is None
    assert any("risk-free" in w for w in res.warnings)


def test_missing_fund_is_named(synthetic, monkeypatch):
    broken = {"EUR": {"risky": {**SYN_TEXTBOOK_FUNDS["EUR"]["risky"], "Gold": "XX0000000000"}, "risk_free": RF_FUND}}
    monkeypatch.setattr(config, "TEXTBOOK_FUNDS", broken)
    with pytest.raises(InsufficientHistory, match="XX0000000000"):
        _tb(synthetic)


@pytest.mark.skipif(not config.DB_PATH.exists(), reason="real database not present")
def test_real_db_fund_sets_have_full_own_history_and_answer_fast():
    from app.api.deps import get_data

    data = get_data()
    for base in ("EUR", "USD"):
        textbook(base, 50, "capm", None, data)  # cold: loads the data caches
        t = time.perf_counter()
        res = textbook(base, 50, "capm", None, data)
        elapsed = time.perf_counter() - t
        assert len(res.funds) == 7 and res.inputs.weeks >= 250, base
        assert not any("proxy" in w for w in res.warnings), res.warnings
        assert elapsed <= 1.0, f"{base} warm {elapsed:.2f}s"
