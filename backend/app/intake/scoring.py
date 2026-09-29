"""Lane F. Spec §6."""

from pathlib import Path
from typing import NamedTuple

from app import config
from app.engine.errors import InvalidSettings
from app.engine.types import IntakeScore, Question, Questionnaire

QUESTIONNAIRE_PATH = Path(__file__).with_name("questionnaire.json")

# Capacity points earned by the investment horizon: (inclusive upper bound in years, points).
# Anything above the last bound earns 100.
HORIZON_BANDS = ((2, 0.0), (5, 25.0), (10, 50.0), (20, 75.0))


def load_questionnaire() -> Questionnaire:
    return Questionnaire.model_validate_json(QUESTIONNAIRE_PATH.read_text(encoding="utf-8"))


def horizon_points(years: int) -> float:
    """Capacity points (0-100) for an investment horizon in whole years."""
    for upper, points in HORIZON_BANDS:
        if years <= upper:
            return points
    return 100.0


class _Scored(NamedTuple):
    question: Question
    points: float
    label: str  # human-readable answer, for the explanation


def _score_answer(q: Question, value: str | float) -> _Scored:
    if q.type == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise InvalidSettings(f"question '{q.id}' needs a number")
        lo, hi = q.min, q.max
        if lo is None or hi is None:
            raise InvalidSettings(f"question '{q.id}' has no min/max in the questionnaire")
        if not lo <= value <= hi:
            raise InvalidSettings(f"question '{q.id}' must be between {lo:g} and {hi:g}, got {value:g}")
        if q.feeds != "horizon":
            raise InvalidSettings(f"number question '{q.id}' must feed 'horizon'")
        years = int(value)
        return _Scored(q, horizon_points(years), f"{years} {q.unit or ''}".strip())
    if not isinstance(value, str):
        raise InvalidSettings(f"question '{q.id}' needs one of the option values")
    for option in q.options:
        if option.value == value:
            return _Scored(q, option.points, option.label)
    raise InvalidSettings(f"unknown option '{value}' for question '{q.id}'")


def _explain(limiting: str, capacity: float, tolerance: float, suggested: float, weakest: _Scored | None,
             mismatch: bool) -> str:
    if limiting == "none":
        return (
            f"Your ability to take risk (capacity {capacity:.0f}/100) and your comfort with risk "
            f"(tolerance {tolerance:.0f}/100) point to the same level, so we suggest {suggested:.0f}."
        )
    if limiting == "capacity":
        text = (
            f"Your capacity for risk ({capacity:.0f}/100) is lower than your tolerance ({tolerance:.0f}/100), "
            f"so it sets the suggested level of {suggested:.0f}."
        )
    else:
        text = (
            f"Your tolerance for risk ({tolerance:.0f}/100) is lower than your capacity ({capacity:.0f}/100), "
            f"so it sets the suggested level of {suggested:.0f}."
        )
    if weakest is not None:
        text += f' The most cautious answer on that side was to "{weakest.question.text}": {weakest.label}.'
    if mismatch:
        text += " There is a large gap between the two, so think about which one should guide you."
    return text


def score(answers: dict[str, str | float], questionnaire: Questionnaire) -> IntakeScore:
    """capacity / tolerance 0-100 = mean points of answered questions feeding each;
    suggested_risk_level = min(capacity, tolerance); mismatch = |capacity - tolerance| > config.MISMATCH_GAP;
    limiting_factor = the lower one ('none' if equal); horizon_years from the 'horizon' question.
    Raises InvalidSettings for unknown question ids, unknown option values, or missing required questions."""
    known = {q.id for q in questionnaire.questions}
    unknown = sorted(set(answers) - known)
    if unknown:
        raise InvalidSettings(f"unknown question id(s): {', '.join(unknown)}")
    missing = [q.id for q in questionnaire.questions if q.id not in answers]
    if missing:
        raise InvalidSettings(f"missing answer(s) for: {', '.join(missing)}")

    sides: dict[str, list[_Scored]] = {"capacity": [], "tolerance": []}
    horizon_years: int | None = None
    for q in questionnaire.questions:
        scored = _score_answer(q, answers[q.id])
        if q.feeds == "horizon":
            horizon_years = int(answers[q.id])
            sides["capacity"].append(scored)
        else:
            sides[q.feeds].append(scored)

    if horizon_years is None:
        raise InvalidSettings("questionnaire has no horizon question")
    for side, items in sides.items():
        if not items:
            raise InvalidSettings(f"questionnaire has no {side} questions")

    capacity = sum(s.points for s in sides["capacity"]) / len(sides["capacity"])
    tolerance = sum(s.points for s in sides["tolerance"]) / len(sides["tolerance"])
    suggested = min(capacity, tolerance)
    if abs(capacity - tolerance) < 1e-9:
        limiting = "none"
    else:
        limiting = "capacity" if capacity < tolerance else "tolerance"
    mismatch = abs(capacity - tolerance) > config.MISMATCH_GAP
    weakest = min(sides[limiting], key=lambda s: s.points) if limiting != "none" else None  # first wins ties

    return IntakeScore(
        capacity=round(capacity, 1),
        tolerance=round(tolerance, 1),
        suggested_risk_level=round(suggested, 1),
        limiting_factor=limiting,
        mismatch=mismatch,
        explanation=_explain(limiting, capacity, tolerance, suggested, weakest, mismatch),
        horizon_years=horizon_years,
    )
