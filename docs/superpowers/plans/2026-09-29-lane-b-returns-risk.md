# Lane B — Universe, Returns, Risk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `universe.select`, `returns.convert_prices`, `returns.weekly_returns` and `risk.covariance` exactly as specified by the Phase 0 stubs' docstrings and spec §5.1–5.3, tested against the `SyntheticData` market.

**Architecture:** Three small pure-pandas modules in `backend/app/engine/`. `universe.select` is a chain of boolean filters followed by a listing choice. `returns` converts daily local prices to base currency, resamples to W-FRI and splices proxy returns before each fund's first own price. `risk.covariance` slices the estimation window and delegates to `pypfopt.risk_models.CovarianceShrinkage(...).ledoit_wolf()`. Signatures are frozen by Phase 0 (tag `phase0-contracts`); this plan only fills bodies.

**Tech Stack:** Python 3.12, uv, pandas, numpy, PyPortfolioOpt (`pypfopt`), scikit-learn (test reference only), pytest.

**Spec:** `docs/superpowers/specs/2026-09-29-roboadvisor-design.md` (§5.0–5.3, §9). Phase 0 plan: `docs/superpowers/plans/2026-09-29-phase0-contracts.md` (assumed merged, tag `phase0-contracts`).

## Global Constraints

- Python tooling is **uv** only: `uv sync`, `uv add`, `uv run pytest`, `uv run python -m ...`. Python pinned to **3.12**. Never use pip or a hand-made venv.
- Backend port **8740**, frontend port **5740** with Vite `strictPort: true`; Vite proxies `/api` → `http://localhost:8740`.
- All API routes live under `/api`. The API is stateless.
- Engine modules (`app/engine/*`) never import FastAPI, sqlite3 or `app.data`.
- All engine return series are **weekly (W-FRI)**, simple returns, base currency, columns = ISIN. Annualisation factor 52.
- Base currencies: `EUR`, `USD`.
- Drawdowns and losses are **negative numbers** (−0.35 = −35%). Thresholds are positive (0.3 means "−30% or worse").
- No network access in tests.
- Only Phase 0 adds Python/npm dependencies. Lanes that need one must escalate.
- Contract files created in Phase 0 (`config.py` structure, `engine/types.py`, `engine/errors.py`, `api/schemas.py`, `data/schema.sql`, route signatures, stub signatures) are frozen after Phase 0; changes go through the integrator.

Lane rules: only touch `backend/app/engine/{universe,returns,risk}.py` and `backend/tests/engine_b/**`. Do not edit `conftest.py`, the fixture, `config.py` or `types.py`. If a contract seems wrong, stop and report it to the integrator.

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/engine/universe.py` | `select`: filter funds by profile, choose one listing per fund |
| `backend/app/engine/returns.py` | `convert_prices` (FX to base), `weekly_returns` (W-FRI returns with proxy splice) |
| `backend/app/engine/risk.py` | `covariance`: windowed, coverage-filtered Ledoit-Wolf, annualised x52 |
| `backend/tests/engine_b/__init__.py` | empty |
| `backend/tests/engine_b/test_universe.py`, `test_returns.py`, `test_risk.py` | lane tests on the `synthetic` fixture |

## Reference facts (hand-derived from the fixture, used by the tests)

Fixture roster (24 funds). US-domiciled `etf` funds with `ucits False`: `US4642882579, US92206C5655, SYNUSEQ00001, SYNTECH00001, SYNUSTL00001, SYNHY0000001, SYNREIT00001, SYNIBIT00001`. `SYNGOLD00001` (etc) and `SYNBTC000001` (etp) are non-UCITS but not `etf`, so they pass the UCITS filter.

- EUR default (risk 50, crypto_max 0): 24 − 8 US ETFs − `SYNBTC000001` (crypto) − `SYNUSTLUH001` (unhedged sibling of `SYNUSTLEH001`, same `index_name`) = **14 funds**: `IE00B6R52259, IE00BDBRDM35, SYNEUEQ00001, SYNEMEQ00001, SYNJPEQ00001, SYNESGEQ0001, SYNHLTH00001, SYNGOVS00001, SYNGOVL00001, SYNUSTLEH001, SYNCORP00001, SYNCASH00001, SYNYOUNG0001, SYNGOLD00001`.
- USD default (`ucits_only` -> False, no fund is `hedged_to == 'USD'`): 24 − 2 crypto = **22 funds**, both `SYNUSTLEH001` and `SYNUSTLUH001` kept.
- Weekly reference: `SyntheticData.weekly_returns(base)` builds base-currency values from the economic series, so after a listing's first own price week it equals the engine's result up to float rounding (the engine computes `price_econ * fx[econ]/fx[listing] * fx[listing]/fx[base]`; the reference computes `fx[econ]/fx[base]` directly; both are the same product, differing by about 1e-16 relative). Before that week the engine uses proxy returns, which lack the fund's idiosyncratic noise, so the two legitimately differ. Tests therefore compare only weeks strictly after the first own-price week, and check proxied weeks against an independent formula on the proxy series.
- The week containing a fund's first own price has no own return (needs a prior own price), so it is a **proxied week**: `proxied[isin]` ends at that week. Example: `IE00B6R52259` first own price Fri 2011-10-21, so `proxied == (2005-01-14, 2011-10-21)`.

---

### Task 1: `universe.select`

**Files:**
- Modify: `backend/app/engine/universe.py`
- Create: `backend/tests/engine_b/__init__.py` (empty)
- Test: `backend/tests/engine_b/test_universe.py`

**Interfaces:**
- Consumes: `app.config.{UCITS_DEFAULT, CRYPTO_MIN_RISK_LEVEL}`, `app.engine.errors.NoEligibleFunds`, `app.engine.types.{InvestorProfile, Preferences, FUND_COLUMNS}`, `SyntheticData.funds()/.listings()`.
- Produces: `select(funds: pd.DataFrame, listings: pd.DataFrame, profile: InvestorProfile) -> pd.DataFrame` — index `isin` (funds order), all fund columns plus `ticker`, `exchange`, `currency` of the chosen listing. Consumed by `returns.weekly_returns` and Phase 2 pipeline.

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_b/__init__.py`: empty file.

`backend/tests/engine_b/test_universe.py`:

```python
import numpy as np
import pandas as pd
import pytest

from app.engine.errors import NoEligibleFunds
from app.engine.types import FUND_COLUMNS, InvestorProfile, Preferences
from app.engine.universe import select

EUR_DEFAULT = {
    "IE00B6R52259", "IE00BDBRDM35", "SYNEUEQ00001", "SYNEMEQ00001", "SYNJPEQ00001", "SYNESGEQ0001",
    "SYNHLTH00001", "SYNGOVS00001", "SYNGOVL00001", "SYNUSTLEH001", "SYNCORP00001", "SYNCASH00001",
    "SYNYOUNG0001", "SYNGOLD00001",
}
US_ETFS = {
    "US4642882579", "US92206C5655", "SYNUSEQ00001", "SYNTECH00001", "SYNUSTL00001", "SYNHY0000001",
    "SYNREIT00001", "SYNIBIT00001",
}
CRYPTO = {"SYNBTC000001", "SYNIBIT00001"}


def profile(base="EUR", risk=50.0, **prefs) -> InvestorProfile:
    return InvestorProfile(
        risk_level=risk, horizon_years=10, base_currency=base, preferences=Preferences(**prefs)
    )


def pick(synthetic, base="EUR", risk=50.0, funds=None, listings=None, **prefs) -> pd.DataFrame:
    return select(
        synthetic.funds() if funds is None else funds,
        synthetic.listings() if listings is None else listings,
        profile(base, risk, **prefs),
    )


def test_esg_only_keeps_only_the_esg_fund(synthetic):
    assert list(pick(synthetic, esg_only=True).index) == ["SYNESGEQ0001"]
    assert list(pick(synthetic, "USD", esg_only=True).index) == ["SYNESGEQ0001"]


def test_eur_default_is_ucits_only_with_hedged_bonds(synthetic):
    sel = pick(synthetic)
    assert set(sel.index) == EUR_DEFAULT
    assert not set(sel.index) & US_ETFS
    assert "SYNGOLD00001" in sel.index  # ETC passes the UCITS filter
    assert "SYNUSTLEH001" in sel.index and "SYNUSTLUH001" not in sel.index
    assert "SYNBTC000001" not in sel.index  # crypto_max == 0


def test_usd_default_keeps_us_funds_and_both_ust_share_classes(synthetic):
    sel = pick(synthetic, "USD")
    assert set(sel.index) == set(synthetic.funds().index) - CRYPTO
    # no share class is hedged to USD, so hedge_bonds drops nothing
    assert {"SYNUSTLEH001", "SYNUSTLUH001"} <= set(sel.index)


def test_ucits_only_override(synthetic):
    eur = pick(synthetic, ucits_only=False)
    assert {"US4642882579", "SYNUSTL00001"} <= set(eur.index)
    assert "SYNUSTLUH001" not in eur.index  # hedge rule still applies
    usd = pick(synthetic, "USD", ucits_only=True)
    assert not set(usd.index) & US_ETFS


@pytest.mark.parametrize(
    "risk, crypto_max, expect_btc",
    [(60.0, 0.0, False), (39.9, 0.05, False), (40.0, 0.05, True), (60.0, 0.05, True)],
)
def test_crypto_rules(synthetic, risk, crypto_max, expect_btc):
    sel = pick(synthetic, risk=risk, crypto_max=crypto_max)
    assert ("SYNBTC000001" in sel.index) is expect_btc
    assert "SYNIBIT00001" not in sel.index  # US ETF, not UCITS


def test_crypto_kept_for_usd_at_risk_60(synthetic):
    sel = pick(synthetic, "USD", risk=60.0, crypto_max=0.05)
    assert CRYPTO <= set(sel.index)


def test_removed_counts_for_the_trace(synthetic):
    removed = pick(synthetic).attrs["removed"]
    assert set(removed) == {
        "esg", "regions_include", "regions_exclude", "sectors_exclude", "max_ter", "distribution", "crypto",
        "non_ucits", "hedged_duplicates_and_unlisted",
    }
    assert removed["crypto"] == 2  # crypto_max == 0
    assert removed["non_ucits"] == 7  # the US-domiciled etfs left after the crypto filter
    assert removed["hedged_duplicates_and_unlisted"] == 1  # SYNUSTLUH001
    assert sum(removed.values()) == len(synthetic.funds()) - len(EUR_DEFAULT)


def test_hedge_bonds_off_keeps_both_share_classes(synthetic):
    sel = pick(synthetic, hedge_bonds=False)
    assert {"SYNUSTLEH001", "SYNUSTLUH001"} <= set(sel.index)


def test_hedge_rule_runs_after_other_filters(synthetic):
    # max_ter 0.0008 removes the hedged class (0.0010) first, so the unhedged one (0.0007) survives.
    assert set(pick(synthetic, max_ter=0.0008).index) == {"SYNUSTLUH001"}


def test_regions_include_lets_global_pass(synthetic):
    sel = pick(synthetic, regions_include=["europe"])
    assert set(sel.index) == {
        "SYNEUEQ00001", "SYNGOVS00001", "SYNGOVL00001", "SYNCORP00001", "SYNCASH00001",  # europe
        "IE00B6R52259", "IE00BDBRDM35", "SYNESGEQ0001", "SYNHLTH00001", "SYNYOUNG0001", "SYNGOLD00001",  # global
    }
    usd = pick(synthetic, "USD", regions_include=["us"])
    assert set(usd["region"]) == {"us", "global"}
    assert "SYNUSEQ00001" in usd.index


def test_regions_exclude(synthetic):
    sel = pick(synthetic, regions_exclude=["em", "japan"])
    assert not {"SYNEMEQ00001", "SYNJPEQ00001"} & set(sel.index)
    assert len(sel) == len(EUR_DEFAULT) - 2


def test_sectors_exclude(synthetic):
    assert "SYNTECH00001" in pick(synthetic, "USD").index
    sel = pick(synthetic, "USD", sectors_exclude=["technology"])
    assert "SYNTECH00001" not in sel.index and "SYNHLTH00001" in sel.index
    assert len(sel) == 21
    assert "SYNHLTH00001" not in pick(synthetic, sectors_exclude=["healthcare"]).index


def test_max_ter_and_unknown_ter_kept(synthetic):
    sel = pick(synthetic, max_ter=0.0015)
    assert set(sel.index) == {
        "IE00BDBRDM35", "SYNEUEQ00001", "SYNJPEQ00001", "SYNGOVS00001", "SYNGOVL00001",
        "SYNUSTLEH001", "SYNCASH00001", "SYNGOLD00001",
    }  # SYNJPEQ00001 and SYNGOVS00001 sit exactly at 0.0015: kept
    funds = synthetic.funds()
    funds.loc["SYNEMEQ00001", "ter"] = np.nan
    assert "SYNEMEQ00001" in pick(synthetic, funds=funds, max_ter=0.0015).index


def test_distribution(synthetic):
    assert set(pick(synthetic, distribution="dist").index) == {"SYNEUEQ00001"}
    assert set(pick(synthetic, distribution="acc").index) == EUR_DEFAULT - {"SYNEUEQ00001"}
    assert set(pick(synthetic, "USD", distribution="dist").index) == US_ETFS - {"SYNIBIT00001"} | {"SYNEUEQ00001"}


@pytest.mark.parametrize(
    "base, isin, prefs, ticker, currency",
    [
        ("EUR", "IE00B6R52259", {}, "IUSQ.DE", "EUR"),
        ("USD", "IE00B6R52259", {}, "SSAC.L", "USD"),
        ("EUR", "SYNEMEQ00001", {}, "SEME.DE", "EUR"),
        ("USD", "SYNEMEQ00001", {}, "SEME.L", "USD"),
        ("EUR", "SYNUSTLUH001", {"hedge_bonds": False}, "SUSU.DE", "EUR"),  # base ccy beats is_primary
        ("USD", "SYNUSTLUH001", {}, "SUSU.L", "USD"),
        ("USD", "SYNEUEQ00001", {}, "SEUE.DE", "EUR"),  # no USD listing: fall back to the only one
    ],
)
def test_listing_choice(synthetic, base, isin, prefs, ticker, currency):
    sel = pick(synthetic, base, **prefs)
    assert sel.loc[isin, "ticker"] == ticker
    assert sel.loc[isin, "currency"] == currency


def test_listing_tie_break_is_primary_then_ticker(synthetic):
    listings = synthetic.listings()
    listings = listings[listings["isin"] != "SYNJPEQ00001"]
    extra = pd.DataFrame(
        [("ZZZ.DE", "SYNJPEQ00001", "XETRA", "EUR", False), ("AAA.DE", "SYNJPEQ00001", "XETRA", "EUR", False)],
        columns=listings.columns,
    )
    sel = pick(synthetic, listings=pd.concat([listings, extra], ignore_index=True))
    assert sel.loc["SYNJPEQ00001", "ticker"] == "AAA.DE"


def test_output_shape(synthetic):
    sel = pick(synthetic)
    assert sel.index.name == "isin" and sel.index.is_unique
    assert list(sel.columns) == FUND_COLUMNS + ["ticker", "exchange", "currency"]
    lst = synthetic.listings().set_index("ticker")
    assert (lst.loc[sel["ticker"], "isin"].to_numpy() == sel.index.to_numpy()).all()


def test_funds_without_listing_are_dropped(synthetic):
    listings = synthetic.listings()
    sel = pick(synthetic, listings=listings[listings["isin"] != "SYNJPEQ00001"])
    assert "SYNJPEQ00001" not in sel.index


def test_no_eligible_funds(synthetic):
    with pytest.raises(NoEligibleFunds):
        pick(synthetic, esg_only=True, regions_exclude=["global"])
    with pytest.raises(NoEligibleFunds):
        pick(synthetic, max_ter=0.0)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/engine_b/test_universe.py -v`
Expected: FAIL, every test with `NotImplementedError: Lane B`.

- [ ] **Step 3: Implement `backend/app/engine/universe.py`**

Replace the whole file (keep the docstring contract verbatim):

```python
"""Lane B. Spec §5.1."""

import pandas as pd

from app import config
from app.engine.errors import NoEligibleFunds
from app.engine.types import InvestorProfile


def _choose_listing(listings: pd.DataFrame, isins: pd.Index, base: str) -> pd.DataFrame:
    """One listing per isin: base currency first, then is_primary, then ticker alphabetical."""
    lst = listings[listings["isin"].isin(isins)].copy()
    lst["_other_ccy"] = lst["currency"] != base
    lst["_not_primary"] = ~lst["is_primary"].astype(bool)
    best = lst.sort_values(["_other_ccy", "_not_primary", "ticker"]).drop_duplicates("isin")
    return best.set_index("isin")[["ticker", "exchange", "currency"]]


def select(funds: pd.DataFrame, listings: pd.DataFrame, profile: InvestorProfile) -> pd.DataFrame:
    """Eligible funds for this profile, one chosen listing each.

    funds / listings: as returned by DataSource.funds() / .listings().
    Returns: funds' columns (index isin) plus 'ticker', 'exchange' and 'currency' of the chosen listing.

    Filters (in this order). The result carries result.attrs["removed"] = {key: number of funds removed} with keys
    esg, regions_include, regions_exclude, sectors_exclude, max_ter, distribution, crypto, non_ucits,
    hedged_duplicates_and_unlisted (every key present, 0 when the filter did nothing), for the trace:
    - esg_only -> keep esg == True.
    - regions_include (non-empty) -> keep region in list or region == 'global'. regions_exclude -> drop region in list.
    - sectors_exclude -> drop sector in list.
    - max_ter -> drop ter > max_ter (unknown TER is kept).
    - distribution 'acc'/'dist' -> keep matching.
    - crypto: drop asset_class == 'crypto' if preferences.crypto_max == 0 or risk_level < config.CRYPTO_MIN_RISK_LEVEL.
    - ucits_only (None -> config.UCITS_DEFAULT[base]) -> drop wrapper == 'etf' funds with ucits False
      (ETPs/ETCs are not UCITS by law but are sold to EU retail, so they pass).
    - hedge_bonds -> among bond funds sharing index_name, if any is hedged_to == base, drop the others.
    - drop funds without any listing.
    Listing choice: currency == base first, then is_primary, then ticker alphabetical.
    Raises NoEligibleFunds if nothing remains.
    """
    p, base = profile.preferences, profile.base_currency
    f = funds
    removed: dict[str, int] = {}

    def keep(key: str, mask: pd.Series) -> None:
        nonlocal f
        removed[key] = int((~mask).sum())
        f = f[mask]

    everything = pd.Series(True, index=f.index)
    keep("esg", f["esg"].astype(bool) if p.esg_only else everything)
    keep("regions_include", f["region"].isin([*p.regions_include, "global"]) if p.regions_include else everything.loc[f.index])
    keep("regions_exclude", ~f["region"].isin(p.regions_exclude))
    keep("sectors_exclude", ~f["sector"].isin(p.sectors_exclude))
    keep("max_ter", ~(f["ter"] > p.max_ter) if p.max_ter is not None else everything.loc[f.index])  # unknown TER stays
    keep("distribution", f["distribution"] == p.distribution if p.distribution != "any" else everything.loc[f.index])
    crypto_off = p.crypto_max == 0 or profile.risk_level < config.CRYPTO_MIN_RISK_LEVEL
    keep("crypto", f["asset_class"] != "crypto" if crypto_off else everything.loc[f.index])
    ucits_only = config.UCITS_DEFAULT[base] if p.ucits_only is None else p.ucits_only
    keep("non_ucits", ~((f["wrapper"] == "etf") & ~f["ucits"].astype(bool)) if ucits_only else everything.loc[f.index])

    before = len(f)
    if p.hedge_bonds:
        bonds = f[f["asset_class"] == "bond"]
        hedged_indices = bonds.loc[bonds["hedged_to"] == base, "index_name"].dropna()
        unhedged_siblings = bonds[bonds["index_name"].isin(hedged_indices) & (bonds["hedged_to"] != base)]
        f = f.drop(index=unhedged_siblings.index)
    f = f.join(_choose_listing(listings, f.index, base), how="inner")
    removed["hedged_duplicates_and_unlisted"] = before - len(f)

    if f.empty:
        raise NoEligibleFunds("no fund matches the investor's preferences")
    f.attrs["removed"] = removed
    return f
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && uv run pytest tests/engine_b/test_universe.py -v`
Expected: PASS (all tests; the parametrised ones count separately).

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/universe.py backend/tests/engine_b/__init__.py backend/tests/engine_b/test_universe.py
git commit -m "feat(engine): universe.select with preference filters and listing choice"
```

---

### Task 2: `returns.convert_prices`

**Files:**
- Modify: `backend/app/engine/returns.py` (only `convert_prices`; `weekly_returns` stays a stub until Task 3)
- Test: `backend/tests/engine_b/test_returns.py`

**Interfaces:**
- Consumes: `SyntheticData.prices(...)`, `SyntheticData.fx()` (USD per 1 unit, includes `USD == 1.0`).
- Produces: `convert_prices(prices: pd.DataFrame, currencies: dict[str, str], fx: pd.DataFrame, base: str) -> pd.DataFrame` — same index/columns as `prices`; `price_base = price_local * usd_rate[local] / usd_rate[base]`, fx forward-filled onto the price dates. Used by `weekly_returns` (Task 3).

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_b/test_returns.py` (Task 3 appends to this file):

```python
import numpy as np
import pandas as pd
import pytest

from app.engine.returns import convert_prices, weekly_returns
from app.engine.types import InvestorProfile, Preferences
from app.engine.universe import select

FRIDAY = pd.offsets.Week(weekday=4)


def test_convert_prices_matches_fx_and_round_trips(synthetic):
    px = synthetic.prices(["IUSQ.DE", "SSAC.L"])
    fx = synthetic.fx()
    ccy = {"IUSQ.DE": "EUR", "SSAC.L": "USD"}
    eur = convert_prices(px, ccy, fx, "EUR")
    usd = convert_prices(px, ccy, fx, "USD")
    assert list(eur.columns) == ["IUSQ.DE", "SSAC.L"]
    pd.testing.assert_series_equal(eur["IUSQ.DE"], px["IUSQ.DE"])  # already EUR
    pd.testing.assert_series_equal(eur["SSAC.L"], px["SSAC.L"] / fx["EUR"], check_names=False)
    pd.testing.assert_series_equal(usd["IUSQ.DE"], px["IUSQ.DE"] * fx["EUR"], check_names=False)
    pd.testing.assert_series_equal(usd["SSAC.L"], px["SSAC.L"])  # already USD
    # round trip: EUR values times the EUR rate are the USD values
    pd.testing.assert_frame_equal(eur.mul(fx["EUR"], axis=0), usd)


def test_convert_prices_forward_fills_fx_and_keeps_nan():
    idx = pd.to_datetime(["2020-01-01", "2020-01-02", "2020-01-03"])
    prices = pd.DataFrame({"A": [10.0, 11.0, 12.0], "B": [np.nan, 5.0, 5.0]}, index=idx)
    fx = pd.DataFrame(
        {"USD": [1.0, 1.0], "EUR": [1.1, 1.3]}, index=pd.to_datetime(["2020-01-01", "2020-01-03"])
    )
    out = convert_prices(prices, {"A": "EUR", "B": "USD"}, fx, "USD")
    np.testing.assert_allclose(out["A"], [11.0, 12.1, 15.6])  # 01-02 uses the 01-01 rate
    assert np.isnan(out["B"].iloc[0])
    np.testing.assert_allclose(out["B"].iloc[1:], [5.0, 5.0])
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/engine_b/test_returns.py -v`
Expected: FAIL with `NotImplementedError: Lane B`.

- [ ] **Step 3: Implement `convert_prices`**

In `backend/app/engine/returns.py`, replace the `convert_prices` body (docstring kept) with:

```python
def convert_prices(prices: pd.DataFrame, currencies: dict[str, str], fx: pd.DataFrame, base: str) -> pd.DataFrame:
    """Daily prices (columns = tickers, local currency) -> base currency.

    price_base = price_local * usd_rate[local] / usd_rate[base]; fx is forward-filled onto the price dates.
    currencies: ticker -> currency code. Columns keep their ticker names.
    """
    rate = fx.reindex(fx.index.union(prices.index)).ffill().reindex(prices.index)
    local = rate[[currencies[t] for t in prices.columns]]
    local.columns = prices.columns
    return (prices * local).div(rate[base], axis=0)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && uv run pytest tests/engine_b/test_returns.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/returns.py backend/tests/engine_b/test_returns.py
git commit -m "feat(engine): returns.convert_prices"
```

---

### Task 3: `returns.weekly_returns` with proxy splice

**Files:**
- Modify: `backend/app/engine/returns.py` (`weekly_returns`, plus imports)
- Test: `backend/tests/engine_b/test_returns.py` (append)

**Interfaces:**
- Consumes: `convert_prices` (Task 2); `universe.select` output (columns `ticker, currency, hedged_to, proxy_ticker, proxy_currency`); `app.engine.types.ReturnsResult(returns, proxied)`.
- Produces: `weekly_returns(prices, selection, fx, base) -> ReturnsResult`. `returns`: W-FRI DatetimeIndex (first week dropped), columns = `selection.index` in order. `proxied[isin] = (first proxied week, last proxied week)`, where the last proxied week is the week that contains the fund's first own price (its return cannot be measured from own prices). Funds without a proxy are absent from `proxied`; their pre-inception weeks stay NaN.

- [ ] **Step 1: Append the failing tests**

Append to `backend/tests/engine_b/test_returns.py`:

```python
def _selection(synthetic, base):
    profile = InvestorProfile(
        risk_level=60, horizon_years=10, base_currency=base, preferences=Preferences(crypto_max=0.05)
    )
    return select(synthetic.funds(), synthetic.listings(), profile)


def _prices(synthetic, sel):
    cols = list(sel["ticker"]) + sorted(sel["proxy_ticker"].dropna().unique())
    return synthetic.prices(cols)


def _run(synthetic, base):
    sel = _selection(synthetic, base)
    prices = _prices(synthetic, sel)
    return sel, prices, weekly_returns(prices, sel, synthetic.fx(), base)


def _weekly_ret(s: pd.Series) -> pd.Series:
    return s.resample("W-FRI").last().pct_change(fill_method=None)


@pytest.mark.parametrize("base", ["EUR", "USD"])
def test_matches_fixture_reference_after_first_own_week(synthetic, base):
    # Engine and reference both compute price_econ * fx[econ] / fx[base]; only float rounding differs (~1e-16),
    # so 1e-9 is a tight bound. Weeks up to the first own-price week are proxied (proxy has no idiosyncratic
    # noise) and legitimately differ from the reference, so they are excluded here.
    sel, prices, res = _run(synthetic, base)
    ref = synthetic.weekly_returns(base)
    assert list(res.returns.columns) == list(sel.index)
    assert res.returns.index.equals(ref.index)
    for isin, row in sel.iterrows():
        first_own = FRIDAY.rollforward(prices[row["ticker"]].first_valid_index())
        after = res.returns.index > first_own
        pd.testing.assert_series_equal(
            res.returns.loc[after, isin], ref.loc[res.returns.index[after], isin],
            rtol=1e-9, atol=1e-12, check_freq=False,
        )


def test_index_is_w_fri_and_first_week_dropped(synthetic):
    _, _, res = _run(synthetic, "EUR")
    idx = res.returns.index
    assert idx.freqstr == "W-FRI" and (idx.dayofweek == 4).all()
    assert idx[0] == pd.Timestamp("2005-01-14")  # 2005-01-07 has no prior price
    assert np.isfinite(res.returns["IE00B6R52259"]).all()  # proxy covers the early years


def test_extra_price_columns_are_ignored(synthetic):
    sel = _selection(synthetic, "EUR")
    prices = _prices(synthetic, sel).join(synthetic.prices(["SUSE"]))
    res = weekly_returns(prices, sel, synthetic.fx(), "EUR")
    assert list(res.returns.columns) == list(sel.index)


def test_young_fund_is_nan_before_inception(synthetic):
    _, _, res = _run(synthetic, "EUR")
    young = res.returns["SYNYOUNG0001"]
    assert young.loc[:"2023-06-02"].isna().all()  # first own price 2023-06-01 -> first return 2023-06-09
    assert np.isfinite(young.loc["2023-06-09":]).all()
    assert "SYNYOUNG0001" not in res.proxied  # no proxy_ticker


def test_proxied_ranges_eur(synthetic):
    _, _, res = _run(synthetic, "EUR")
    ts = pd.Timestamp
    assert res.proxied["IE00B6R52259"] == (ts("2005-01-14"), ts("2011-10-21"))
    assert res.proxied["IE00BDBRDM35"] == (ts("2005-01-14"), ts("2017-11-24"))
    assert res.proxied["SYNESGEQ0001"] == (ts("2005-01-14"), ts("2015-06-05"))
    assert res.proxied["SYNUSTLEH001"] == (ts("2005-01-14"), ts("2016-03-04"))
    assert res.proxied["SYNBTC000001"] == (ts("2014-09-26"), ts("2020-01-03"))  # proxy itself starts 2014-09-17
    assert set(res.proxied) == {"IE00B6R52259", "IE00BDBRDM35", "SYNESGEQ0001", "SYNUSTLEH001", "SYNBTC000001"}
    assert res.returns["SYNBTC000001"].loc[:"2014-09-19"].isna().all()


def test_proxy_returns_are_converted_to_base(synthetic):
    _, _, res = _run(synthetic, "EUR")
    eq = synthetic.prices(["SYN-EQ"])["SYN-EQ"]
    expected = _weekly_ret(eq / synthetic.fx()["EUR"])  # USD proxy -> EUR
    span = slice("2005-01-14", "2011-10-21")
    pd.testing.assert_series_equal(
        res.returns["IE00B6R52259"].loc[span], expected.loc[span],
        check_names=False, check_freq=False, rtol=1e-9, atol=1e-12,
    )


def test_hedged_fund_proxy_uses_unconverted_returns(synthetic):
    _, _, res = _run(synthetic, "EUR")  # IE00BDBRDM35 is hedged_to EUR
    bd = synthetic.prices(["SYN-BD"])["SYN-BD"]
    unconverted = _weekly_ret(bd)
    converted = _weekly_ret(bd / synthetic.fx()["EUR"])
    span = slice("2005-01-14", "2017-11-24")
    got = res.returns["IE00BDBRDM35"].loc[span]
    pd.testing.assert_series_equal(
        got, unconverted.loc[span], check_names=False, check_freq=False, rtol=1e-9, atol=1e-12
    )
    assert (got - converted.loc[span]).abs().max() > 0.005  # FX moves would have shown up


def test_usd_base_proxy_ranges_match_and_hedge_rule_is_base_specific(synthetic):
    _, _, res = _run(synthetic, "USD")
    ts = pd.Timestamp
    assert res.proxied["IE00B6R52259"] == (ts("2005-01-14"), ts("2011-10-21"))
    assert res.proxied["SYNIBIT00001"] == (ts("2014-09-26"), ts("2024-01-12"))
    # hedged_to == 'EUR' is not the USD base, so the proxy is converted (fx[USD] == 1 makes it identical here)
    bd = synthetic.prices(["SYN-BD"])["SYN-BD"]
    span = slice("2005-01-14", "2017-11-24")
    pd.testing.assert_series_equal(
        res.returns["IE00BDBRDM35"].loc[span], _weekly_ret(bd).loc[span],
        check_names=False, check_freq=False, rtol=1e-9, atol=1e-12,
    )
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/engine_b/test_returns.py -v`
Expected: the two Task 2 tests PASS; every new test FAILS with `NotImplementedError: Lane B`.

- [ ] **Step 3: Implement `weekly_returns`**

In `backend/app/engine/returns.py`, change the import line to `from app.engine.types import ReturnsResult` (already present) and replace the `weekly_returns` body (docstring kept):

```python
def weekly_returns(prices: pd.DataFrame, selection: pd.DataFrame, fx: pd.DataFrame, base: str) -> ReturnsResult:
    """Weekly (W-FRI, last price of week) simple returns in base currency, columns = isin.

    selection: output of universe.select (uses ticker, currency, hedged_to, proxy_ticker, proxy_currency).
    prices: daily local prices containing every selection ticker and proxy ticker.
    Before a fund's first own price, returns come from its proxy_ticker:
      - converted to base, except when the fund is hedged_to == base: then the proxy's local-currency
        returns are used unconverted (approximates a currency-hedged history).
    proxied[isin] = (first proxied week, last proxied week).
    Weeks without data (and no proxy) stay NaN. The first week (no prior price) is dropped.
    """
    with_proxy = selection["proxy_ticker"].notna()
    currencies = {
        **dict(zip(selection["ticker"], selection["currency"])),
        **dict(zip(selection.loc[with_proxy, "proxy_ticker"], selection.loc[with_proxy, "proxy_currency"])),
    }
    local = prices.reindex(columns=list(currencies))
    level = convert_prices(local, currencies, fx, base).resample("W-FRI").last()
    ret = level.pct_change(fill_method=None)
    local_ret = local.resample("W-FRI").last().pct_change(fill_method=None)  # unconverted, for hedged proxies

    columns, proxied = {}, {}
    for isin, row in selection.iterrows():
        r = ret[row["ticker"]]
        start = level[row["ticker"]].first_valid_index()  # week of the first own price
        if pd.notna(row["proxy_ticker"]) and start is not None:
            source = local_ret if row["hedged_to"] == base else ret
            proxy = source[row["proxy_ticker"]]
            early = r.index <= start  # own return of that week needs a prior own price, so it is proxied too
            r = r.where(~early, proxy)
            span = proxy[early].dropna().index
            if len(span):
                proxied[isin] = (span[0], span[-1])
        columns[isin] = r
    returns = pd.DataFrame(columns).iloc[1:].asfreq("W-FRI")
    return ReturnsResult(returns=returns, proxied=proxied)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && uv run pytest tests/engine_b/test_returns.py -v`
Expected: PASS (all tests in the file).

If `test_matches_fixture_reference_after_first_own_week` fails on a single fund with a difference around 1e-3 or larger (not 1e-12), do not loosen the tolerance: inspect that fund's week alignment (`first_own` computation) first. Rounding-level failures (~1e-13) would justify `atol=1e-10`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/returns.py backend/tests/engine_b/test_returns.py
git commit -m "feat(engine): returns.weekly_returns with proxy splice and hedged-proxy rule"
```

---

### Task 4: `risk.covariance`

**Files:**
- Modify: `backend/app/engine/risk.py`
- Test: `backend/tests/engine_b/test_risk.py`

**Interfaces:**
- Consumes: `app.config.{MIN_COVERAGE, PERIODS_PER_YEAR}`, `app.engine.errors.InsufficientHistory`, `pypfopt.risk_models.CovarianceShrinkage`; fixtures `weekly_eur` (reference weekly returns).
- Produces: `covariance(returns: pd.DataFrame, window_years: int, end: pd.Timestamp | None = None) -> tuple[pd.DataFrame, list[str]]` — annualised (x52) Ledoit-Wolf covariance indexed/columned by isin (surviving funds, original order), and the list of isins dropped for insufficient coverage. Never reads rows after `end`. Raises `InsufficientHistory` when nothing usable is left (added to the docstring, not a signature change).

- [ ] **Step 1: Write the failing tests**

`backend/tests/engine_b/test_risk.py`:

```python
import numpy as np
import pandas as pd
import pytest
from sklearn.covariance import ledoit_wolf

from app.engine import risk
from app.engine.errors import InsufficientHistory
from app.engine.risk import covariance

EQ = ["IE00B6R52259", "SYNEUEQ00001", "SYNEMEQ00001", "SYNJPEQ00001", "SYNHLTH00001"]


def _lw(x: pd.DataFrame) -> pd.DataFrame:
    """Independent reference: sklearn Ledoit-Wolf on the raw array, annualised x52."""
    return pd.DataFrame(52 * ledoit_wolf(x.to_numpy())[0], index=x.columns, columns=x.columns)


def test_symmetric_positive_definite_and_labelled(synthetic, weekly_eur):
    cov, dropped = covariance(weekly_eur, 5)
    kept = [c for c in weekly_eur.columns if c != "SYNYOUNG0001"]
    assert dropped == ["SYNYOUNG0001"]
    assert list(cov.index) == kept and list(cov.columns) == kept
    assert np.allclose(cov, cov.T)
    assert np.linalg.eigvalsh(cov.to_numpy()).min() > 0


def test_diagonal_is_close_to_annualised_sample_variance(weekly_eur):
    # shrinkage pulls variances toward their mean, so equality is not expected; equity funds are similar enough
    # for a 15% band.
    cov, _ = covariance(weekly_eur[EQ], 5)
    sample = 52 * weekly_eur[EQ].iloc[-260:].var()
    np.testing.assert_allclose(np.diag(cov), sample.to_numpy(), rtol=0.15)
    assert (cov.to_numpy()[~np.eye(len(EQ), dtype=bool)] > 0).all()  # equities co-move


def test_uses_pypfopt_ledoit_wolf_on_returns_with_frequency_52(monkeypatch, weekly_eur):
    calls = {}
    real = risk.CovarianceShrinkage

    class Spy(real):
        def __init__(self, prices, returns_data=False, frequency=252, **kw):
            calls.update(returns_data=returns_data, frequency=frequency)
            super().__init__(prices, returns_data=returns_data, frequency=frequency, **kw)

    monkeypatch.setattr(risk, "CovarianceShrinkage", Spy)
    cov, _ = covariance(weekly_eur[EQ], 5)
    assert calls == {"returns_data": True, "frequency": 52}
    pd.testing.assert_frame_equal(cov, _lw(weekly_eur[EQ].iloc[-260:]))


@pytest.mark.parametrize("years", [1, 3, 5])
def test_window_is_last_52_weeks_per_year(weekly_eur, years):
    cov, dropped = covariance(weekly_eur[EQ], years)
    assert dropped == []
    pd.testing.assert_frame_equal(cov, _lw(weekly_eur[EQ].iloc[-52 * years :]))


def test_end_bounds_the_window_and_later_rows_are_never_read(weekly_eur):
    end = pd.Timestamp("2020-12-31")
    clean, dropped = covariance(weekly_eur, 5, end=end)
    assert dropped == ["SYNYOUNG0001"]  # no data at all before 2023
    truncated, _ = covariance(weekly_eur.loc[:end], 5)
    pd.testing.assert_frame_equal(clean, truncated)

    corrupted = weekly_eur.copy()
    after = corrupted.index > end
    corrupted.loc[after] = np.random.default_rng(1).normal(0, 5, size=(after.sum(), corrupted.shape[1]))
    garbage, dropped_garbage = covariance(corrupted, 5, end=end)
    pd.testing.assert_frame_equal(clean, garbage)
    assert dropped_garbage == dropped

    expected = _lw(weekly_eur.loc[:end].iloc[-260:].drop(columns="SYNYOUNG0001"))
    pd.testing.assert_frame_equal(clean, expected)


def test_min_coverage_drops_young_fund_in_five_year_window(weekly_eur):
    # SYNYOUNG0001 has ~133 valid weeks of 260 (51% < 80%)
    cov, dropped = covariance(weekly_eur, 5)
    assert dropped == ["SYNYOUNG0001"] and "SYNYOUNG0001" not in cov.columns
    # in a 2-year window it has full coverage and is kept
    cov2, dropped2 = covariance(weekly_eur, 2)
    assert dropped2 == [] and "SYNYOUNG0001" in cov2.columns


def test_partial_coverage_is_kept_and_nan_rows_are_dropped(weekly_eur):
    w = weekly_eur[EQ[:3]].copy()
    w.iloc[-260:-230, 1] = np.nan  # 30 NaN weeks -> 88.5% coverage, above the 80% bar
    cov, dropped = covariance(w, 5)
    assert dropped == []
    pd.testing.assert_frame_equal(cov, _lw(w.iloc[-260:].dropna()))


def test_nothing_usable_raises_no_data(weekly_eur):
    empty = pd.DataFrame(np.nan, index=weekly_eur.index[:300], columns=["A", "B"])
    with pytest.raises(InsufficientHistory):
        covariance(empty, 5)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/engine_b/test_risk.py -v`
Expected: FAIL with `NotImplementedError: Lane B` (the monkeypatch test fails with `AttributeError: module 'app.engine.risk' has no attribute 'CovarianceShrinkage'`).

- [ ] **Step 3: Implement `backend/app/engine/risk.py`**

Replace the whole file:

```python
"""Lane B. Spec §5.3."""

import pandas as pd
from pypfopt.risk_models import CovarianceShrinkage

from app import config
from app.engine.errors import InsufficientHistory


def covariance(returns: pd.DataFrame, window_years: int, end: pd.Timestamp | None = None) -> tuple[pd.DataFrame, list[str]]:
    """Ledoit-Wolf shrunk, annualised (x52) covariance of weekly returns.

    Window: the last window_years*52 weeks up to and including `end` (default: last row). Never reads rows after `end`.
    Funds with fewer than config.MIN_COVERAGE non-NaN weeks in the window are dropped; their isins are the
    second return value. Remaining rows containing any NaN are dropped before estimation.
    Returns (cov indexed/columned by isin, dropped isins).
    Raises InsufficientHistory if no fund or fewer than 52 complete weeks remain.
    """
    window = (returns if end is None else returns.loc[:end]).iloc[-window_years * config.PERIODS_PER_YEAR :]
    coverage = window.notna().mean()
    dropped = coverage.index[coverage < config.MIN_COVERAGE].tolist()
    usable = window.drop(columns=dropped).dropna()
    if usable.shape[1] == 0 or len(usable) < config.PERIODS_PER_YEAR:
        raise InsufficientHistory("not enough overlapping weekly returns in the estimation window")
    cov = CovarianceShrinkage(usable, returns_data=True, frequency=config.PERIODS_PER_YEAR).ledoit_wolf()
    return cov, dropped
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && uv run pytest tests/engine_b/test_risk.py -v`
Expected: PASS (all tests).

If `test_diagonal_is_close_to_annualised_sample_variance` fails, print `np.diag(cov) / sample.to_numpy()`; a ratio outside 0.85–1.15 means the shrinkage intensity is larger than expected: report the ratios to the integrator instead of widening the band silently.

- [ ] **Step 5: Run the whole lane suite and the frozen-contract tests, then commit**

Run: `cd backend && uv run pytest tests/engine_b tests/test_contract.py -v`
Expected: all PASS (the Phase 0 contract test still finds `select`, `convert_prices`, `weekly_returns`, `covariance` as functions).

```bash
git add backend/app/engine/risk.py backend/tests/engine_b/test_risk.py
git commit -m "feat(engine): risk.covariance (Ledoit-Wolf, windowed, coverage filter)"
```

---

## Self-review

- **Spec coverage:** §5.1 all filters, ordering, listing rule, `NoEligibleFunds` → Task 1. §5.2 FX conversion, weekly last-price, simple returns, proxy splice + mask, NaN weeks → Tasks 2–3. §5.3 window, 80% coverage drop reported, Ledoit-Wolf via PyPortfolioOpt, x52 → Task 4. Required test list: every bullet maps to a test above (esg_only, UCITS-by-base, ETP/ETC kept, crypto rules incl. risk 60 / cap 0.05, hedge rule EUR and USD, regions with `global`, sectors, max_ter, distribution, listing choices, `NoEligibleFunds`; convert round trip, reference match, proxied ranges, hedged proxy rule, young fund, W-FRI, first week dropped; PSD/symmetry, diagonal, `end` window, coverage drop, pypfopt call arguments).
- **Placeholders:** none; every step has complete code and commands.
- **Type consistency:** `select` returns index `isin` + `ticker/exchange/currency`, which `weekly_returns` reads via `selection["ticker"|"currency"|"hedged_to"|"proxy_ticker"|"proxy_currency"]`; `ReturnsResult(returns, proxied)` matches `types.py`; `covariance` returns `(DataFrame, list[str])` as frozen.
