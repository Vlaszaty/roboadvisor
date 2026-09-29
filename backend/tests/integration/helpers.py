"""Request builders with a response cache (the synthetic market is deterministic, so identical requests
give identical responses; caching keeps the suite fast)."""

import json

FAST = {"mc_paths": 1000}
_CACHE: dict[str, dict] = {}


def profile(risk: float = 50, base: str = "EUR", horizon: int = 10, **prefs) -> dict:
    return {"risk_level": risk, "horizon_years": horizon, "base_currency": base, "preferences": prefs}


def _post(client, path: str, body: dict) -> dict:
    key = path + json.dumps(body, sort_keys=True)
    if key not in _CACHE:
        r = client.post(path, json=body)
        assert r.status_code == 200, r.text
        _CACHE[key] = r.json()
    return _CACHE[key]


def recommend(client, risk: float = 50, base: str = "EUR", settings: dict | None = None, **prefs) -> dict:
    return _post(client, "/api/portfolio", {"profile": profile(risk, base, **prefs), "settings": settings or FAST})


def post_backtest(client, backtest: dict, weights: dict | None = None, risk: float = 50, base: str = "EUR") -> dict:
    body = {"profile": profile(risk, base), "settings": FAST, "backtest": backtest}
    if weights is not None:
        body["weights"] = weights
    return _post(client, "/api/backtest", body)
