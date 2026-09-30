import json

import pytest

from app.engine import pipeline
from app.engine.types import BacktestResult, Frontier, FundDetail, IntakeScore, Questionnaire, Recommendation
from scripts.export_contract import build_mocks


@pytest.fixture(scope="module")
def mocks():
    return build_mocks()


def test_mocks_validate_against_contract(mocks):
    Recommendation.model_validate(mocks["portfolio"])
    BacktestResult.model_validate(mocks["backtest"])
    Frontier.model_validate(mocks["frontier"])
    Questionnaire.model_validate(mocks["questionnaire"])
    IntakeScore.model_validate(mocks["score"])
    FundDetail.model_validate(mocks["fund"])
    assert len(mocks["universe"]) >= 20
    json.dumps(mocks, allow_nan=False)  # valid JSON: no NaN/inf


def test_mocks_come_from_the_real_implementations(mocks):
    assert [s["step"] for s in mocks["portfolio"]["trace"]] == list(pipeline.RECOMMEND_STEPS)
    assert not any("Mock data" in w for w in mocks["portfolio"]["warnings"])
    assert mocks["backtest"]["trace"][-1]["step"] == "backtest"
    assert mocks["questionnaire"]["version"] != "mock" and len(mocks["questionnaire"]["questions"]) >= 5
    assert 0 <= mocks["score"]["suggested_risk_level"] <= 100


def test_backtest_mock_has_both_references(mocks):
    bt = mocks["backtest"]
    assert [r["key"] for r in bt["references"]] == ["world", "sp500"]
    assert all(len(r["values"]) == len(bt["series"]["dates"]) for r in bt["references"])
    assert not any("reference" in w for w in bt["warnings"])


def test_frontier_mock_has_curves_and_every_marker_kind(mocks):
    fr = mocks["frontier"]
    assert len(fr["model_curve"]) >= 5 and len(fr["hindsight_curve"]) >= 5
    assert {m["kind"] for m in fr["markers"]} == {"portfolio", "reference", "strategy", "fund"}
    assert {"world", "sp500"} <= {m["key"] for m in fr["markers"]}
    assert fr["trace"][-1]["step"] == "frontier"
