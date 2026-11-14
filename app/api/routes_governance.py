import logging
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.database import get_collection
from app.database.policy_service import get_live_policy, update_policy_limit
from app.agent.hitl_manager import resume_interrupted_thread

logger = logging.getLogger(__name__)

router = APIRouter()

REFUND_REQUESTS_COLLECTION = "refund_requests"


class PolicyUpdateRequest(BaseModel):
    max_auto_refund: float = Field(..., ge=0, description="New maximum automated refund threshold in USD")
    agent_id: Optional[str] = Field("agent_01", description="Target agent ID")


class ManagerDecisionRequest(BaseModel):
    manager_notes: Optional[str] = Field("Approved via Governance Console", description="Optional audit notes")


@router.get("/api/policies")
async def get_policy_endpoint(agent_id: str = "agent_01"):
    """
    Returns the live policy document directly from MongoDB Atlas 'policies' collection.
    Guarantees no local caching.
    """
    try:
        policy = get_live_policy(agent_id)
        return {"success": True, "policy": policy}
    except Exception as e:
        logger.error(f"Failed to fetch live policy: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/api/policies")
async def update_policy_endpoint(req: PolicyUpdateRequest):
    """
    Updates the live max_auto_refund policy threshold in MongoDB Atlas.
    Demonstrates immediate agent obedience to policy modifications.
    """
    try:
        updated = update_policy_limit(req.max_auto_refund, req.agent_id or "agent_01")
        return {
            "success": True,
            "message": f"MongoDB Atlas policy updated: max_auto_refund is now ${updated['max_auto_refund']:.2f}",
            "policy": updated
        }
    except Exception as e:
        logger.error(f"Failed to update policy: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/refund-requests")
async def list_refund_requests_endpoint(status: Optional[str] = None):
    """
    Lists refund requests from MongoDB Atlas 'refund_requests' collection.
    """
    try:
        col = get_collection(REFUND_REQUESTS_COLLECTION)
        query = {"status": status} if status else {}
        cursor = col.find(query).sort("created_at", -1).limit(50)
        
        requests_list = []
        for doc in cursor:
            doc["_id"] = str(doc["_id"])
            requests_list.append(doc)
            
        return {"success": True, "requests": requests_list}
    except Exception as e:
        logger.error(f"Failed to list refund requests: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/approve/{request_id}")
async def approve_refund_endpoint(request_id: str, body: Optional[ManagerDecisionRequest] = None):
    """
    Manager approves a paused refund request.
    Updates MongoDB Atlas document and resumes the paused LangGraph workflow.
    """
    try:
        notes = body.manager_notes if body else "Approved by Human Manager"
        resumed = resume_interrupted_thread(
            request_id=request_id,
            approved=True,
            decided_by="Governance Console Manager",
            notes=notes
        )
        return {
            "success": True,
            "message": f"Refund request '{request_id}' has been approved and LangGraph thread resumed.",
            "data": resumed
        }
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to approve request {request_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/reject/{request_id}")
async def reject_refund_endpoint(request_id: str, body: Optional[ManagerDecisionRequest] = None):
    """
    Manager rejects a paused refund request.
    Updates MongoDB Atlas document and resumes the paused LangGraph workflow.
    """
    try:
        notes = body.manager_notes if body else "Declined by Human Manager"
        resumed = resume_interrupted_thread(
            request_id=request_id,
            approved=False,
            decided_by="Governance Console Manager",
            notes=notes
        )
        return {
            "success": True,
            "message": f"Refund request '{request_id}' has been declined and LangGraph thread resumed.",
            "data": resumed
        }
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to reject request {request_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
