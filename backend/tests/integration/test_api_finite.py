"""Serialized API responses must be strict JSON: no NaN / Infinity / -Infinity tokens."""

import json

import pytest

from tests.integration.helpers import FAST, profile

WALK_FORWARD = {"mode": "walk_forward", "start": "2018-01-01", "end": "2021-12-31",
                "rebalance": {"type": "periodic", "frequency": "quarterly"}}


def _reject(token: str):
    raise AssertionError(f"non-finite JSON token {token!r} in response")


@pytest.mark.parametrize("path, body", [
    ("/api/portfolio", {"profile": profile(20), "settings": FAST}),
    ("/api/portfolio", {"profile": profile(80, "USD", crypto_max=0.05), "settings": FAST}),
    ("/api/portfolio", {"profile": profile(80, esg_only=True, max_position=1.0, max_etfs=1), "settings": FAST}),
    ("/api/backtest", {"profile": profile(), "settings": FAST, "backtest": {"mode": "static"}}),
    ("/api/backtest", {"profile": profile(), "settings": FAST, "backtest": WALK_FORWARD}),
], ids=["portfolio-low", "portfolio-crypto-usd", "portfolio-single-fund", "backtest-static", "backtest-walk-forward"])
def test_response_json_is_finite(client, path, body):
    r = client.post(path, json=body)
    assert r.status_code == 200, r.text
    json.loads(r.text, parse_constant=_reject)
