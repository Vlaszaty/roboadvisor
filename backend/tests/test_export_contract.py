import json

import pytest

from app.engine import pipeline
from app.engine.types import BacktestResult, FundDetail, IntakeScore, Questionnaire, Recommendation
from scripts.export_contract import build_mocks


@pytest.fixture(scope="module")
def mocks():
    return build_mocks()


def test_mocks_validate_against_contract(mocks):
    Recommendation.model_validate(mocks["portfolio"])
    BacktestResult.model_validate(mocks["backtest"])
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
