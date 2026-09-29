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
