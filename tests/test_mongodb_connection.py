import pytest
from app.database import get_mongodb_client, get_database, get_collection
from app.config import settings


def test_mongodb_atlas_ping():
    """Confirms live connectivity to MongoDB Atlas cluster."""
    client = get_mongodb_client()
    ping_res = client.admin.command("ping")
    assert ping_res.get("ok") == 1.0, f"Expected ping ok=1.0, got: {ping_res}"


def test_mongodb_database_and_collections():
    """Confirms target database 'auditable_agent' and core collections exist or are accessible."""
    db = get_database()
    assert db.name == settings.MONGODB_DB_NAME
    collections = db.list_collection_names()
    assert isinstance(collections, list)
