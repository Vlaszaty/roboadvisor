from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app import config
import threading

from app.api import backtest, frontier, health, intake, menu, portfolio, textbook, universe
from app.api.deps import get_data_optional
from app.engine.errors import DomainError

# One schema per model (no -Input/-Output split) keeps the generated TypeScript types simple.
app = FastAPI(title="Robo-Advisor API", version="0.1.0", separate_input_output_schemas=False)
app.add_middleware(
    CORSMiddleware, allow_origins=config.FRONTEND_ORIGINS, allow_methods=["*"], allow_headers=["*"]
)
for module in (health, intake, universe, portfolio, backtest, frontier, textbook, menu):
    app.include_router(module.router, prefix="/api")


@app.on_event("startup")
def warm_menu() -> None:
    """Build the café menu in the background so the first visitor does not wait for it."""
    if config.WARM_MENU and (data := get_data_optional()) is not None:
        threading.Thread(target=lambda: _safe_warm(data), daemon=True).start()


def _safe_warm(data) -> None:
    try:
        menu.cached_menu(data)
        for base in menu.menu.BASES:  # the method page's chart
            menu.cached_frontier(base, data)
    except Exception as exc:  # the endpoint reports errors on request; warming must never crash the server
        print(f"menu warm-up failed: {exc}")


@app.exception_handler(DomainError)
async def domain_error(_: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": type(exc).__name__, "detail": str(exc)})


@app.exception_handler(NotImplementedError)
async def not_implemented(_: Request, exc: NotImplementedError) -> JSONResponse:
    return JSONResponse(status_code=501, content={"error": "NotImplemented", "detail": str(exc) or "not built yet"})


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str) -> FileResponse:
    """The built frontend (one container serves both); unknown paths get index.html for client-side routes."""
    if path == "api" or path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")
    root = config.STATIC_DIR.resolve()
    file = (root / path).resolve()
    if path and file.is_file() and file.is_relative_to(root):
        return FileResponse(file)
    if not (root / "index.html").is_file():
        raise HTTPException(status_code=404, detail="Not Found")
    return FileResponse(root / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=config.API_PORT, reload=True)
