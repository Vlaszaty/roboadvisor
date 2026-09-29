from fastapi import APIRouter

from app.api.schemas import IntakeAnswers, IntakeScore, Questionnaire
from app.intake import scoring

router = APIRouter(prefix="/intake", tags=["intake"])


@router.get("/questionnaire", response_model=Questionnaire)
def questionnaire() -> Questionnaire:
    raise NotImplementedError("Lane F")


@router.post("/score", response_model=IntakeScore)
def score(body: IntakeAnswers) -> IntakeScore:
    raise NotImplementedError("Lane F")
