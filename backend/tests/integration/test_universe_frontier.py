"""Universe risk/return chart (spec 2026-09-30-universe-frontier-design)."""

from app.api.universe import list_funds
from app.engine.types import UniverseFilters
from app.engine.universe import filter_funds

CASES = [UniverseFilters(), UniverseFilters(asset_class="bond"), UniverseFilters(region="us", max_ter=0.002),
         UniverseFilters(esg=True), UniverseFilters(q="gold")]


def test_filter_funds_matches_the_table(synthetic):
    for f in CASES:
        table = [x.isin for x in list_funds(**f.model_dump(), data=synthetic)]
        assert list(filter_funds(synthetic.funds(), synthetic.listings(), f).index) == table, f
