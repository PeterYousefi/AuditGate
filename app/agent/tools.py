import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional

from app.database import get_collection
from app.database.policy_service import get_live_policy
from app.database.audit_service import record_audit_log
from app.database.orders_service import update_order_status

logger = logging.getLogger(__name__)

REFUND_REQUESTS_COLLECTION = "refund_requests"


def fetch_live_policy_limit(agent_id: str = "agent_01") -> float:
    """
    CRITICAL AUDIT REQUIREMENT:
    Before the agent executes any refund tool, it MUST query MongoDB 'policies' live.
    Strictly NO hardcoded limit in Python. If edited in Atlas, agent obeys immediately.
    """
    policy = get_live_policy(agent_id)
    limit = float(policy.get("max_auto_refund", 50.0))
    logger.info(f"Queried LIVE policy from MongoDB Atlas for '{agent_id}': max_auto_refund=${limit}")
    return limit


def execute_auto_refund_tool(
    thread_id: str,
    amount: float,
    reason: str,
    order_id: Optional[str] = None,
    agent_id: str = "agent_01"
) -> Dict[str, Any]:
    """
    Executes immediate refund when amount <= max_auto_refund.
    Logs immutable audit entry into MongoDB Atlas 'audit_logs'.
    """
    live_limit = fetch_live_policy_limit(agent_id)
    if amount > live_limit:
        raise ValueError(f"Requested amount ${amount} exceeds live limit ${live_limit}")

    metadata = {"execution_method": "autonomous_tool", "currency": "USD"}
    if order_id:
        metadata["order_id"] = order_id
        update_order_status(order_id, "REFUNDED")

    # Physical transaction simulation / audit trail write
    audit_entry = record_audit_log(
        thread_id=thread_id,
        agent_id=agent_id,
        user_requested_amount=amount,
        policy_limit_applied=live_limit,
        decision="AUTO_APPROVED",
        reason=f"Auto-approved by policy: amount (${amount:.2f}) <= live limit (${live_limit:.2f}). Justification: {reason}",
        metadata=metadata
    )

    return {
        "success": True,
        "amount": amount,
        "order_id": order_id,
        "policy_limit": live_limit,
        "audit_id": audit_entry["_id"],
        "message": f"Successfully processed automated refund of ${amount:.2f}."
    }


def create_escalation_request_tool(
    thread_id: str,
    customer_id: str,
    amount: float,
    reason: str,
    order_id: Optional[str] = None,
    email: Optional[str] = None,
    agent_id: str = "agent_01",
    is_injection: bool = False
) -> Dict[str, Any]:
    """
    Creates a pending refund request document in MongoDB Atlas 'refund_requests'
    and records an audit entry with decision 'PENDING_APPROVAL'.
    """
    live_limit = fetch_live_policy_limit(agent_id)
    col = get_collection(REFUND_REQUESTS_COLLECTION)

    request_id = f"req_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.now(timezone.utc).isoformat()

    doc = {
        "request_id": request_id,
        "thread_id": thread_id,
        "customer_id": customer_id,
        "order_id": order_id,
        "email": email,
        "amount": float(amount),
        "currency": "USD",
        "policy_limit_applied": live_limit,
        "reason": reason or "Customer requested refund exceeding auto limit",
        "status": "PENDING",
        "created_at": now_iso,
        "decision_at": None,
        "decided_by": None,
        "manager_notes": None,
        "is_prompt_injection": is_injection
    }

    col.insert_one(doc)
    doc["_id"] = str(doc.get("_id", ""))

    metadata = {"request_id": request_id, "customer_id": customer_id}
    if order_id:
        metadata["order_id"] = order_id
    if email:
        metadata["email"] = email
    if is_injection:
        metadata["guardrail_engaged"] = "prompt_injection"

    audit_reason = (
        f"Prompt Injection Defense Engaged: forwarded for manual review. Original input: {reason}"
        if is_injection else
        f"Exceeds ${live_limit:.2f} live policy threshold: amount (${amount:.2f}) > live limit (${live_limit:.2f}). Request ID: {request_id}"
    )

    # Audit the escalation
    record_audit_log(
        thread_id=thread_id,
        agent_id=agent_id,
        user_requested_amount=amount,
        policy_limit_applied=live_limit,
        decision="PENDING_APPROVAL",
        reason=audit_reason,
        metadata=metadata
    )

    logger.info(f"Created pending refund request '{request_id}' in MongoDB Atlas. Awaiting human manager.")
    return doc
