import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_data
from app.main import app


@pytest.fixture
def client(synthetic):
    app.dependency_overrides[get_data] = lambda: synthetic
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_data, None)
