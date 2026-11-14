import asyncio
import logging
import threading
from datetime import datetime, timezone
from typing import Dict, Any, Optional

from langgraph.types import Command
from pymongo.collection import Collection

from app.database import get_collection
from app.agent.graph import build_auditgate_graph

logger = logging.getLogger(__name__)

REFUND_REQUESTS_COLLECTION = "refund_requests"

# Global reference to compiled graph singleton
_compiled_graph = None
# Set to track processed resumptions (prevents duplicate execution)
_processed_resumptions = set()


def get_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_auditgate_graph()
    return _compiled_graph


def resume_interrupted_thread(
    request_id: str,
    approved: bool,
    decided_by: str = "manager_ui",
    notes: Optional[str] = None
) -> Dict[str, Any]:
    """
    Resumes a paused LangGraph thread when a human manager approves or rejects a refund.
    Can be invoked via the UI button endpoints (/approve, /reject) OR automatically
    by the MongoDB Change Stream listener when a document is edited directly in MongoDB Atlas.
    """
    col = get_collection(REFUND_REQUESTS_COLLECTION)
    req_doc = col.find_one({"request_id": request_id})
    if not req_doc:
        raise ValueError(f"Refund request '{request_id}' not found in MongoDB Atlas.")

    thread_id = req_doc.get("thread_id")
    status_str = "APPROVED" if approved else "REJECTED"
    decision_type = "HUMAN_APPROVED" if approved else "HUMAN_REJECTED"
    now_iso = datetime.now(timezone.utc).isoformat()

    # Update MongoDB Atlas document
    col.update_one(
        {"request_id": request_id},
        {
            "$set": {
                "status": status_str,
                "decided_by": decided_by,
                "decision_at": now_iso,
                "manager_notes": notes or f"Processed via {decided_by}"
            }
        }
    )

    # Idempotency lock for thread resumption
    resume_key = f"{request_id}:{status_str}"
    if resume_key in _processed_resumptions:
        logger.info(f"Request '{request_id}' already resumed. Skipping duplicate graph trigger.")
        return {"request_id": request_id, "status": status_str, "thread_id": thread_id}

    _processed_resumptions.add(resume_key)

    # Resume the paused LangGraph workflow from its MongoDB Atlas checkpoint!
    graph = get_graph()
    config = {"configurable": {"thread_id": thread_id}}

    try:
        logger.info(f"Resuming LangGraph thread '{thread_id}' for request '{request_id}' with decision: {decision_type}...")
        resume_payload = {
            "approved": approved,
            "decision": decision_type,
            "decided_by": decided_by,
            "request_id": request_id
        }
        resumed_result = graph.invoke(Command(resume=resume_payload), config=config)
        logger.info(f"LangGraph thread '{thread_id}' resumed successfully. Final state status: {resumed_result.get('status')}")

        # Ensure history in MongoDB Atlas checkpoint includes the manager resolution
        try:
            final_resp = resumed_result.get("final_response")
            if final_resp:
                st = graph.get_state(config)
                hist = list(st.values.get("history") or [])
                if not hist or hist[-1].get("content") != final_resp:
                    hist.append({"role": "assistant", "content": final_resp})
                    graph.update_state(config, {"history": hist})
        except Exception as he:
            logger.warning(f"Notice updating history post-resumption: {he}")
        return {
            "request_id": request_id,
            "status": status_str,
            "thread_id": thread_id,
            "final_response": resumed_result.get("final_response"),
            "audio_base64": resumed_result.get("audio_base64")
        }
    except Exception as e:
        logger.error(f"Error resuming LangGraph thread '{thread_id}': {e}")
        return {
            "request_id": request_id,
            "status": status_str,
            "thread_id": thread_id,
            "error": str(e)
        }


def run_change_stream_listener_thread():
    """
    Background worker that monitors MongoDB Atlas 'refund_requests' collection via Change Streams.
    If a manager edits a document directly inside MongoDB Atlas from 'PENDING' to 'APPROVED' or 'REJECTED',
    the change stream immediately intercepts the change and resumes the paused LangGraph workflow!
    """
    logger.info("Starting background MongoDB Atlas Change Stream listener on 'refund_requests'...")
    col = get_collection(REFUND_REQUESTS_COLLECTION)

    pipeline = [
        {
            "$match": {
                "operationType": {"$in": ["update", "replace"]},
                "$or": [
                    {"updateDescription.updatedFields.status": {"$in": ["APPROVED", "REJECTED"]}},
                    {"fullDocument.status": {"$in": ["APPROVED", "REJECTED"]}}
                ]
            }
        }
    ]

    while True:
        try:
            with col.watch(pipeline=pipeline, full_document="updateLookup", max_await_time_ms=2000) as stream:
                for change in stream:
                    full_doc = change.get("fullDocument") or {}
                    request_id = full_doc.get("request_id")
                    status = full_doc.get("status")
                    decided_by = full_doc.get("decided_by") or "atlas_direct_edit"

                    if not request_id or not status:
                        continue

                    resume_key = f"{request_id}:{status}"
                    if resume_key in _processed_resumptions:
                        continue

                    logger.info(f"[MongoDB Change Stream Event] Detected direct Atlas update on '{request_id}' -> status={status}")
                    approved = status == "APPROVED"
                    resume_interrupted_thread(
                        request_id=request_id,
                        approved=approved,
                        decided_by=decided_by,
                        notes="Triggered by live MongoDB Atlas Change Stream listener"
                    )
        except Exception as e:
            logger.warning(f"Notice in Change Stream listener loop: {e}. Reconnecting in 3s...")
            asyncio.run(asyncio.sleep(3)) if asyncio.get_event_loop().is_running() else threading.Event().wait(3)


def start_change_stream_background_listener():
    """Starts the MongoDB Change Stream listener in a background daemon thread."""
    t = threading.Thread(target=run_change_stream_listener_thread, daemon=True, name="AtlasChangeStreamListener")
    t.start()
    return t
