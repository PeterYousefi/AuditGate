import uuid
import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.agent.graph import (
    build_auditgate_graph,
    extract_refund_intent_and_amount,
    general_response_node
)
from app.agent.hitl_manager import get_graph
from app.agent.state import AgentState
from app.database import get_collection
from app.database.policy_service import get_live_policy
from app.voice.elevenlabs_client import get_speech_audio_base64

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
    Maintains multi-turn context and persists state to MongoDB Atlas via MongoDBSaver.
    """
    thread_id = req.thread_id or f"thread_{uuid.uuid4().hex[:8]}"
    graph = get_graph()
    config = {"configurable": {"thread_id": thread_id}}

    # Live policy query from MongoDB Atlas
    live_policy = get_live_policy("agent_01")
    limit = live_policy["max_auto_refund"]

    # 1. Retrieve existing checkpoint state from MongoDB Atlas
    current_state = graph.get_state(config)
    existing_history: List[Dict[str, str]] = []
    if current_state and current_state.values:
        existing_history = list(current_state.values.get("history") or [])

    # 2. Check if thread has an active pending interrupt (manager review in flight)
    col = get_collection("refund_requests")
    pending_req = col.find_one({"thread_id": thread_id, "status": "PENDING"})

    has_graph_interrupt = bool(
        current_state and (
            (current_state.next and "escalate_hitl" in current_state.next) or
            (current_state.tasks and any(t.interrupts for t in current_state.tasks))
        )
    )
    is_thread_interrupted = has_graph_interrupt or (pending_req is not None)

    # If thread is currently waiting on manager approval, handle conversational follow-ups
    # (e.g., "why?", "how long?", "what orders do I have?") without destroying the pending interrupt
    if is_thread_interrupted:
        extracted = extract_refund_intent_and_amount(req.message, history=existing_history)
        intent = extracted.get("intent", "CONVERSATIONAL")

        if intent in ("CONVERSATIONAL", "ORDERS_INQUIRY", "REFUND_INCOMPLETE"):
            req_id = pending_req["request_id"] if pending_req else None
            amt = float(pending_req["amount"]) if pending_req else 0.0
            order_id = pending_req.get("order_id") if pending_req else None
            rule_desc = pending_req.get("reason", "Specialist review required") if pending_req else None

            # Create transient state to generate context-aware response
            transient_state: AgentState = {
                "thread_id": thread_id,
                "customer_id": req.customer_id or "customer_01",
                "user_message": req.message,
                "intent": intent,
                "requested_amount": amt,
                "order_id": order_id,
                "email": pending_req.get("email") if pending_req else None,
                "is_prompt_injection": False,
                "currency": "USD",
                "reason": rule_desc,
                "policy_limit_applied": limit,
                "status": "PENDING_APPROVAL",
                "request_id": req_id,
                "final_response": None,
                "audio_base64": None,
                "history": existing_history + [{"role": "user", "content": req.message}]
            }

            gen_result = general_response_node(transient_state)
            reply_text = gen_result.get("final_response") or "Our specialist is currently reviewing your request."
            audio_b64 = gen_result.get("audio_base64")

            # Update history in MongoDB Atlas checkpoint while preserving the pending task
            updated_hist = list(existing_history)
            updated_hist.append({"role": "user", "content": req.message})
            updated_hist.append({"role": "assistant", "content": reply_text})
            try:
                graph.update_state(config, {"history": updated_hist})
            except Exception as e:
                logger.warning(f"Notice updating history on interrupted thread: {e}")

            return ChatResponse(
                thread_id=thread_id,
                status="PENDING_APPROVAL",
                response=reply_text,
                audio_base64=audio_b64,
                request_id=req_id,
                policy_limit_applied=limit,
                interrupted=True
            )

    # 3. Normal Graph Invocation with full conversation history
    updated_history = list(existing_history)
    updated_history.append({"role": "user", "content": req.message})

    initial_state = {
        "thread_id": thread_id,
        "customer_id": req.customer_id or "customer_01",
        "user_message": req.message,
        "intent": "",
        "requested_amount": None,
        "order_id": None,
        "email": None,
        "currency": "USD",
        "reason": None,
        "policy_limit_applied": limit,
        "status": "INIT",
        "request_id": None,
        "final_response": None,
        "audio_base64": None,
        "history": updated_history
    }

    try:
        result = graph.invoke(initial_state, config=config)
        is_interrupted = "__interrupt__" in result

        req_id = None
        if is_interrupted:
            interrupt_data = result["__interrupt__"][0].value if result.get("__interrupt__") else {}
            req_id = interrupt_data.get("request_id")
            status_val = "PENDING_APPROVAL"
            amt = interrupt_data.get("amount", 0.0)
            order_id = interrupt_data.get("order_id")
            order_str = f" for order #{order_id}" if order_id else ""
            default_text = f"Because of the refund amount, I've routed your ${amt:.2f} request{order_str} to a specialist for quick review. I'll update you right here as soon as it's approved."
            response_text = interrupt_data.get("response_text") or default_text
            audio_b64 = interrupt_data.get("audio_base64")
            if not audio_b64:
                audio_b64 = get_speech_audio_base64(response_text)
        else:
            status_val = result.get("status", "COMPLETED")
            response_text = result.get("final_response") or "Thank you for reaching out to AuditGate support."
            audio_b64 = result.get("audio_base64")
            req_id = result.get("request_id")

        # Update checkpoint history with assistant's response
        post_invoke_state = graph.get_state(config)
        post_hist = list(post_invoke_state.values.get("history") or updated_history)
        if not post_hist or post_hist[-1].get("role") != "assistant":
            post_hist.append({"role": "assistant", "content": response_text})
            graph.update_state(config, {"history": post_hist})

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
