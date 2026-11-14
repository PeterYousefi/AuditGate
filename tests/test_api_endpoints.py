from fastapi.testclient import TestClient
from app.main import app
from app.database.orders_service import seed_default_orders_if_missing
from app.database.policy_service import update_policy_limit

client = TestClient(app)


def test_health_endpoint():
    """Tests the /health endpoint verifying MongoDB database status."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["database"] == "auditable_agent"


def test_get_policies_endpoint():
    """Tests /api/policies returns the live MongoDB policy."""
    response = client.get("/api/policies")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "max_auto_refund" in data["policy"]


def test_test_schema_enforcement_endpoint():
    """Tests /api/test-schema-enforcement triggers MongoDB $jsonSchema rejection."""
    response = client.post("/api/test-schema-enforcement")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["result"]["blocked"] is True
    assert data["result"]["error_code"] == 121


def test_chat_auto_refund_endpoint():
    """Tests /api/chat with a verified numeric order and amount below policy threshold."""
    seed_default_orders_if_missing()
    update_policy_limit(50.0, "agent_01")
    response = client.post(
        "/api/chat",
        json={"message": "Please refund $28 for order 1042. Email: alex@example.com.", "customer_id": "cust_test_api"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "AUTO_APPROVED"
    assert "$28" in data["response"]
    assert "1042" in data["response"]


def test_voice_greeting_endpoint():
    """Tests GET /api/voice/greeting returns ElevenLabs audio and brand pronunciation."""
    response = client.get("/api/voice/greeting")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "welcome" in data["text"].lower()
    assert "audit gate" in data["spoken_text"].lower()
    assert data["audio_base64"] is not None


def test_reset_endpoint():
    """Tests POST /api/reset resets collections concurrently in parallel."""
    response = client.post("/api/reset")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "reset complete" in data["message"].lower()


def test_analytics_endpoint():
    """Tests GET /api/analytics returns faceted aggregation data."""
    response = client.get("/api/analytics")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "analytics" in data
    assert "total_events" in data["analytics"]
    assert "block_rate_percent" in data["analytics"]
