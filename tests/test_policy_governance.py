import uuid
import pytest
from app.database.policy_service import (
    seed_default_policy_if_missing,
    get_live_policy,
    update_policy_limit
)
from app.database.orders_service import seed_default_orders_if_missing
from app.agent.tools import fetch_live_policy_limit
from app.agent.graph import build_auditgate_graph
from app.agent.hitl_manager import resume_interrupted_thread


def test_live_policy_obedience():
    """
    CRITICAL POLICY REQUIREMENT:
    Verifies that changing policy limit in MongoDB Atlas takes immediate effect
    on the agent without hardcoding or restarting.
    """
    seed_default_policy_if_missing()
    
    # 1. Update limit to $75.0 in MongoDB Atlas
    update_policy_limit(75.0, "agent_01")
    live_limit = fetch_live_policy_limit("agent_01")
    assert live_limit == 75.0, f"Expected live limit $75.0, got ${live_limit}"
    
    # 2. Reset limit back to $50.0 in MongoDB Atlas
    update_policy_limit(50.0, "agent_01")
    live_limit_reset = fetch_live_policy_limit("agent_01")
    assert live_limit_reset == 50.0, f"Expected reset limit $50.0, got ${live_limit_reset}"


def test_hitl_workflow_and_checkpoint_resumption():
    """
    Verifies that refund requests exceeding the policy threshold pause via LangGraph interrupt,
    save checkpoints to MongoDB Atlas, and resume upon manager decision.
    """
    seed_default_orders_if_missing()
    graph = build_auditgate_graph()
    thread_id = f"test_thread_{uuid.uuid4().hex[:6]}"
    config = {"configurable": {"thread_id": thread_id}}

    # Invoke with $250 refund on verified order 1089 (exceeds $50 limit)
    state_input = {
        "thread_id": thread_id,
        "customer_id": "test_cust_hitl",
        "user_message": "Please refund $250 for order 1089. Email: alex@example.com.",
        "intent": "",
        "requested_amount": None,
        "order_id": None,
        "email": None,
        "currency": "USD",
        "reason": None,
        "policy_limit_applied": None,
        "status": "INIT",
        "request_id": None,
        "final_response": None,
        "audio_base64": None,
        "history": []
    }

    res = graph.invoke(state_input, config=config)
    assert "__interrupt__" in res, "Graph should have paused execution at the HITL gate!"

    interrupt_data = res["__interrupt__"][0].value
    request_id = interrupt_data["request_id"]
    assert request_id.startswith("req_")

    # Resume the paused thread
    resumed = resume_interrupted_thread(request_id, approved=True, decided_by="pytest_suite")
    assert resumed["status"] == "APPROVED"
    assert "approved" in resumed["final_response"].lower()
