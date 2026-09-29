import json

import pytest

from app import config
from scripts.golden import GOLDEN_PATH, TOLERANCES, compute

pytestmark = pytest.mark.skipif(
    not config.DB_PATH.exists(), reason="no real DB; run `uv run python -m app.data.ingest` in backend/"
)


def test_golden_eur_50_has_not_drifted():
    assert GOLDEN_PATH.exists(), "no golden file; run `uv run python -m scripts.golden --write` in backend/"
    golden = json.loads(GOLDEN_PATH.read_text())
    now = compute()
    drift = {k: {"golden": golden[k], "now": now[k], "tolerance": tol}
             for k, tol in TOLERANCES.items() if abs(now[k] - golden[k]) > tol}
    assert not drift, (
        f"golden run drifted: {drift}. If intended (new data, model change), review, then "
        f"`uv run python -m scripts.golden --write` and commit the JSON."
    )
