import logging
from typing import Dict, Any
from pymongo.errors import OperationFailure
from app.database.mongodb import get_database

logger = logging.getLogger(__name__)

AUDIT_LOGS_COLLECTION = "audit_logs"

# Strict JSON Schema enforced at the MongoDB database engine level
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
                    "BLOCKED_BY_SCHEMA"
                ],
                "description": "Strictly audited governance verdict"
            },
            "reason": {
                "bsonType": "string",
                "description": "Detailed explanation or audit justification for the verdict"
            },
            "metadata": {
                "bsonType": "object",
                "description": "Optional contextual metadata (e.g. human manager ID, prompt hash)"
            }
        },
        "additionalProperties": True
    }
}


def init_schema_validation() -> None:
    """
    Programmatically creates or updates the audit_logs collection with
    strict $jsonSchema validation so MongoDB Atlas physically rejects
    any malformed or unauthenticated writes.
    """
    db = get_database()
    existing_collections = db.list_collection_names()

    if AUDIT_LOGS_COLLECTION not in existing_collections:
        logger.info(f"Creating '{AUDIT_LOGS_COLLECTION}' collection with strict $jsonSchema validator...")
        db.create_collection(
            AUDIT_LOGS_COLLECTION,
            validator=AUDIT_LOG_SCHEMA,
            validationLevel="strict",
            validationAction="error"
        )
        logger.info(f"Successfully created '{AUDIT_LOGS_COLLECTION}' with database-level schema validation.")
    else:
        logger.info(f"Applying strict $jsonSchema validator to existing '{AUDIT_LOGS_COLLECTION}' collection...")
        try:
            db.command(
                "collMod",
                AUDIT_LOGS_COLLECTION,
                validator=AUDIT_LOG_SCHEMA,
                validationLevel="strict",
                validationAction="error"
            )
            logger.info(f"Successfully updated '{AUDIT_LOGS_COLLECTION}' collection schema validator via collMod.")
        except OperationFailure as e:
            logger.warning(f"Notice on collMod for '{AUDIT_LOGS_COLLECTION}': {e}")
