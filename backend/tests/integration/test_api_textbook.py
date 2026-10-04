import json

import pytest

from app import config
from tests.fixtures.synthetic import SYN_TEXTBOOK_FUNDS


def test_api_textbook_validates(client):
    assert client.post("/api/textbook", json={"risk_level": 101}).status_code == 422
    assert client.post("/api/textbook", json={"market_premium": 0.5}).status_code == 422
    assert client.post("/api/textbook", json={"return_model": "guess"}).status_code == 422
    assert client.post("/api/textbook", json={"base_currency": "GBP"}).status_code == 422


def _reject(token: str):
    raise AssertionError(f"non-finite JSON token {token!r} in response")


@pytest.mark.parametrize("model", ["capm", "historical"])
def test_api_textbook(client, monkeypatch, model):
    monkeypatch.setattr(config, "TEXTBOOK_FUNDS", SYN_TEXTBOOK_FUNDS)
    r = client.post("/api/textbook", json={"risk_level": 30, "return_model": model})
    assert r.status_code == 200, r.text
    d = json.loads(r.text, parse_constant=_reject)
    assert len(d["funds"]) == 7 and len(d["correlation"]["matrix"]) == 7
    assert d["inputs"]["return_model"] == model
    assert abs(sum(d["portfolio"]["weights"].values()) - 1) < 1e-4


def test_api_textbook_missing_fund_is_a_422(client, monkeypatch):
    broken = {"EUR": {"risky": {"Gold": "XX0000000000"}, "risk_free": "SYNCASH00001"}}
    monkeypatch.setattr(config, "TEXTBOOK_FUNDS", broken)
    r = client.post("/api/textbook", json={})
    assert r.status_code == 422 and "XX0000000000" in r.json()["detail"]
