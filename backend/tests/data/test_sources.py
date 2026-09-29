from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.data import sources

DAYS = pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04"])


def _multi(data: dict[str, list[float]], index=DAYS) -> pd.DataFrame:
    """Shape of yf.download(list, group_by='column'): MultiIndex (field, ticker)."""
    cols, arrays = [], []
    for field in ("Close", "Volume"):
        for t, v in data.items():
            cols.append((field, t))
            arrays.append(np.array(v) if field == "Close" else np.ones(len(v)))
    return pd.DataFrame(dict(zip(cols, arrays)), index=index)


def test_fetch_prices_batches_and_drops_empty_columns(monkeypatch):
    calls = []

    def fake(batch, start):
        calls.append((list(batch), start))
        data = {t: [1.0, 2.0, 3.0] for t in batch}
        if "DEAD" in batch:
            data["DEAD"] = [np.nan] * 3  # yfinance keeps failed tickers as all-NaN columns
        return _multi(data)

    monkeypatch.setattr(sources, "_download", fake)
    monkeypatch.setattr(sources, "BATCH_SIZE", 2)
    out = sources.fetch_prices(["A", "B", "DEAD", "A", "C"], date(2020, 1, 1))
    assert calls == [(["A", "B"], date(2020, 1, 1)), (["DEAD", "C"], date(2020, 1, 1))]
    assert list(out.columns) == ["A", "B", "C"]
    assert isinstance(out.index, pd.DatetimeIndex) and len(out) == 3


def test_fetch_prices_normalises_timezone_and_time_of_day(monkeypatch):
    idx = pd.DatetimeIndex(["2024-01-02 09:00", "2024-01-03 09:00"], tz="Europe/Berlin")
    monkeypatch.setattr(sources, "_download", lambda b, s: _multi({"A": [1.0, 2.0]}, idx))
    out = sources.fetch_prices(["A"], None)
    assert out.index.tz is None
    assert list(out.index) == [pd.Timestamp("2024-01-02"), pd.Timestamp("2024-01-03")]


def test_fetch_prices_accepts_flat_columns_for_single_ticker(monkeypatch):
    flat = pd.DataFrame({"Close": [1.0, 2.0, 3.0], "Volume": [1, 1, 1]}, index=DAYS)
    monkeypatch.setattr(sources, "_download", lambda b, s: flat)
    assert list(sources.fetch_prices(["A"], None).columns) == ["A"]


def test_fetch_prices_survives_a_failed_batch(monkeypatch, capsys):
    def fake(batch, start):
        if "BAD" in batch:
            raise RuntimeError("boom")
        return _multi({t: [1.0, 2.0, 3.0] for t in batch})

    monkeypatch.setattr(sources, "_download", fake)
    monkeypatch.setattr(sources, "BATCH_SIZE", 1)
    out = sources.fetch_prices(["A", "BAD", "C"], None)
    assert list(out.columns) == ["A", "C"]
    assert "price download failed" in capsys.readouterr().err


def test_fetch_prices_returns_empty_frame_when_nothing_comes_back(monkeypatch):
    monkeypatch.setattr(sources, "_download", lambda b, s: pd.DataFrame())
    assert sources.fetch_prices(["A"], None).empty
    assert sources.fetch_prices([], None).empty


def test_fetch_fx_uses_usd_quoted_tickers_and_skips_usd(monkeypatch):
    seen = []

    def fake(tickers, start):
        seen.append(list(tickers))
        return pd.DataFrame({t: [1.1, 1.2, 1.3] for t in tickers}, index=DAYS)

    monkeypatch.setattr(sources, "fetch_prices", fake)
    out = sources.fetch_fx(["EUR", "USD", "GBP", "EUR"], None)
    assert seen == [["EURUSD=X", "GBPUSD=X"]]
    assert list(out.columns) == ["EUR", "GBP"]
    assert sources.fetch_fx(["USD"], None).empty


def test_fetch_rf_usd_divides_irx_by_100(monkeypatch):
    monkeypatch.setattr(
        sources, "fetch_prices", lambda t, s: pd.DataFrame({"^IRX": [5.25, np.nan, 5.0]}, index=DAYS)
    )
    rf = sources.fetch_rf("USD", None)
    assert rf.name == "USD"
    assert rf.tolist() == pytest.approx([0.0525, 0.05])


ECB_CSV_EONIA = "KEY,FREQ,TIME_PERIOD,OBS_VALUE,OBS_STATUS\nEON.D.EONIA_TO.RATE,D,2019-09-27,-0.452,A\nEON.D.EONIA_TO.RATE,D,2019-09-30,-0.460,A\n"
ECB_CSV_ESTR = "KEY,FREQ,TIME_PERIOD,OBS_VALUE,OBS_STATUS\nEST.B.EU000A2X2A25.WT,B,2019-10-01,-0.549,A\nEST.B.EU000A2X2A25.WT,B,2019-10-02,-0.550,A\n"


def _fake_ecb(calls):
    def fake(url, params):
        calls.append((url, dict(params)))
        if "/EON/" in url:
            return ECB_CSV_EONIA
        return ECB_CSV_ESTR

    return fake


def test_fetch_rf_eur_splices_eonia_and_estr(monkeypatch):
    calls = []
    monkeypatch.setattr(sources, "_http_get", _fake_ecb(calls))
    rf = sources.fetch_rf("EUR", None)
    assert calls == [
        ("https://data-api.ecb.europa.eu/service/data/EON/D.EONIA_TO.RATE",
         {"format": "csvdata", "endPeriod": "2019-09-30"}),
        ("https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT",
         {"format": "csvdata", "startPeriod": "2019-10-01"}),
    ]
    assert rf.name == "EUR"
    assert [d.strftime("%Y-%m-%d") for d in rf.index] == ["2019-09-27", "2019-09-30", "2019-10-01", "2019-10-02"]
    assert rf.tolist() == pytest.approx([-0.00452, -0.0046, -0.00549, -0.0055])  # percent -> fraction


def test_fetch_rf_eur_incremental_skips_eonia(monkeypatch):
    calls = []
    monkeypatch.setattr(sources, "_http_get", _fake_ecb(calls))
    sources.fetch_rf("EUR", date(2024, 1, 2))
    assert len(calls) == 1
    assert calls[0][0].endswith("/EST/B.EU000A2X2A25.WT") and calls[0][1]["startPeriod"] == "2024-01-02"


def test_fetch_rf_eur_with_empty_ecb_answer(monkeypatch):
    monkeypatch.setattr(sources, "_http_get", lambda url, params: "")
    rf = sources.fetch_rf("EUR", date(2030, 1, 1))
    assert rf.empty and rf.name == "EUR"


def test_fetch_rf_rejects_other_currencies():
    with pytest.raises(ValueError):
        sources.fetch_rf("CHF", None)


def test_fetch_currencies_normalises_pence(monkeypatch):
    table = {"A.L": "GBp", "B.DE": "EUR", "C": "USD"}
    monkeypatch.setattr(sources, "_yahoo_currency", lambda t: table.get(t))
    assert sources.fetch_currencies(["A.L", "B.DE", "C", "UNKNOWN"]) == {"A.L": "GBP", "B.DE": "EUR", "C": "USD"}
