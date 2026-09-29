import sqlite3
from pathlib import Path

import app.data

SCHEMA = Path(app.data.__file__).with_name("schema.sql")


def test_schema_creates_tables():
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA.read_text())
    names = {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
    assert {"fund", "listing", "price", "fx", "rf_rate", "meta"} <= names
    cols = [r[1] for r in conn.execute("pragma table_info(fund)")]
    assert cols[0] == "isin" and "proxy_currency" in cols and "wrapper" in cols
