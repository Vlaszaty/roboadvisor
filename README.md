# Robo-Advisor

Spec: `docs/superpowers/specs/2026-09-29-roboadvisor-design.md` · Plans: `docs/superpowers/plans/`

## Backend (port 8740)

```bash
cd backend
uv sync
uv run python -m app.data.ingest        # download data (first run: all history)
uv run uvicorn app.main:app --port 8740 --reload
uv run pytest
```

API docs: http://localhost:8740/docs

After changing `app/engine/types.py` or `app/api/schemas.py`:

```bash
uv run python -m scripts.export_contract   # backend/openapi.json + frontend mocks
cd ../frontend && npm run gen:api
```

## Frontend (port 5740)

```bash
cd frontend
npm install
npm run dev          # talks to the backend on 8740 via /api proxy
npm run dev:mock     # no backend needed, serves src/mocks/*.json
npm test && npm run typecheck
```
