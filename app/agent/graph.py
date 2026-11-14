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

from app.config import settings
from app.database.mongodb import get_mongodb_client
from app.database.policy_service import get_live_policy
from app.database.audit_service import record_audit_log
from app.database.orders_service import (
    get_order_by_id,
    get_order_by_id_and_email,
    normalize_order_id,
    list_customer_orders
)
from app.agent.state import AgentState
from app.agent.tools import (
    fetch_live_policy_limit,
    execute_auto_refund_tool,
    create_escalation_request_tool
)
from app.voice.elevenlabs_client import get_speech_audio_base64

logger = logging.getLogger(__name__)

# Candidate models for high availability across Free Tier quotas
CANDIDATE_GEMINI_MODELS = [
    settings.GEMINI_MODEL,
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash"
]


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


def extract_refund_intent_and_amount(
    message: str,
    history: Optional[List[Dict[str, str]]] = None
) -> Dict[str, Any]:
    """
    Extracts refund intent, order_id, email, amount, reason, and injection status
    from user message and multi-turn conversation history.
    Strictly separates order IDs from currency dollar amounts.
    """
    msg_lower = message.strip().lower()

    # 1. Edge Case A: Check for Prompt Injection / Adversarial Override
    is_injection = any(p in msg_lower for p in [
        "system override", "ignore rules", "ignore previous instructions",
        "ignore policy", "override mongodb", "bypass", "jailbreak",
        "override policies", "override limits", "disregard rules"
    ])

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

    # 3. Order ID extraction: match patterns like #ORD-1042, ORD-1089, ORD-9999, order 12345
    order_id = None
    order_match = re.search(r"#?\b(ORD-?\d+)\b", message, re.IGNORECASE)
    if order_match:
        order_id = normalize_order_id(order_match.group(1))
    else:
        generic_match = re.search(r"\b(?:order|order\s*number|order\s*id)\s*#?\s*([A-Za-z0-9\-]+)", message, re.IGNORECASE)
        if generic_match:
            order_id = normalize_order_id(generic_match.group(1))
        elif re.match(r"^#?[0-9]{4,6}$", message.strip()):
            # User simply answered with digits (e.g. 1042 or #1042)
            order_id = normalize_order_id(message.strip().lstrip("#"))

    # If order_id not in current message, look back in conversation history
    if not order_id and history:
        for prev in reversed(history[-6:]):
            prev_content = prev.get("content", "")
            prev_m = re.search(r"#?\b(ORD-?\d+)\b", prev_content, re.IGNORECASE)
            if prev_m:
                order_id = normalize_order_id(prev_m.group(1))
                break

    # 4. Email Extraction: match standard email address format
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

    # Check if prior history was asking for refund details (Edge Case B multi-turn context)
    was_pending_refund_query = False
    if history:
        for prev in reversed(history[-3:]):
            prev_text = prev.get("content", "").lower()
            if prev.get("role") == "assistant" and any(k in prev_text for k in [
                "order number", "email address", "refund", "amount you'd like refunded", "specialist"
            ]):
                was_pending_refund_query = True
                break

    # 6. Strict Currency Amount Extraction (NEVER bare digits like order numbers)
    amount = None

    # Pattern A: Dollar-prefixed value ($28, $28.00, $ 250)
    dollar_match = re.search(r"\$\s*([0-9]+(?:\.[0-9]{1,2})?)", message)
    if dollar_match:
        try:
            amt = float(dollar_match.group(1))
            if amt > 0:
                amount = amt
        except ValueError:
            pass

    # Pattern B: Word currency (28 dollars, 250 usd, 50 bucks)
    if amount is None:
        word_match = re.search(r"\b([0-9]+(?:\.[0-9]{1,2})?)\s*(?:dollars?|bucks?|usd)\b", message, re.IGNORECASE)
        if word_match:
            try:
                amt = float(word_match.group(1))
                if amt > 0:
                    amount = amt
            except ValueError:
                pass

    # Check if amount was provided in prior history
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

    # 7. Conversational follow-ups (e.g. "why?", "how come?", "who reviews it?", "thanks")
    conversational_phrases = [
        "why", "why?", "why is that", "why review", "how come",
        "how long", "what now", "who reviews", "who is reviewing",
        "thanks", "thank you", "hello", "hi", "hey"
    ]
    is_conversational_followup = any(
        msg_lower == p or msg_lower.startswith(p + " ") or msg_lower.startswith(p + "?")
        for p in conversational_phrases
    )

    # If conversational and not providing new order/email data
    if is_conversational_followup and not is_injection and not (email_match or order_match):
        return {
            "intent": "CONVERSATIONAL",
            "order_id": order_id,
            "email": email,
            "amount": amount,
            "reason": message[:200],
            "is_prompt_injection": False
        }

    # 8. Return parsed intent
    is_in_refund_flow = is_refund_keyword or was_pending_refund_query or is_injection or (order_id is not None and email is not None)

    return {
        "intent": "REFUND" if is_in_refund_flow else "CONVERSATIONAL",
        "order_id": order_id,
        "email": email,
        "amount": amount,
        "reason": message[:200],
        "is_prompt_injection": is_injection
    }


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

    # Query MongoDB Atlas LIVE policy (NEVER HARDCODED)
    live_limit = fetch_live_policy_limit("agent_01")

    # =========================================================================
    # Edge Case A — Prompt Injection / Manipulation Attempt
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
        missing_reply = "I'd be glad to help with your refund! Please provide your order number (e.g., #ORD-1042) and the email address associated with your purchase."
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
        missing_reply = f"To look up order #{order_id}, could you please provide the email address associated with your order?"
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
        missing_reply = f"Thanks for providing your email ({email}). Could you please share your order number (e.g., #ORD-1042) so I can pull up your details?"
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
    # Query MongoDB Atlas 'orders' collection for { order_id, email }
    # =========================================================================
    order_doc = get_order_by_id_and_email(order_id, email)
    if not order_doc:
        logger.warning(f"Verification failed: order #{order_id} not found for email '{email}'.")
        record_audit_log(
            thread_id=thread_id,
            agent_id="agent_01",
            user_requested_amount=amount or 0.0,
            policy_limit_applied=live_limit,
            decision="VERIFICATION_FAILED",
            reason=f"Verification failed: no matching order found for order #{order_id} and email '{email}'",
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
        logger.warning(f"Duplicate refund rejected: order #{order_id} already refunded.")
        record_audit_log(
            thread_id=thread_id,
            agent_id="agent_01",
            user_requested_amount=amount or float(order_doc.get("amount", 0.0)),
            policy_limit_applied=live_limit,
            decision="REJECTED_DUPLICATE",
            reason=f"Refund rejected: order #{order_id} has already been refunded.",
            metadata={"order_id": order_id, "email": email, "order_status": order_doc.get("status")}
        )
        dup_reply = f"Order #{order_id} has already been refunded."
        audio_b64 = get_speech_audio_base64(dup_reply)
        return {
            "intent": "REJECTED_DUPLICATE",
            "status": "REJECTED_DUPLICATE",
            "requested_amount": amount or float(order_doc.get("amount", 0.0)),
            "order_id": order_id,
            "email": email,
            "reason": f"Order #{order_id} already refunded",
            "is_prompt_injection": False,
            "policy_limit_applied": live_limit,
            "final_response": dup_reply,
            "audio_base64": audio_b64
        }

    # If amount was not explicitly provided by the user, default to original order total
    if amount is None:
        amount = float(order_doc.get("amount", 0.0))
        logger.info(f"Resolved order #{order_id} amount from database: ${amount:.2f}")

    if amount > float(order_doc.get("amount", 0.0)):
        logger.warning(f"Amount mismatch rejected: requested ${amount:.2f} > order total ${float(order_doc['amount']):.2f}")
        record_audit_log(
            thread_id=thread_id,
            agent_id="agent_01",
            user_requested_amount=amount,
            policy_limit_applied=live_limit,
            decision="REJECTED_AMOUNT_MISMATCH",
            reason=f"Refund rejected: requested amount ${amount:.2f} exceeds original order total ${float(order_doc['amount']):.2f} for order #{order_id}.",
            metadata={"order_id": order_id, "email": email, "order_total": float(order_doc["amount"])}
        )
        mismatch_reply = f"The requested amount of ${amount:.2f} exceeds the original order total of ${float(order_doc['amount']):.2f}."
        audio_b64 = get_speech_audio_base64(mismatch_reply)
        return {
            "intent": "REJECTED_AMOUNT_MISMATCH",
            "status": "REJECTED_AMOUNT_MISMATCH",
            "requested_amount": amount,
            "order_id": order_id,
            "email": email,
            "reason": f"Requested amount exceeds original order total of ${float(order_doc['amount']):.2f}",
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
        "reason": reason or f"Refund request for order #{order_id}",
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


def execute_auto_refund_node(state: AgentState) -> Dict[str, Any]:
    """
    Node 2: Executes automated refund when amount <= max_auto_refund.
    Updates order status in MongoDB 'orders' and records immutable audit log.
    """
    thread_id = state["thread_id"]
    amount = state["requested_amount"]
    order_id = state.get("order_id")
    reason = state.get("reason", "Customer requested refund")
    limit = state.get("policy_limit_applied", 50.0)

    result = execute_auto_refund_tool(thread_id, amount, reason, order_id=order_id)

    order_str = f" for order #{order_id}" if order_id else ""
    response_text = f"Your refund of ${amount:.2f}{order_str} has been processed. You'll see it back on your card shortly."

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
    order_id = state.get("order_id")
    email = state.get("email")
    reason = state.get("reason", "Customer requested refund")
    limit = state.get("policy_limit_applied", 50.0)

    order_str = f" for order #{order_id}" if order_id else ""
    response_text = f"Because of the refund amount, I've routed your ${amount:.2f} request{order_str} to a specialist for quick review. I'll update you right here as soon as it's approved."
    rule_desc = f"Exceeds ${limit:.2f} live policy threshold"

    # Create request in MongoDB Atlas with internal audit context
    req_doc = create_escalation_request_tool(
        thread_id=thread_id,
        customer_id=customer_id,
        amount=amount,
        reason=f"[{rule_desc}] {reason}",
        order_id=order_id,
        email=email,
        is_injection=False
    )
    request_id = req_doc["request_id"]

    # Generate ElevenLabs audio for customer response
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
        "is_prompt_injection": False
    })

    # When resumed via Command(resume={...}):
    decision_type = human_decision.get("decision", "HUMAN_APPROVED") if isinstance(human_decision, dict) else "HUMAN_APPROVED"
    approved = decision_type == "HUMAN_APPROVED" or human_decision.get("approved", True)

    if approved:
        final_text = f"Good news! Your ${amount:.2f} refund has been approved and processed."
        status_val = "HUMAN_APPROVED"
        audit_decision = "HUMAN_APPROVED"
    else:
        final_text = "Thank you for waiting. After review, your refund request was declined."
        status_val = "HUMAN_REJECTED"
        audit_decision = "HUMAN_REJECTED"

    # Record final audit log in MongoDB Atlas
    record_audit_log(
        thread_id=thread_id,
        agent_id="agent_01",
        user_requested_amount=amount,
        policy_limit_applied=limit,
        decision=audit_decision,
        reason=f"Human manager decision processed: {decision_type}. Triggered rule: {rule_desc}. Request ID: {request_id}",
        metadata={
            "request_id": request_id,
            "order_id": order_id,
            "email": email,
            "triggered_rule": rule_desc,
            "decided_by": human_decision.get("decided_by", "manager")
        }
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
    Node 4: Handles conversational follow-ups, incomplete requests, security blocks,
    and order inquiries. Maintains multi-turn context without leaking internal policy thresholds.
    """
    # If a final_response was already prepared (e.g. from security block or validation gate)
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
        lines = ["Here are your recent orders with Verve Studio:"]
        for o in orders:
            item_name = o.get("item", "Item")
            amt = o.get("amount", 0.0)
            status = o.get("status", "DELIVERED").title()
            lines.append(f"• #{o['order_id']}: {item_name} (${amt:.2f}) — {status}")
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
            "You are AuditGate Support Concierge (agent_01) for Verve Studio. "
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
