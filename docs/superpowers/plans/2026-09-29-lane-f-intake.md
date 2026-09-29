# Lane F — Intake Questionnaire and Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the real intake questionnaire (10 questions, version "1"), the deterministic scoring function that turns answers into capacity / tolerance / suggested risk level, and the two `/api/intake/*` route bodies.

**Architecture:** `questionnaire.json` is plain data validated by the frozen `Questionnaire` model. `scoring.score()` is a pure function: capacity = mean points of the capacity questions plus horizon-derived points (banded), tolerance = mean points of the tolerance questions, suggested = min of the two. The routes are thin wrappers; the questionnaire is cached in `api/intake.py` with `functools.lru_cache`. No data source is needed, so nothing in this lane touches the database or the engine.

**Tech Stack:** Python 3.12, uv, FastAPI, Pydantic v2, pytest (all already installed by Phase 0; no new dependencies).

**Spec:** `docs/superpowers/specs/2026-09-29-roboadvisor-design.md` (§6 Intake, §7 API). Builds on `docs/superpowers/plans/2026-09-29-phase0-contracts.md` as merged (git tag `phase0-contracts`).

## Global Constraints

- Python tooling is **uv** only: `uv sync`, `uv add`, `uv run pytest`, `uv run python -m ...`. Python pinned to **3.12**. Never use pip or a hand-made venv.
- Backend port **8740**, frontend port **5740** with Vite `strictPort: true`; Vite proxies `/api` → `http://localhost:8740`.
- All API routes live under `/api`. The API is stateless.
- Engine modules (`app/engine/*`) never import FastAPI, sqlite3 or `app.data`.
- All engine return series are **weekly (W-FRI)**, simple returns, base currency, columns = ISIN. Annualisation factor 52.
- Base currencies: `EUR`, `USD`.
- Drawdowns and losses are **negative numbers** (−0.35 = −35%). Thresholds are positive (0.3 means "−30% or worse").
- No network access in tests.
- Only Phase 0 adds Python/npm dependencies. Lanes that need one must escalate.
- Contract files created in Phase 0 (`config.py` structure, `engine/types.py`, `engine/errors.py`, `api/schemas.py`, `data/schema.sql`, route signatures, stub signatures) are frozen; changes go through the integrator. If something in them blocks this lane, stop and escalate.
- Lane F may touch ONLY: `backend/app/intake/questionnaire.json`, `backend/app/intake/scoring.py`, the route bodies in `backend/app/api/intake.py`, and new files under `backend/tests/intake/`.

## Design decisions (read before starting)

- **All questions are required.** The frozen `Question` model has no `required` flag; a missing answer raises `InvalidSettings`.
- **Horizon** is a `number` question (`feeds: "horizon"`, 1–40 years). It gives `horizon_years = int(answer)` and also contributes capacity points through fixed bands (inclusive upper bounds): 1–2 years → 0, 3–5 → 25, 6–10 → 50, 11–20 → 75, over 20 → 100. It counts as one capacity question in the mean.
- **Rounding:** `capacity`, `tolerance`, `suggested_risk_level` are rounded to 1 decimal in the output; `limiting_factor` and `mismatch` are decided on unrounded values. `mismatch = abs(capacity - tolerance) > config.MISMATCH_GAP` (a gap of exactly 20 is NOT a mismatch). Limiting factor is `"none"` when the two are equal within 1e-9.
- **Explanation** names the limiting side and quotes the weakest answer (lowest points; the first one in questionnaire order on ties) on that side.
- **Caching:** `scoring.load_questionnaire` stays an undecorated plain function (Phase 0's `test_contract.py` checks `inspect.isfunction` on it, which is False for an `lru_cache` wrapper). The cache lives in a private helper in `api/intake.py`.
- **Phase 2 note:** the frontend mock `frontend/src/mocks/questionnaire.json` (Phase 0) is a placeholder. In Phase 2 the integrator must replace it with the real questionnaire (e.g. via the export script) and refresh the mock score response.

## File structure

| File | Responsibility |
|---|---|
| `backend/app/intake/questionnaire.json` | The 10 questions, options and points (data only) |
| `backend/app/intake/scoring.py` | `load_questionnaire`, `horizon_points`, `score` |
| `backend/app/api/intake.py` | Route bodies for the two intake endpoints |
| `backend/tests/intake/__init__.py` | Empty |
| `backend/tests/intake/helpers.py` | `pick()` builds max/min answer sets from a questionnaire |
| `backend/tests/intake/test_questionnaire.py` | Structure validation of the JSON |
| `backend/tests/intake/test_scoring.py` | Scoring logic and errors |
| `backend/tests/intake/test_api.py` | TestClient tests of both routes |

---

### Task 1: The questionnaire

**Files:**
- Modify: `backend/app/intake/questionnaire.json`
- Create: `backend/tests/intake/__init__.py` (empty), `backend/tests/intake/helpers.py`
- Test: `backend/tests/intake/test_questionnaire.py`

**Interfaces:**
- Consumes: `app.intake.scoring.load_questionnaire() -> Questionnaire` (Phase 0 stub, already works); `app.engine.types.{Questionnaire, Question, QuestionOption}`.
- Produces: `questionnaire.json` version `"1"` with these ids and feeds. Capacity: `horizon` (number, feeds `horizon`), `income_stability`, `wealth_share`, `emergency_buffer`, `withdrawals`. Tolerance: `drop_reaction`, `tradeoff`, `experience`, `self_assessment`, `max_loss`. Also `tests.intake.helpers.pick(q, capacity, tolerance) -> dict[str, str | float]`.

- [ ] **Step 1: Create the test package and helper**

`backend/tests/intake/__init__.py`: empty file.

`backend/tests/intake/helpers.py`:

```python
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
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/intake/test_questionnaire.py`:

```python
from collections import Counter

from app.intake.scoring import load_questionnaire

Q = load_questionnaire()


def test_version_and_size():
    assert Q.version == "1"
    assert len(Q.questions) == 10


def test_ids_unique():
    counts = Counter(q.id for q in Q.questions)
    assert [i for i, n in counts.items() if n > 1] == []


def test_feed_split():
    feeds = Counter(q.feeds for q in Q.questions)
    assert feeds["horizon"] == 1
    assert feeds["capacity"] == 4  # plus horizon = 5 capacity inputs
    assert feeds["tolerance"] == 5


def test_every_question_has_text_and_help():
    for q in Q.questions:
        assert q.text.strip(), q.id
        assert q.help and q.help.strip(), q.id


def test_single_questions_have_at_least_two_options_and_valid_points():
    for q in Q.questions:
        if q.type != "single":
            continue
        assert len(q.options) >= 2, q.id
        assert len({o.value for o in q.options}) == len(q.options), f"duplicate option value in {q.id}"
        for o in q.options:
            assert 0 <= o.points <= 100, f"{q.id}/{o.value}"
        points = [o.points for o in q.options]
        assert max(points) == 100 and min(points) == 0, f"{q.id} should span 0..100"


def test_horizon_is_a_bounded_number_question():
    (h,) = [q for q in Q.questions if q.feeds == "horizon"]
    assert h.id == "horizon" and h.type == "number"
    assert (h.min, h.max, h.unit) == (1, 40, "years")
    assert h.options == []


def test_only_horizon_is_a_number_question():
    assert [q.id for q in Q.questions if q.type == "number"] == ["horizon"]
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && uv run pytest tests/intake/test_questionnaire.py -v`
Expected: FAIL (`assert '0' == '1'` in `test_version_and_size`, and other tests fail on the empty question list).

- [ ] **Step 4: Write `backend/app/intake/questionnaire.json`**

Replace the whole file (ASCII only):

```json
{
  "version": "1",
  "questions": [
    {
      "id": "horizon",
      "text": "How many years until you expect to need a large part of this money?",
      "help": "The longer you can leave the money invested, the more time it has to recover from bad years. Give your best estimate, between 1 and 40 years.",
      "type": "number",
      "feeds": "horizon",
      "min": 1,
      "max": 40,
      "unit": "years"
    },
    {
      "id": "income_stability",
      "text": "How stable is your income?",
      "help": "If your income is steady, you are less likely to be forced to sell investments at a bad moment to pay your bills.",
      "type": "single",
      "feeds": "capacity",
      "options": [
        {"label": "Very stable (permanent job, pension, civil service)", "value": "very_stable", "points": 100},
        {"label": "Fairly stable", "value": "fairly_stable", "points": 70},
        {"label": "Variable (freelance, commission, seasonal work)", "value": "variable", "points": 35},
        {"label": "Uncertain, or likely to drop soon", "value": "unstable", "points": 0}
      ]
    },
    {
      "id": "wealth_share",
      "text": "What share of all your savings and assets will this investment be?",
      "help": "Count everything you own: savings, property, other investments. The bigger this investment is compared with the rest, the more a loss would hurt your overall situation.",
      "type": "single",
      "feeds": "capacity",
      "options": [
        {"label": "Less than 10%", "value": "lt_10", "points": 100},
        {"label": "10% to 25%", "value": "10_25", "points": 70},
        {"label": "25% to 50%", "value": "25_50", "points": 35},
        {"label": "More than 50%", "value": "gt_50", "points": 0}
      ]
    },
    {
      "id": "emergency_buffer",
      "text": "If your income stopped, how long could you cover your living costs from savings outside this investment?",
      "help": "An emergency buffer in cash means you will not have to sell investments in a downturn just to get by. Experts often suggest three to six months of expenses.",
      "type": "single",
      "feeds": "capacity",
      "options": [
        {"label": "More than 12 months", "value": "over_12m", "points": 100},
        {"label": "6 to 12 months", "value": "6_12m", "points": 70},
        {"label": "3 to 6 months", "value": "3_6m", "points": 35},
        {"label": "Less than 3 months", "value": "under_3m", "points": 0}
      ]
    },
    {
      "id": "withdrawals",
      "text": "How likely is it that you will need to take money out before your planned horizon?",
      "help": "Money you may need soon should not take big risks. Money you will not touch for many years can ride out the ups and downs.",
      "type": "single",
      "feeds": "capacity",
      "options": [
        {"label": "Very unlikely, I will leave it untouched", "value": "none", "points": 100},
        {"label": "Unlikely", "value": "unlikely", "points": 70},
        {"label": "Possible, if something unexpected comes up", "value": "possible", "points": 35},
        {"label": "Likely, I expect to withdraw soon or regularly", "value": "likely", "points": 0}
      ]
    },
    {
      "id": "drop_reaction",
      "text": "Imagine your portfolio falls 20% within three months. What would you most likely do?",
      "help": "Falls of 20% or more happen in markets from time to time. What matters is how you would really behave, because selling after a fall turns a temporary loss into a permanent one.",
      "type": "single",
      "feeds": "tolerance",
      "options": [
        {"label": "Sell everything to stop the losses", "value": "sell_all", "points": 0},
        {"label": "Sell part of it to feel safer", "value": "sell_some", "points": 30},
        {"label": "Do nothing and wait for a recovery", "value": "hold", "points": 70},
        {"label": "Invest more while prices are low", "value": "buy_more", "points": 100}
      ]
    },
    {
      "id": "tradeoff",
      "text": "Which range of possible results over one year would you choose?",
      "help": "Higher possible gains usually come with bigger possible losses. There is no right answer, pick the range you would be most comfortable living with.",
      "type": "single",
      "feeds": "tolerance",
      "options": [
        {"label": "Between -2% and +6%", "value": "very_safe", "points": 0},
        {"label": "Between -8% and +12%", "value": "moderate", "points": 40},
        {"label": "Between -18% and +25%", "value": "growth", "points": 75},
        {"label": "Between -30% and +45%", "value": "aggressive", "points": 100}
      ]
    },
    {
      "id": "experience",
      "text": "How much experience do you have with investing in stocks, funds or ETFs?",
      "help": "People who have lived through a market fall usually know better how they react to one. If you have not, that is fine, we simply take a more careful starting point.",
      "type": "single",
      "feeds": "tolerance",
      "options": [
        {"label": "None, this is my first time", "value": "none", "points": 0},
        {"label": "A little, for less than 3 years", "value": "little", "points": 35},
        {"label": "Some, 3 to 10 years", "value": "some", "points": 70},
        {"label": "A lot, over 10 years including at least one market fall", "value": "lots", "points": 100}
      ]
    },
    {
      "id": "self_assessment",
      "text": "Which sentence describes you best as an investor?",
      "help": "Your own gut feeling about risk is a useful signal. It is combined with the more factual answers, and you can adjust the final result yourself.",
      "type": "single",
      "feeds": "tolerance",
      "options": [
        {"label": "I want safety, even if returns are low", "value": "cautious", "points": 0},
        {"label": "I prefer stability with a little growth", "value": "careful", "points": 35},
        {"label": "I accept some ups and downs for better returns", "value": "balanced", "points": 70},
        {"label": "I accept big swings for the highest long-term returns", "value": "adventurous", "points": 100}
      ]
    },
    {
      "id": "max_loss",
      "text": "What is the largest loss over one year that you could accept without losing sleep?",
      "help": "Think in euros or dollars, not percentages: a 20% loss on 10,000 is 2,000. Choose the largest loss you could truly live with.",
      "type": "single",
      "feeds": "tolerance",
      "options": [
        {"label": "None, I want to keep my money safe", "value": "none", "points": 0},
        {"label": "Up to 10%", "value": "up_to_10", "points": 35},
        {"label": "Up to 20%", "value": "up_to_20", "points": 65},
        {"label": "Up to 30%", "value": "up_to_30", "points": 85},
        {"label": "More than 30%", "value": "over_30", "points": 100}
      ]
    }
  ]
}
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && uv run pytest tests/intake/test_questionnaire.py -v`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/intake/questionnaire.json backend/tests/intake
git commit -m "feat(intake): questionnaire v1 with 10 questions"
```

---

### Task 2: Scoring

**Files:**
- Modify: `backend/app/intake/scoring.py` (keep `QUESTIONNAIRE_PATH`, `load_questionnaire`, and the `score` signature exactly)
- Test: `backend/tests/intake/test_scoring.py`

**Interfaces:**
- Consumes: `app.config.MISMATCH_GAP` (20); `app.engine.errors.InvalidSettings`; `app.engine.types.{IntakeScore, Questionnaire, Question, QuestionOption}`; `tests.intake.helpers.pick`.
- Produces: `scoring.horizon_points(years: int) -> float`; `scoring.score(answers: dict[str, str | float], questionnaire: Questionnaire) -> IntakeScore` (frozen signature).

- [ ] **Step 1: Write the failing tests**

`backend/tests/intake/test_scoring.py`:

```python
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
    # horizon 30 -> 75 points, buffer low -> 0: capacity 37.5
    r = score({"horizon": 30, "buffer": "low", "reaction": "hold"}, MINI)
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
    assert "capacity" in r.explanation
    assert "How big is your emergency buffer?" in r.explanation
    assert "Low answer" in r.explanation
    assert "What would you do in a crash?" not in r.explanation


def test_explanation_names_limiting_tolerance_question():
    r = score({"horizon": 40, "buffer": "high", "reaction": "sell"}, MINI)
    assert r.limiting_factor == "tolerance"
    assert "tolerance" in r.explanation
    assert "What would you do in a crash?" in r.explanation
    assert "Sell everything" in r.explanation


def test_explanation_can_name_the_horizon_question():
    r = score({"horizon": 1, "buffer": "high", "reaction": "hold"}, MINI)  # capacity (0 + 100) / 2
    assert "How many years?" in r.explanation
    assert "1 years" in r.explanation


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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/intake/test_scoring.py -v`
Expected: FAIL at import (`ImportError: cannot import name 'horizon_points' from 'app.intake.scoring'`).

- [ ] **Step 3: Write `backend/app/intake/scoring.py`**

Replace the whole file:

```python
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
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/intake -v`
Expected: PASS (Task 1 tests plus all scoring tests, about 40 in total).

- [ ] **Step 5: Confirm the Phase 0 contract test still passes**

Run: `cd backend && uv run pytest tests/test_contract.py::test_all_stub_functions_exist -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/intake/scoring.py backend/tests/intake/test_scoring.py
git commit -m "feat(intake): deterministic capacity/tolerance scoring"
```

---

### Task 3: Route bodies and API tests

**Files:**
- Modify: `backend/app/api/intake.py` (bodies only; decorators, paths, signatures and `response_model`s stay exactly as in Phase 0; the only addition is the private cache helper)
- Test: `backend/tests/intake/test_api.py`

**Interfaces:**
- Consumes: `scoring.load_questionnaire()`, `scoring.score(answers, questionnaire)`, `IntakeAnswers`, `IntakeScore`, `Questionnaire`.
- Produces: `GET /api/intake/questionnaire -> Questionnaire`, `POST /api/intake/score` (`{answers}` → `IntakeScore`); domain errors surface as 422 `{error: "InvalidSettings", detail}` through the Phase 0 handler.

- [ ] **Step 1: Write the failing tests**

`backend/tests/intake/test_api.py`:

```python
from fastapi.testclient import TestClient

from app.api import intake
from app.intake.scoring import load_questionnaire
from app.main import app
from tests.intake.helpers import pick

client = TestClient(app)
REAL = load_questionnaire()


def test_get_questionnaire():
    r = client.get("/api/intake/questionnaire")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "1"
    assert len(body["questions"]) == 10
    assert body["questions"][0]["id"] == "horizon"
    assert body["questions"][1]["options"][0]["points"] == 100


def test_questionnaire_is_cached():
    assert intake._questionnaire() is intake._questionnaire()


def test_score_all_max():
    r = client.post("/api/intake/score", json={"answers": pick(REAL, "max", "max")})
    assert r.status_code == 200
    body = r.json()
    assert body["capacity"] == 100 and body["tolerance"] == 100
    assert body["suggested_risk_level"] == 100
    assert body["limiting_factor"] == "none"
    assert body["mismatch"] is False
    assert body["horizon_years"] == 40


def test_score_capacity_limited():
    r = client.post("/api/intake/score", json={"answers": pick(REAL, "min", "max")})
    assert r.status_code == 200
    body = r.json()
    assert body["limiting_factor"] == "capacity"
    assert body["mismatch"] is True
    assert "capacity" in body["explanation"]


def test_score_accepts_integer_horizon_in_json():
    answers = pick(REAL, "max", "max")
    answers["horizon"] = 12
    r = client.post("/api/intake/score", json={"answers": answers})
    assert r.status_code == 200
    assert r.json()["horizon_years"] == 12


def test_score_unknown_question_is_422():
    answers = pick(REAL, "max", "max") | {"bogus": "x"}
    r = client.post("/api/intake/score", json={"answers": answers})
    assert r.status_code == 422
    assert r.json()["error"] == "InvalidSettings"
    assert "bogus" in r.json()["detail"]


def test_score_unknown_option_is_422():
    answers = pick(REAL, "max", "max") | {"drop_reaction": "panic"}
    r = client.post("/api/intake/score", json={"answers": answers})
    assert r.status_code == 422
    assert r.json()["error"] == "InvalidSettings"


def test_score_missing_question_is_422():
    answers = pick(REAL, "max", "max")
    del answers["max_loss"]
    r = client.post("/api/intake/score", json={"answers": answers})
    assert r.status_code == 422
    assert "max_loss" in r.json()["detail"]


def test_score_horizon_out_of_range_is_422():
    answers = pick(REAL, "max", "max") | {"horizon": 55}
    r = client.post("/api/intake/score", json={"answers": answers})
    assert r.status_code == 422
    assert r.json()["error"] == "InvalidSettings"


def test_score_malformed_body_is_422():
    assert client.post("/api/intake/score", json={}).status_code == 422
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/intake/test_api.py -v`
Expected: FAIL: the route tests get `501` (Phase 0 stubs raise `NotImplementedError`) and `test_questionnaire_is_cached` fails with `AttributeError: module 'app.api.intake' has no attribute '_questionnaire'`.

- [ ] **Step 3: Write `backend/app/api/intake.py`**

```python
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
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/intake -v`
Expected: PASS (all intake tests).

- [ ] **Step 5: Run the whole backend suite**

Run: `cd backend && uv run pytest -q`
Expected: PASS for everything this lane owns and every earlier Phase 0 test that is not waiting on other lanes. Failures may only come from other lanes' unfinished stubs, never from `tests/intake` or `tests/test_contract.py`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/intake.py backend/tests/intake/test_api.py
git commit -m "feat(api): intake questionnaire and score routes"
```

---

## Self-review

- **Spec §6 coverage:** ~10 questions with feeds (Task 1); capacity = horizon, income stability, share of wealth, buffer, withdrawals; tolerance = drop reaction, trade-off, experience, self-assessment, plus max acceptable loss (Task 1); score fields `capacity, tolerance, suggested_risk_level, limiting_factor, mismatch, explanation, horizon_years` (Task 2); routes per §7 (Task 3). The "info" feed and "slider" type from spec §6 do not exist in the frozen `Question` model and are not used.
- **Placeholders:** none; all code and JSON are complete.
- **Type consistency:** `horizon_points`, `score`, `_questionnaire`, `pick` are named identically wherever used; option values used in tests (`mid`, `low`, `sell`, `calm`, `bold`, `hold`) all exist in `MINI`; real-questionnaire tests only use `pick()`.
- **Handoff to Phase 2:** replace `frontend/src/mocks` questionnaire and score mocks with real output; `openapi.json` needs no change from this lane.
