import json

from app.engine.types import BacktestResult, FundDetail, IntakeScore, Questionnaire, Recommendation
from scripts.export_contract import build_mocks


def test_mocks_validate_against_contract():
    mocks = build_mocks()
    Recommendation.model_validate(mocks["portfolio"])
    BacktestResult.model_validate(mocks["backtest"])
    Questionnaire.model_validate(mocks["questionnaire"])
    IntakeScore.model_validate(mocks["score"])
    FundDetail.model_validate(mocks["fund"])
    assert len(mocks["universe"]) >= 20
    json.dumps(mocks)  # serialisable
