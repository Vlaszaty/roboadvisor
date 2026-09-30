from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import config
from app.api import backtest, frontier, health, intake, portfolio, universe
from app.engine.errors import DomainError

# One schema per model (no -Input/-Output split) keeps the generated TypeScript types simple.
app = FastAPI(title="Robo-Advisor API", version="0.1.0", separate_input_output_schemas=False)
app.add_middleware(
    CORSMiddleware, allow_origins=config.FRONTEND_ORIGINS, allow_methods=["*"], allow_headers=["*"]
)
for module in (health, intake, universe, portfolio, backtest, frontier):
    app.include_router(module.router, prefix="/api")


@app.exception_handler(DomainError)
async def domain_error(_: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": type(exc).__name__, "detail": str(exc)})


@app.exception_handler(NotImplementedError)
async def not_implemented(_: Request, exc: NotImplementedError) -> JSONResponse:
    return JSONResponse(status_code=501, content={"error": "NotImplemented", "detail": str(exc) or "not built yet"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=config.API_PORT, reload=True)
