"""Explicit local café demo: real engine, deterministic synthetic prices, no DB/network.

Run: uv run python -m scripts.cafe_preview
Never imported by the production app. Preview responses identify their synthetic source.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api import health, portfolio
from app.api.deps import get_data, get_data_optional
from app.engine.errors import DomainError
from tests.fixtures.synthetic import SyntheticData


class CafeDemoData(SyntheticData):
    def funds(self):
        funds = super().funds()
        # Illustrative ESG labels give the demo an investable ESG mix; NOT actual fund classifications.
        funds.loc[["SYNESGEQ0001", "SYNGOVS00001", "SYNCORP00001", "SYNCASH00001"], "esg"] = True
        return funds


def create_app() -> FastAPI:
    preview = FastAPI(title="Café preview — SYNTHETIC DATA ONLY")
    source = CafeDemoData()
    preview.dependency_overrides[get_data] = lambda: source
    preview.dependency_overrides[get_data_optional] = lambda: source
    preview.include_router(health.router, prefix="/api")
    preview.include_router(portfolio.router, prefix="/api")

    @preview.middleware("http")
    async def identify_source(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Cafe-Data"] = "synthetic"
        return response

    @preview.exception_handler(DomainError)
    async def domain_error(_: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": type(exc).__name__, "detail": str(exc)})

    return preview


if __name__ == "__main__":
    import uvicorn

    print("SYNTHETIC café preview: fictitious prices and ESG labels, real portfolio engine. No market database is modified.")
    uvicorn.run(create_app(), host="127.0.0.1", port=8741)
