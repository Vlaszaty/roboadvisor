from fastapi.testclient import TestClient

from app.api.deps import get_data_optional
from app.main import app


def test_health_without_data():
    app.dependency_overrides[get_data_optional] = lambda: None
    try:
        r = TestClient(app).get("/api/health")
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "data_loaded": False, "last_ingest": None, "n_funds": 0}


def test_defaults_exposes_config():
    r = TestClient(app).get("/api/defaults")
    assert r.status_code == 200
    body = r.json()
    assert body["vol_range"] == [0.02, 0.20]
    assert body["markets"]["capm_multi_asset"]["premium"] == 0.035
    assert body["stress_events"][0]["name"] == "GFC 2008"


def test_unimplemented_route_returns_501():
    from app.api.deps import get_data

    app.dependency_overrides[get_data] = lambda: object()
    try:
        r = TestClient(app).post("/api/portfolio", json={"profile": {"risk_level": 50, "horizon_years": 10, "base_currency": "EUR"}})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 501
