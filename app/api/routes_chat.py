import uuid
import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.agent.graph import build_auditgate_graph
from app.agent.hitl_manager import get_graph
from app.database.policy_service import get_live_policy

logger = logging.getLogger(__name__)

router = APIRouter()


class ChatRequest(BaseModel):
    message: str = Field(..., description="Customer message or command")
    thread_id: Optional[str] = Field(None, description="Conversation thread identifier")
    customer_id: Optional[str] = Field("customer_01", description="Customer ID")


class ChatResponse(BaseModel):
    thread_id: str
    status: str
    response: str
    audio_base64: Optional[str] = None
    request_id: Optional[str] = None
    policy_limit_applied: float
    interrupted: bool = False


@router.post("/api/chat", response_model=ChatResponse)
async def process_chat_message(req: ChatRequest):
    """
    Submits a message into the LangGraph governance workflow.
    State is persisted to MongoDB Atlas via MongoDBSaver.
    """
    thread_id = req.thread_id or f"thread_{uuid.uuid4().hex[:8]}"
    graph = get_graph()
    config = {"configurable": {"thread_id": thread_id}}

    # Live policy query
    live_policy = get_live_policy("agent_01")
    limit = live_policy["max_auto_refund"]

    initial_state = {
        "thread_id": thread_id,
        "customer_id": req.customer_id or "customer_01",
        "user_message": req.message,
        "intent": "",
        "requested_amount": None,
        "currency": "USD",
        "reason": None,
        "policy_limit_applied": limit,
        "status": "INIT",
        "request_id": None,
        "final_response": None,
        "audio_base64": None,
        "history": []
    }

    try:
        result = graph.invoke(initial_state, config=config)
        is_interrupted = "__interrupt__" in result
        
        req_id = None
        if is_interrupted:
            interrupt_payload = result["__interrupt__"][0].value if result.get("__interrupt__") else {}
            req_id = interrupt_payload.get("request_id")
            status_val = "PENDING_APPROVAL"
            response_text = (
                f"Your refund request for ${interrupt_payload.get('amount', 0):.2f} exceeds our automated support limit of ${limit:.2f}. "
                f"Your request ({req_id}) has been paused in LangGraph and submitted to human management for review."
            )
            audio_b64 = result.get("audio_base64")
        else:
            status_val = result.get("status", "COMPLETED")
            response_text = result.get("final_response") or "Thank you for reaching out to AuditGate support."
            audio_b64 = result.get("audio_base64")
            req_id = result.get("request_id")

        return ChatResponse(
            thread_id=thread_id,
            status=status_val,
            response=response_text,
            audio_base64=audio_b64,
            request_id=req_id,
            policy_limit_applied=limit,
            interrupted=is_interrupted
        )
    except Exception as e:
        logger.error(f"Error in chat processing: {e}")
        raise HTTPException(status_code=500, detail=str(e))
