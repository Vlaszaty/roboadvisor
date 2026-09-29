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
    assert "your finances can carry" in body["explanation"]


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
