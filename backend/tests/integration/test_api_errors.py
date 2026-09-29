from fastapi.testclient import TestClient

from app import config
from app.api.deps import get_data
from app.main import app
from tests.integration.helpers import FAST, profile


def test_no_eligible_funds_is_422(client):
    r = client.post("/api/portfolio", json={"profile": profile(max_ter=0.0), "settings": FAST})
    assert r.status_code == 422
    assert r.json()["error"] == "NoEligibleFunds"


def test_invalid_profile_is_422(client):
    r = client.post("/api/portfolio", json={"profile": profile(risk=150)})
    assert r.status_code == 422


def test_crypto_above_hard_cap_is_422(client):
    r = client.post("/api/portfolio", json={"profile": profile(risk=80, crypto_max=0.2)})
    assert r.status_code == 422


def test_missing_db_is_503(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "missing.db")
    app.dependency_overrides.pop(get_data, None)
    c = TestClient(app)
    for method, path, body in [("post", "/api/portfolio", {"profile": profile()}),
                               ("post", "/api/backtest", {"profile": profile()}),
                               ("get", "/api/universe", None)]:
        r = c.post(path, json=body) if method == "post" else c.get(path)
        assert r.status_code == 503, path
        assert r.json()["error"] == "NoData" and "ingest" in r.json()["detail"]
