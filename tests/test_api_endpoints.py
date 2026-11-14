from fastapi.testclient import TestClient
from app.main import app

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
    """Tests /api/chat with an amount below the policy threshold."""
    response = client.post(
        "/api/chat",
        json={"message": "Please refund $10 for a defective cable.", "customer_id": "cust_test_api"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "AUTO_APPROVED"
    assert "$10.00" in data["response"]
