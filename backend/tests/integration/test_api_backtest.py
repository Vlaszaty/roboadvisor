from tests.integration.helpers import FAST, post_backtest, profile

WALK_FORWARD = {"mode": "walk_forward", "start": "2018-01-01", "end": "2021-12-31",
                "rebalance": {"type": "periodic", "frequency": "quarterly"}}


def _look_ahead(body: dict) -> bool:
    return any("look-ahead" in w for w in body["warnings"])


def test_static_backtest_from_recommendation(client):
    body = post_backtest(client, {"mode": "static"})
    assert _look_ahead(body)
    assert abs(sum(body["weights"].values()) - 1) < 1e-5
    n = len(body["series"]["dates"])
    assert n > 700 and len(body["series"]["portfolio"]) == n and len(body["series"]["benchmark"]) == n
    assert body["trace"][-1]["step"] == "backtest"
    registry = {"cagr", "volatility", "sharpe", "sortino", "max_drawdown", "max_drawdown_duration", "cvar_95", "calmar"}
    assert set(body["metrics"]["benchmark"]) == registry
    assert set(body["metrics"]["portfolio"]) == registry | {"beta", "turnover"}
    assert body["series"]["portfolio"][0] == 1.0
    assert body["series"]["dates"][0] not in body["rebalance_dates"]


def test_walk_forward_quarterly(client):
    body = post_backtest(client, WALK_FORWARD)
    assert not _look_ahead(body)
    assert len(body["rebalance_dates"]) >= 12
    assert [s["step"] for s in body["trace"]] == ["universe", "returns", "backtest"]


def test_static_with_explicit_weights_and_benchmark(client):
    body = post_backtest(client, {"mode": "static", "benchmark": {"IE00B6R52259": 1.0}},
                         weights={"IE00B6R52259": 0.6, "SYNGOVS00001": 0.4})
    assert abs(body["weights"]["IE00B6R52259"] - 0.6) < 1e-9
    assert body["trace"][-1]["summary"]["benchmark"] == {"IE00B6R52259": 1.0}


def test_walk_forward_without_rebalancing_is_422(client):
    r = client.post("/api/backtest", json={"profile": profile(), "settings": FAST, "backtest": {"mode": "walk_forward"}})
    assert r.status_code == 422


def test_unknown_isin_in_weights_is_422(client):
    r = client.post("/api/backtest", json={"profile": profile(), "settings": FAST, "weights": {"NOPE00000000": 1.0}})
    assert r.status_code == 422
    assert r.json()["error"] == "InvalidSettings" and "NOPE00000000" in r.json()["detail"]
