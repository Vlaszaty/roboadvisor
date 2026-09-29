from functools import lru_cache

from fastapi import APIRouter

from app.api.schemas import IntakeAnswers, IntakeScore, Questionnaire
from app.intake import scoring

router = APIRouter(prefix="/intake", tags=["intake"])


@lru_cache(maxsize=1)
def _questionnaire() -> Questionnaire:
    # Read the JSON once per process; callers must not mutate the returned model.
    return scoring.load_questionnaire()


@router.get("/questionnaire", response_model=Questionnaire)
def questionnaire() -> Questionnaire:
    return _questionnaire()


@router.post("/score", response_model=IntakeScore)
def score(body: IntakeAnswers) -> IntakeScore:
    return scoring.score(body.answers, _questionnaire())
