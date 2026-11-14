# 🏛️ AuditGate Architecture Deep Dive

## Overview

In traditional agent systems, policies and guardrails are either hardcoded into application source code or specified as soft instructions within system prompts. Both approaches fail under adversarial pressure:
1. **Prompt Injections:** Adversarial prompts can jailbreak the LLM into disregarding soft instructions.
2. **Hardcoded Logic:** Static Python code cannot adapt dynamically without code deploys or server restarts, creating brittle ops.
3. **Repudiable Audit Trails:** Application-level logging can be suppressed, edited, or bypassed by bugs or rogue actors.

**AuditGate solves this by making MongoDB Atlas the physical, deterministic governance kernel of the agent.**

---

## 1. Identity & Policy Layer (`policies` Collection)

Every agent possesses an authoritative identity profile within the `policies` collection:

```json
{
  "_id": "ObjectId(...)",
  "role": "support_agent",
  "agent_id": "agent_01",
  "max_auto_refund": 50.0,
  "currency": "USD",
  "updated_at": "2026-11-14T17:15:15.767932+00:00",
  "description": "Default customer support refund policy"
}
```

### Deterministic Guardrail Execution
Before the agent's tool layer can execute any financial operation:
1. The tool queries MongoDB Atlas `policies` live.
2. The current `max_auto_refund` is fetched directly from the database engine.
3. No local memory caching is used, ensuring that any modification made by compliance officers in Atlas takes effect instantaneously on subsequent invocations.

---

## 2. Human-in-the-Loop State Engine (LangGraph + MongoDBSaver)

AuditGate implements a stateful Human-in-the-Loop workflow:

```text
       User Request
            │
            ▼
    [analyze_request]
            │
    ┌───────┴───────┐
    ▼               ▼
Amount <= Limit   Amount > Limit
    │               │
    ▼               ▼
[execute_auto]   [escalate_hitl]
    │               │
    ▼               ▼
   END      LangGraph interrupt()
                    │
                    ▼
          Persisted to MongoDB
          'checkpoints' collection
                    │
         (Awaits Human Decision)
                    │
                    ▼
          MongoDB Change Stream
         Detects APPROVE/REJECT
                    │
                    ▼
        LangGraph Resumed with
        Command(resume={...})
                    │
                    ▼
                   END
```

### Resumption Paths:
1. **Governance UI Button:** The compliance officer clicks "Approve" or "Reject" on the web portal.
2. **Direct Atlas Update:** An administrator directly updates the `refund_requests` document in MongoDB Atlas Compass or Cloud UI. The background MongoDB Change Stream listener detects the event and resumes the paused thread automatically.

---

## 3. Tamper-Proof Audit Trail (MongoDB Engine $jsonSchema)

The `audit_logs` collection enforces an engine-level JSON Schema that physically rejects malformed or unauthenticated writes:

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
      "decision": {
        "enum": [
          "AUTO_APPROVED",
          "PENDING_APPROVAL",
          "HUMAN_APPROVED",
          "HUMAN_REJECTED",
          "BLOCKED_BY_SCHEMA"
        ]
      }
    }
  }
}
```

Any attempt to insert a log entry missing these fields triggers `WriteError: Document failed validation (Code 121)` directly from MongoDB Atlas.
