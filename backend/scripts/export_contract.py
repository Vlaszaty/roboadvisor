"""Write backend/openapi.json and frontend/src/mocks/*.json.

Run from backend/: `uv run python -m scripts.export_contract`.
Every mock is produced by the real implementation on the deterministic SyntheticData market, so the
frontend's mock mode shows real shapes and magnitudes (re-run after any engine or intake change).
"""

import json
from pathlib import Path
from unittest import mock

from app import config
from app.api.health import defaults, health
from app.api.universe import fund_detail, list_funds
from app.engine import menu, pipeline, textbook
from app.engine.types import BacktestSettings, EngineSettings, InvestorProfile, Questionnaire, UniverseFilters
from app.intake import scoring
from app.main import app
from scripts.cafe_preview import CafeDemoData
from tests.fixtures.synthetic import SYN_TEXTBOOK_FUNDS, SyntheticData

BACKEND = Path(__file__).resolve().parents[1]
MOCKS = BACKEND.parent / "frontend" / "src" / "mocks"

DEMO_PROFILE = InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR")
MOCK_SETTINGS = EngineSettings(mc_paths=2000)
DEMO_FUND = "IE00B6R52259"
ROUND = 6
# SyntheticData has no MSCI World / S&P 500 UCITS ETFs: its ACWI and US large cap funds stand in as references
SYNTHETIC_REFERENCES = {
    "world": {"label": "World equities (MSCI World)", "isin": "IE00B6R52259"},
    "sp500": {"label": "S&P 500", "isin": "SYNUSEQ00001"},
}


def demo_answers(questionnaire: Questionnaire) -> dict[str, str | float]:
    """A complete, middle-of-the-road answer set: the middle option of each single-choice question,
    10 (or the midpoint of the allowed range) for number questions."""
    answers: dict[str, str | float] = {}
    for q in questionnaire.questions:
        if q.type == "single":
            answers[q.id] = q.options[len(q.options) // 2].value
        else:
            lo = q.min if q.min is not None else 0.0
            hi = q.max if q.max is not None else lo + 20
            answers[q.id] = 10.0 if lo <= 10 <= hi else (lo + hi) / 2
    return answers


def _round(x):
    if isinstance(x, float):
        return round(x, ROUND)
    if isinstance(x, dict):
        return {k: _round(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_round(v) for v in x]
    return x


def build_mocks() -> dict:
    data = SyntheticData()
    questionnaire = scoring.load_questionnaire()
    score = scoring.score(demo_answers(questionnaire), questionnaire)
    rec = pipeline.recommend(DEMO_PROFILE, MOCK_SETTINGS, data)
    with mock.patch.object(config, "REFERENCES", SYNTHETIC_REFERENCES):
        bt = pipeline.backtest(DEMO_PROFILE, None, MOCK_SETTINGS, BacktestSettings(), data)
        frontier = pipeline.frontier(DEMO_PROFILE, MOCK_SETTINGS, 12, data)
    universe = list_funds(asset_class=None, region=None, esg=None, ucits=None, max_ter=None, q=None, data=data)
    fund = fund_detail(isin=DEMO_FUND, base_currency="EUR", data=data)
    universe_frontier = pipeline.universe_frontier(UniverseFilters(), 5, "EUR", 12, data)
    with mock.patch.object(config, "TEXTBOOK_FUNDS", SYN_TEXTBOOK_FUNDS):
        textbook_portfolio = textbook.textbook("EUR", DEMO_PROFILE.risk_level, "capm", None, data)

    # the café menu needs ESG bonds and cash, which only the café demo market labels (illustratively)
    cafe = CafeDemoData()
    cafe_menu = menu.build(cafe)
    cafe_order = menu.order(menu.OrderRequest(base="coffee", profile_id=4, horizon_years=10, initial_amount=10_000),
                            cafe)

    dump = lambda m: _round(m.model_dump(mode="json"))  # noqa: E731
    return {
        "health": dump(health(data=data)),
        "defaults": dump(defaults()),
        "questionnaire": dump(questionnaire),
        "score": dump(score),
        "universe": [dump(u) for u in universe],
        "fund": dump(fund),
        "portfolio": dump(rec),
        "backtest": dump(bt),
        "frontier": dump(frontier),
        "universe_frontier": dump(universe_frontier),
        "textbook": dump(textbook_portfolio),
        "menu": dump(cafe_menu),
        "menu_order": dump(cafe_order),
    }


def main() -> None:
    (BACKEND / "openapi.json").write_text(json.dumps(app.openapi(), indent=2))
    MOCKS.mkdir(parents=True, exist_ok=True)
    for name, body in build_mocks().items():
        (MOCKS / f"{name}.json").write_text(json.dumps(body, allow_nan=False))
    print(f"wrote {BACKEND / 'openapi.json'} and {MOCKS}/*.json")


if __name__ == "__main__":
    main()
