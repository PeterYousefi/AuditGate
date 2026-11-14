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
        "item": "Ceramic Pour-Over Coffee Dripper",
        "amount": 28.00,
        "currency": "USD",
        "status": "DELIVERED",
        "delivered_at": "2026-11-10T14:30:00Z"
    },
    {
        "order_id": "ORD-1089",
        "customer_id": "customer_01",
        "item": "Merino Wool Waffle Throw Blanket",
        "amount": 250.00,
        "currency": "USD",
        "status": "DELIVERED",
        "delivered_at": "2026-11-12T16:45:00Z"
    },
    {
        "order_id": "ORD-2055",
        "customer_id": "customer_01",
        "item": "Cast Iron Dutch Oven 5.5 Qt",
        "amount": 75.00,
        "currency": "USD",
        "status": "DELIVERED",
        "delivered_at": "2026-11-13T11:20:00Z"
    }
]


def seed_default_orders_if_missing() -> None:
    """
    Seeds realistic demo orders in MongoDB Atlas 'orders' collection if missing.
    """
    col = get_collection(ORDERS_COLLECTION)
    for order in DEFAULT_SEEDED_ORDERS:
        col.update_one(
            {"order_id": order["order_id"]},
            {"$setOnInsert": order},
            upsert=True
        )
    logger.info("MongoDB Atlas 'orders' collection verified and seeded.")


def get_order_by_id(order_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetches an order document by order_id (case-insensitive and resilient to '#' prefix).
    """
    if not order_id:
        return None
    clean_id = order_id.strip().lstrip("#").upper()
    col = get_collection(ORDERS_COLLECTION)
    
    # Try exact match, then with ORD- prefix
    order = col.find_one({"order_id": clean_id})
    if not order and not clean_id.startswith("ORD-"):
        order = col.find_one({"order_id": f"ORD-{clean_id}"})
    if not order:
        order = col.find_one({"order_id": {"$regex": f"^{clean_id}$", "$options": "i"}})
    return order


def list_customer_orders(customer_id: str = "customer_01") -> List[Dict[str, Any]]:
    """
    Lists all orders for a customer from MongoDB Atlas.
    """
    col = get_collection(ORDERS_COLLECTION)
    orders = list(col.find({"customer_id": customer_id}, {"_id": 0}))
    if not orders:
        orders = list(col.find({}, {"_id": 0}).limit(10))
    return orders
