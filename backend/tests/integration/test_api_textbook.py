def test_api_textbook_validates(client):
    assert client.post("/api/textbook", json={"risk_level": 101}).status_code == 422
    assert client.post("/api/textbook", json={"market_premium": 0.5}).status_code == 422
    assert client.post("/api/textbook", json={"return_model": "guess"}).status_code == 422
    assert client.post("/api/textbook", json={"base_currency": "GBP"}).status_code == 422
