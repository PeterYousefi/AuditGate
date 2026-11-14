import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import (
    init_schema_validation,
    seed_default_policy_if_missing,
    close_mongodb_connection
)
from app.database.orders_service import seed_default_orders_if_missing
from app.agent.hitl_manager import start_change_stream_background_listener
from app.api import api_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("AuditGate")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup & shutdown lifespan event handler:
    1. Enforces MongoDB Atlas $jsonSchema validation on 'audit_logs'
    2. Seeds default identity & policy document in 'policies'
    3. Starts background MongoDB Change Stream listener on 'refund_requests'
    """
    logger.info("==================================================")
    logger.info("Initializing AuditGate Governance & Policy Engine")
    logger.info("==================================================")

    # 1. Enforce $jsonSchema validation at MongoDB engine level
    init_schema_validation()

    # 2. Seed default policy document & realistic demo orders
    seed_default_policy_if_missing()
    seed_default_orders_if_missing()

    # 3. Start background MongoDB Change Stream listener
    start_change_stream_background_listener()

    logger.info("AuditGate is fully initialized and operational!")
    yield

    # Clean shutdown
    logger.info("Shutting down AuditGate...")
    close_mongodb_connection()


app = FastAPI(
    title="AuditGate",
    description="Identity, Policy, State, and Tamper-Proof Audit Layer for Autonomous AI Agents",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(api_router)

# Static files and frontend SPA
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def serve_index():
    """Serves the single-page HTML/Tailwind/JS governance dashboard."""
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "AuditGate API is active. Frontend index.html loading..."}


@app.get("/health")
async def health_check():
    """Health check endpoint confirming MongoDB Atlas connection."""
    from app.database import get_database
    db = get_database()
    colls = db.list_collection_names()
    return {
        "status": "healthy",
        "database": db.name,
        "collections": colls
    }
