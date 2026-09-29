from app.engine.types import Questionnaire


def pick(q: Questionnaire, capacity: str, tolerance: str) -> dict[str, str | float]:
    """Build a full answer set. capacity/tolerance are 'max' or 'min': the answer with the
    highest / lowest points for each question feeding that side (horizon counts as capacity;
    number questions use their max / min)."""
    side = {"capacity": capacity, "horizon": capacity, "tolerance": tolerance}
    answers: dict[str, str | float] = {}
    for question in q.questions:
        top = side[question.feeds] == "max"
        if question.type == "number":
            answers[question.id] = question.max if top else question.min
        else:
            choose = max if top else min
            answers[question.id] = choose(question.options, key=lambda o: o.points).value
    return answers
