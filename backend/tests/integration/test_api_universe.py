import pandas as pd
import pytest


def test_list_all(client, synthetic):
    body = client.get("/api/universe").json()
    assert len(body) == len(synthetic.funds())
    acwi = next(f for f in body if f["isin"] == "IE00B6R52259")
    assert set(acwi["tickers"]) == {"IUSQ.DE", "SSAC.L"}
    assert acwi["has_proxy"] is True


@pytest.mark.parametrize("query,check", [
    ("asset_class=bond", lambda f: f["asset_class"] == "bond"),
    ("region=japan", lambda f: f["region"] == "japan"),
    ("esg=true", lambda f: f["esg"] is True),
    ("ucits=false", lambda f: f["ucits"] is False),
    ("max_ter=0.001", lambda f: f["ter"] is None or f["ter"] <= 0.001),
])
def test_filters(client, query, check):
    body = client.get(f"/api/universe?{query}").json()
    assert body and all(check(f) for f in body)


@pytest.mark.parametrize("q,isin", [
    ("iusq", "IE00B6R52259"),          # ticker
    ("ie00bdbrdm35", "IE00BDBRDM35"),  # isin
    ("world health", "SYNHLTH00001"),  # name
    ("s&p technology", "SYNTECH00001"),  # index name
])
def test_search(client, q, isin):
    body = client.get("/api/universe", params={"q": q}).json()
    assert isin in {f["isin"] for f in body}


def test_search_without_match_is_empty(client):
    assert client.get("/api/universe", params={"q": "zzz-no-such-fund"}).json() == []


def test_detail_uses_primary_listing_converted_weekly(client, synthetic):
    eur = client.get("/api/universe/IE00B6R52259").json()
    usd = client.get("/api/universe/IE00B6R52259", params={"base_currency": "USD"}).json()
    assert [l["ticker"] for l in eur["listings"] if l["is_primary"]] == ["IUSQ.DE"]
    dates = pd.to_datetime([p["date"] for p in eur["history"]])
    assert dates[0] >= pd.Timestamp("2011-10-21") and (dates.dayofweek == 4).all()
    assert len(eur["history"]) == len(usd["history"]) > 700
    fx_last = synthetic.fx()["EUR"].resample("W-FRI").last().loc[dates[-1]]
    assert usd["history"][-1]["value"] == pytest.approx(eur["history"][-1]["value"] * fx_last, rel=1e-4)


def test_detail_unknown_isin_is_404(client):
    r = client.get("/api/universe/XX0000000000")
    assert r.status_code == 404
    assert "XX0000000000" in r.json()["detail"]


class _PenceLondon:
    """SyntheticData stand-in whose primary listing is a .L / GBP line quoted in pence (raw level x100)."""

    def __init__(self, base, isin):
        self._b = base
        all_ls = base.listings()
        self._src = all_ls[(all_ls["isin"] == isin) & all_ls["is_primary"]].iloc[0]["ticker"]
        row = all_ls[all_ls["ticker"] == self._src].iloc[0].copy()
        row["ticker"], row["exchange"], row["currency"] = "PENCE.L", "LSE", "GBP"
        ls = all_ls[all_ls["ticker"] != self._src]
        self._ls = pd.concat([ls, row.to_frame().T], ignore_index=True)
        self._ls["is_primary"] = self._ls["is_primary"].astype(bool)

    def funds(self): return self._b.funds()
    def listings(self): return self._ls
    def fx(self): return self._b.fx().assign(GBP=1.25)

    def prices(self, tickers):
        df = self._b.prices([self._src if t == "PENCE.L" else t for t in tickers])
        df.columns = tickers
        return df * 100  # pence


def test_gbp_london_history_is_in_pounds_not_pence(synthetic):
    from app.api.deps import get_data
    from app.main import app
    from fastapi.testclient import TestClient

    isin = "IE00B6R52259"
    stub = _PenceLondon(synthetic, isin)
    app.dependency_overrides[get_data] = lambda: stub
    try:
        body = TestClient(app).get(f"/api/universe/{isin}", params={"base_currency": "USD"}).json()
    finally:
        app.dependency_overrides.pop(get_data, None)
    pence = stub.prices(["PENCE.L"])["PENCE.L"].resample("W-FRI").last().dropna()
    assert body["history"][-1]["value"] == pytest.approx(pence.iloc[-1] / 100 * 1.25, rel=1e-4)
    assert [l["ticker"] for l in body["listings"] if l["is_primary"]] == ["PENCE.L"]
