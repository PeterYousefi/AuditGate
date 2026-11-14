import re
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from app.database.mongodb import get_collection

logger = logging.getLogger(__name__)

ORDERS_COLLECTION = "orders"

# Strictly numeric string order IDs (NO '#' or 'ORD-' prefixes)
DEFAULT_SEEDED_ORDERS = [
    {
        "order_id": "1042",
        "customer_id": "customer_01",
        "email": "alex@example.com",
        "item": "Ceramic Pour-Over Set",
        "amount": 28.00,
        "currency": "USD",
        "status": "DELIVERED",
        "delivered_at": "2026-11-10T14:30:00Z"
    },
    {
        "order_id": "1089",
        "customer_id": "customer_01",
        "email": "alex@example.com",
        "item": "Merino Wool Throw",
        "amount": 250.00,
        "currency": "USD",
        "status": "DELIVERED",
        "delivered_at": "2026-11-12T16:45:00Z"
    },
    {
        "order_id": "2055",
        "customer_id": "customer_02",
        "email": "sarah@example.com",
        "item": "Espresso Grinder",
        "amount": 140.00,
        "currency": "USD",
        "status": "DELIVERED",
        "delivered_at": "2026-11-13T11:20:00Z"
    },
    {
        "order_id": "3010",
        "customer_id": "customer_01",
        "email": "alex@example.com",
        "item": "Linen Bedding Bundle",
        "amount": 310.00,
        "currency": "USD",
        "status": "ALREADY_REFUNDED",
        "delivered_at": "2026-11-05T09:15:00Z"
    }
]


def format_currency(amount: Optional[float]) -> str:
    """
    Smart Whole-Dollar Formatting (Python):
    Omit .00 whenever cents equal zero ($28, $250, $50, $500),
    and render two decimals only when non-zero cents exist ($28.50).
    """
    if amount is None:
        return "$0"
    val = float(amount)
    if val.is_integer() or val == int(val):
        return f"${int(val)}"
    return f"${val:.2f}"


def normalize_order_id(order_id: Optional[str]) -> Optional[str]:
    """
    Normalizes an order identifier to strictly numeric digits.
    Strips any '#', 'ORD-', or 'order ' prefixes and enforces digits-only.
    """
    if not order_id:
        return None
    s = str(order_id).strip().lstrip("#")
    s = re.sub(r"^(?:ORD-?|order\s*)", "", s, flags=re.IGNORECASE).strip()
    digits = re.findall(r"\d+", s)
    if digits:
        return digits[0]
    return s if s.isdigit() else None


def seed_default_orders_if_missing() -> None:
    """
    Seeds and synchronizes realistic demo orders with strictly numeric order IDs.
    Removes any stale 'ORD-' prefixed records from legacy runs.
    """
    col = get_collection(ORDERS_COLLECTION)

    # 1. Purge legacy ORD- prefixed records if present
    stale_res = col.delete_many({"order_id": {"$regex": "^ORD-", "$options": "i"}})
    if stale_res.deleted_count > 0:
        logger.info(f"Purged {stale_res.deleted_count} stale ORD- prefixed order documents.")

    # 2. Upsert purely numeric demo orders
    for order in DEFAULT_SEEDED_ORDERS:
        col.update_one(
            {"order_id": order["order_id"]},
            {"$set": order},
            upsert=True
        )
    logger.info("MongoDB Atlas 'orders' collection synchronized with strictly numeric demo orders.")


def get_order_by_id(order_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetches an order document by strictly numeric order_id.
    """
    clean_id = normalize_order_id(order_id)
    if not clean_id:
        return None
    col = get_collection(ORDERS_COLLECTION)
    order = col.find_one({"order_id": clean_id})
    return order


def get_order_by_id_and_email(order_id: str, email: str) -> Optional[Dict[str, Any]]:
    """
    Strict Verification Gate: Verifies that an order exists AND belongs to the customer's email.
    Order ID is normalized to numeric string; email is matched case-insensitively.
    """
    clean_id = normalize_order_id(order_id)
    if not clean_id or not email:
        return None
    
    clean_email = email.strip().lower()
    col = get_collection(ORDERS_COLLECTION)

    order = col.find_one({
        "order_id": clean_id,
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
        {"order_id": clean_id},
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
