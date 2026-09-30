import threading
from functools import lru_cache

from app import config
from app.engine.errors import NoData
from app.engine.types import DataSource


# One engine call at a time. SqliteData caches pandas objects that every request shares, and pandas
# builds index lookup tables lazily and not thread-safely: parallel requests on a cold cache raised
# spurious "cannot reindex on an axis with duplicate labels" errors.
# ponytail: global lock (fine for a local single-user app); per-request copies if throughput ever matters.
ENGINE_LOCK = threading.Lock()


@lru_cache(maxsize=1)
def _sqlite(path: str) -> DataSource:
    # ponytail: cached for the process lifetime; restart the server after a re-ingest.
    from app.data.db import SqliteData  # Lane A

    return SqliteData(path)


def get_data() -> DataSource:
    if not config.DB_PATH.exists():
        raise NoData("no data loaded, run `uv run python -m app.data.ingest` in backend/")
    return _sqlite(str(config.DB_PATH))


def get_data_optional() -> DataSource | None:
    try:
        return get_data()
    except (NoData, NotImplementedError):
        return None
