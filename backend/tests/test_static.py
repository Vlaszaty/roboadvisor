from fastapi.testclient import TestClient

from app import config
from app.main import app


def test_serves_the_built_frontend(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "assets" / "app.js").write_text("js")
    monkeypatch.setattr(config, "STATIC_DIR", tmp_path)
    c = TestClient(app)
    assert c.get("/").text == "<html>app</html>"
    assert c.get("/portfolio").text == "<html>app</html>"  # client-side route
    assert c.get("/assets/app.js").text == "js"
    assert c.get("/../pyproject.toml").text == "<html>app</html>"  # no escape from the static dir
    r = c.get("/api/nope")
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/json")
    assert c.get("/api/health").json()["status"] == "ok"


def test_no_frontend_build_is_a_404(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "STATIC_DIR", tmp_path)
    assert TestClient(app).get("/portfolio").status_code == 404
