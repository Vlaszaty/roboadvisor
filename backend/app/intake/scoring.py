"""Lane F. Spec §6."""

from pathlib import Path

from app.engine.types import IntakeScore, Questionnaire

QUESTIONNAIRE_PATH = Path(__file__).with_name("questionnaire.json")


def load_questionnaire() -> Questionnaire:
    return Questionnaire.model_validate_json(QUESTIONNAIRE_PATH.read_text())


def score(answers: dict[str, str | float], questionnaire: Questionnaire) -> IntakeScore:
    """Every question is required.
    capacity = mean points of the capacity questions plus the horizon question (horizon years mapped to points by
    fixed bands defined in this module); tolerance = mean points of the tolerance questions (0-100 each).
    suggested_risk_level = min(capacity, tolerance); mismatch = |capacity - tolerance| > config.MISMATCH_GAP (strict);
    limiting_factor = the lower one ('none' if equal); horizon_years = int(horizon answer).
    Raises InvalidSettings for unknown question ids, unknown option values, missing questions, wrong answer types
    or numbers outside [min, max]. load_questionnaire stays a plain (uncached) function."""
    raise NotImplementedError("Lane F")
