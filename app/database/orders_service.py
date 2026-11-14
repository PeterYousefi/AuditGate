import re
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from app.database.mongodb import get_collection

logger = logging.getLogger(__name__)

ORDERS_COLLECTION = "orders"

DEFAULT_SEEDED_ORDERS = [
    {
        "order_id": "ORD-1042",
        "customer_id": "customer_01",
        "email": "alex@example.com",
        "item": "Ceramic Pour-Over Set",
        "amount": 28.00,
        "currency": "USD",
        "status": "DELIVERED",
        "delivered_at": "2026-11-10T14:30:00Z"
    },
    {
        "order_id": "ORD-1089",
        "customer_id": "customer_01",
        "email": "alex@example.com",
        "item": "Merino Wool Throw",
        "amount": 250.00,
        "currency": "USD",
        "status": "DELIVERED",
        "delivered_at": "2026-11-12T16:45:00Z"
    },
    {
        "order_id": "ORD-2055",
        "customer_id": "customer_02",
        "email": "sarah@example.com",
        "item": "Espresso Grinder",
        "amount": 140.00,
        "currency": "USD",
        "status": "DELIVERED",
        "delivered_at": "2026-11-13T11:20:00Z"
    },
    {
        "order_id": "ORD-3010",
        "customer_id": "customer_01",
        "email": "alex@example.com",
        "item": "Linen Bedding Bundle",
        "amount": 310.00,
        "currency": "USD",
        "status": "ALREADY_REFUNDED",
        "delivered_at": "2026-11-05T09:15:00Z"
    }
]


def seed_default_orders_if_missing() -> None:
    """
    Seeds and synchronizes realistic demo orders in MongoDB Atlas 'orders' collection.
    Uses $set to ensure fields (including email, item, amount, and status) are up-to-date.
    """
    col = get_collection(ORDERS_COLLECTION)
    for order in DEFAULT_SEEDED_ORDERS:
        col.update_one(
            {"order_id": order["order_id"]},
            {"$set": order},
            upsert=True
        )
    logger.info("MongoDB Atlas 'orders' collection verified and synchronized with 4 demo orders.")


def normalize_order_id(order_id: Optional[str]) -> Optional[str]:
    """
    Normalizes an order identifier (strips '#', uppercases, prefixes 'ORD-' if purely numeric).
    """
    if not order_id:
        return None
    cleaned = order_id.strip().lstrip("#").upper()
    if cleaned.isdigit():
        return f"ORD-{cleaned}"
    if not cleaned.startswith("ORD-") and cleaned.startswith("ORD"):
        return f"ORD-{cleaned[3:].lstrip('-')}"
    return cleaned


def get_order_by_id(order_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetches an order document by order_id (case-insensitive and resilient to '#' prefix).
    """
    clean_id = normalize_order_id(order_id)
    if not clean_id:
        return None
    col = get_collection(ORDERS_COLLECTION)
    
    order = col.find_one({"order_id": clean_id})
    if not order:
        order = col.find_one({"order_id": {"$regex": f"^{re.escape(clean_id)}$", "$options": "i"}})
    return order


def get_order_by_id_and_email(order_id: str, email: str) -> Optional[Dict[str, Any]]:
    """
    Strict Verification Gate: Verifies that an order exists AND belongs to the customer's email.
    Both order_id and email are matched case-insensitively.
    """
    clean_id = normalize_order_id(order_id)
    if not clean_id or not email:
        return None
    
    clean_email = email.strip().lower()
    col = get_collection(ORDERS_COLLECTION)

    # First attempt: exact normalized order_id and case-insensitive email regex
    order = col.find_one({
        "order_id": {"$regex": f"^{re.escape(clean_id)}$", "$options": "i"},
        "email": {"$regex": f"^{re.escape(clean_email)}$", "$options": "i"}
    })
    return order


def update_order_status(order_id: str, new_status: str = "REFUNDED") -> bool:
    """
    Updates the status of an order in MongoDB Atlas (e.g. from DELIVERED to REFUNDED).
    """
    clean_id = normalize_order_id(order_id)
    if not clean_id:
        return False
    col = get_collection(ORDERS_COLLECTION)
    res = col.update_one(
        {"order_id": {"$regex": f"^{re.escape(clean_id)}$", "$options": "i"}},
        {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return res.modified_count > 0 or res.matched_count > 0


def list_all_demo_orders() -> List[Dict[str, Any]]:
    """
    Lists all demo orders from MongoDB Atlas for the presenter cheat-sheet modal.
    """
    col = get_collection(ORDERS_COLLECTION)
    orders = list(col.find({}, {"_id": 0}).sort("order_id", 1))
    return orders


def list_customer_orders(customer_id: str = "customer_01") -> List[Dict[str, Any]]:
    """
    Lists all orders for a customer from MongoDB Atlas.
    """
    col = get_collection(ORDERS_COLLECTION)
    orders = list(col.find({"customer_id": customer_id}, {"_id": 0}))
    if not orders:
        orders = list(col.find({}, {"_id": 0}).limit(10))
    return orders
