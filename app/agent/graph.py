import re
import json
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone

from google import genai
from google.genai import types
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command
from langgraph.checkpoint.mongodb import MongoDBSaver
from langsmith import traceable

from app.config import settings
from app.database.mongodb import get_mongodb_client
from app.database.policy_service import get_live_policy
from app.database.audit_service import record_audit_log
from app.database.orders_service import (
    get_order_by_id,
    get_order_by_id_and_email,
    normalize_order_id,
    format_currency,
    update_order_status,
    list_customer_orders
)
from app.database.vector_service import (
    search_security_injection,
    search_policy_precedents
)
from app.agent.state import AgentState
from app.agent.tools import (
    fetch_live_policy_limit,
    execute_auto_refund_tool,
    create_escalation_request_tool
)
from app.voice.elevenlabs_client import get_speech_audio_base64, normalize_for_speech

logger = logging.getLogger(__name__)

# Candidate models for high availability across Free Tier quotas
CANDIDATE_GEMINI_MODELS = [
    settings.GEMINI_MODEL,
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash"
]


@traceable(name="gemini_generate_response")
def generate_gemini_response(
    contents: Any,
    system_instruction: Optional[str] = None,
    json_mode: bool = False
) -> Optional[str]:
    """
    Robust Gemini caller with fallback across candidate models.
    """
    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    config_args: Dict[str, Any] = {}
    if json_mode:
        config_args["response_mime_type"] = "application/json"
    if system_instruction:
        config_args["system_instruction"] = system_instruction

    config = types.GenerateContentConfig(**config_args) if config_args else None

    seen = set()
    models_to_try = [m for m in CANDIDATE_GEMINI_MODELS if not (m in seen or seen.add(m))]

    for model_name in models_to_try:
        try:
            resp = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=config
            )
            if resp and resp.text:
                return resp.text.strip()
        except Exception as e:
            logger.warning(f"Gemini call with {model_name} failed: {e}. Trying next model...")
            continue
    return None


@traceable(name="extract_refund_intent_and_amount")
def extract_refund_intent_and_amount(
    message: str,
    history: Optional[List[Dict[str, str]]] = None
) -> Dict[str, Any]:
    """
    Extracts refund intent, strictly numeric order_id (e.g. '1042'), email, amount,
    and checks prompt injection via regex + Atlas Vector Search.
    """
    msg_lower = message.strip().lower()

    # 1. Edge Case A: Check for Prompt Injection / Adversarial Override (Regex + Vector Search)
    regex_injection = any(p in msg_lower for p in [
        "system override", "ignore rules", "ignore previous instructions",
        "ignore policy", "override mongodb", "bypass", "jailbreak",
        "override policies", "override limits", "disregard rules", "admin mode"
    ])

    vector_injection_match = None
    if not regex_injection:
        vector_injection_match = search_security_injection(message, score_threshold=0.91)

    is_injection = regex_injection or (vector_injection_match is not None)

    # 2. Check for Orders Inquiry
    is_orders_inquiry = any(p in msg_lower for p in [
        "what orders", "my orders", "show orders", "list orders", "recent orders",
        "view orders", "what did i buy", "what do i have"
    ])
    if is_orders_inquiry and not is_injection:
        return {
            "intent": "ORDERS_INQUIRY",
            "order_id": None,
            "email": None,
            "amount": None,
            "reason": "Customer inquired about past orders",
            "is_prompt_injection": False
        }

    # Helper for robust numeric-only order ID extraction (avoids capturing $250 or $500 amounts)
    def _extract_order(text: str) -> Optional[str]:
        if not text:
            return None
        explicit = re.search(r"(?:order(?:\s*(?:id|number|#))?[:\s]*#?|#|ORD-)(\d{3,6})\b", text, re.IGNORECASE)
        if explicit:
            return normalize_order_id(explicit.group(1))
        general = re.search(r"(?<!\$)(?<!\$\s)\b(\d{4})\b", text)
        if general:
            return normalize_order_id(general.group(1))
        return None

    # 3. Numeric-Only Order ID extraction
    order_id = _extract_order(message)

    # If order_id not in current message, look back in conversation history
    if not order_id and history:
        for prev in reversed(history[-6:]):
            prev_content = prev.get("content", "")
            found_prev = _extract_order(prev_content)
            if found_prev:
                order_id = found_prev
                break

    # 4. Email Extraction
    email = None
    email_match = re.search(r"\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b", message)
    if email_match:
        email = email_match.group(1).lower().strip()

    # If email not in current message, look back in conversation history
    if not email and history:
        for prev in reversed(history[-6:]):
            prev_content = prev.get("content", "")
            prev_em = re.search(r"\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b", prev_content)
            if prev_em:
                email = prev_em.group(1).lower().strip()
                break

    # 5. Check for Refund Intent Keywords
    is_refund_keyword = any(w in msg_lower for w in [
        "refund", "money back", "return", "reimburse", "chargeback", "credit"
    ])

    was_pending_refund_query = False
    if history:
        for prev in reversed(history[-3:]):
            prev_text = prev.get("content", "").lower()
            if prev.get("role") == "assistant" and any(k in prev_text for k in [
                "order number", "email address", "refund", "amount", "specialist"
            ]):
                was_pending_refund_query = True
                break

    # 6. Currency Amount Extraction
    amount = None
    dollar_match = re.search(r"\$\s*([0-9]+(?:\.[0-9]{1,2})?)", message)
    if dollar_match:
        try:
            amt = float(dollar_match.group(1))
            if amt > 0:
                amount = amt
        except ValueError:
            pass

    if amount is None:
        word_match = re.search(r"\b([0-9]+(?:\.[0-9]{1,2})?)\s*(?:dollars?|bucks?|usd)\b", message, re.IGNORECASE)
        if word_match:
            try:
                amt = float(word_match.group(1))
                if amt > 0:
                    amount = amt
            except ValueError:
                pass

    if amount is None and history:
        for prev in reversed(history[-4:]):
            prev_content = prev.get("content", "")
            prev_dollar = re.search(r"\$\s*([0-9]+(?:\.[0-9]{1,2})?)", prev_content)
            if prev_dollar:
                try:
                    amount = float(prev_dollar.group(1))
                    break
                except ValueError:
                    pass

    # 7. Conversational follow-ups
    conversational_phrases = [
        "why", "why?", "why is that", "why review", "how come",
        "how long", "what now", "who reviews", "who is reviewing",
        "thanks", "thank you", "hello", "hi", "hey"
    ]
    is_conversational_followup = any(
        msg_lower == p or msg_lower.startswith(p + " ") or msg_lower.startswith(p + "?")
        for p in conversational_phrases
    )

    if is_conversational_followup and not is_injection and not (email or order_id):
        return {
            "intent": "CONVERSATIONAL",
            "order_id": order_id,
            "email": email,
            "amount": amount,
            "reason": message[:200],
            "is_prompt_injection": False
        }

    is_in_refund_flow = is_refund_keyword or was_pending_refund_query or is_injection or (order_id is not None and email is not None)

    return {
        "intent": "REFUND" if is_in_refund_flow else "CONVERSATIONAL",
        "order_id": order_id,
        "email": email,
        "amount": amount,
        "reason": message[:200],
        "is_prompt_injection": is_injection
    }


@traceable(name="analyze_request_node")
def analyze_request_node(state: AgentState) -> Dict[str, Any]:
    """
    Node 1: Evaluates user message against strict multi-step governance verification gate
    and live MongoDB Atlas policies.
    """
    thread_id = state["thread_id"]
    user_msg = state.get("user_message", "")
    history = state.get("history", [])
    extracted = extract_refund_intent_and_amount(user_msg, history=history)

    intent = extracted["intent"]
    amount = extracted.get("amount")
    order_id = extracted.get("order_id")
    email = extracted.get("email")
    reason = extracted.get("reason", user_msg)
    is_injection = extracted.get("is_prompt_injection", False)

    live_limit = fetch_live_policy_limit("agent_01")

    # =========================================================================
    # Edge Case A — Prompt Injection / Manipulation Attempt
    # Block immediately, write SECURITY_BLOCK to audit_logs, polite response
    # =========================================================================
    if is_injection:
        logger.warning(f"Prompt injection detected on thread '{thread_id}'. Engaging SECURITY_BLOCK guardrail.")
        record_audit_log(
            thread_id=thread_id,
            agent_id="agent_01",
            user_requested_amount=amount or 0.0,
            policy_limit_applied=live_limit,
            decision="SECURITY_BLOCK",
            reason=f"Security guardrail engaged: prompt injection detected. Blocked input: {user_msg[:200]}",
            metadata={"guardrail_engaged": "prompt_injection", "raw_message": user_msg}
        )
        polite_reply = "I'm unable to process that request. To look into a refund, please provide a valid order number and the email address on your account."
        audio_b64 = get_speech_audio_base64(polite_reply)
        return {
            "intent": "SECURITY_BLOCK",
            "status": "SECURITY_BLOCK",
            "requested_amount": amount or 0.0,
            "order_id": order_id,
            "email": email,
            "reason": "Prompt injection detected and blocked",
            "is_prompt_injection": True,
            "policy_limit_applied": live_limit,
            "final_response": polite_reply,
            "audio_base64": audio_b64
        }

    # =========================================================================
    # Conversational or Orders Inquiry — Route to general response
    # =========================================================================
    if intent in ("CONVERSATIONAL", "ORDERS_INQUIRY"):
        return {
            "intent": intent,
            "requested_amount": amount,
            "order_id": order_id,
            "email": email,
            "reason": reason,
            "is_prompt_injection": False,
            "policy_limit_applied": live_limit,
            "status": "CONVERSATIONAL"
        }

    # =========================================================================
    # Edge Case B — Missing Order Number or Missing Email
    # Never create a pending refund request without verified order_id AND email.
    # =========================================================================
    if not order_id and not email:
        missing_reply = "I'd be glad to help with your refund! Please provide your order number (e.g., order 1042) and the email address associated with your purchase."
        audio_b64 = get_speech_audio_base64(missing_reply)
        return {
            "intent": "AWAITING_INFO",
            "status": "AWAITING_INFO",
            "requested_amount": amount,
            "order_id": None,
            "email": None,
            "reason": "Awaiting order number and email address",
            "is_prompt_injection": False,
            "policy_limit_applied": live_limit,
            "final_response": missing_reply,
            "audio_base64": audio_b64
        }
    elif not email:
        missing_reply = f"To look up order {order_id}, could you please provide the email address associated with your order?"
        audio_b64 = get_speech_audio_base64(missing_reply)
        return {
            "intent": "AWAITING_INFO",
            "status": "AWAITING_INFO",
            "requested_amount": amount,
            "order_id": order_id,
            "email": None,
            "reason": "Awaiting customer email address for order verification",
            "is_prompt_injection": False,
            "policy_limit_applied": live_limit,
            "final_response": missing_reply,
            "audio_base64": audio_b64
        }
    elif not order_id:
        missing_reply = f"Thanks for providing your email ({email}). Could you please share your order number (e.g., order 1042) so I can pull up your details?"
        audio_b64 = get_speech_audio_base64(missing_reply)
        return {
            "intent": "AWAITING_INFO",
            "status": "AWAITING_INFO",
            "requested_amount": amount,
            "order_id": None,
            "email": email,
            "reason": "Awaiting order number for email verification",
            "is_prompt_injection": False,
            "policy_limit_applied": live_limit,
            "final_response": missing_reply,
            "audio_base64": audio_b64
        }

    # =========================================================================
    # Edge Case C — Order Does Not Exist or Email Doesn't Match
    # =========================================================================
    order_doc = get_order_by_id_and_email(order_id, email)
    if not order_doc:
        logger.warning(f"Verification failed: order {order_id} not found for email '{email}'.")
        record_audit_log(
            thread_id=thread_id,
            agent_id="agent_01",
            user_requested_amount=amount or 0.0,
            policy_limit_applied=live_limit,
            decision="VERIFICATION_FAILED",
            reason=f"Verification failed: no matching order found for order {order_id} and email '{email}'",
            metadata={"order_id": order_id, "email": email}
        )
        failed_reply = "I couldn't find an order matching that order number and email address. Please double-check your details and try again."
        audio_b64 = get_speech_audio_base64(failed_reply)
        return {
            "intent": "VERIFICATION_FAILED",
            "status": "VERIFICATION_FAILED",
            "requested_amount": amount or 0.0,
            "order_id": order_id,
            "email": email,
            "reason": "Verification failed: order ID and email do not match records",
            "is_prompt_injection": False,
            "policy_limit_applied": live_limit,
            "final_response": failed_reply,
            "audio_base64": audio_b64
        }

    # =========================================================================
    # Edge Case D — Already Refunded or Amount Exceeds Order Total
    # =========================================================================
    if order_doc.get("status") == "ALREADY_REFUNDED":
        logger.warning(f"Duplicate refund rejected: order {order_id} already refunded.")
        record_audit_log(
            thread_id=thread_id,
            agent_id="agent_01",
            user_requested_amount=amount or float(order_doc.get("amount", 0.0)),
            policy_limit_applied=live_limit,
            decision="REJECTED_DUPLICATE",
            reason=f"Refund rejected: order {order_id} has already been refunded.",
            metadata={"order_id": order_id, "email": email, "order_status": order_doc.get("status")}
        )
        dup_reply = f"Order {order_id} has already been refunded."
        audio_b64 = get_speech_audio_base64(dup_reply)
        return {
            "intent": "REJECTED_DUPLICATE",
            "status": "REJECTED_DUPLICATE",
            "requested_amount": amount or float(order_doc.get("amount", 0.0)),
            "order_id": order_id,
            "email": email,
            "reason": f"Order {order_id} already refunded",
            "is_prompt_injection": False,
            "policy_limit_applied": live_limit,
            "final_response": dup_reply,
            "audio_base64": audio_b64
        }

    # If amount was not explicitly provided by the user, default to original order total
    if amount is None:
        amount = float(order_doc.get("amount", 0.0))
        logger.info(f"Resolved order {order_id} amount from database: {format_currency(amount)}")

    if amount > float(order_doc.get("amount", 0.0)):
        logger.warning(f"Amount mismatch rejected: requested {format_currency(amount)} > order total {format_currency(order_doc['amount'])}")
        record_audit_log(
            thread_id=thread_id,
            agent_id="agent_01",
            user_requested_amount=amount,
            policy_limit_applied=live_limit,
            decision="REJECTED_AMOUNT_MISMATCH",
            reason=f"Refund rejected: requested amount {format_currency(amount)} exceeds original order total {format_currency(order_doc['amount'])} for order {order_id}.",
            metadata={"order_id": order_id, "email": email, "order_total": float(order_doc["amount"])}
        )
        mismatch_reply = f"The requested amount of {format_currency(amount)} exceeds the original order total of {format_currency(order_doc['amount'])}."
        audio_b64 = get_speech_audio_base64(mismatch_reply)
        return {
            "intent": "REJECTED_AMOUNT_MISMATCH",
            "status": "REJECTED_AMOUNT_MISMATCH",
            "requested_amount": amount,
            "order_id": order_id,
            "email": email,
            "reason": f"Requested amount exceeds original order total of {format_currency(order_doc['amount'])}",
            "is_prompt_injection": False,
            "policy_limit_applied": live_limit,
            "final_response": mismatch_reply,
            "audio_base64": audio_b64
        }

    # =========================================================================
    # Edge Case E — Verified Order + Valid Amount -> Ready for Governance Check
    # =========================================================================
    return {
        "intent": "REFUND",
        "status": "POLICY_EVALUATION",
        "requested_amount": amount,
        "order_id": order_id,
        "email": email,
        "reason": reason or f"Refund request for order {order_id}",
        "is_prompt_injection": False,
        "policy_limit_applied": live_limit
    }


def router_decision(state: AgentState) -> str:
    """
    Conditional edge router based on live MongoDB policy check and verification results.
    """
    intent = state.get("intent", "CONVERSATIONAL")
    amount = state.get("requested_amount")
    limit = state.get("policy_limit_applied", 50.0)

    if intent == "REFUND" and amount is not None:
        if amount <= limit:
            return "auto_refund"
        else:
            return "escalate_to_human"
    return "general_response"


# =============================================================================
# NODE SEPARATION: Dedicated human_gate_node (interrupt only, zero side effects)
# =============================================================================

@traceable(name="human_gate_node")
def human_gate_node(state: AgentState) -> Dict[str, Any]:
    """
    Node: Pauses execution via LangGraph HITL interrupt and inserts pending document
    into MongoDB Atlas 'refund_requests'.
    STRICT SAFETY: Does NOT mutate order status or write final financial audit log here!
    Irreversible writes reside in downstream execute_refund_node.
    """
    thread_id = state["thread_id"]
    customer_id = state.get("customer_id", "customer_default")
    amount = state["requested_amount"]
    order_id = state.get("order_id")
    email = state.get("email")
    reason = state.get("reason", "Customer requested refund")
    limit = state.get("policy_limit_applied", 50.0)

    # Search policy precedents for compliance citation
    precedents = search_policy_precedents(f"Refund request of {format_currency(amount)} exceeding limit", limit=1)
    citation = precedents[0].get("citation") if precedents else "AuditGate Governance Spec §4.2 (High-Value Controls)"

    order_str = f" for order {order_id}" if order_id else ""
    # Persona-Execution Separation: polite customer message with zero internal threshold leaks
    response_text = f"Because of the refund amount, I've routed your {format_currency(amount)} request{order_str} to a specialist for quick review. I'll update you right here as soon as it's approved."
    rule_desc = f"Exceeds {format_currency(limit)} live policy threshold"

    # Create pending escalation request in MongoDB Atlas
    req_doc = create_escalation_request_tool(
        thread_id=thread_id,
        customer_id=customer_id,
        amount=amount,
        reason=f"[{rule_desc}] {reason}. Precedent: {citation}",
        order_id=order_id,
        email=email,
        is_injection=False
    )
    request_id = req_doc["request_id"]
    audio_b64 = get_speech_audio_base64(response_text)

    # PAUSE graph execution via LangGraph interrupt with manager audit metadata
    human_decision = interrupt({
        "action": "MANAGER_REVIEW_REQUIRED",
        "request_id": request_id,
        "order_id": order_id,
        "email": email,
        "amount": amount,
        "limit": limit,
        "thread_id": thread_id,
        "response_text": response_text,
        "audio_base64": audio_b64,
        "triggered_rule": rule_desc,
        "precedent_citation": citation,
        "is_prompt_injection": False
    })

    # When resumed via Command(resume={...}):
    if isinstance(human_decision, dict):
        decision_type = human_decision.get("decision", "HUMAN_APPROVED")
        if "approved" in human_decision:
            approved = bool(human_decision["approved"])
        else:
            approved = (decision_type == "HUMAN_APPROVED")
        decided_by = human_decision.get("decided_by", "manager")
    else:
        decision_type = "HUMAN_APPROVED"
        approved = True
        decided_by = "manager"

    return {
        "request_id": request_id,
        "status": "RESUMED_FROM_HITL",
        "approved": approved,
        "manager_decision": decision_type,
        "decided_by": decided_by,
        "precedent_citation": citation
    }


def human_gate_router(state: AgentState) -> str:
    """
    Routes the resumed HITL execution to execute_refund or decline_refund.
    """
    if state.get("approved", True):
        return "execute_refund"
    return "decline_refund"


# =============================================================================
# NODE SEPARATION: Dedicated execute_refund_node (single point of DB mutation)
# =============================================================================

@traceable(name="execute_refund_node")
def execute_refund_node(state: AgentState) -> Dict[str, Any]:
    """
    Node: Single point of irreversible execution for refunds.
    Mutates order status in MongoDB Atlas 'orders' and logs permanent audit log.
    Guarantees no duplicate writes upon LangGraph resumption.
    """
    thread_id = state["thread_id"]
    amount = state["requested_amount"]
    order_id = state.get("order_id")
    email = state.get("email")
    reason = state.get("reason", "Customer requested refund")
    limit = state.get("policy_limit_applied", 50.0)
    request_id = state.get("request_id")
    manager_decision = state.get("manager_decision")
    precedent_citation = state.get("precedent_citation")

    # 1. Mutate order status to REFUNDED in MongoDB Atlas 'orders'
    if order_id:
        update_order_status(order_id, "REFUNDED")

    # 2. Determine if this was an autonomous execution or human manager approval
    order_str = f" for order {order_id}" if order_id else ""

    if manager_decision == "HUMAN_APPROVED":
        status_val = "HUMAN_APPROVED"
        final_text = f"Good news! Your {format_currency(amount)} refund has been approved and processed."
        record_audit_log(
            thread_id=thread_id,
            agent_id="agent_01",
            user_requested_amount=amount,
            policy_limit_applied=limit,
            decision="HUMAN_APPROVED",
            reason=f"Human manager decision processed: HUMAN_APPROVED. Request ID: {request_id}. Precedent: {precedent_citation or 'N/A'}",
            metadata={
                "request_id": request_id,
                "order_id": order_id,
                "email": email,
                "decided_by": state.get("decided_by", "manager"),
                "precedent_citation": precedent_citation
            }
        )
    else:
        status_val = "AUTO_APPROVED"
        final_text = f"Your refund of {format_currency(amount)}{order_str} has been processed. You'll see it back on your card shortly."
        record_audit_log(
            thread_id=thread_id,
            agent_id="agent_01",
            user_requested_amount=amount,
            policy_limit_applied=limit,
            decision="AUTO_APPROVED",
            reason=f"Auto-approved by policy: amount ({format_currency(amount)}) <= live limit ({format_currency(limit)}). Justification: {reason}",
            metadata={
                "execution_method": "autonomous_tool",
                "currency": "USD",
                "order_id": order_id,
                "email": email
            }
        )

    # Generate ElevenLabs audio with speech normalizer
    audio_b64 = get_speech_audio_base64(final_text)

    return {
        "status": status_val,
        "final_response": final_text,
        "audio_base64": audio_b64
    }


@traceable(name="decline_refund_node")
def decline_refund_node(state: AgentState) -> Dict[str, Any]:
    """
    Node: Handles human manager decline path.
    Logs permanent HUMAN_REJECTED audit log and returns polite rejection.
    """
    thread_id = state["thread_id"]
    amount = state["requested_amount"]
    order_id = state.get("order_id")
    email = state.get("email")
    limit = state.get("policy_limit_applied", 50.0)
    request_id = state.get("request_id")

    final_text = "Thank you for waiting. After review, your refund request was declined."
    record_audit_log(
        thread_id=thread_id,
        agent_id="agent_01",
        user_requested_amount=amount or 0.0,
        policy_limit_applied=limit,
        decision="HUMAN_REJECTED",
        reason=f"Human manager decision processed: HUMAN_REJECTED. Request ID: {request_id}",
        metadata={
            "request_id": request_id,
            "order_id": order_id,
            "email": email,
            "decided_by": state.get("decided_by", "manager")
        }
    )

    audio_b64 = get_speech_audio_base64(final_text)

    return {
        "status": "HUMAN_REJECTED",
        "final_response": final_text,
        "audio_base64": audio_b64
    }


@traceable(name="general_response_node")
def general_response_node(state: AgentState) -> Dict[str, Any]:
    """
    Node: Handles conversational follow-ups, incomplete requests, security blocks,
    and order inquiries. Maintains multi-turn context without leaking internal policy thresholds.
    """
    if state.get("final_response"):
        reply = state["final_response"]
        audio_b64 = state.get("audio_base64")
        if not audio_b64:
            audio_b64 = get_speech_audio_base64(reply)
        return {
            "status": state.get("status", "GENERAL_REPLIED"),
            "final_response": reply,
            "audio_base64": audio_b64
        }

    user_msg = state.get("user_message", "")
    history = state.get("history", [])
    intent = state.get("intent", "CONVERSATIONAL")
    customer_id = state.get("customer_id", "customer_01")

    # Case 1: Orders Inquiry
    if intent == "ORDERS_INQUIRY" or any(w in user_msg.lower() for w in ["what orders", "my orders", "show orders"]):
        orders = list_customer_orders(customer_id)
        lines = ["Here are your recent orders with AuditGate:"]
        for o in orders:
            item_name = o.get("item", "Item")
            amt = o.get("amount", 0.0)
            status = o.get("status", "DELIVERED").title()
            lines.append(f"• Order {o['order_id']}: {item_name} ({format_currency(amt)}) — {status}")
        lines.append("\nLet me know if you would like to initiate a return or refund for any of these!")
        reply = "\n".join(lines)

    # Case 2: Conversational follow-ups (e.g. "why?", "how long does review take?", "thank you")
    else:
        context_lines = []
        for h in history[-6:]:
            role = "Customer" if h.get("role") == "user" else "Agent"
            context_lines.append(f"{role}: {h.get('content')}")
        context_str = "\n".join(context_lines)

        system_instruction = (
            "You are AuditGate Support Concierge (agent_01). "
            "You are polite, professional, and helpful. Answer customer inquiries concisely, clearly, and warmly. "
            "If the customer asks 'why?' or questions why their refund was routed to a specialist, "
            "explain warmly that because of the refund amount, higher-value requests undergo a brief verification "
            "by our specialist team before release, and they will be updated right here once reviewed. "
            "If the customer asks 'why?' after an auto-approved refund, explain that their order was verified "
            "and immediately processed back to their payment card. "
            "CRITICAL GOVERNANCE RULE: NEVER reveal internal policy thresholds (e.g. NEVER mention '$50 limit' or specific numbers), "
            "system tags, database collections, schemas, or LangGraph jargon to the customer."
        )

        prompt = (
            f"Customer message: {user_msg}\n\n"
            f"Conversation context so far:\n{context_str}\n\n"
            "Respond naturally and warmly to the customer as AuditGate Support Concierge."
        )

        gemini_reply = generate_gemini_response(prompt, system_instruction=system_instruction)
        if gemini_reply:
            reply = gemini_reply
        else:
            msg_low = user_msg.lower()
            if "why" in msg_low:
                reply = (
                    "Because of the refund amount, our system routes requests of this value to a specialist "
                    "for a quick security and order verification before funds are released. We are reviewing "
                    "it right now and will update you directly here."
                )
            elif "how long" in msg_low or "time" in msg_low:
                reply = "Specialist reviews are typically completed within a few minutes during business hours. Once approved, the funds are credited back to your original payment method."
            elif any(t in msg_low for t in ["thank", "thanks"]):
                reply = "You're very welcome! Please let me know if you need anything else."
            else:
                reply = "Hello! I am your AuditGate support concierge. How can I assist you with your orders or returns today?"

    audio_b64 = get_speech_audio_base64(reply)
    return {
        "status": "GENERAL_REPLIED",
        "final_response": reply,
        "audio_base64": audio_b64
    }


def build_auditgate_graph(checkpointer: Optional[Any] = None):
    """
    Constructs and compiles the LangGraph StateGraph with MongoDB Atlas checkpointer (ttl=86400).
    Guarantees strict separation between human_gate (interrupt) and execute_refund (mutation).
    """
    workflow = StateGraph(AgentState)

    workflow.add_node("analyze_request", analyze_request_node)
    workflow.add_node("human_gate", human_gate_node)
    workflow.add_node("execute_refund", execute_refund_node)
    workflow.add_node("decline_refund", decline_refund_node)
    workflow.add_node("general_response", general_response_node)

    workflow.add_edge(START, "analyze_request")

    workflow.add_conditional_edges(
        "analyze_request",
        router_decision,
        {
            "auto_refund": "execute_refund",
            "escalate_to_human": "human_gate",
            "general_response": "general_response"
        }
    )

    workflow.add_conditional_edges(
        "human_gate",
        human_gate_router,
        {
            "execute_refund": "execute_refund",
            "decline_refund": "decline_refund"
        }
    )

    workflow.add_edge("execute_refund", END)
    workflow.add_edge("decline_refund", END)
    workflow.add_edge("general_response", END)

    if checkpointer is None:
        client = get_mongodb_client()
        # Enforce 24-hour TTL (86400 seconds) on LangGraph checkpoints in MongoDB Atlas
        checkpointer = MongoDBSaver(client, db_name=settings.MONGODB_DB_NAME, ttl=86400)

    return workflow.compile(checkpointer=checkpointer)
