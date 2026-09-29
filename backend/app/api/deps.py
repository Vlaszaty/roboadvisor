from functools import lru_cache

from app import config
from app.engine.errors import NoData
from app.engine.types import DataSource


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
