import pytest

from app.data import db


def load_synthetic(conn, synthetic) -> None:
    """Write a SyntheticData market into an initialised DB using the Lane A upsert helpers."""
    funds, listings = synthetic.funds(), synthetic.listings()
    db.upsert_funds(conn, funds)
    db.upsert_listings(conn, listings)
    tickers = list(listings["ticker"]) + ["SYN-EQ", "SYN-BD", "SYN-UST", "SYN-BTC"]
    db.upsert_prices(conn, synthetic.prices(tickers))
    fx = synthetic.fx()
    db.upsert_fx(conn, fx[["EUR"]])
    for ccy in ("USD", "EUR"):
        db.upsert_rf(conn, ccy, synthetic.rf(ccy))
    db.set_meta(conn, "last_ingest", "2025-12-31")


@pytest.fixture(scope="session")
def synthetic_db_path(synthetic, tmp_path_factory):
    path = tmp_path_factory.mktemp("db") / "synthetic.db"
    conn = db.connect(path)
    db.init_db(conn)
    load_synthetic(conn, synthetic)
    conn.close()
    return path
