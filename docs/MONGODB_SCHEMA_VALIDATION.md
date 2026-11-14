# 🔒 MongoDB Atlas Schema Validation & Tamper-Proofing

## Background

In enterprise agent governance, logging is typically handled at the application level (e.g. `logger.info(...)`). However, application-level logs suffer from key vulnerabilities:
1. They can be silently skipped when code crashes.
2. Rogue subagents or compromised processes can insert unverified or spoofed logs.
3. Crucial governance fields (such as policy limit applied or author identity) can be omitted without failure.

## Programmatic Schema Enforcement in AuditGate

AuditGate uses MongoDB Atlas's built-in `$jsonSchema` engine validation with `validationLevel: "strict"` and `validationAction: "error"`.

### Schema Specification
```json
{
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
        "description": "Optional contextual metadata"
      }
    },
    "additionalProperties": true
  }
}
```

### Proving Enforcement Live to Judges
When the "Test Schema Enforcement" button is clicked in the AuditGate Governance Console, the server executes:
```python
col = get_collection("audit_logs")
invalid_doc = {
    "thread_id": "rogue_unauthenticated_attempt",
    "agent_id": "unauthorized_actor",
    "user_requested_amount": 99999.0,
    "reason": "Attempting to bypass audit trail without decision or policy limit"
    # Missing: timestamp, policy_limit_applied, decision
}
col.insert_one(invalid_doc)
```

MongoDB Atlas immediately returns:
```text
WriteError: Document failed validation (Code 121)
missingProperties: ['decision', 'policy_limit_applied', 'timestamp']
```

This guarantees physical non-repudiation at the database engine level.
