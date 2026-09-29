import pytest

from app import config
from app.engine.errors import InvalidSettings
from app.engine.types import Question, QuestionOption, Questionnaire
from app.intake.scoring import horizon_points, load_questionnaire, score
from tests.intake.helpers import pick

REAL = load_questionnaire()


def _opts(*pairs: tuple[str, float]) -> list[QuestionOption]:
    return [QuestionOption(label=v.capitalize() + " answer", value=v, points=p) for v, p in pairs]


MINI = Questionnaire(
    version="test",
    questions=[
        Question(id="horizon", text="How many years?", type="number", feeds="horizon", min=1, max=40, unit="years"),
        Question(
            id="buffer", text="How big is your emergency buffer?", type="single", feeds="capacity",
            options=_opts(("low", 0), ("mid", 50), ("high", 100)),
        ),
        Question(
            id="reaction", text="What would you do in a crash?", type="single", feeds="tolerance",
            options=[
                QuestionOption(label="Sell everything", value="sell", points=0),
                QuestionOption(label="Sit tight", value="mid", points=50),
                QuestionOption(label="Stay calm", value="calm", points=70),
                QuestionOption(label="Buy a bit more", value="bold", points=75),
                QuestionOption(label="Buy a lot more", value="hold", points=100),
            ],
        ),
    ],
)


@pytest.mark.parametrize(
    "years,expected",
    [(1, 0), (2, 0), (3, 25), (5, 25), (6, 50), (10, 50), (11, 75), (20, 75), (21, 100), (40, 100)],
)
def test_horizon_bands(years, expected):
    assert horizon_points(years) == expected


def test_all_max_answers_give_100_and_no_mismatch():
    r = score(pick(REAL, "max", "max"), REAL)
    assert (r.capacity, r.tolerance, r.suggested_risk_level) == (100, 100, 100)
    assert r.limiting_factor == "none"
    assert r.mismatch is False
    assert r.horizon_years == 40


def test_all_min_answers_give_zero():
    r = score(pick(REAL, "min", "min"), REAL)
    assert (r.capacity, r.tolerance, r.suggested_risk_level) == (0, 0, 0)
    assert r.limiting_factor == "none"


def test_conservative_capacity_aggressive_tolerance_real_questionnaire():
    r = score(pick(REAL, "min", "max"), REAL)
    assert r.capacity == 0 and r.tolerance == 100
    assert r.suggested_risk_level == 0
    assert r.limiting_factor == "capacity"
    assert r.mismatch is True
    assert r.horizon_years == 1


def test_aggressive_capacity_conservative_tolerance_real_questionnaire():
    r = score(pick(REAL, "max", "min"), REAL)
    assert r.limiting_factor == "tolerance"
    assert r.suggested_risk_level == r.tolerance == 0
    assert r.mismatch is True


def test_equal_scores_have_no_limiting_factor():
    # horizon 8 -> 50 points, buffer mid -> 50: capacity 50. reaction mid -> tolerance 50.
    r = score({"horizon": 8, "buffer": "mid", "reaction": "mid"}, MINI)
    assert (r.capacity, r.tolerance, r.suggested_risk_level) == (50, 50, 50)
    assert r.limiting_factor == "none"
    assert r.mismatch is False
    assert "same level" in r.explanation


def test_capacity_is_mean_of_answers_including_horizon_points():
    # horizon 15 -> 75 points, buffer low -> 0: capacity 37.5
    r = score({"horizon": 15, "buffer": "low", "reaction": "hold"}, MINI)
    assert r.capacity == 37.5
    assert r.tolerance == 100
    assert r.suggested_risk_level == 37.5
    assert r.limiting_factor == "capacity"
    assert r.mismatch is True


def test_gap_of_exactly_mismatch_gap_is_not_a_mismatch():
    r = score({"horizon": 8, "buffer": "mid", "reaction": "calm"}, MINI)  # 50 vs 70
    assert r.tolerance - r.capacity == config.MISMATCH_GAP
    assert r.mismatch is False
    assert r.limiting_factor == "capacity"


def test_gap_above_mismatch_gap_is_a_mismatch():
    r = score({"horizon": 8, "buffer": "mid", "reaction": "bold"}, MINI)  # 50 vs 75
    assert r.mismatch is True


def test_horizon_years_is_int_of_answer():
    r = score({"horizon": 7.9, "buffer": "mid", "reaction": "mid"}, MINI)
    assert r.horizon_years == 7
    assert isinstance(r.horizon_years, int)


def test_explanation_names_limiting_capacity_question():
    r = score({"horizon": 30, "buffer": "low", "reaction": "hold"}, MINI)
    assert "your finances can carry" in r.explanation
    assert "How big is your emergency buffer?" in r.explanation
    assert "Low answer" in r.explanation
    assert "What would you do in a crash?" not in r.explanation


def test_explanation_names_limiting_tolerance_question():
    r = score({"horizon": 40, "buffer": "high", "reaction": "sell"}, MINI)
    assert r.limiting_factor == "tolerance"
    assert "comfortable with" in r.explanation
    assert "capacity" not in r.explanation.lower()
    assert "What would you do in a crash?" in r.explanation
    assert "Sell everything" in r.explanation


def test_explanation_can_name_the_horizon_question():
    r = score({"horizon": 1, "buffer": "high", "reaction": "hold"}, MINI)  # capacity (0 + 100) / 2
    assert "How many years?" in r.explanation
    assert "1 year" in r.explanation
    assert "1 years" not in r.explanation


def test_explanation_mentions_mismatch():
    r = score({"horizon": 30, "buffer": "low", "reaction": "hold"}, MINI)
    assert "large gap" in r.explanation
    calm = score({"horizon": 8, "buffer": "mid", "reaction": "mid"}, MINI)
    assert "large gap" not in calm.explanation


def test_scoring_is_deterministic():
    a = pick(REAL, "max", "min")
    assert score(a, REAL) == score(dict(a), REAL)


def test_unknown_question_id():
    with pytest.raises(InvalidSettings, match="unknown question"):
        score({"horizon": 8, "buffer": "mid", "reaction": "mid", "nope": "x"}, MINI)


def test_unknown_option_value():
    with pytest.raises(InvalidSettings, match="unknown option"):
        score({"horizon": 8, "buffer": "enormous", "reaction": "mid"}, MINI)


def test_missing_question():
    with pytest.raises(InvalidSettings, match="missing answer"):
        score({"horizon": 8, "buffer": "mid"}, MINI)


@pytest.mark.parametrize("bad", [0, 0.5, 41, 100, -3])
def test_number_out_of_range(bad):
    with pytest.raises(InvalidSettings, match="between 1 and 40"):
        score({"horizon": bad, "buffer": "mid", "reaction": "mid"}, MINI)


def test_number_answer_must_be_a_number():
    with pytest.raises(InvalidSettings, match="needs a number"):
        score({"horizon": "10", "buffer": "mid", "reaction": "mid"}, MINI)


def test_boolean_is_not_a_number():
    with pytest.raises(InvalidSettings, match="needs a number"):
        score({"horizon": True, "buffer": "mid", "reaction": "mid"}, MINI)


def test_single_answer_must_be_a_string():
    with pytest.raises(InvalidSettings, match="needs one of the option values"):
        score({"horizon": 8, "buffer": 50, "reaction": "mid"}, MINI)


def test_questionnaire_without_horizon_question_is_invalid():
    no_horizon = Questionnaire(version="t", questions=MINI.questions[1:])
    with pytest.raises(InvalidSettings, match="horizon"):
        score({"buffer": "mid", "reaction": "mid"}, no_horizon)


def test_questionnaire_without_tolerance_question_is_invalid():
    no_tol = Questionnaire(version="t", questions=MINI.questions[:2])
    with pytest.raises(InvalidSettings, match="tolerance"):
        score({"horizon": 8, "buffer": "mid"}, no_tol)


def test_single_question_feeding_horizon_is_invalid():
    bad = Questionnaire(
        version="t",
        questions=[
            Question(id="horizon", text="Horizon?", type="single", feeds="horizon", options=_opts(("a", 0), ("b", 100))),
            MINI.questions[2],
        ],
    )
    with pytest.raises(InvalidSettings, match="horizon"):
        score({"horizon": "a", "reaction": "mid"}, bad)
