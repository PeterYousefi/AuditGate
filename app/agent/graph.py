import re
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timezone

from google import genai
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command
from langgraph.checkpoint.mongodb import MongoDBSaver

from app.config import settings
from app.database.mongodb import get_mongodb_client
from app.database.policy_service import get_live_policy
from app.database.audit_service import record_audit_log
from app.agent.state import AgentState
from app.agent.tools import (
    fetch_live_policy_limit,
    execute_auto_refund_tool,
    create_escalation_request_tool
)
from app.voice.elevenlabs_client import get_speech_audio_base64

logger = logging.getLogger(__name__)


def extract_refund_intent_and_amount(message: str) -> Dict[str, Any]:
    """
    Extracts intent and amount from user message.
    Uses regex pattern recognition for instant low-latency responses,
    with Gemini fallback for complex natural language phrasing.
    """
    msg_lower = message.lower()
    is_refund_keyword = any(w in msg_lower for w in ["refund", "money back", "return", "reimburse", "chargeback", "credit"])
    
    # Try regex first for fast matching
    amount_match = re.search(r"\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:dollars?|bucks?|usd|\$)?", message, re.IGNORECASE)
    
    # Check if amount was captured and keyword matches
    if is_refund_keyword and amount_match:
        try:
            amt = float(amount_match.group(1))
            if amt > 0:
                return {
                    "intent": "REFUND",
                    "amount": amt,
                    "reason": message[:200]
                }
        except (ValueError, IndexError):
            pass

    # Fallback to Gemini 3.5 Flash for natural language parsing
    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        prompt = (
            "Analyze this customer support message. "
            "Determine if the user is asking for a financial refund or credit. "
            "Respond in strictly this exact format with NO extra text:\n"
            "IS_REFUND: [YES or NO]\n"
            "AMOUNT: [number only e.g. 50, or 0 if none]\n"
            "REASON: [short summary]\n\n"
            f"Message: {message}"
        )
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=prompt
        )
        resp_text = response.text or ""
        
        is_ref = "IS_REFUND: YES" in resp_text.upper()
        amt = 0.0
        reason = message
        
        amt_match = re.search(r"AMOUNT:\s*([0-9]+(?:\.[0-9]+)?)", resp_text)
        if amt_match:
            amt = float(amt_match.group(1))
            
        reason_match = re.search(r"REASON:\s*(.+)", resp_text)
        if reason_match:
            reason = reason_match.group(1).strip()
            
        if is_ref and amt > 0:
            return {"intent": "REFUND", "amount": amt, "reason": reason}
    except Exception as e:
        logger.warning(f"Gemini intent extraction notice: {e}")

    # Default fallback
    if is_refund_keyword and amount_match:
        return {"intent": "REFUND", "amount": float(amount_match.group(1)), "reason": message}
    return {"intent": "GENERAL", "amount": None, "reason": message}


def analyze_request_node(state: AgentState) -> Dict[str, Any]:
    """
    Node 1: Evaluates user message against live MongoDB Atlas policies.
    """
    user_msg = state.get("user_message", "")
    extracted = extract_refund_intent_and_amount(user_msg)
    
    intent = extracted["intent"]
    amount = extracted.get("amount")
    reason = extracted.get("reason", user_msg)
    
    # Check for adversarial prompt injection
    lower_msg = user_msg.lower()
    is_injection = any(p in lower_msg for p in ["ignore rules", "system override", "ignore previous instructions", "jailbreak", "bypass"])
    
    # Query MongoDB Atlas LIVE policy (NEVER HARDCODED)
    live_limit = fetch_live_policy_limit("agent_01")
    
    updates: Dict[str, Any] = {
        "intent": intent,
        "requested_amount": amount,
        "reason": reason,
        "policy_limit_applied": live_limit,
    }
    
    if is_injection:
        updates["status"] = "PROMPT_INJECTION_DETECTED"
    
    return updates


def router_decision(state: AgentState) -> str:
    """
    Conditional edge router based on live MongoDB policy check.
    """
    intent = state.get("intent", "GENERAL")
    amount = state.get("requested_amount")
    limit = state.get("policy_limit_applied", 50.0)
    
    if intent == "REFUND" and amount is not None:
        if amount <= limit:
            return "auto_refund"
        else:
            return "escalate_to_human"
    return "general_response"


def execute_auto_refund_node(state: AgentState) -> Dict[str, Any]:
    """
    Node 2: Executes automated refund when amount <= max_auto_refund.
    """
    thread_id = state["thread_id"]
    amount = state["requested_amount"]
    reason = state.get("reason", "Customer requested refund")
    limit = state.get("policy_limit_applied", 50.0)
    
    result = execute_auto_refund_tool(thread_id, amount, reason)
    
    response_text = (
        f"Your refund request for ${amount:.2f} has been verified against our live governance policy "
        f"(max automated limit: ${limit:.2f}) and APPROVED immediately. The funds have been returned to your payment method."
    )
    
    # Generate ElevenLabs audio
    audio_b64 = get_speech_audio_base64(response_text)
    
    return {
        "status": "AUTO_APPROVED",
        "final_response": response_text,
        "audio_base64": audio_b64
    }


def escalate_hitl_node(state: AgentState) -> Dict[str, Any]:
    """
    Node 3: Pauses execution using LangGraph HITL interrupt
    and inserts pending document into MongoDB Atlas 'refund_requests'.
    """
    thread_id = state["thread_id"]
    customer_id = state.get("customer_id", "customer_default")
    amount = state["requested_amount"]
    reason = state.get("reason", "Customer requested refund")
    limit = state.get("policy_limit_applied", 50.0)
    
    # Create request in MongoDB Atlas
    req_doc = create_escalation_request_tool(
        thread_id=thread_id,
        customer_id=customer_id,
        amount=amount,
        reason=reason
    )
    request_id = req_doc["request_id"]
    
    # Check if this was a prompt injection attempt
    was_injection = state.get("status") == "PROMPT_INJECTION_DETECTED"
    prefix = "[Governance Guardrail Engaged] " if was_injection else ""
    
    response_text = (
        f"{prefix}Your refund request for ${amount:.2f} exceeds the live autonomous threshold of ${limit:.2f}. "
        f"Request {request_id} has been paused in LangGraph and routed to the Human Governance Console for manager review."
    )
    
    audio_b64 = get_speech_audio_base64(response_text)
    
    # PAUSE graph execution via LangGraph interrupt!
    # MongoDBSaver persists this pause checkpoint directly into MongoDB Atlas.
    human_decision = interrupt({
        "action": "MANAGER_REVIEW_REQUIRED",
        "request_id": request_id,
        "amount": amount,
        "limit": limit,
        "thread_id": thread_id
    })
    
    # When resumed via Command(resume={...}):
    decision_type = human_decision.get("decision", "HUMAN_APPROVED") if isinstance(human_decision, dict) else "HUMAN_APPROVED"
    approved = decision_type == "HUMAN_APPROVED" or human_decision.get("approved", True)
    
    if approved:
        final_text = (
            f"Update on request {request_id}: Human management has reviewed and APPROVED your refund of ${amount:.2f}. "
            f"The transaction has settled."
        )
        status_val = "HUMAN_APPROVED"
        audit_decision = "HUMAN_APPROVED"
    else:
        final_text = (
            f"Update on request {request_id}: Human management has reviewed your request for ${amount:.2f} and DECLINED the refund per company policy."
        )
        status_val = "HUMAN_REJECTED"
        audit_decision = "HUMAN_REJECTED"
        
    # Record final audit log in MongoDB Atlas
    record_audit_log(
        thread_id=thread_id,
        agent_id="agent_01",
        user_requested_amount=amount,
        policy_limit_applied=limit,
        decision=audit_decision,
        reason=f"Human manager decision processed: {decision_type}. Request ID: {request_id}",
        metadata={"request_id": request_id, "decided_by": human_decision.get("decided_by", "manager")}
    )
    
    final_audio = get_speech_audio_base64(final_text)
    
    return {
        "request_id": request_id,
        "status": status_val,
        "final_response": final_text,
        "audio_base64": final_audio
    }


def general_response_node(state: AgentState) -> Dict[str, Any]:
    """
    Node 4: Handles general customer queries using Gemini 3.5 Flash.
    """
    user_msg = state.get("user_message", "")
    
    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        system_instruction = (
            "You are AuditGate Support Agent (agent_01). "
            "You are polite, professional, and governed by strict MongoDB policies. "
            "Answer customer inquiries concisely."
        )
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=user_msg,
            config={"system_instruction": system_instruction}
        )
        reply = response.text or "Thank you for contacting AuditGate customer support. How can I assist you with your orders or refund requests today?"
    except Exception as e:
        logger.warning(f"Gemini general chat notice: {e}")
        reply = "Hello! I am your AuditGate support assistant. I can assist with order inquiries and refund requests up to our policy threshold."
        
    audio_b64 = get_speech_audio_base64(reply)
    return {
        "status": "GENERAL_REPLIED",
        "final_response": reply,
        "audio_base64": audio_b64
    }


def build_auditgate_graph(checkpointer: Optional[Any] = None):
    """
    Constructs and compiles the LangGraph StateGraph with MongoDB Atlas checkpointer.
    """
    workflow = StateGraph(AgentState)
    
    workflow.add_node("analyze_request", analyze_request_node)
    workflow.add_node("execute_auto_refund", execute_auto_refund_node)
    workflow.add_node("escalate_hitl", escalate_hitl_node)
    workflow.add_node("general_response", general_response_node)
    
    workflow.add_edge(START, "analyze_request")
    
    workflow.add_conditional_edges(
        "analyze_request",
        router_decision,
        {
            "auto_refund": "execute_auto_refund",
            "escalate_to_human": "escalate_hitl",
            "general_response": "general_response"
        }
    )
    
    workflow.add_edge("execute_auto_refund", END)
    workflow.add_edge("escalate_hitl", END)
    workflow.add_edge("general_response", END)
    
    if checkpointer is None:
        client = get_mongodb_client()
        checkpointer = MongoDBSaver(client, db_name=settings.MONGODB_DB_NAME)
        
    return workflow.compile(checkpointer=checkpointer)
