import logging
from typing import Optional
import certifi
from pymongo import MongoClient
from pymongo.database import Database
from pymongo.collection import Collection

from app.config import settings

logger = logging.getLogger(__name__)

_mongo_client: Optional[MongoClient] = None


def get_mongodb_client() -> MongoClient:
    """Returns singleton MongoDB Atlas client instance."""
    global _mongo_client
    if _mongo_client is None:
        logger.info("Initializing MongoDB Atlas connection pool...")
        _mongo_client = MongoClient(
            settings.MONGODB_URI,
            tlsCAFile=certifi.where(),
            serverSelectionTimeoutMS=10000,
            connectTimeoutMS=10000,
            appname="AuditGate"
        )
    return _mongo_client


def get_database(db_name: Optional[str] = None) -> Database:
    """Returns the target MongoDB database (default: 'auditable_agent')."""
    client = get_mongodb_client()
    return client[db_name or settings.MONGODB_DB_NAME]


def get_collection(collection_name: str) -> Collection:
    """Helper to get a typed MongoDB collection from the auditable_agent database."""
    db = get_database()
    return db[collection_name]


def close_mongodb_connection() -> None:
    """Closes the MongoDB Atlas connection pool cleanly on shutdown."""
    global _mongo_client
    if _mongo_client is not None:
        logger.info("Closing MongoDB Atlas connection pool...")
        _mongo_client.close()
        _mongo_client = None
