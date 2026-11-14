from fastapi import APIRouter
from app.api.routes_chat import router as chat_router
from app.api.routes_governance import router as governance_router
from app.api.routes_audit import router as audit_router
from app.api.routes_voice import router as voice_router

api_router = APIRouter()
api_router.include_router(chat_router, tags=["Customer Chat"])
api_router.include_router(governance_router, tags=["Governance & Policy"])
api_router.include_router(audit_router, tags=["Audit Trail & Schema Validation"])
api_router.include_router(voice_router, tags=["Voice"])

__all__ = ["api_router"]
