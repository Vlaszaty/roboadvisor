import threading

from fastapi import APIRouter, Depends

from app.api.deps import ENGINE_LOCK, get_data
from app.engine import menu
from app.engine.types import DataSource, Frontier, Recommendation

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


# The frontier is the slow part of the method page (seconds on a small server) and is the same for every strength
# of a base, so it is computed once per base and data version.
_frontiers: dict[tuple[int, str | None, str], Frontier] = {}
_frontier_lock = threading.Lock()


def cached_frontier(base: menu.Base, data: DataSource) -> Frontier:
    key = (id(data), data.last_ingest(), base)
    with _frontier_lock:
        if key not in _frontiers:
            with ENGINE_LOCK:
                _frontiers[key] = menu.frontier(base, data)
        return _frontiers[key]


@router.post("/menu/frontier", response_model=Frontier)
def frontier(body: menu.OrderRequest, data: DataSource = Depends(get_data)) -> Frontier:
    return cached_frontier(body.base, data)
