from fastapi.testclient import TestClient

from app.engine.types import InvestorProfile
from scripts.cafe_preview import CafeDemoData, create_app


def test_preview_is_explicit_and_has_multiple_illustrative_esg_ingredients():
    data = CafeDemoData()
    esg = data.funds().query("esg == True")
    assert len(esg) == 4
    assert set(esg.asset_class) == {"equity", "bond", "cash"}
    client = TestClient(create_app())
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.headers["x-cafe-data"] == "synthetic"
    assert response.json()["data_loaded"] is True


def test_preview_runs_real_engine_for_both_bases_and_requested_horizon():
    client = TestClient(create_app())
    for esg in (False, True):
        profile = InvestorProfile(risk_level=25, horizon_years=3, base_currency="EUR", preferences={"esg_only": esg})
        response = client.post("/api/portfolio", json={"profile": profile.model_dump(), "settings": {"mc_paths": 500}})
        assert response.status_code == 200, response.text
        result = response.json()
        assert response.headers["x-cafe-data"] == "synthetic"
        assert abs(result["summary"]["target_volatility"] - 0.065) < 1e-9
        assert result["downside"]["fan"][-1]["year"] == 3
        if esg:
            funds = CafeDemoData().funds()
            assert all(bool(funds.loc[h["isin"], "esg"]) for h in result["holdings"])
