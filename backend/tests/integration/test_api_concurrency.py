import threading
import time

from fastapi.testclient import TestClient

from app.api.deps import get_data
from app.engine import pipeline
from app.main import app

BODY = {"profile": {"risk_level": 50, "horizon_years": 10, "base_currency": "EUR"}}


def test_engine_calls_never_overlap(monkeypatch, synthetic):
    # Regression: parallel requests shared SqliteData's cached pandas objects and raced inside
    # pandas' lazily built index engines ("cannot reindex on an axis with duplicate labels" → 500
    # on the landing page, whose example and the page itself request at the same moment).
    real = pipeline.recommend
    active = 0
    peak = 0
    guard = threading.Lock()

    def spy(*args, **kwargs):
        nonlocal active, peak
        with guard:
            active += 1
            peak = max(peak, active)
        time.sleep(0.05)
        try:
            return real(*args, **kwargs)
        finally:
            with guard:
                active -= 1

    monkeypatch.setattr(pipeline, "recommend", spy)
    app.dependency_overrides[get_data] = lambda: synthetic
    try:
        client = TestClient(app)
        barrier = threading.Barrier(4)
        codes: list[int] = []

        def call() -> None:
            barrier.wait()
            codes.append(client.post("/api/portfolio", json=BODY | {"settings": {"mc_paths": 500}}).status_code)

        threads = [threading.Thread(target=call) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    finally:
        app.dependency_overrides.clear()
    assert codes == [200] * 4
    assert peak == 1
