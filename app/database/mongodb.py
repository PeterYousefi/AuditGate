import logging
from typing import Optional
import certifi
from pymongo import MongoClient, AsyncMongoClient
from pymongo.database import Database
from pymongo.collection import Collection

from app.config import settings

logger = logging.getLogger(__name__)

_mongo_client: Optional[MongoClient] = None
_async_mongo_client: Optional[AsyncMongoClient] = None


def get_mongodb_client() -> MongoClient:
    """Returns singleton synchronous MongoDB Atlas client instance (used by MongoDBSaver)."""
    global _mongo_client
    if _mongo_client is None:
        logger.info("Initializing synchronous MongoDB Atlas connection pool...")
        _mongo_client = MongoClient(
            settings.MONGODB_URI,
            tlsCAFile=certifi.where(),
            serverSelectionTimeoutMS=10000,
            connectTimeoutMS=10000,
            appname="AuditGate-Sync"
        )
    return _mongo_client


def get_async_mongodb_client() -> AsyncMongoClient:
    """Returns singleton AsyncMongoClient for async FastAPI endpoints and Change Streams."""
    global _async_mongo_client
    if _async_mongo_client is None:
        logger.info("Initializing asynchronous MongoDB Atlas connection pool...")
        _async_mongo_client = AsyncMongoClient(
            settings.MONGODB_URI,
            tlsCAFile=certifi.where(),
            serverSelectionTimeoutMS=10000,
            connectTimeoutMS=10000,
            appname="AuditGate-Async"
        )
    return _async_mongo_client


def get_database(db_name: Optional[str] = None) -> Database:
    """Returns the synchronous target MongoDB database (default: 'auditable_agent')."""
    client = get_mongodb_client()
    return client[db_name or settings.MONGODB_DB_NAME]


def get_collection(collection_name: str) -> Collection:
    """Helper to get a typed synchronous MongoDB collection."""
    db = get_database()
    return db[collection_name]


def get_async_database(db_name: Optional[str] = None):
    """Returns the asynchronous target MongoDB database."""
    client = get_async_mongodb_client()
    return client[db_name or settings.MONGODB_DB_NAME]


def get_async_collection(collection_name: str):
    """Helper to get a typed asynchronous MongoDB collection."""
    db = get_async_database()
    return db[collection_name]


async def close_async_mongodb_connection() -> None:
    """Closes the async MongoDB Atlas connection pool cleanly on shutdown."""
    global _async_mongo_client
    if _async_mongo_client is not None:
        logger.info("Closing async MongoDB Atlas connection pool...")
        await _async_mongo_client.close()
        _async_mongo_client = None


def close_mongodb_connection() -> None:
    """Closes both synchronous and asynchronous MongoDB Atlas connection pools cleanly."""
    global _mongo_client, _async_mongo_client
    if _mongo_client is not None:
        logger.info("Closing synchronous MongoDB Atlas connection pool...")
        _mongo_client.close()
        _mongo_client = None
    if _async_mongo_client is not None:
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(_async_mongo_client.close())
            else:
                loop.run_until_complete(_async_mongo_client.close())
        except Exception:
            pass
        _async_mongo_client = None
