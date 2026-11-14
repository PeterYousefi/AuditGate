# 🤖 LangGraph Human-in-the-Loop & MongoDB Atlas Checkpointing

## How LangGraph State Checkpointing Works

AuditGate leverages `langgraph` paired with `langgraph-checkpoint-mongodb`:

```python
from langgraph.checkpoint.mongodb import MongoDBSaver
from pymongo import MongoClient

client = MongoClient(settings.MONGODB_URI, tlsCAFile=certifi.where())
checkpointer = MongoDBSaver(client, db_name="auditable_agent")
graph = workflow.compile(checkpointer=checkpointer)
```

## The Human-in-the-Loop Interrupt Pattern

When a refund amount exceeds the live policy limit fetched from MongoDB Atlas:
1. The agent invokes `interrupt()`:
   ```python
   human_decision = interrupt({
       "action": "MANAGER_REVIEW_REQUIRED",
       "request_id": request_id,
       "amount": amount,
       "limit": limit,
       "thread_id": thread_id
   })
   ```
2. LangGraph immediately serializes and persists the execution state into the MongoDB Atlas `checkpoints` and `checkpoint_writes` collections.
3. Execution pauses safely without blocking thread pools or holding open long-lived HTTP connections.

## Resuming the Graph

When human approval is received:
```python
from langgraph.types import Command

graph.invoke(
    Command(resume={
        "approved": True,
        "decision": "HUMAN_APPROVED",
        "decided_by": "manager_ui",
        "request_id": request_id
    }),
    config={"configurable": {"thread_id": thread_id}}
)
```

LangGraph deserializes the checkpoint directly from MongoDB Atlas, restores node state, applies the approval decision, generates the completion voice response, logs to `audit_logs`, and transitions to `END`.
