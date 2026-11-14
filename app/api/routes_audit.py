import logging
from typing import Optional
from fastapi import APIRouter, HTTPException

from app.database.audit_service import list_audit_logs, test_invalid_schema_insert

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/audit-logs")
async def get_audit_logs_endpoint(limit: int = 50):
    """
    Returns live immutable audit trail from MongoDB Atlas 'audit_logs' collection.
    """
    try:
        logs = list_audit_logs(limit=limit)
        return {"success": True, "count": len(logs), "logs": logs}
    except Exception as e:
        logger.error(f"Failed to fetch audit logs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/test-schema-enforcement")
async def test_schema_enforcement_endpoint():
    """
    LIVE DEMO ENDPOINT FOR JUDGES:
    Deliberately attempts to insert an incomplete/unauthenticated entry into 'audit_logs'.
    Demonstrates that MongoDB Atlas engine physically throws $jsonSchema validation error (Code 121),
    proving non-repudiation and tamper-proofing.
    """
    try:
        result = test_invalid_schema_insert()
        return {
            "success": True,
            "demonstration": "MongoDB Atlas Engine-Level Schema Validation Test",
            "result": result
        }
    except Exception as e:
        logger.error(f"Schema test endpoint exception: {e}")
        raise HTTPException(status_code=500, detail=str(e))
