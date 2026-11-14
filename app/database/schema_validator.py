import logging
from typing import Dict, Any
from pymongo.errors import OperationFailure
from app.database.mongodb import get_database

logger = logging.getLogger(__name__)

# -------------------------------------------------------------
# MongoDB 9.0 Strict $jsonSchema Definitions with schemaVersion
# -------------------------------------------------------------

AUDIT_LOG_SCHEMA: Dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": [
            "timestamp",
            "thread_id",
            "agent_id",
            "user_requested_amount",
            "policy_limit_applied",
            "decision",
            "reason"
        ],
        "properties": {
            "schema_version": {
                "bsonType": "int",
                "description": "Schema version indicator"
            },
            "timestamp": {
                "bsonType": ["date", "string"],
                "description": "Timestamp when the governance decision was evaluated"
            },
            "thread_id": {
                "bsonType": "string",
                "description": "Unique session or LangGraph conversation thread identifier"
            },
            "agent_id": {
                "bsonType": "string",
                "description": "Unique identifier of the agent executing the action"
            },
            "user_requested_amount": {
                "bsonType": ["double", "int", "long", "decimal"],
                "minimum": 0,
                "description": "Requested refund amount in USD"
            },
            "policy_limit_applied": {
                "bsonType": ["double", "int", "long", "decimal"],
                "minimum": 0,
                "description": "Policy threshold fetched live from MongoDB at decision time"
            },
            "decision": {
                "enum": [
                    "AUTO_APPROVED",
                    "PENDING_APPROVAL",
                    "HUMAN_APPROVED",
                    "HUMAN_REJECTED",
                    "BLOCKED_BY_SCHEMA",
                    "SECURITY_BLOCK",
                    "VERIFICATION_FAILED",
                    "REJECTED_DUPLICATE",
                    "REJECTED_AMOUNT_MISMATCH",
                    "ESCALATED_TO_HUMAN"
                ],
                "description": "Strictly audited governance verdict"
            },
            "reason": {
                "bsonType": "string",
                "description": "Detailed explanation or audit justification for the verdict"
            },
            "metadata": {
                "bsonType": "object",
                "description": "Contextual metadata (e.g. LangSmith run IDs, order details)"
            }
        },
        "additionalProperties": True
    }
}

ORDERS_SCHEMA: Dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": ["order_id", "customer_id", "email", "item", "amount", "status"],
        "properties": {
            "schema_version": {
                "bsonType": "int"
            },
            "order_id": {
                "bsonType": "string",
                "pattern": "^[0-9]+$",
                "description": "Strictly numeric string order identifier (no # or ORD- prefix)"
            },
            "customer_id": {
                "bsonType": "string"
            },
            "email": {
                "bsonType": "string",
                "pattern": "^.+@.+\\..+$",
                "description": "Customer email address"
            },
            "item": {
                "bsonType": "string"
            },
            "amount": {
                "bsonType": ["double", "int", "long", "decimal"],
                "minimum": 0
            },
            "currency": {
                "bsonType": "string"
            },
            "status": {
                "enum": ["DELIVERED", "REFUNDED", "ALREADY_REFUNDED"],
                "description": "Order fulfillment / return status"
            }
        },
        "additionalProperties": True
    }
}

POLICIES_SCHEMA: Dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": ["agent_id", "max_auto_refund", "currency"],
        "properties": {
            "schema_version": {
                "bsonType": "int"
            },
            "agent_id": {
                "bsonType": "string"
            },
            "max_auto_refund": {
                "bsonType": ["double", "int", "long", "decimal"],
                "minimum": 0,
                "description": "Maximum automated refund limit in USD"
            },
            "currency": {
                "bsonType": "string"
            }
        },
        "additionalProperties": True
    }
}

REFUND_REQUESTS_SCHEMA: Dict[str, Any] = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": ["request_id", "thread_id", "customer_id", "order_id", "amount", "status"],
        "properties": {
            "schema_version": {
                "bsonType": "int"
            },
            "request_id": {
                "bsonType": "string"
            },
            "thread_id": {
                "bsonType": "string"
            },
            "customer_id": {
                "bsonType": "string"
            },
            "order_id": {
                "bsonType": "string"
            },
            "amount": {
                "bsonType": ["double", "int", "long", "decimal"],
                "minimum": 0
            },
            "status": {
                "enum": ["PENDING", "APPROVED", "REJECTED"],
                "description": "Human manager review status"
            }
        },
        "additionalProperties": True
    }
}


COLLECTION_SCHEMAS = {
    "audit_logs": AUDIT_LOG_SCHEMA,
    "orders": ORDERS_SCHEMA,
    "policies": POLICIES_SCHEMA,
    "refund_requests": REFUND_REQUESTS_SCHEMA
}


def apply_collection_schema(collection_name: str, schema: Dict[str, Any]) -> None:
    """
    Applies strict $jsonSchema validation with errorAndLog action on a specific collection.
    NEVER apply validators to 'checkpoints' or 'checkpoint_writes'.
    """
    db = get_database()
    existing_collections = db.list_collection_names()

    if collection_name not in existing_collections:
        logger.info(f"Creating '{collection_name}' collection with strict $jsonSchema validator...")
        db.create_collection(
            collection_name,
            validator=schema,
            validationLevel="strict",
            validationAction="error"
        )
        logger.info(f"Created '{collection_name}' with database-level schema validation.")
    else:
        try:
            db.command(
                "collMod",
                collection_name,
                validator=schema,
                validationLevel="strict",
                validationAction="error"
            )
            logger.info(f"Applied strict $jsonSchema to '{collection_name}' via collMod.")
        except OperationFailure as e:
            logger.warning(f"Notice on collMod for '{collection_name}': {e}")


def init_schema_validation() -> None:
    """
    Programmatically applies strict $jsonSchema validation across all 4 business collections:
    audit_logs, orders, policies, and refund_requests.
    Leaves LangGraph checkpoints and checkpoint_writes unvalidated.
    """
    for col_name, schema in COLLECTION_SCHEMAS.items():
        apply_collection_schema(col_name, schema)
