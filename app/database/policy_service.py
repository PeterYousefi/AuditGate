import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from app.database.mongodb import get_collection

logger = logging.getLogger(__name__)

POLICIES_COLLECTION = "policies"
DEFAULT_AGENT_ID = "agent_01"
DEFAULT_ROLE = "support_agent"
DEFAULT_MAX_AUTO_REFUND = 50.0
DEFAULT_CURRENCY = "USD"


def seed_default_policy_if_missing() -> Dict[str, Any]:
    """
    Seeds default policy document into MongoDB Atlas if none exists:
    {"role": "support_agent", "agent_id": "agent_01", "max_auto_refund": 50, "currency": "USD"}
    """
    col = get_collection(POLICIES_COLLECTION)
    existing = col.find_one({"agent_id": DEFAULT_AGENT_ID})
    if not existing:
        default_policy = {
            "role": DEFAULT_ROLE,
            "agent_id": DEFAULT_AGENT_ID,
            "max_auto_refund": DEFAULT_MAX_AUTO_REFUND,
            "currency": DEFAULT_CURRENCY,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "description": "Default customer support refund policy"
        }
        col.insert_one(default_policy)
        logger.info(f"Seeded default policy document in MongoDB '{POLICIES_COLLECTION}' collection: {default_policy}")
        return default_policy
    return existing


def get_live_policy(agent_id: str = DEFAULT_AGENT_ID) -> Dict[str, Any]:
    """
    Queries MongoDB Atlas 'policies' collection LIVE.
    Strictly NO in-memory caching: if modified in Atlas, changes are immediately reflected.
    """
    col = get_collection(POLICIES_COLLECTION)
    doc = col.find_one({"agent_id": agent_id})
    if not doc:
        # Fallback to any policy in the collection or re-seed
        doc = col.find_one() or seed_default_policy_if_missing()

    # Normalize fields
    return {
        "agent_id": doc.get("agent_id", DEFAULT_AGENT_ID),
        "role": doc.get("role", DEFAULT_ROLE),
        "max_auto_refund": float(doc.get("max_auto_refund", DEFAULT_MAX_AUTO_REFUND)),
        "currency": doc.get("currency", DEFAULT_CURRENCY),
        "updated_at": doc.get("updated_at")
    }


def update_policy_limit(new_limit: float, agent_id: str = DEFAULT_AGENT_ID) -> Dict[str, Any]:
    """
    Updates the max_auto_refund limit in MongoDB Atlas.
    """
    col = get_collection(POLICIES_COLLECTION)
    now_iso = datetime.now(timezone.utc).isoformat()
    col.update_one(
        {"agent_id": agent_id},
        {
            "$set": {
                "max_auto_refund": float(new_limit),
                "updated_at": now_iso
            }
        },
        upsert=True
    )
    return get_live_policy(agent_id)
