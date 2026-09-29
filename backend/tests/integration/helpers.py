"""Request builders with a response cache.

Assumption: the market data behind a client is deterministic, so identical requests against the SAME data source
give identical responses. The cache is keyed on the data source's identity (the object the client's `get_data`
override returns; the real DB path when there is no override) as well as the request, and it keeps a reference to
that source so an id can't be reused by another object. Callers get a deep copy, so mutating a response can't
leak into later tests.
"""

import copy
import json

from app import config
from app.api.deps import get_data

FAST = {"mc_paths": 1000}
VOL_WARNING_MARKERS = ("below the lowest reachable", "above the highest-return", "is above the")
_CACHE: dict[tuple[int, str], tuple[object, dict]] = {}


def profile(risk: float = 50, base: str = "EUR", horizon: int = 10, **prefs) -> dict:
    return {"risk_level": risk, "horizon_years": horizon, "base_currency": base, "preferences": prefs}


def has_vol_warning(warnings: list[str]) -> bool:
    """The optimizer / pipeline warning that the volatility target was not met."""
    return any("volatility" in w.lower() and any(m in w for m in VOL_WARNING_MARKERS) for w in warnings)


def _source(client) -> object:
    override = client.app.dependency_overrides.get(get_data)
    return override() if override is not None else str(config.DB_PATH)


def _post(client, path: str, body: dict) -> dict:
    src = _source(client)
    key = (id(src), path + json.dumps(body, sort_keys=True))
    hit = _CACHE.get(key)
    if hit is None or hit[0] is not src:
        r = client.post(path, json=body)
        assert r.status_code == 200, r.text
        hit = _CACHE[key] = (src, r.json())
    return copy.deepcopy(hit[1])


def recommend(client, risk: float = 50, base: str = "EUR", settings: dict | None = None, **prefs) -> dict:
    return _post(client, "/api/portfolio", {"profile": profile(risk, base, **prefs), "settings": settings or FAST})


def post_backtest(client, backtest: dict, weights: dict | None = None, risk: float = 50, base: str = "EUR") -> dict:
    body = {"profile": profile(risk, base), "settings": FAST, "backtest": backtest}
    if weights is not None:
        body["weights"] = weights
    return _post(client, "/api/backtest", body)
