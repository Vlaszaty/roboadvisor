import threading

from fastapi import APIRouter, Depends

from app.api.deps import ENGINE_LOCK, get_data
from app.engine import menu
from app.engine.types import DataSource, Recommendation

router = APIRouter(tags=["menu"])

# The full menu takes a while (14 recommendations plus walk-forward backtests), so it is built once per data
# source and data version and then served from memory.
_cache: dict[tuple[int, str | None], menu.Menu] = {}
_cache_lock = threading.Lock()


def cached_menu(data: DataSource) -> menu.Menu:
    key = (id(data), data.last_ingest())
    with _cache_lock:
        if key not in _cache:
            with ENGINE_LOCK:
                _cache.clear()
                _cache[key] = menu.build(data)
        return _cache[key]


@router.get("/menu", response_model=menu.Menu)
def get_menu(data: DataSource = Depends(get_data)) -> menu.Menu:
    return cached_menu(data)


@router.post("/menu/order", response_model=Recommendation)
def order(body: menu.OrderRequest, data: DataSource = Depends(get_data)) -> Recommendation:
    with ENGINE_LOCK:
        return menu.order(body, data)
