"""Golden run of the reference EUR profile on the real DB.

`uv run python -m scripts.golden` prints the key numbers; `--write` records them in
tests/integration/golden_eur_50.json (commit it).
"""

import argparse
import json
from pathlib import Path

from app import config
from app.engine import pipeline
from app.engine.types import EngineSettings, InvestorProfile, Recommendation

GOLDEN_PATH = Path(__file__).resolve().parents[1] / "tests" / "integration" / "golden_eur_50.json"
PROFILE = InvestorProfile(risk_level=50, horizon_years=10, base_currency="EUR")
TOLERANCES = {
    "expected_return": 0.005,
    "volatility": 0.01,
    "target_volatility": 1e-9,
    "sharpe": 0.10,
    "weighted_ter": 0.0003,
    "equity_share": 0.10,
    "bond_share": 0.10,
    "p_drawdown_30": 0.05,
    "p_below_invested": 0.05,
    "n_holdings": 2,
}


def key_numbers(rec: Recommendation) -> dict:
    s = rec.summary
    dd = {p.threshold: p.probability for p in rec.downside.drawdown_probs}
    return {
        "expected_return": s.expected_return,
        "volatility": s.volatility,
        "target_volatility": s.target_volatility,
        "sharpe": s.sharpe,
        "weighted_ter": s.weighted_ter,
        "equity_share": s.mix.get("equity", 0.0),
        "bond_share": s.mix.get("bond", 0.0),
        "p_drawdown_30": dd[0.3],
        "p_below_invested": rec.downside.p_below_invested,
        "n_holdings": len(rec.holdings),
        "holdings": {h.isin: h.weight for h in rec.holdings},  # informational, not compared
    }


def compute() -> dict:
    from app.data.db import SqliteData

    return key_numbers(pipeline.recommend(PROFILE, EngineSettings(), SqliteData(config.DB_PATH)))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="record the numbers as the new golden file")
    args = parser.parse_args(argv)
    numbers = compute()
    print(json.dumps(numbers, indent=2))
    if args.write:
        GOLDEN_PATH.write_text(json.dumps(numbers, indent=2) + "\n")
        print(f"wrote {GOLDEN_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
